import test from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG, HistoricalLuminescence } from '../luminescence.mjs';

function adjacent(value, direction) {
  const buffer = new ArrayBuffer(4);
  const view = new DataView(buffer);
  view.setFloat32(0, value);
  view.setUint32(0, view.getUint32(0) + direction);
  return view.getFloat32(0);
}
const types = events => events.map(x => x.type);

test('targets use the recovered single-precision multiplier, without rounding for UI', () => {
  const expected = { EZ: 684796.5, HD: 677965.5, IN: 784842.8125 };
  for (const [difficulty, target] of Object.entries(expected)) {
    assert.equal(new HistoricalLuminescence(difficulty).snapshot().targetScore, target);
    assert.equal(new HistoricalLuminescence(difficulty).snapshot().targetScore, target);
  }
  assert.throws(() => new HistoricalLuminescence('AT'), /verified/);
});

test('both judgement-window endpoints are inclusive, adjacent float32 values are outside', () => {
  for (const kind of ['Bad', 'Miss']) {
    for (const time of [CONFIG.eventStartTime, CONFIG.eventEndTime]) {
      const replay = new HistoricalLuminescence('IN');
      replay.update(time, 0); replay.judge(kind);
      assert.equal(replay.snapshot().stage1Failed, true, `${kind} at ${time}`);
    }
    for (const time of [adjacent(CONFIG.eventStartTime, -1), adjacent(CONFIG.eventEndTime, 1)]) {
      const replay = new HistoricalLuminescence('IN');
      replay.update(time, 0); replay.judge(kind);
      assert.equal(replay.snapshot().stage1Failed, false, `${kind} at ${time}`);
    }
  }
});

test('Good and Perfect callbacks leave the active event intact', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.update(90, 0);
  replay.judge('Good'); replay.judge('Perfect');
  assert.equal(replay.snapshot().stage1Failed, false);
});

test('callbacks use the most recent Update flag, not an invented judgement timestamp', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.judge('Miss');
  assert.equal(replay.snapshot().stage1Failed, false);
  replay.update(adjacent(CONFIG.eventStartTime, -1), 0);
  replay.judge('Bad');
  assert.equal(replay.snapshot().stage1Failed, false);
  replay.update(CONFIG.eventStartTime, 0);
  replay.judge('Bad');
  assert.equal(replay.snapshot().stage1Failed, true);
  const other = new HistoricalLuminescence('IN');
  other.update(CONFIG.eventEndTime, 0);
  other.update(adjacent(CONFIG.eventEndTime, 1), 0);
  other.judge('Miss');
  assert.equal(other.snapshot().stage1Failed, false);
});

test('score is sampled by the first Update at or beyond the score-check time', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.update(adjacent(CONFIG.scoreCheckTime, -1), 0);
  assert.equal(replay.snapshot().scoreCheckComplete, false);
  assert.equal(replay.update(CONFIG.scoreCheckTime, 784842.8125)[0].passed, true);
  replay.update(131, 0);
  assert.equal(replay.snapshot().stage2Failed, false);
});

test('a rounded display score cannot rescue a raw float32 score below the target', () => {
  const replay = new HistoricalLuminescence('IN');
  const below = adjacent(replay.snapshot().targetScore, -1);
  assert.equal(below, 784842.75);
  assert.equal(Math.round(below), Math.round(replay.snapshot().targetScore));
  const events = replay.update(CONFIG.scoreCheckTime, below);
  assert.equal(events[0].passed, false);
  assert.deepEqual(replay.update(151, 1000000), []);
  assert.equal(replay.snapshot().stage2Failed, true);
});

test('a late first Update uses its current score rather than an interpolated historical score', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.update(130, 0);
  assert.equal(replay.update(131, 900000)[0].passed, true);
});

test('effect thresholds are strict and fire once in native order', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.update(CONFIG.scoreCheckTime, 900000);
  assert.deepEqual(types(replay.update(130.5, 900000)), []);
  assert.deepEqual(types(replay.update(adjacent(130.5, 1), 900000)), ['shoot-up-play', 'hide-ui-coroutine-requested']);
  assert.deepEqual(types(replay.update(133, 900000)), []);
  assert.deepEqual(types(replay.update(adjacent(133, 1), 900000)), ['explode-play']);
  assert.deepEqual(types(replay.update(150, 900000)), []);
  assert.deepEqual(types(replay.update(adjacent(150, 1), 900000)), ['shoot-up-stop', 'explode-stop', 'pop-message-start', 'unlock-retribution-coroutine-requested']);
  assert.deepEqual(replay.update(155, 900000), []);
  assert.equal(replay.snapshot().timeTag, 3);
  assert.equal(replay.snapshot().unlockCoroutineRequested, true);
  assert.equal('retributionUnlocked' in replay.snapshot(), false);
});

test('one skipped-frame Update can enter all three consecutive effect blocks', () => {
  const replay = new HistoricalLuminescence('IN');
  assert.deepEqual(types(replay.update(151, 900000)), [
    'score-check', 'shoot-up-play', 'hide-ui-coroutine-requested', 'explode-play',
    'shoot-up-stop', 'explode-stop', 'pop-message-start', 'unlock-retribution-coroutine-requested',
  ]);
});

test('stage 1 failure prevents effects, but the independent score check still runs', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.update(90, 0); replay.judge('Miss');
  assert.deepEqual(types(replay.update(151, 1000000)), ['score-check']);
  assert.equal(replay.snapshot().stage1Failed, true);
  assert.equal(replay.snapshot().stage2Failed, false);
  assert.equal(replay.snapshot().timeTag, 0);
});

test('float32 inputs and invalid-call handling cannot corrupt a pending run', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.update(0.1, 0.1);
  assert.equal(replay.snapshot().time, Math.fround(0.1));
  const before = replay.snapshot();
  for (const [time, score] of [[NaN, 1], [1, Infinity], [1, 1e300], ['90', 1]])
    assert.throws(() => replay.update(time, score));
  assert.throws(() => replay.judge('Autoplay'));
  assert.deepEqual(replay.snapshot(), before);
});

test('seeking does not reset a native latch; a new run gets a new instance', () => {
  const replay = new HistoricalLuminescence('IN');
  replay.update(131, 0);
  replay.update(0, 1000000);
  assert.equal(replay.snapshot().stage2Failed, true);
  const fresh = new HistoricalLuminescence('IN').snapshot();
  assert.equal(fresh.scoreCheckComplete, false);
  assert.equal(fresh.stage2Failed, false);
  assert.equal(fresh.targetScore, 784842.8125);
});
