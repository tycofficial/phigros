'use strict';
// Engineering regression only. Synthetic local charts are test inputs, never official reference content.
// Run against the real static server: node tests/full-flow-browser.cjs http://127.0.0.1:4180 [output-directory]
const { chromium } = require('playwright');
const fs = require('node:fs'), path = require('node:path'), assert = require('node:assert/strict'), crypto = require('node:crypto');
const base = process.argv[2] || 'http://127.0.0.1:4180';
const out = path.resolve(process.argv[3] || 'work/browser-flow');
fs.mkdirSync(out, { recursive: true });
const report = { scope: 'Real browser engineering regression; no official consistency conclusion', referenceVersion: null, platform: process.platform + '/' + process.arch, audioEvidence: 'Decoded media duration and music clock only; physical device latency and audible output are not measured', viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, locale: 'zh-CN', startedAt: new Date().toISOString(), implementationHashes: Object.fromEntries(['index.html','js/app.js','js/course-mode.js','js/interactive-replay.js','css/style.css'].map(file => [file,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'..',file))).digest('hex')])), steps: [], pageErrors: [], requestFailures: [] };
const step = (name, evidence) => { report.steps.push({ name, at: new Date().toISOString(), ...evidence }); console.log(name, JSON.stringify(evidence)); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); };
function wave(index) {
  const samples = 32000, data = Buffer.alloc(44 + samples * 2); data.write('RIFF'); data.writeUInt32LE(data.length - 8, 4); data.write('WAVEfmt ', 8); data.writeUInt32LE(16, 16); data.writeUInt16LE(1, 20); data.writeUInt16LE(1, 22); data.writeUInt32LE(8000, 24); data.writeUInt32LE(16000, 28); data.writeUInt16LE(2, 32); data.writeUInt16LE(16, 34); data.write('data', 36); data.writeUInt32LE(samples * 2, 40);
  for (let n = 0; n < samples; n++) data.writeInt16LE(Math.round(80 * Math.sin(2 * Math.PI * (220 + index * 55) * n / 8000)), 44 + n * 2); return data;
}
function chart() { return JSON.stringify({ formatVersion: 3, offset: 0, judgeLineList: [{ bpm: 120, notesAbove: Array.from({ length: 4 }, (_, i) => ({ type: 1, time: 64 + i * 32, positionX: 0, holdTime: 0, speed: 1, floorPosition: 1 + i * .5 })), notesBelow: [], speedEvents: [{ startTime: 0, endTime: 10000, value: 1 }], judgeLineMoveEvents: [{ startTime: 0, endTime: 10000, start: .5, end: .5, start2: .5, end2: .5 }], judgeLineRotateEvents: [{ startTime: 0, endTime: 10000, start: 0, end: 0 }], judgeLineDisappearEvents: [{ startTime: 0, endTime: 10000, start: 1, end: 1 }] }] }); }
async function engineState(page) { return page.evaluate(() => { const e = window.__phiEngine; return e ? { name: e.record.name, running: e.running, paused: e.paused, starting: e.starting, time: e.musicCurrentTime(), duration: e.musicDuration(), total: e.total, counts: [...e.counts], score: e.score(), autoplay: e.autoplay, courseSessionId: e.courseSessionId, courseStageToken: e.courseStageToken, musicUsingWebAudio: e.musicUsingWebAudio } : null; }); }
(async () => {
  const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH || '/usr/bin/chromium', headless: true, args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  let context, page;
  try {
    report.browser = browser.version();
    context = await browser.newContext({ viewport: report.viewport, deviceScaleFactor: 1, locale: report.locale, serviceWorkers: 'block', ...(process.env.PHI_FLOW_VIDEO === '1' ? { recordVideo: { dir: path.join(out, 'video'), size: report.viewport } } : {}) });
    page = await context.newPage(); page.setDefaultTimeout(45000);
    page.on('pageerror', e => report.pageErrors.push(e.message));
    page.on('requestfailed', r => report.requestFailures.push({ url: r.url(), error: r.failure()?.errorText }));
    await page.goto(base, { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(() => window.PhiOfflineNext && PhiOfflineNext.modules.StorageManager.mode() === 'persistent');
    await page.screenshot({ path: path.join(out, '01-startup.png') });
    step('startup', { stage: await page.locator('#refHome').getAttribute('data-stage'), screenshot: '01-startup.png' });
    for (let n = 0; n < 3 && !await page.locator('#refCollection').isVisible(); n++) await page.locator('#refHome').click({ position: { x: 100, y: 100 } });
    await page.waitForSelector('#refCollection:not(.hidden)');
    step('chapter-navigation', { chapterButtons: await page.locator('#refCatalogGroups [data-collection]').count() });
    await page.locator('[data-reference-open-library]').first().click();
    await page.waitForSelector('#libraryView:not(.hidden)');
    await page.waitForFunction(() => document.querySelector('#libraryFocusTitle').textContent === 'Leave All Behind');
    await page.screenshot({ path: path.join(out, '02-song-selection.png') });
    step('song-selection', { title: await page.locator('#libraryFocusTitle').innerText(), chartGroups: await page.locator('#chartList .card').count(), screenshot: '02-song-selection.png' });
    const difficultyTargets = [];
    for (const viewport of [{ width: 1280, height: 720 }, { width: 1920, height: 1080 }, { width: 720, height: 1280 }]) {
      await page.setViewportSize(viewport);
      for (const tier of ['EZ', 'HD', 'IN', 'AT']) {
        await page.locator(`#libraryFocusDifficulty button[data-tier="${tier}"]`).click();
        assert.equal(await page.locator(`#libraryFocusDifficulty button[data-tier="${tier}"]`).getAttribute('aria-pressed'), 'true');
        difficultyTargets.push({ viewport, tier, selected: true });
      }
    }
    await page.setViewportSize(report.viewport);
    step('visible-difficulty-buttons-receive-real-clicks', { targets: difficultyTargets });
    await page.locator('#libraryFocusDifficulty button[data-tier="EZ"]').click();
    await page.locator('#libraryFocusPlay').click();
    await page.waitForFunction(() => window.__phiEngine?.running && !__phiEngine.starting && __phiEngine.musicCurrentTime() > 2, null, { timeout: 90000 });
    await page.screenshot({ path: path.join(out, '03-builtin-gameplay.png') });
    step('builtin-gameplay', { engine: await engineState(page), screenshot: '03-builtin-gameplay.png' });
    await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click();
    await page.waitForFunction(() => __phiEngine.paused);
    const paused = await engineState(page); await page.waitForTimeout(400); const still = await engineState(page); assert(Math.abs(still.time - paused.time) < .08);
    await page.screenshot({ path: path.join(out, '04-paused.png') });
    step('pause-freezes-music-clock', { before: paused, after: still, screenshot: '04-paused.png' });
    await page.locator('#resumeBtn').click();
    await page.waitForFunction(t => !__phiEngine.paused && !__phiEngine.resumePending && __phiEngine.musicCurrentTime() > t + .4, paused.time);
    step('resume', { engine: await engineState(page) });
    await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click();
    await page.waitForFunction(() => __phiEngine.paused);
    await page.locator('#restartBtn').click();
    await page.waitForFunction(() => __phiEngine.running && !__phiEngine.starting && !__phiEngine.paused && __phiEngine.musicCurrentTime() < 2);
    step('retry', { engine: await engineState(page) });
    await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click(); await page.waitForFunction(() => __phiEngine.paused); await page.locator('#quitBtn').click();
    await page.waitForSelector('#libraryView:not(.hidden)'); step('return-to-library', {});
    // Fail only an uncached chart request; the media and successful path remain real.
    await page.locator('#libraryFocusDifficulty button[data-tier="HD"]').click();
    const failureURL = '**/assets/charts/individual/ch9_0_hd.bin'; let injectedFailures = 0;
    await context.route(failureURL, route => { injectedFailures++; return route.fulfill({ status: 404, contentType: 'text/plain', body: 'Controlled regression: missing chart' }); });
    await page.locator('#libraryFocusPlay').click();
    await page.waitForFunction(() => document.querySelector('#toast').textContent.includes('无法开始'));
    await page.waitForSelector('#libraryView:not(.hidden)');
    assert(injectedFailures > 0); assert(!await page.evaluate(() => window.__phiEngine?.running));
    step('controlled-chart-download-failure', { injectedFailures, message: await page.locator('#toast').innerText(), fault: 'Only ch9_0_hd.bin returned a controlled HTTP 404' });
    await context.unroute(failureURL); await page.locator('#libraryFocusPlay').click();
    await page.waitForFunction(() => window.__phiEngine?.running && !__phiEngine.starting && __phiEngine.musicCurrentTime() > .5, null, { timeout: 90000 });
    step('download-failure-retry-recovers', { engine: await engineState(page) });
    await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click(); await page.waitForFunction(() => __phiEngine.paused); await page.locator('#quitBtn').click();
    await page.waitForSelector('#libraryView:not(.hidden)');
    // Generate the archive with the existing exporter, then exercise the real file chooser/importer.
    const files = [];
    for (let i = 0; i < 3; i++) { const prefix = `fixture-${i + 1}/`; files.push({ name: prefix + 'chart.json', bytes: [...Buffer.from(chart())] }, { name: prefix + 'music.wav', bytes: [...wave(i)] }, { name: prefix + 'info.json', bytes: [...Buffer.from(JSON.stringify({ name: `Browser regression fixture ${i + 1}`, chart: 'chart.json', music: 'music.wav', level: `EZ Lv.${i + 1}`, composer: 'Automated regression fixture; not official content' }))] }); }
    const archiveBytes = await page.evaluate(async files => [...new Uint8Array(await (await PhiOfflineNext.modules.ExportManager.buildStoredZip(files.map(f => ({ name: f.name, blob: new Blob([new Uint8Array(f.bytes)]) })))).arrayBuffer())], files);
    const archive = path.join(out, 'browser-course-fixture.pez'); fs.writeFileSync(archive, Buffer.from(archiveBytes));
    await page.locator('#refLibraryBack').click(); await page.locator('[data-collection="local"]').click(); await page.waitForSelector('#libraryView:not(.hidden)');
    const chooser = page.waitForEvent('filechooser'); await page.locator('#importLocalCharts').click(); await (await chooser).setFiles(archive);
    await page.waitForFunction(() => document.querySelectorAll('#chartList .card').length === 3);
    const imported = await page.evaluate(async () => { const db = await PhiOfflineNext.modules.StorageManager.openDB(); return new Promise((resolve, reject) => { const req = db.transaction('charts').objectStore('charts').getAll(); req.onsuccess = () => { db.close(); resolve(req.result.map(r => ({ id: r.id, name: r.name, parser: r.parser, notes: r.notes, duration: r.duration, audioHash: r.audioHash }))); }; req.onerror = () => reject(req.error); }); });
    assert.equal(imported.length, 3); assert(imported.every(r => r.parser === 'pgr' && r.notes === 4));
    await page.screenshot({ path: path.join(out, '05-imported-library.png') }); step('local-pez-import-through-existing-button', { records: imported, screenshot: '05-imported-library.png', fixture: 'browser-course-fixture.pez' });
    await page.locator('#dialogClose').click();
    // A real all-miss play: no fabricated completion, seeking, autoplay, or injected score.
    await page.locator('#chartList .card').first().click(); await page.locator('#libraryFocusPlay').click();
    await page.waitForSelector('#resultView:not(.hidden)', { timeout: 60000 });
    const natural = await engineState(page); assert.equal(natural.total, 4); assert.deepEqual(natural.counts, [0, 0, 0, 4]); assert.equal(natural.autoplay, false); assert.equal(natural.score, 0);
    await page.screenshot({ path: path.join(out, '06-local-natural-result.png') }); step('local-natural-audio-end-result', { engine: natural, displayedMisses: await page.locator('#rMiss').innerText(), screenshot: '06-local-natural-result.png' });
    await page.locator('#resultBack').click(); await page.locator('#refLibraryBack').click(); await page.locator('#refCourse').click();
    await page.waitForSelector('#phiCoursePanel:not(.hidden)');
    await page.locator('#phiCoursePanel input[type="search"]').fill('Browser regression fixture');
    for (let i = 1; i <= 3; i++) await page.locator('.phiCourseChoices button').filter({ hasText: `Browser regression fixture ${i}` }).click();
    const chosen = await page.locator('.phiCourseSlots').innerText(); await page.getByRole('button', { name: '开始课题', exact: true }).click();
    const stages = [];
    for (let i = 0; i < 3; i++) {
      await page.waitForFunction(index => window.PhiCourse?.current()?.index === index && window.__phiEngine?.running, i, { timeout: 60000 });
      const start = await engineState(page); assert(start.courseSessionId); assert.equal(start.autoplay, false);
      await page.waitForSelector('#phiCoursePanel:not(.hidden)', { timeout: 60000 });
      const state = await page.evaluate(() => { const s = PhiCourse.current(); return { id: s.id, index: s.index, state: s.state, score: s.score, counts: s.counts, assisted: s.assisted, results: s.results, stageToken: s.stageToken }; });
      assert.equal(state.results.length, i + 1); assert.deepEqual(state.results[i].counts, [0, 0, 0, 4]); stages.push({ start, result: state });
      if (i < 2) await page.getByRole('button', { name: '下一首', exact: true }).click();
    }
    assert.equal(stages[2].result.state, 'complete'); assert.deepEqual(stages[2].result.counts, [0, 0, 0, 12]);
    await page.screenshot({ path: path.join(out, '07-course-complete.png') }); step('three-stage-course-natural-completion', { chosen, stages, screenshot: '07-course-complete.png' });
    await page.getByRole('button', { name: '退出课题', exact: true }).click(); await page.waitForSelector('#libraryView:not(.hidden)'); assert.equal(await page.evaluate(() => PhiCourse.current()), null);
    await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.PhiOfflineNext && PhiOfflineNext.modules.StorageManager.mode() === 'persistent');
    const restored = await page.evaluate(async ids => await Promise.all(ids.map(async id => { const r = await PhiOfflineNext.modules.StorageManager.dbGetChart(id); return { id: r?.id, name: r?.name, audioHash: r?.audioHash, notes: r?.notes }; })), imported.map(r => r.id));
    assert.deepEqual(restored.map(r => r.id), imported.map(r => r.id)); assert.deepEqual(restored.map(r => r.audioHash), imported.map(r => r.audioHash)); step('imported-data-survives-reload', { records: restored });
    assert.equal(report.pageErrors.length, 0, report.pageErrors.join('\n')); report.status = 'passed-engineering-regression-only';
  } catch (error) { report.status = 'failed'; report.error = error.stack; console.error(error); if (page) report.failureState = await page.evaluate(() => ({ route: document.body.dataset.referenceScene, toast: document.querySelector('#toast')?.textContent, loadingVisible: !document.querySelector('#loadingView')?.classList.contains('hidden'), title: document.querySelector('#libraryFocusTitle')?.textContent, course: window.PhiCourse?.current()?.state })).catch(() => null); if (page) await page.screenshot({ path: path.join(out, 'failure.png') }).catch(() => {}); process.exitCode = 1; }
  finally { report.finishedAt = new Date().toISOString(); fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2)); await context?.close(); await browser.close(); }
})();
