/**
 * Narrow, fresh-instance model of the recovered historical ARM64 component.
 * Source: third-party modified 3.0.0.1 archive, NOT verified current official 4.x.
 * This models control decisions only; it does not render the original scene,
 * calculate gameplay scores, run coroutines, or write an unlock/save.
 * See EVIDENCE.md for native addresses, inputs, provenance, and limits.
 */
export const CONFIG = Object.freeze({
  eventStartTime: 86.08699798583984,
  eventEndTime: 96.52100372314453,
  scoreCheckTime: 130.4340057373047,
  startEffectTime: 130.5,
  explosionTime: 133,
  stopTime: 150,
  baseTargets: Object.freeze({ EZ: 744344, HD: 736919, IN: 853090 }),
  scoreMultiplier: 0.9200000166893005,
});

function single(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value))
    throw new TypeError(`${label} must be a finite number`);
  const result = Math.fround(value);
  if (!Number.isFinite(result)) throw new RangeError(`${label} exceeds float32`);
  return result;
}

export class HistoricalLuminescence {
  #time = null;
  #rawScore = null;
  #eventActive = false;
  #stage1Failed = false;
  #stage2Failed = false;
  #scoreCheckComplete = false;
  #timeTag = 0;
  #targetScore;

  constructor(difficulty) {
    if (!Object.hasOwn(CONFIG.baseTargets, difficulty))
      throw new RangeError('Only historical EZ, HD, and IN targets are verified');
    this.difficulty = difficulty;
    // Native OnEnable loads the base field, multiplies in single precision,
    // then writes _targetScore. It does not multiply a previously scaled target.
    this.#targetScore = Math.fround(CONFIG.baseTargets[difficulty] * CONFIG.scoreMultiplier);
    Object.freeze(this);
  }

  snapshot() {
    return Object.freeze({
      difficulty: this.difficulty,
      time: this.#time,
      rawScore: this.#rawScore,
      targetScore: this.#targetScore,
      eventActive: this.#eventActive,
      stage1Failed: this.#stage1Failed,
      stage2Failed: this.#stage2Failed,
      scoreCheckComplete: this.#scoreCheckComplete,
      timeTag: this.#timeTag,
      unlockCoroutineRequested: this.#timeTag === 3,
    });
  }

  /**
   * Exactly one component Update call, using ProgressControl time and the
   * current ScoreControl._score. Both native fields are float32.
   * Calls and judgement callbacks must retain their original ordering.
   */
  update(time, rawScore) {
    const now = single(time, 'time');
    const score = single(rawScore, 'rawScore');
    this.#time = now;
    this.#rawScore = score;
    const events = [];

    // Update @ 0x2690620..0x2690648; this flag is cached for callbacks.
    this.#eventActive = now >= CONFIG.eventStartTime && now <= CONFIG.eventEndTime;

    // Update @ 0x269064c..0x2690688: first eligible Update only.
    if (now >= CONFIG.scoreCheckTime && !this.#scoreCheckComplete) {
      this.#stage2Failed = score < this.#targetScore;
      this.#scoreCheckComplete = true;
      events.push(Object.freeze({ type: 'score-check', passed: !this.#stage2Failed, score, target: this.#targetScore }));
    }

    // Update @ 0x269068c..0x26907b0: consecutive ifs, not else-if.
    // A single late Update can execute all three blocks in this order.
    if (!this.#stage1Failed && !this.#stage2Failed) {
      if (now > CONFIG.startEffectTime && this.#timeTag === 0) {
        events.push({ type: 'shoot-up-play' }, { type: 'hide-ui-coroutine-requested' });
        this.#timeTag = 1;
      }
      if (now > CONFIG.explosionTime && this.#timeTag === 1) {
        events.push({ type: 'explode-play' });
        this.#timeTag = 2;
      }
      if (now > CONFIG.stopTime && this.#timeTag === 2) {
        events.push(
          { type: 'shoot-up-stop' },
          { type: 'explode-stop' },
          { type: 'pop-message-start' },
          { type: 'unlock-retribution-coroutine-requested' },
        );
        this.#timeTag = 3;
      }
    }
    return Object.freeze(events.map(Object.freeze));
  }

  /**
   * A score component callback. It has no timestamp argument in the native
   * component and reads the eventActive flag from the most recent Update.
   */
  judge(kind) {
    if (!['Perfect', 'Good', 'Bad', 'Miss'].includes(kind))
      throw new RangeError('Unknown judgement');
    if ((kind === 'Bad' || kind === 'Miss') && this.#eventActive)
      this.#stage1Failed = true;
    return this.snapshot();
  }
}
