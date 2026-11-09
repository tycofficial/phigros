'use strict';
// Exercises the shipped storage helpers against real Chromium IndexedDB.
// Every case uses a new browser context and a test-only origin: existing user
// libraries, scores and settings are never opened or deleted.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const source = fs.readFileSync('js/app.js', 'utf8');
function sourceBetween(start, end) {
  const a = source.indexOf(start), b = source.indexOf(end, a);
  assert(a >= 0 && b > a, `storage helper boundaries: ${start}`);
  return source.slice(a, b);
}
const helpers = sourceBetween('  function idbWrite(storeName, operation)', '  async function retryPersistentOperation') +
  sourceBetween('  function idbWriteMany(storeNames, operation)', '  async function dbGetChart');

async function withDatabase(run) {
  const browser = await chromium.launch({
    executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium',
    headless: true, args: ['--no-sandbox']
  });
  try {
    const page = await browser.newPage();
    await page.route('http://phi-storage.test/**', route => route.fulfill({
      contentType: 'text/html', body: '<!doctype html><title>isolated storage regression</title>'
    }));
    await page.goto('http://phi-storage.test/');
    await page.evaluate(async helpers => {
      window.Diagnostics = { warn() {} };
      window.db = await new Promise((resolve, reject) => {
        const r = indexedDB.open('isolated-import-regression', 1);
        r.onupgradeneeded = () => {
          r.result.createObjectStore('charts', { keyPath: 'id' });
          r.result.createObjectStore('chartIndex', { keyPath: 'id' });
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
      (0, eval)(helpers);
      await idbWriteMany(['charts', 'chartIndex'], transaction => {
        transaction.objectStore('charts').put({ id: 'existing', chartText: 'original', importedAt: 7 });
        transaction.objectStore('chartIndex').put({ id: 'existing', name: 'original', importedAt: 7 });
      });
      window.readAll = () => Promise.all(['charts', 'chartIndex'].map(name => new Promise((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
      })));
    }, helpers);
    return await run(page);
  } finally { await browser.close(); }
}
const original = [[{ id: 'existing', chartText: 'original', importedAt: 7 }], [{ id: 'existing', name: 'original', importedAt: 7 }]];

test('a synchronous multi-store import failure rolls back queued charts and preserves the original library', async () => {
  const result = await withDatabase(page => page.evaluate(async () => {
    let error;
    try {
      await idbWriteMany(['charts', 'chartIndex'], transaction => {
        const charts = transaction.objectStore('charts'), index = transaction.objectStore('chartIndex');
        charts.put({ id: 'existing', chartText: 'replacement' });
        index.put({ id: 'existing', name: 'replacement' });
        charts.put({ id: 'new-valid', chartText: 'valid' });
        charts.put({ id: 'new-uncloneable', chartText: 'invalid', uncloneable() {} });
      });
    } catch (e) { error = e.name; }
    return { error, records: await readAll() };
  }));
  assert.equal(result.error, 'DataCloneError');
  assert.deepEqual(result.records, original);
});

test('a synchronous single-store callback failure rolls back already queued writes', async () => {
  const result = await withDatabase(page => page.evaluate(async () => {
    let error;
    try {
      await idbWrite('charts', store => {
        store.put({ id: 'existing', chartText: 'replacement' });
        return store.put({ id: 'invalid', uncloneable() {} });
      });
    } catch (e) { error = e.name; }
    return { error, records: await readAll() };
  }));
  assert.equal(result.error, 'DataCloneError');
  assert.deepEqual(result.records, original);
});

test('an asynchronous constraint failure aborts the entire transaction and rejects the write', async () => {
  const result = await withDatabase(page => page.evaluate(async () => {
    let error;
    try {
      await idbWriteMany(['charts', 'chartIndex'], transaction => {
        transaction.objectStore('charts').put({ id: 'new-valid', chartText: 'valid' });
        transaction.objectStore('chartIndex').add({ id: 'existing', name: 'duplicate' });
      });
    } catch (e) { error = e.name; }
    return { error, records: await readAll() };
  }));
  assert.ok(result.error, 'the failed transaction must reject');
  assert.deepEqual(result.records, original);
});

test('successful chart/index writes resolve after commit and remain readable after reopening', async () => {
  const result = await withDatabase(page => page.evaluate(async () => {
    let committed = false;
    const id = await idbWriteMany(['charts', 'chartIndex'], transaction => {
      transaction.addEventListener('complete', () => { committed = true; });
      transaction.objectStore('charts').put({ id: 'new', chartText: 'persisted' });
      transaction.objectStore('chartIndex').put({ id: 'new', name: 'persisted' });
      return 'new';
    });
    const committedAtResolve = committed;
    db.close();
    db = await new Promise((resolve, reject) => {
      const r = indexedDB.open('isolated-import-regression', 1);
      r.onsuccess = () => resolve(r.result); r.onerror = () => reject(r.error);
    });
    const single = await idbWrite('charts', store => store.put({ id: 'single', chartText: 'committed' }));
    return { id, single, committedAtResolve, records: await readAll() };
  }));
  assert.equal(result.id, 'new');
  assert.equal(result.single, 'single');
  assert.equal(result.committedAtResolve, true);
  assert.equal(result.records[0].length, 3);
  assert.equal(result.records[1].length, 2);
  assert.equal(result.records[0].find(record => record.id === 'existing').chartText, 'original');
});
