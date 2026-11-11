'use strict';
// Actual SW installation/update and offline navigation, with isolated test saves.
// Previous worker is the shipped pages-32 fixture; no official-game comparison.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),http=require('node:http'),assert=require('node:assert/strict'),crypto=require('node:crypto'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),out=path.resolve(process.argv[2]||'work/service-worker');
fs.mkdirSync(out,{recursive:true});
const read=name=>fs.readFileSync(path.join(root,name),'utf8'),hash=s=>crypto.createHash('sha256').update(s).digest('hex');
const html=read('index.html'),source=read('js/app.js'),worker=fs.readFileSync(process.env.PHI_TEST_SW_SOURCE||path.join(root,'sw.js'),'utf8');
const version=source.match(/runtime:\s*"([^"]+)"/)[1],previous='4.0.1.2-pages-32',oldWorker=read('tests/fixtures/service-worker-pages32.js');
const suffix=version.match(/pages-\d+/)[0],nextSuffix='pages-'+(Number(suffix.slice(6))+1),nextVersion=version.replace(suffix,nextSuffix);
let phase='previous';
const candidate=worker===oldWorker?worker.replace("APP_CACHE='tycphigros-app-pages-32'","APP_CACHE='tycphigros-app-test-update'"):worker;
const report={scope:'Real service-worker engineering regression; synthetic saves, no official equivalence',sourceHashes:{'index.html':hash(html),'js/app.js':hash(source),'sw.js':hash(worker)},steps:[],requests:[],pageErrors:[],consoleErrors:[]};
report.releaseSimulation='Previous app differs only by runtime/cache tokens; broken/recovered next releases rewrite those same tokens and inject one controlled missing bootstrap response.';
report.previousSourceHashes={'index.html':hash(html.replaceAll(suffix,'pages-32')),'js/app.js':hash(source.replaceAll(suffix,'pages-32')),'sw.js':hash(oldWorker)};
const mime={'.html':'text/html','.js':'application/javascript','.mjs':'application/javascript','.css':'text/css','.json':'application/json','.webp':'image/webp','.png':'image/png','.m4a':'audio/mp4','.ogg':'audio/ogg','.woff2':'font/woff2'};
const server=http.createServer((req,res)=>{
 const url=new URL(req.url,'http://localhost'),name=url.pathname.replace(/^\/game\//,'')||'index.html';
 if(!url.pathname.startsWith('/game/')){res.writeHead(404).end();return;}
 const requestRecord={phase,path:url.pathname,search:url.search};report.requests.push(requestRecord);
 const sendRuntime=(body,type)=>{const bytes=zlib.gzipSync(body);requestRecord.encoding='gzip';res.writeHead(200,{'Content-Type':type,'Content-Encoding':'gzip','Content-Length':bytes.length}).end(bytes);};
 res.setHeader('Cache-Control','no-store');
 if(name==='sw.js'){
  const body=phase==='previous'?oldWorker:['broken','recovered'].includes(phase)?candidate.replaceAll(suffix,nextSuffix):candidate;
  res.writeHead(200,{'Content-Type':mime['.js']}).end(body);return;
 }
 if(phase==='broken'&&name==='js/loading-presentation.js'){res.writeHead(404).end('Controlled missing bootstrap file');return;}
 if(name==='index.html'||name==='js/app.js'){
  let body=name==='index.html'?html:source;
  if(phase==='previous')body=body.replaceAll(suffix,'pages-32');
  if(['broken','recovered'].includes(phase))body=body.replaceAll(suffix,nextSuffix);
  sendRuntime(body,mime[path.extname(name)]);return;
 }
 const file=path.resolve(root,name);
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 fs.stat(file,(error,stat)=>{if(error||!stat.isFile()){res.writeHead(404).end();return;}
  if(/\.(?:js|mjs|css)$/.test(name)){sendRuntime(fs.readFileSync(file),mime[path.extname(file)]);return;}
  res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Content-Length':stat.size});fs.createReadStream(file).pipe(res);});
});
const step=(name,data={})=>{report.steps.push({name,...data});console.log(name,JSON.stringify(data));};
const readSaved=page=>page.evaluate(async()=>{
 const s=PhiOfflineNext.modules.StorageManager,r=await s.dbGetChart('sw-existing-chart'),setting=await s.dbGetSetting('sw-existing-setting'),db=await s.openDB();
 const score=await new Promise((resolve,reject)=>{const req=db.transaction('scores').objectStore('scores').get('sw-existing-score');req.onsuccess=()=>resolve(req.result.score);req.onerror=()=>reject(req.error);});db.close();
 return {id:r.id,chartText:r.chartText,audio:await r.audioBlob.text(),setting:setting.value,score,localScore:localStorage.getItem('phi.offline.bestScore.v1::sw-existing-score')};
});
async function updateWorker(page,transition){
 // Navigation's load handler also registers the worker. Observe before making
 // the recovered release reachable, not only before our own explicit update.
 await page.evaluate(()=>{
  const container=navigator.serviceWorker,previous=container.controller;
  let timer,listener;
  const wait={events:0,explicitUpdateStarted:false,claimedBeforeExplicitUpdate:false};
  wait.dispose=()=>{clearTimeout(timer);container.removeEventListener('controllerchange',listener);};
  wait.promise=new Promise((resolve,reject)=>{
   listener=()=>{if(!container.controller||container.controller===previous)return;wait.events++;wait.claimedBeforeExplicitUpdate=!wait.explicitUpdateStarted;wait.dispose();resolve();};
   container.addEventListener('controllerchange',listener);
   timer=setTimeout(()=>{wait.dispose();reject(Error('new worker did not take control'));},20000);
  });
  wait.promise.catch(()=>{}); // It is still awaited below, including rejection.
  window.__swUpdateWait=wait;
 });
 try{
  await transition();
  if(process.env.PHI_TEST_SW_PRECLAIM==='1'&&phase==='recovered'){
   await page.evaluate(async()=>{const registration=await navigator.serviceWorker.ready;await registration.update();await __swUpdateWait.promise;});
  }
  const observation=await page.evaluate(async()=>{
   const wait=window.__swUpdateWait;wait.explicitUpdateStarted=true;
   const registration=await navigator.serviceWorker.ready;await registration.update();await wait.promise;
   return {events:wait.events,claimedBeforeExplicitUpdate:wait.claimedBeforeExplicitUpdate,timeoutMs:20000};
  });
  (report.updateObservations||=[]).push({phase,...observation});
  if(process.env.PHI_TEST_SW_PRECLAIM==='1'&&phase==='recovered')assert.equal(observation.claimedBeforeExplicitUpdate,true,'exercise the already-claimed ordering');
 }finally{await page.evaluate(()=>{window.__swUpdateWait?.dispose();delete window.__swUpdateWait;});}
}
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base=`http://127.0.0.1:${server.address().port}/game/`;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'allow'}),page=await context.newPage();
 context.on('console',message=>{if(message.type()==='error')report.consoleErrors.push({phase,text:message.text()});});
 page.on('pageerror',error=>report.pageErrors.push(error.message));page.setDefaultTimeout(30000);
 try{
  report.browser=browser.version();
  await page.goto(base+'?skipIntro=1');
  await page.waitForFunction(()=>window.PhiOfflineNext?.modules.StorageManager.mode()==='persistent'&&!!navigator.serviceWorker.controller);
  await page.reload();
  await page.waitForFunction(()=>window.PhiOfflineNext?.versions.runtime==='4.0.1.2-pages-32');
  await page.waitForFunction(async()=>!!await(await caches.open('tycphigros-app-pages-32')).match(new URL('./js/app.js?v=4.0.1.2-pages-32',location.href)));
  const expected=await page.evaluate(async()=>{
   const s=PhiOfflineNext.modules.StorageManager;
   await s.dbPutChart({id:'sw-existing-chart',name:'Service worker storage fixture',chartText:'saved-original',parser:'pgr',importedAt:7,audioBlob:new Blob(['saved-original-audio'])});
   await s.dbPutSetting({key:'sw-existing-setting',value:{offset:123}});
   const db=await s.openDB();await new Promise((resolve,reject)=>{const tx=db.transaction('scores','readwrite');tx.objectStore('scores').put({key:'sw-existing-score',score:321,ranked:true});tx.oncomplete=resolve;tx.onabort=()=>reject(tx.error);});db.close();
   localStorage.setItem('phi.offline.bestScore.v1::sw-existing-score','321');
   const media=await caches.open('tycphigros-4.0.1.2-stability-2');await media.put(new URL('./assets/sw-range-fixture.m4a',location.href),new Response('0123456789',{headers:{'Content-Type':'audio/mp4','Content-Length':'10'}}));
   return {id:'sw-existing-chart',chartText:'saved-original',audio:'saved-original-audio',setting:{offset:123},score:321,localScore:'321'};
  });
  step('previous-worker-warmed',{runtime:previous,caches:await page.evaluate(()=>caches.keys())});
  await updateWorker(page,async()=>{phase='current';});
  step('updated-worker-claimed',{caches:await page.evaluate(()=>caches.keys())});
  await context.setOffline(true);
  const navigation=await page.reload({waitUntil:'domcontentloaded'});
  assert(navigation.fromServiceWorker(),'offline navigation must come from the real worker');
  await page.waitForFunction(runtime=>window.PhiOfflineNext?.versions.runtime===runtime&&PhiOfflineNext.modules.StorageManager.mode()==='persistent',version);
  const restored=await readSaved(page);
  assert.deepEqual(restored,expected);
  await page.screenshot({path:path.join(out,'offline-after-update.png')});
  step('offline-after-update-restores-app-and-saves',{runtime:version,restored,screenshot:'offline-after-update.png'});
  const range=await page.evaluate(async()=>{const r=await fetch('./assets/sw-range-fixture.m4a',{headers:{Range:'bytes=2-5'}});return {status:r.status,range:r.headers.get('Content-Range'),body:await r.text()};});
  assert.deepEqual(range,{status:206,range:'bytes 2-5/10',body:'2345'});step('shared-media-range-survives-update',range);
  await page.goto(base+'index.html?skipIntro=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(runtime=>window.PhiOfflineNext?.versions.runtime===runtime,version);step('offline-index-alias-loads',{runtime:version});
  await context.setOffline(false);phase='broken';
  const failure=await page.evaluate(async()=>{
   const registration=await navigator.serviceWorker.ready,controller=navigator.serviceWorker.controller;
   const result=await new Promise(async(resolve,reject)=>{
    const timer=setTimeout(()=>reject(Error('broken installation did not settle')),20000);
    registration.addEventListener('updatefound',()=>{
     const installing=registration.installing;installing.addEventListener('statechange',()=>{
      if(installing.state==='redundant'||installing.state==='activated'){clearTimeout(timer);resolve(installing.state);}
     });
    },{once:true});
    try{await registration.update();}catch(error){clearTimeout(timer);reject(error);}
   });
   return {state:result,sameController:navigator.serviceWorker.controller===controller};
  });
  assert.deepEqual(failure,{state:'redundant',sameController:true});step('missing-bootstrap-rejects-update',failure);
  phase='current';await context.setOffline(true);await page.goto(base+'?skipIntro=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(runtime=>window.PhiOfflineNext?.versions.runtime===runtime,version);step('failed-install-keeps-offline-app',{runtime:version});
  await updateWorker(page,async()=>{phase='recovered';await context.setOffline(false);});await context.setOffline(true);
  await page.goto(base+'?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(runtime=>window.PhiOfflineNext?.versions.runtime===runtime,nextVersion);
  const recovered=await readSaved(page);assert.deepEqual(recovered,expected);step('retry-installs-complete-release-and-preserves-saves',{runtime:nextVersion,restored:recovered});
  phase='current';
  const fresh=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'allow'});
  try{
   const first=await fresh.newPage();first.on('pageerror',error=>report.pageErrors.push(error.message));
   await first.goto(base+'?skipIntro=1');
   await first.waitForFunction(runtime=>window.PhiOfflineNext?.versions.runtime===runtime&&!!navigator.serviceWorker.controller,version);
   await fresh.setOffline(true);const response=await first.reload({waitUntil:'domcontentloaded'});assert(response.fromServiceWorker());
   await first.waitForFunction(runtime=>window.PhiOfflineNext?.versions.runtime===runtime&&PhiOfflineNext.modules.StorageManager.mode()==='persistent',version);
   await first.screenshot({path:path.join(out,'offline-after-first-install.png')});step('first-install-can-reopen-shell-offline',{runtime:version,screenshot:'offline-after-first-install.png',limitation:'Only the program shell is prepared; this does not download all songs or optional resources.'});
  }finally{await fresh.close();}
  assert.deepEqual(report.pageErrors,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,error:report.error,steps:report.steps}));await context.close();await browser.close();await new Promise(resolve=>server.close(resolve));}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
