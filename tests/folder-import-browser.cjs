'use strict';
// Existing More -> Import -> full folder path, with real directory file selection.
// Nested files and saved records below are isolated synthetic regression fixtures.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const {wave,chart}=require('./helpers/import-fixtures.cjs');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/folder-import'),input=path.join(out,'input');
fs.mkdirSync(input,{recursive:true});
for(let i=1;i<=3;i++){
 const folder=path.join(input,'nested','song-'+i);fs.mkdirSync(folder,{recursive:true});
 fs.writeFileSync(path.join(folder,'chart.json'),chart());fs.writeFileSync(path.join(folder,'music.wav'),wave(i));
 fs.writeFileSync(path.join(folder,'info.json'),JSON.stringify({name:'Folder regression fixture '+i,chart:'chart.json',music:'music.wav',level:'EZ Lv.'+i,composer:'Synthetic regression input; not official content'}));
}
const style=fs.readFileSync(process.env.PHI_TEST_STYLE_SOURCE||'css/style.css','utf8');
const report={scope:'Engineering folder import and existing-menu visibility only; no official equivalence',styleSHA256:crypto.createHash('sha256').update(style).digest('hex'),pageErrors:[],steps:[]};
const step=(name,data={})=>{report.steps.push({name,...data});console.log(name,JSON.stringify(data));};
const snapshot=page=>page.evaluate(async()=>{
 const s=PhiOfflineNext.modules.StorageManager,r=await s.dbGetChart('folder-existing'),setting=await s.dbGetSetting('folder-setting'),db=await s.openDB();
 const score=await new Promise((resolve,reject)=>{const req=db.transaction('scores').objectStore('scores').get('folder-score');req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});db.close();
 return {chart:{id:r.id,name:r.name,chartText:r.chartText,importedAt:r.importedAt,audioSHA256:[...new Uint8Array(await crypto.subtle.digest('SHA-256',await r.audioBlob.arrayBuffer()))].map(n=>n.toString(16).padStart(2,'0')).join('')},setting,score};
});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();
 try{
  report.browser=browser.version();page.on('pageerror',error=>report.pageErrors.push(error.message));
  if(process.env.PHI_TEST_STYLE_SOURCE)await context.route('**/css/style.css*',route=>route.fulfill({contentType:'text/css',body:style}));
  await page.addInitScript(()=>document.addEventListener('change',event=>{if(event.target.id==='chartFolderInput')window.__folderFiles=[...event.target.files].map(file=>({name:file.name,path:file.webkitRelativePath}));}));
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext?.modules.StorageManager.mode()==='persistent');
  report.runtime=await page.evaluate(()=>PhiOfflineNext.versions.runtime);
  for(const viewport of [{width:1280,height:720},{width:1920,height:1080},{width:720,height:1280}]){
   await page.setViewportSize(viewport);await page.locator('#libraryMoreBtn').click();
   const state=await page.evaluate(()=>({expanded:document.querySelector('#libraryMoreBtn').getAttribute('aria-expanded'),viewClasses:document.querySelector('#libraryView').className,display:getComputedStyle(document.querySelector('#libraryMoreSheet')).display}));
   step('existing-more-menu-opens',{viewport,...state});assert.equal(await page.locator('#importCharts').isVisible(),true,'Existing import action is hidden after opening More');
   await page.keyboard.press('Escape');assert.equal(await page.locator('#libraryMoreBtn').getAttribute('aria-expanded'),'false');assert.equal(await page.locator('#libraryMoreSheet').isVisible(),false);
   await page.locator('#libraryMoreBtn').click();await page.locator('#chartList .card').filter({hasText:'Leave All Behind'}).first().click();assert.equal(await page.locator('#libraryMoreSheet').isVisible(),false);
  }
  await page.setViewportSize({width:1280,height:720});
  await page.evaluate(async fixture=>{
   const s=PhiOfflineNext.modules.StorageManager;await s.dbPutChart({id:'folder-existing',name:'Existing regression fixture',chartText:fixture.chart,parser:'pgr',notes:4,duration:4,importedAt:7,audioBlob:new Blob([new Uint8Array(fixture.audio)],{type:'audio/wav'})});
   await s.dbPutSetting({key:'folder-setting',value:{offset:123}});const db=await s.openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').put({key:'folder-score',score:321,ranked:true});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
  },{chart:chart(),audio:[...wave(9)]});
  const original=await snapshot(page);
  await page.locator('#libraryMoreBtn').click();await page.locator('#importCharts').click();
  const chooser=page.waitForEvent('filechooser');await page.locator('#pickChartFolder').click();await(await chooser).setFiles(input);
  await page.waitForFunction(()=>document.querySelector('#dialog').textContent.includes('成功导入：3'));
  const imported=await page.evaluate(async()=>{
   const db=await PhiOfflineNext.modules.StorageManager.openDB();return new Promise((resolve,reject)=>{const req=db.transaction('charts').objectStore('charts').getAll();req.onsuccess=()=>{db.close();resolve(req.result.filter(r=>r.id!=='folder-existing').map(r=>({id:r.id,name:r.name,parser:r.parser,notes:r.notes,duration:r.duration,audioHash:r.audioHash})));};req.onerror=()=>reject(req.error);});
  });
  assert.equal(imported.length,3);assert(imported.every(r=>r.parser==='pgr'&&r.notes===4&&r.duration===4));assert.equal(new Set(imported.map(r=>r.audioHash)).size,3);
  for(let i=1;i<=3;i++){const audio=wave(i);assert.equal(imported.find(r=>r.name==='Folder regression fixture '+i)?.audioHash,'sha256:'+crypto.createHash('sha256').update(audio).digest('hex')+':'+audio.length);}
  assert.deepEqual(imported.map(r=>r.name).sort(),[1,2,3].map(i=>'Folder regression fixture '+i));
  const files=await page.evaluate(()=>window.__folderFiles);assert.equal(files.length,9);assert(files.every(f=>f.path.includes('/nested/song-')));
  assert.deepEqual(await snapshot(page),original);
  await page.screenshot({path:path.join(out,'folder-import.png')});step('nested-folder-import-preserves-original-data',{files,imported,original,screenshot:'folder-import.png'});
  await page.reload({waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext?.modules.StorageManager.mode()==='persistent');
  assert.deepEqual(await snapshot(page),original);
  const restored=await page.evaluate(async ids=>Promise.all(ids.map(async id=>{const r=await PhiOfflineNext.modules.StorageManager.dbGetChart(id);return {id:r?.id,audioHash:r?.audioHash};})),imported.map(r=>r.id));
  assert.deepEqual(restored,imported.map(r=>({id:r.id,audioHash:r.audioHash})));step('folder-data-and-original-saves-survive-reload',{restored});
  assert.deepEqual(report.pageErrors,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error}));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
