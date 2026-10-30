import test from 'node:test';
import assert from 'node:assert/strict';
import { RETRIBUTION as R, retributionNoteDelta as delta, sampleRetributionHP as sample } from '../retribution-hp.mjs';

function nextFloat(value, direction) {
  const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, value);
  d.setUint32(0, d.getUint32(0) + direction); return d.getFloat32(0);
}

test('phase 1 starts at recovered per-difficulty HP and uses its own judgement scales', () => {
  for (const [difficulty, hp, basic] of [['EZ', 0.9, 0.012], ['HD', 0.7, 0.013], ['IN', 0.6, 0.015]]) {
    assert.equal(sample(1, difficulty, R.phase1Start, 0).rawHP, hp);
    assert.equal(delta(1, difficulty, R.phase1Start, 'Miss'), -basic);
    assert.equal(delta(1, difficulty, R.phase1Start, 'Bad'), -basic);
    assert.equal(delta(1, difficulty, R.phase1Start, 'Good'), basic * 0.2);
    assert.equal(delta(1, difficulty, R.phase1Start, 'Perfect'), basic * 0.4);
  }
});

test('judgements before the exact start or after death do not affect HP', () => {
  for (const phase of [1, 2]) {
    const start = phase === 1 ? R.phase1Start : R.phase2Start;
    assert.equal(delta(phase, 'IN', nextFloat(start, -1), 'Miss'), 0);
    assert.equal(delta(phase, 'IN', start, 'Miss', true), 0);
    assert.notEqual(delta(phase, 'IN', start, 'Miss'), 0);
  }
});

test('phase 1 note impact fades to zero and has no end-time success branch', () => {
  assert.ok(delta(1, 'IN', 141, 'Miss') === 0); // native multiply can retain -0
  assert.equal(delta(1, 'IN', 160, 'Perfect'), 0);
  const late = sample(1, 'IN', 160, 0);
  assert.equal(late.branch, 'hp');
  assert.equal(late.wouldDie, true);
});

test('HP excess is removed from accumulated recovery, preventing a hidden reserve', () => {
  const capped = sample(2, 'IN', R.phase2Start, 0.5);
  assert.equal(capped.rawHP, 1.5);
  assert.equal(capped.cappedHP, 1);
  assert.equal(capped.adjustedTotal, 0);
  assert.equal(sample(2, 'IN', R.phase2Start, capped.adjustedTotal).rawHP, 1);
});

test('phase 2 has distinct difficulty deltas, unrelated to generic HPProvider', () => {
  for (const [difficulty, miss, good, perfect] of [['EZ', -0.03, 0.0024, 0.0048], ['HD', -0.04, 0.0026, 0.0052], ['IN', -0.06, 0.003, 0.006]]) {
    assert.equal(delta(2, difficulty, R.phase2Start, 'Miss'), miss);
    assert.equal(delta(2, difficulty, R.phase2Start, 'Bad'), miss);
    assert.equal(delta(2, difficulty, R.phase2Start, 'Good'), good);
    assert.equal(delta(2, difficulty, R.phase2Start, 'Perfect'), perfect);
  }
});

test('phase 2 locks strictly after its threshold before any HP death check', () => {
  assert.equal(sample(2, 'IN', R.phase2Lock, -10).wouldDie, true);
  const crossed = sample(2, 'IN', nextFloat(R.phase2Lock, 1), -10);
  assert.equal(crossed.branch, 'lock');
  assert.equal(crossed.deathCheck, false);
  assert.equal('wouldDie' in crossed, false);
  // OnJudge itself still has no locked check; the enclosing runtime owns it.
  assert.equal(delta(2, 'IN', 110, 'Perfect'), 0.006);
});

test('death includes exact zero and rejects only the unsupported input domain', () => {
  assert.equal(sample(1, 'IN', R.phase1Start, -0.6).rawHP, 0);
  assert.equal(sample(1, 'IN', R.phase1Start, -0.6).wouldDie, true);
  assert.equal(sample(1, 'IN', R.phase1Start, -0.6 + Number.EPSILON).wouldDie, false);
  assert.throws(() => sample(1, '__proto__', 110, 0), /verified/);
  assert.throws(() => sample(2, 'IN', Infinity, 0), /finite/);
});
