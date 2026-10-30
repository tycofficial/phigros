'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const filename = path.resolve('js/hosted-media.js');
const source = fs.readFileSync(filename, 'utf8');
const context = vm.createContext({
  PhiHostedManifest: {audio: {}, artwork: {}},
  navigator: {},
  performance: {now: () => 0},
  location: {origin: 'https://example.test', protocol: 'https:', href: 'https://example.test/'},
  document: {baseURI: 'https://example.test/'},
  window: {addEventListener() {}},
  URL,
});
vm.runInContext(source, context, {filename});
const select = context.PhiHostedMedia.selectAudio;
const OGG = 'audio/ogg; codecs="vorbis"';
const OPUS = 'audio/ogg; codecs="opus"';
const AAC = 'audio/mp4';
const ogg = {url: 'https://example.test/original.ogg', bytes: 5000000, sha256: 'original-hash', mime: OGG};
const fallback = {url: 'https://example.test/compat.m4a', bytes: 600000, sha256: 'fallback-hash', mime: AAC};
const spec = {...ogg, duration: 160, original: ogg.url, remote: true, lowFallback: fallback};
const snapshot = JSON.stringify(spec);
const audio = (...accepted) => ({canPlayType: mime => accepted.includes(mime) ? 'probably' : ''});
test('OGG-capable browsers preserve the original URL, hash and quality', () => {
  for (const forceLow of [false, true]) {
    const chosen = select(spec, audio(OGG, AAC), forceLow);
    assert.equal(chosen.url, ogg.url);
    assert.equal(chosen.sha256, ogg.sha256);
    assert.equal(chosen.quality, 'high');
  }
});
test('AAC-capable old Safari selects the compatible derivative', () => {
  const chosen = select(spec, audio(AAC));
  assert.equal(chosen.url, fallback.url);
  assert.equal(chosen.bytes, fallback.bytes);
  assert.equal(chosen.sha256, fallback.sha256);
  assert.equal(chosen.mime, AAC);
  assert.equal(chosen.quality, 'low');
  assert.equal(chosen.formatLabel, '联网兼容 AAC');
});
test('Compatibility selection preserves the OGG export source and duration', () => {
  const chosen = select(spec, audio(AAC));
  assert.equal(chosen.original, ogg.url);
  assert.equal(chosen.duration, spec.duration);
});
test('Selecting AAC never mutates either manifest variant', () => {
  select(spec, audio(AAC));
  assert.equal(JSON.stringify(spec), snapshot);
});
test('No supported codec produces an actionable error', () => {
  assert.throws(() => select(spec, audio()), /不支持/);
});
test('A missing AAC derivative keeps unsupported OGG from being selected', () => {
  const {lowFallback, ...withoutFallback} = spec;
  assert.throws(() => select(withoutFallback, audio(AAC)), /不支持/);
});
test('A missing codec capability API does not assume AAC support', () => {
  assert.throws(() => select(spec, {}), /不支持/);
});
test('Existing local tracks without variants preserve their behavior', () => {
  const local = {url: './local.m4a', original: './local.ogg', bytes: 800000};
  const chosen = select(local, audio());
  assert.equal(chosen.url, local.url);
  assert.equal(chosen.mime, AAC);
  assert.equal(chosen.quality, 'high');
});
test('Existing local Opus/AAC low variants retain codec selection', () => {
  const local = {...ogg, remote: false, high: ogg, low: {url: './low.ogg', mime: OPUS}, lowFallback: fallback};
  assert.equal(select(local, audio(OPUS, AAC)).url, './low.ogg');
  assert.equal(select(local, audio(AAC)).url, fallback.url);
});
test('Existing fast-network original quality remains selectable', () => {
  context.navigator.connection = {downlink: 10, rtt: 20};
  const local = {...ogg, remote: false, high: ogg, low: {url: './low.ogg', mime: OPUS}, lowFallback: fallback};
  assert.equal(select(local, audio(OGG, OPUS, AAC)).url, ogg.url);
});
