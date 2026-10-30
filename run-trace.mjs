import { readFile } from 'node:fs/promises';
import { HistoricalLuminescence } from './luminescence.mjs';

const trace = JSON.parse(await readFile(process.argv[2] || new URL('./traces/success.json', import.meta.url), 'utf8'));
const replay = new HistoricalLuminescence(trace.difficulty);
console.log('Historical 3.0.0.1 modified-archive control study; no scene or save unlock.');
for (const step of trace.steps) {
  let events;
  if (step.call === 'update') events = replay.update(step.time, step.rawScore);
  else if (step.call === 'judge') { replay.judge(step.kind); events = []; }
  else throw new Error(`Unknown trace call: ${step.call}`);
  console.log(JSON.stringify({ call: step, events, state: replay.snapshot() }));
}
