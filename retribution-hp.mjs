/** Historical modified 3.0.0.1 HP decisions only. See RETRIBUTION-EVIDENCE.md. */
export const RETRIBUTION = Object.freeze({
  phase1Start: 101.68419647216797,
  phase2Start: 40.421051025390625,
  phase2Lock: 101.68419647216797,
  noteAffect: 0.025956284153,
  phase1: Object.freeze({
    EZ: Object.freeze({ beginHP: 0.9, timeAffect: 0.001628459272, basicNoteAffect: 0.012 }),
    HD: Object.freeze({ beginHP: 0.7, timeAffect: 0.001835141443, basicNoteAffect: 0.013 }),
    IN: Object.freeze({ beginHP: 0.6, timeAffect: 0.002103500983, basicNoteAffect: 0.015 }),
  }),
  phase2: Object.freeze({
    EZ: Object.freeze({ beginHP: 1, timeAffect: 0.000284977021, Miss: -0.03, Bad: -0.03, Good: 0.0024, Perfect: 0.0048 }),
    HD: Object.freeze({ beginHP: 1, timeAffect: 0.000576304506, Miss: -0.04, Bad: -0.04, Good: 0.0026, Perfect: 0.0052 }),
    IN: Object.freeze({ beginHP: 1, timeAffect: 0.000897002881, Miss: -0.06, Bad: -0.06, Good: 0.003, Perfect: 0.006 }),
  }),
});

function finite(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new TypeError('Expected finite number');
  return value;
}
function inputs(phase, difficulty, time) {
  if (phase !== 1 && phase !== 2) throw new RangeError('Phase must be 1 or 2');
  const configurations = RETRIBUTION[`phase${phase}`];
  if (!Object.hasOwn(configurations, difficulty)) throw new RangeError('Only historical EZ, HD, IN are verified');
  const config = configurations[difficulty];
  const now = Math.fround(finite(time));
  finite(now);
  // Native fadd s-register first, then fcvt to double for HP arithmetic.
  const elapsed = Math.fround(now - RETRIBUTION[phase === 1 ? 'phase1Start' : 'phase2Start']);
  return { config, now, elapsed };
}

/** Mirrors OnJudge's HP delta, assuming its dead guard has not fired. */
export function retributionNoteDelta(phase, difficulty, time, kind, dead = false) {
  const { config, elapsed } = inputs(phase, difficulty, time);
  if (!['Miss', 'Bad', 'Good', 'Perfect'].includes(kind)) throw new RangeError('Unknown judgement');
  if (dead || elapsed < 0) return 0;
  if (phase === 2) return config[kind]; // The native callback has no locked guard.
  const scale = { Miss: -1, Bad: -1, Good: 0.2, Perfect: 0.4 }[kind];
  return (config.basicNoteAffect * Math.max(1 - RETRIBUTION.noteAffect * elapsed, 0)) * scale;
}

/**
 * One HP/lock decision for a caller-owned accumulated note delta.
 * Persist adjustedTotal after an HP sample: excess HP is removed from the
 * accumulated note term. Preserve the caller's existing death latch.
 * A lock result means native Update skipped its HP/death block that frame.
 */
export function sampleRetributionHP(phase, difficulty, time, totalNoteAffect) {
  const { config, now, elapsed } = inputs(phase, difficulty, time);
  finite(totalNoteAffect);
  if (elapsed < 0) return Object.freeze({ branch: 'before-start', elapsed, deathCheck: false });
  if (phase === 2 && now > RETRIBUTION.phase2Lock)
    return Object.freeze({ branch: 'lock', elapsed, deathCheck: false });
  const loss = ((config.timeAffect * -0.5) * elapsed) * elapsed;
  const rawHP = totalNoteAffect + (config.beginHP + loss);
  const adjustedTotal = rawHP > 1 ? totalNoteAffect - (rawHP - 1) : totalNoteAffect;
  return Object.freeze({
    branch: 'hp', elapsed, rawHP, cappedHP: Math.min(rawHP, 1),
    adjustedTotal, deathCheck: true, wouldDie: rawHP <= 0,
  });
}
