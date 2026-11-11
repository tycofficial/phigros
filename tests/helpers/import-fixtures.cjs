'use strict';
// Synthetic charts/audio for browser regressions; never shipped as game content.
function wave(index) {
  const samples = 32000, data = Buffer.alloc(44 + samples * 2); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) data.writeInt16LE(Math.round(80 * Math.sin(2 * Math.PI * (220 + index * 55) * n / 8000)), 44 + n * 2); return data;
}
function chart() { return JSON.stringify({ formatVersion: 3, offset: 0, judgeLineList: [{ bpm: 120, notesAbove: Array.from({ length: 4 }, (_, i) => ({ type: 1, time: 64 + i * 32, positionX: 0, holdTime: 0, speed: 1, floorPosition: 1 + i * .5 })), notesBelow: [], speedEvents: [{ startTime: 0, endTime: 10000, value: 1 }], judgeLineMoveEvents: [{ startTime: 0, endTime: 10000, start: .5, end: .5, start2: .5, end2: .5 }], judgeLineRotateEvents: [{ startTime: 0, endTime: 10000, start: 0, end: 0 }], judgeLineDisappearEvents: [{ startTime: 0, endTime: 10000, start: 1, end: 1 }] }] }); }
module.exports={wave,chart};
