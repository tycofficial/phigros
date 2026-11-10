'use strict';
// Real Rrharil input and preparation handoff. Cached original bytes only;
// chapter rules, media rates, engine and timing are not replaced.
const {chromium}=require('playwright');
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://127.0.0.1:4190',out=path.resolve(process.argv[3]||'work/replay-ownership');
const selectedCase=process.env.PHI_REPLAY_OWNERSHIP_CASE||'all';assert(['all','rrharil','preparation'].includes(selectedCase),'Unknown ownership case');
fs.mkdirSync(out,{recursive:true});
const plans=[['docs/evidence/2026-11-10-remote-resources/plan.json.gz','work/remote-resource-audit/cache'],['docs/evidence/2026-11-10-vision-resources/plan.json','work/vision-resource-audit/cache']];
const specs=new Map(),loaded=new Map();
for(const [file,cache] of plans){const raw=fs.readFileSync(file),p=JSON.parse(file.endsWith('.gz')?zlib.gunzipSync(raw):raw);for(const s of p.resources)for(const url of [s.url,s.mirror].filter(Boolean))specs.set(url,{...s,cache,hash:s.expectedSHA256,bytes:s.expectedBytes});}
const report={scope:'Real app Rrharil hold/release/re-entry and preparation ownership; verified cached bytes through controlled transport. No fresh CORS, official fidelity or physical-device comparison.',startedAt:new Date().toISOString(),sourceHashes:Object.fromEntries(['js/app.js','js/interactive-replay.js','js/boss-replay-rules.js','js/boss-replay-visuals.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),steps:[],requests:[],pageErrors:[],consoleErrors:[],unknownExternal:[]};
report.selectedCase=selectedCase;
const step=(name,data={})=>{report.steps.push({name,at:new Date().toISOString(),...data});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(name,JSON.stringify(data));};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);
 const state=()=>page.evaluate(()=>({replay:PhiInteractiveReplay.current,engine:window.__phiEngine?{name:__phiEngine.record.name,running:__phiEngine.running,paused:__phiEngine.paused,time:__phiEngine.musicCurrentTime(),replay:__phiEngine.record.visionReplay}:null,video:{time:document.querySelector('#interactiveVisionScene video')?.currentTime,src:document.querySelector('#interactiveVisionScene video')?.getAttribute('src'),rate:document.querySelector('#interactiveVisionScene video')?.playbackRate},loading:!document.querySelector('#loadingView').classList.contains('hidden'),library:!document.querySelector('#libraryView').classList.contains('hidden')}));
 async function select(key,tier){
  const name=await page.evaluate(({key,tier})=>PhiOfflineNext.modules.BuiltinCatalog.entries.find(e=>PhiInteractiveReplay.songKey(e)===key&&e.meta.difficultyClass===tier)?.name,{key,tier});assert(name,'catalog entry missing: '+key+' '+tier);
  await page.waitForSelector('#libraryView:not(.hidden)');await page.locator('#libraryMoreBtn').click();
  const search=page.locator('#librarySearch');if(await search.inputValue()!==name){const previous=await page.locator('#chartList .card').first().elementHandle();await search.fill(name);if(previous)await page.waitForFunction(node=>!node.isConnected,previous);}
  await page.locator('#chartList .card').filter({hasText:name}).first().click();await page.waitForFunction(name=>document.querySelector('#libraryFocusTitle').textContent===name,name);
  const difficulty=page.locator('#libraryFocusDifficulty [data-tier="'+tier+'"]');await difficulty.click();assert.equal(await difficulty.getAttribute('aria-pressed'),'true');(report.selections||=[]).push({key,tier,name,at:new Date().toISOString()});assert.match(await page.locator('#libraryFocusPlay').innerText(),/重演/);await page.locator('#libraryFocusPlay').click();
 }
 try{
  report.browser=browser.version();page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')report.consoleErrors.push(m.text());});
  if(selectedCase!=='rrharil')await context.addInitScript(()=>{
   let exposed;window.__replayStartSettlements=[];
   Object.defineProperty(window,'PhiInteractiveReplay',{configurable:true,get:()=>exposed,set:api=>{
    const descriptors=Object.getOwnPropertyDescriptors(api);
    descriptors.configure={value(adapter){const start=adapter.startSong;return api.configure({...adapter,startSong:async function(...args){const id=args[1].visionReplay.id;let error;try{return await start.apply(adapter,args);}catch(e){error=e.message;throw e;}finally{__replayStartSettlements.push({id,error,at:performance.now()});}}});}};
    exposed=Object.defineProperties({},descriptors);
   }});
  });
  await context.route('**/*',async route=>{
   const req=route.request(),url=req.url();if(new URL(url).origin===new URL(base).origin)return route.continue();
   const s=specs.get(url);if(!s){report.unknownExternal.push(url);return route.abort('blockedbyclient');}
   const row={url,hash:s.hash};report.requests.push(row);
   if(url.includes('cdn.jsdelivr.net')&&(/\/DF_Unlock.mp4$/.test(url)||/\/AboutUs1.flac$/.test(url))){row.status='known-blocked-not-served';return route.abort('blockedbyclient');}
   if(!loaded.has(s.hash)){const body=fs.readFileSync(path.join(s.cache,s.hash+'.bin'));assert.equal(body.length,s.bytes);assert.equal(crypto.createHash('sha256').update(body).digest('hex'),s.hash);loaded.set(s.hash,body);}
   const body=loaded.get(s.hash),range=req.headers().range?.match(/^bytes=(\d+)-(\d*)$/),headers={'access-control-allow-origin':'*','accept-ranges':'bytes'};
   if(range){const start=Number(range[1]),end=Math.min(body.length-1,range[2]?Number(range[2]):body.length-1);headers['content-range']=`bytes ${start}-${end}/${body.length}`;try{await route.fulfill({status:206,headers,body:body.subarray(start,end+1)});}catch{row.cancelled=true;}return;}
   try{await route.fulfill({status:200,headers,body});row.status='cached-original';}catch{row.cancelled=true;}
  });
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext?.modules.BuiltinCatalog&&PhiOfflineNext.modules.StorageManager.mode()==='persistent');
  if(selectedCase!=='preparation'){
  await select('rrharil','EZ');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='clock');
  const initial=await state();assert.equal(initial.replay.snapshot.cameraZ,-10);assert.equal(initial.replay.snapshot.held,false);assert.equal(initial.video.rate,1);step('native-reverse-reaches-fresh-clock',{state:initial});
  await page.keyboard.down('Enter');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.cameraZ>30);const held=await state();assert(held.replay.snapshot.held);await page.keyboard.up('Enter');await page.waitForTimeout(1500);
  const released=await state();assert.equal(released.replay.snapshot.held,false);assert(released.replay.snapshot.cameraSpeed<held.replay.snapshot.cameraSpeed/10);step('real-keyboard-hold-and-release-decelerate',{held,released});
  await page.keyboard.down('Enter');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='clock-ready');const ready=await state();await page.keyboard.up('Enter');await page.waitForTimeout(100);
  const afterRelease=await state();step('release-after-clock-ready',{ready,afterRelease});assert.equal(afterRelease.replay.snapshot.phase,'clock-ready','the old clock hold release must not confirm the next scene');
  await page.screenshot({path:path.join(out,'clock-ready.png')});
  const firstId=afterRelease.replay.id;await page.keyboard.press('Escape');await page.waitForFunction(()=>!PhiInteractiveReplay.current);await select('rrharil','HD');
  await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='clock');const reentered=await state();assert.notEqual(reentered.replay.id,firstId);assert.equal(reentered.replay.snapshot.cameraZ,-10);assert.equal(reentered.replay.snapshot.cameraSpeed,0);assert.equal(reentered.replay.snapshot.held,false);assert.equal(reentered.replay.route.tier,'HD');step('real-reentry-resets-clock-and-keeps-new-tier',{state:reentered});
  const box=await page.locator('#interactiveVisionScene').boundingBox();await page.mouse.move(box.x+box.width/2,box.y+box.height/2);await page.mouse.down();await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.cameraZ>30);const pointerHeld=await state();await page.mouse.up();await page.waitForTimeout(1500);const pointerReleased=await state();assert.equal(pointerReleased.replay.snapshot.phase,'clock');assert.equal(pointerReleased.replay.snapshot.held,false);assert(pointerReleased.replay.snapshot.cameraSpeed<pointerHeld.replay.snapshot.cameraSpeed/10);step('real-pointer-hold-and-release-decelerate',{held:pointerHeld,released:pointerReleased});
  await page.mouse.down();await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='clock-ready');await page.mouse.up();assert.equal((await state()).replay.snapshot.phase,'clock-ready');
  const point=await page.evaluate(()=>{const root=document.querySelector('#interactiveVisionScene'),rect=root.getBoundingClientRect(),polygon=PhiBossReplayVisuals.buttonPolygon(PhiInteractiveReplay.current.snapshot,{width:rect.width,height:rect.height});return {x:rect.x+polygon.reduce((n,p)=>n+p.x,0)/polygon.length,y:rect.y+polygon.reduce((n,p)=>n+p.y,0)/polygon.length};});
  await page.mouse.click(point.x,point.y);await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='entry');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.sceneTime>.8);await page.locator('#interactiveVisionScene').click({position:{x:640,y:360}});await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='intro'&&document.querySelector('#interactiveVisionScene video').currentTime>.05);step('actual-play-target-starts-original-unlock',{state:await state()});
  await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='ready',null,{timeout:45000});assert(!((await state()).engine?.running));await page.keyboard.press('Enter');
  await page.waitForFunction(()=>window.__phiEngine?.running&&__phiEngine.record.visionReplay?.songKey==='rrharil'&&__phiEngine.musicCurrentTime()>.25,null,{timeout:45000});const playing=await state();assert.equal(playing.replay.route.tier,'HD');await page.screenshot({path:path.join(out,'rrharil-chart.png')});step('original-rr-unlock-final-play-to-real-chart',{state:playing});
  await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click();await page.waitForFunction(()=>__phiEngine.paused);await page.locator('#quitBtn').click();await page.waitForFunction(()=>!PhiInteractiveReplay.current);step('actual-quit-releases-rr-session',{});
  }
  if(selectedCase!=='rrharil'){
  // Delay completion only after the original chart transfer has produced its
  // real bytes. Test ownership independently of cooperative transport abort.
  await page.evaluate(()=>{
   const original=PhiHostedMedia;window.__heldPreparation=null;let hold=true;
   window.PhiHostedMedia={...original,bytes:async(url,options)=>{const bytes=await original.bytes(url,options);if(hold&&url.includes('/catalog-charts/')){hold=false;await new Promise(resolve=>{window.__heldPreparation={resolve,url,byteLength:bytes.length,signal:options.signal};});}return bytes;}};
  });
  await select('luminescence','EZ');await page.waitForFunction(()=>window.__heldPreparation&&PhiInteractiveReplay.current?.loading);const preparing=await state();step('actual-chart-preparation-held-after-transfer',{state:preparing,prepared:await page.evaluate(()=>({url:__heldPreparation.url,bytes:__heldPreparation.byteLength}))});
  await page.locator('#loadingBack').click();await page.waitForSelector('#libraryView:not(.hidden)');const cancelled=await state();step('loading-back-releases-replay-ownership',{state:cancelled});assert.equal(cancelled.replay,null,'loading Back must release the replay before an old preparation callback returns');
  await select('luminescence','HD');await page.waitForFunction(()=>window.__phiEngine?.running&&__phiEngine.record.visionReplay?.songKey==='luminescence'&&__phiEngine.musicCurrentTime()>.25);const replacement=await state();assert.notEqual(replacement.replay.id,preparing.replay.id);assert.equal(replacement.replay.route.tier,'HD');
  await page.evaluate(()=>__heldPreparation.resolve());await page.waitForFunction(id=>__replayStartSettlements.some(item=>item.id===id),preparing.replay.id);await page.waitForTimeout(100);const afterOld=await state();assert.equal(afterOld.replay.id,replacement.replay.id);assert.equal(afterOld.engine.replay.id,replacement.replay.id);assert(afterOld.engine.running);assert(afterOld.engine.time>replacement.engine.time);step('late-preparation-cannot-revive-or-stop-new-session',{before:replacement,after:afterOld,oldSignalAborted:await page.evaluate(()=>__heldPreparation.signal.aborted),settlements:await page.evaluate(()=>__replayStartSettlements)});
  await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click();await page.waitForFunction(()=>__phiEngine.paused);await page.locator('#quitBtn').click();await page.waitForFunction(()=>!PhiInteractiveReplay.current);step('replacement-quit-clears-ownership',{});
  }
  report.status='passed';assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.unknownExternal,[]);
 }catch(error){report.status='failed';report.error=error.stack;report.failureState=await state().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;console.error(error);}
 finally{report.finishedAt=new Date().toISOString();report.uniqueCachedFiles=loaded.size;report.uniqueCachedBytes=[...loaded.values()].reduce((n,b)=>n+b.length,0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,steps:report.steps.length,error:report.error}));await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
