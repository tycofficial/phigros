'use strict';
// Run from the repository root: node tests/library-migration-browser.cjs
// Uses the real app/parser/ZIP codec and isolated Chromium IndexedDB contexts.
// Synthetic charts/audio below are fixtures, never shipped as game content.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { chromium } = require('playwright');
const root = process.cwd();
const mime = { '.html': 'text/html', '.js': 'application/javascript', '.mjs': 'application/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.ogg': 'audio/ogg', '.m4a': 'audio/mp4' };
const server = http.createServer((req, res) => {
  const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
  if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
  fs.stat(file, (error, stat) => {
    if (error || !stat.isFile()) { res.writeHead(404).end(); return; }
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Content-Length': stat.size });
    fs.createReadStream(file).pipe(res);
  });
});

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true,
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const results = [];
  try {
    for (const scenario of ['missing-zip', 'invalid-chart', 'missing-declared-chart', 'malformed-settings', 'transaction-failure', 'success', 'direct-import', 'direct-partial-failure', 'direct-formats', 'direct-pez', 'direct-loose'].filter(scenario => !process.argv[2] || scenario === process.argv[2])) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 720 }, serviceWorkers: 'block' });
      try {
        const page = await context.newPage(), errors = [];
        page.on('pageerror', error => errors.push(error.message));
        if (process.env.PHI_TEST_APP_SOURCE) await page.route('**/js/app.js*', route => route.fulfill({
          contentType: 'application/javascript', body: fs.readFileSync(process.env.PHI_TEST_APP_SOURCE, 'utf8')
        }));
        await page.goto(base, { waitUntil: 'domcontentloaded' });
        await page.waitForFunction(() => window.PhiOfflineNext?.modules.StorageManager.mode() === 'persistent');
        const result = await page.evaluate(async scenario => {
          const modules = PhiOfflineNext.modules, storage = modules.StorageManager, exporter = modules.ExportManager;
          const getDB = () => new Promise((resolve, reject) => {
            const request = indexedDB.open('phi-offline-db');
            request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error);
          });
          const read = async () => {
            const database = await getDB();
            try { return await Promise.all(['charts', 'chartIndex', 'settings', 'scores'].map(store => new Promise((resolve, reject) => {
              const request = database.transaction(store).objectStore(store).getAll();
              request.onsuccess = () => resolve(request.result.map(record => ({ ...record,
                audioBlob: record.audioBlob ? `Blob:${record.audioBlob.size}` : record.audioBlob,
                bgBlob: record.bgBlob ? `Blob:${record.bgBlob.size}` : record.bgBlob
              }))); request.onerror = () => reject(request.error);
            }))); } finally { database.close(); }
          };
          const originalChart = { id: 'old-chart', name: 'original chart', chartText: 'original', sourceName: 'old.zip', parser: 'pgr', importedAt: 7 };
          await storage.dbPutChart(originalChart);
          await storage.dbPutSetting({ key: 'regression-setting', value: 'original' });
          const database = await getDB();
          await new Promise((resolve, reject) => {
            const transaction = database.transaction('scores', 'readwrite');
            transaction.objectStore('scores').put({ key: 'regression-score', score: 321, ranked: true });
            transaction.oncomplete = resolve; transaction.onabort = () => reject(transaction.error);
          });
          database.close();
          const before = await read();
          const chart = { formatVersion: 3, offset: 0, judgeLineList: [{ bpm: 120,
            notesAbove: [{ type: 1, time: 32, positionX: 0, holdTime: 0, speed: 1, floorPosition: .5 }], notesBelow: [],
            speedEvents: [{ startTime: 0, endTime: 128, value: 1 }],
            judgeLineMoveEvents: [{ startTime: 0, endTime: 128, start: .5, end: .5, start2: .5, end2: .5 }],
            judgeLineRotateEvents: [{ startTime: 0, endTime: 128, start: 0, end: 0 }],
            judgeLineDisappearEvents: [{ startTime: 0, endTime: 128, start: 1, end: 1 }] }] };
          const wav = new ArrayBuffer(44 + 8000 * 2), view = new DataView(wav);
          const text = (offset, value) => [...value].forEach((ch, index) => view.setUint8(offset + index, ch.charCodeAt(0)));
          text(0, 'RIFF'); view.setUint32(4, wav.byteLength - 8, true); text(8, 'WAVE'); text(12, 'fmt ');
          view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
          view.setUint32(24, 8000, true); view.setUint32(28, 16000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
          text(36, 'data'); view.setUint32(40, wav.byteLength - 44, true);
          const chartEntries = [
            { name: 'chart.json', blob: new Blob([scenario === 'invalid-chart' ? '{}' : JSON.stringify(chart)]) },
            { name: 'audio.wav', blob: new Blob([wav], { type: 'audio/wav' }) },
            { name: 'info.yml', blob: new Blob(['name: Migration fixture\nchart: chart.json\nmusic: audio.wav\nlevel: 1\n']) }
          ];
          if (scenario === 'direct-formats') {
            chartEntries.push(
              { name: 'legacy.json', blob: new Blob([JSON.stringify({ ...chart, formatVersion: 1 })]) },
              { name: 'rpe.json', blob: new Blob([JSON.stringify({ META: { RPEVersion: 140, offset: 0 }, BPMList: [{ startTime: [0, 0, 1], bpm: 120 }], judgeLineList: [{ notes: [{ type: 1, startTime: [1, 0, 1], endTime: [1, 0, 1], positionX: 0, above: 1, speed: 1, alpha: 255, size: 1, isFake: 0 }], eventLayers: [] }] })]) },
              { name: 'chart.pec', blob: new Blob(['0\nbp 0 120\nn1 0 1 0 1 0\ncv 0 0 7\ncp 0 0 1024 700\ncd 0 0 0\nca 0 0 255\n']) },
              { name: 'chart.sus', blob: new Blob(['#TITLE "SUS fixture"\n#BPM01:120\n#00008:01\n#00012:11\n']) }
            );
          }
          const zip = await exporter.buildStoredZip(chartEntries);
          const chartZip = new File([zip], scenario === 'direct-pez' ? 'fixture.pez' : 'fixture.zip', { type: 'application/zip' });
          if (scenario.startsWith('direct-')) {
            // Exercise the actual existing file-input listener, not a duplicate importer.
            const transfer = new DataTransfer();
            if (scenario === 'direct-loose') for (const entry of chartEntries) transfer.items.add(new File([entry.blob], entry.name, { type: entry.blob.type }));
            else transfer.items.add(chartZip);
            if (scenario === 'direct-partial-failure') {
              const invalid = chartEntries.map(entry => entry.name === 'chart.json' ? { name: entry.name, blob: new Blob(['{}']) } : entry);
              transfer.items.add(new File([await exporter.buildStoredZip(invalid)], 'invalid.zip', { type: 'application/zip' }));
            }
            const input = document.querySelector('#chartInput'); input.files = transfer.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            await new Promise((resolve, reject) => {
              const deadline = performance.now() + 15000;
              const timer = setInterval(async () => {
                const records = await read();
                if (scenario === 'direct-partial-failure'
                    ? document.querySelector('#dialog').textContent.includes('本批次未写入')
                    : records[0].length === (scenario === 'direct-formats' ? 6 : 2)) { clearInterval(timer); resolve(); }
                else if (performance.now() > deadline) { clearInterval(timer); reject(Error('direct import did not commit: ' + document.querySelector('#dialog').textContent)); }
              }, 50);
            });
            return { scenario, before, after: await read(), error: null, buttonRestored: true,
              dialog: document.querySelector('#dialog').textContent, cacheOriginal: await storage.dbGetChartSummary('old-chart') };
          }
          const manifest = {
            format: 'phi-offline-library-backup', version: 2,
            charts: [{ id: 'fixture', file: 'charts/fixture.zip' }],
            settings: [{ key: 'regression-setting', value: 'replacement' }],
            scores: [{ key: 'regression-score', score: 999, ranked: true }]
          };
          if (scenario === 'missing-declared-chart') manifest.charts.push({ file: 'charts/absent.zip' });
          if (scenario === 'malformed-settings') manifest.settings = { key: 'regression-setting', value: 'invalid shape' };
          const entries = [{ name: 'phi-library-backup.json', blob: new Blob([JSON.stringify(manifest)]) }];
          if (scenario !== 'missing-zip') entries.push({ name: 'charts/fixture.zip', blob: zip });
          const backup = new File([await exporter.buildStoredZip(entries)], 'library.zip', { type: 'application/zip' });
          const originalPut = IDBObjectStore.prototype.put;
          if (scenario === 'transaction-failure') IDBObjectStore.prototype.put = function (value, ...args) {
            if (this.name === 'scores' && value.key === 'regression-score') throw new DOMException('injected write failure', 'DataCloneError');
            return originalPut.call(this, value, ...args);
          };
          const button = document.createElement('button'); button.textContent = 'original button';
          let error = null;
          try { await storage.importLibraryMigrationPackage(backup, button); }
          catch (e) { error = { name: e.name, message: e.message }; }
          finally { IDBObjectStore.prototype.put = originalPut; }
          return { scenario, before, after: await read(), error,
            buttonRestored: !button.disabled && button.textContent === 'original button',
            cacheOriginal: await storage.dbGetChartSummary('old-chart'), dialog: document.querySelector('#dialog').textContent };
        }, scenario);
        assert.equal(result.buttonRestored, true);
        assert.equal(result.cacheOriginal.name, 'original chart');
        assert.deepEqual(errors, [], 'page errors');
        if (scenario === 'success' || scenario.startsWith('direct-') && scenario !== 'direct-partial-failure') {
          assert.equal(result.error, null);
          assert.equal(result.after[0].length, scenario === 'direct-formats' ? 6 : 2);
          assert.equal(result.after[1].length, scenario === 'direct-formats' ? 6 : 2);
          assert.deepEqual(result.after[0].find(record => record.id === 'old-chart'), result.before[0][0]);
          assert.equal(result.after[2].find(record => record.key === 'regression-setting').value, scenario === 'success' ? 'replacement' : 'original');
          assert.equal(result.after[3].find(record => record.key === 'regression-score').score, scenario === 'success' ? 999 : 321);
          assert.match(result.dialog, scenario === 'direct-formats' ? /成功导入：5/ : /成功导入：1/);
          if (scenario === 'direct-formats') assert.deepEqual(result.after[0].filter(record => record.id !== 'old-chart').map(record => record.parser).sort(), ['pec', 'pgr', 'pgr', 'rpe', 'sus']);
          await page.reload({ waitUntil: 'domcontentloaded' });
          await page.waitForFunction(() => window.PhiOfflineNext?.modules.StorageManager.mode() === 'persistent');
          assert.equal(await page.evaluate(() => new Promise((resolve, reject) => {
            const request = indexedDB.open('phi-offline-db'); request.onerror = () => reject(request.error);
            request.onsuccess = () => { const db = request.result, count = db.transaction('charts').objectStore('charts').count();
              count.onsuccess = () => { db.close(); resolve(count.result); }; count.onerror = () => reject(count.error); };
          })), scenario === 'direct-formats' ? 6 : 2);
        } else {
          if (scenario === 'direct-partial-failure') assert.match(result.dialog, /成功导入：0/);
          else assert(result.error, 'invalid migration must reject');
          assert.deepEqual(result.after, result.before, 'failed migration must preserve charts, index, settings and scores');
        }
        results.push({ scenario, status: 'passed', error: result.error, storesBefore: result.before.map(x => x.length), storesAfter: result.after.map(x => x.length) });
        console.log(JSON.stringify(results.at(-1)));
      } finally { await context.close(); }
    }
    console.log(JSON.stringify({ browser: browser.version(), passed: results.length, results }, null, 2));
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
