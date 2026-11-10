'use strict';
// Real app entry/rules/input/engine with already measured bytes supplied by a
// controlled browser transport. No network, fresh CORS or official comparison.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),zlib=require('node:zlib'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/replay-flow');
fs.mkdirSync(out,{recursive:true});
const main=JSON.parse(zlib.gunzipSync(fs.readFileSync('docs/evidence/2026-11-10-remote-resources/plan.json.gz'))),vision=JSON.parse(fs.readFileSync('docs/evidence/2026-11-10-vision-resources/plan.json'));
const specs=new Map(),loaded=new Map();
for(const [plan,cache] of [[main,'work/remote-resource-audit/cache'],[vision,'work/vision-resource-audit/cache']])for(const s of plan.resources){for(const url of [s.url,s.mirror].filter(Boolean))specs.set(url,{...s,cache,hash:s.expectedSHA256,bytes:s.expectedBytes});}
const report={scope:'Actual app replay entry and lifecycle; controlled transport of verified cached originals, no fresh external availability or official equivalence',startedAt:new Date().toISOString(),sourceHashes:Object.fromEntries(['js/app.js','js/interactive-replay.js','js/chapter8-replay-rules.js','js/boss-replay-rules.js'].map(p=>[p,crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex')])),steps:[],requests:[],pageErrors:[],unknownExternal:[]};
const step=(name,data={})=>{report.steps.push({name,at:new Date().toISOString(),...data});fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2));console.log(name,JSON.stringify(data));};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(20000);
 let held=null,holdTouch=true;
 const state=()=>page.evaluate(()=>({replay:PhiInteractiveReplay.current,engine:window.__phiEngine?{running:__phiEngine.running,paused:__phiEngine.paused,time:__phiEngine.musicCurrentTime(),replay:__phiEngine.record.visionReplay,name:__phiEngine.record.name}:null,video:{time:document.querySelector('#interactiveVisionScene video')?.currentTime,src:document.querySelector('#interactiveVisionScene video')?.getAttribute('src'),paused:document.querySelector('#interactiveVisionScene video')?.paused}}));
 async function select(name,tier){
  await page.waitForSelector('#libraryView:not(.hidden)');await page.locator('#libraryMoreBtn').click();await page.locator('#librarySearch').fill(name);
  const card=page.locator('#chartList .card').filter({has:page.locator('h3',{hasText:new RegExp('^'+name.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')+'(?: · 联网)?$')})}).first();
  await card.click();await page.waitForFunction(name=>document.querySelector('#libraryFocusTitle').textContent.startsWith(name),name);
  await page.locator('#libraryFocusDifficulty button[data-tier="'+tier+'"]').click();assert.match(await page.locator('#libraryFocusPlay').innerText(),/重演/);await page.locator('#libraryFocusPlay').click();
 }
 try{
  report.browser=browser.version();page.on('pageerror',e=>report.pageErrors.push(e.message));
  await context.route('**/*',async route=>{
   const req=route.request(),url=req.url();if(new URL(url).origin===new URL(base).origin)return route.continue();
   const s=specs.get(url);if(!s){report.unknownExternal.push(url);return route.abort('blockedbyclient');}
   const record={url,cache:s.cache,hash:s.hash};report.requests.push(record);
   if(url.includes('cdn.jsdelivr.net')&&(/\/DF_Unlock.mp4$/.test(url)||/\/AboutUs1.flac$/.test(url))){record.status='known-blocked-not-served';return route.abort('blockedbyclient');}
   if(holdTouch&&url.includes('/DF_Touch2Start.mp4')){holdTouch=false;record.controlledDelay=true;await new Promise(resolve=>{held=resolve;});}
   if(!loaded.has(s.hash)){
    const body=fs.readFileSync(path.join(s.cache,s.hash+'.bin'));assert.equal(body.length,s.bytes);assert.equal(crypto.createHash('sha256').update(body).digest('hex'),s.hash);loaded.set(s.hash,body);
   }
   const body=loaded.get(s.hash),range=req.headers().range?.match(/^bytes=(\d+)-(\d*)$/),headers={'access-control-allow-origin':'*','accept-ranges':'bytes'};
   if(range){const start=Number(range[1]),end=Math.min(body.length-1,range[2]?Number(range[2]):body.length-1);headers['content-range']=`bytes ${start}-${end}/${body.length}`;record.range=[start,end];try{await route.fulfill({status:206,headers,body:body.subarray(start,end+1)});}catch(e){record.cancelled=true;}return;}
   try{await route.fulfill({status:200,headers,body});record.status='cached-original';}catch(e){record.cancelled=true;}
  });
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext?.modules.StorageManager.mode()==='persistent');
  await select('Distorted Fate','HD');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.stage==='df-touch-lead');
  await page.waitForFunction(()=>!!document.querySelector('#interactiveVisionScene:not(.hidden)'));
  const holdDeadline=Date.now()+20000;while(!held&&Date.now()<holdDeadline)await page.waitForTimeout(20);assert(held,'controlled media request did not start within 20 seconds');
  const cancelledId=(await state()).replay.id;await page.keyboard.press('Escape');await page.waitForFunction(()=>!PhiInteractiveReplay.current&&!document.querySelector('#libraryView').classList.contains('hidden'));
  held();held=null;await page.waitForTimeout(250);assert.equal((await state()).replay,null);assert.equal((await state()).video.src,null);step('cancel-pending-original-media',{cancelledId});
  await select('Distorted Fate','HD');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.awaitingInput===true);
  const waiting=await state();assert.equal(waiting.video.paused,true);assert.equal(waiting.replay.route.tier,'HD');
  const root=page.locator('#interactiveVisionScene');await root.click({position:{x:200,y:200}});await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.stage==='df-unlock-main');
  step('real-pointer-gate-starts-unlock',{before:waiting,after:await state()});
  await page.waitForFunction(()=>window.__phiEngine?.running&&__phiEngine.record.visionReplay?.songKey==='distorted-fate'&&!__phiEngine.starting&&__phiEngine.musicCurrentTime()>.25,null,{timeout:75000});
  const playing=await state();assert.equal(playing.replay.route.tier,'HD');await page.screenshot({path:path.join(out,'df-chart-start.png')});step('native-df-scene-to-real-chart',{state:playing,screenshot:'df-chart-start.png'});
  await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click();await page.waitForFunction(()=>__phiEngine.paused);await page.locator('#restartBtn').click();
  await page.waitForFunction(id=>PhiInteractiveReplay.current?.id!==id&&PhiInteractiveReplay.current?.snapshot?.stage==='df-prepare',playing.replay.id);
  const restarted=await state();assert(!restarted.engine?.running);assert.equal(restarted.replay.route.tier,'HD');step('actual-retry-restarts-scene-and-releases-chart',{state:restarted});
  await page.locator('#interactiveVisionScene [data-action="exit"]').click();await page.waitForSelector('#libraryView:not(.hidden)');assert.equal((await state()).replay,null);
  await select('Igallta','EZ');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.sceneTime>1.1&&document.querySelector('#interactiveVisionScene video').currentTime>.05);
  await page.keyboard.press('Enter');await page.waitForFunction(()=>PhiInteractiveReplay.current?.snapshot?.phase==='intro');step('real-keyboard-starts-boss-intro',{state:await state()});
  await page.waitForFunction(()=>window.__phiEngine?.running&&__phiEngine.record.visionReplay?.songKey==='igallta'&&!__phiEngine.starting&&__phiEngine.musicCurrentTime()>.25,null,{timeout:45000});
  const boss=await state();assert.equal(boss.replay.route.tier,'EZ');step('native-boss-scene-to-real-chart',{state:boss});
  await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click();await page.waitForFunction(()=>__phiEngine.paused);await page.locator('#quitBtn').click();await page.waitForSelector('#libraryView:not(.hidden)');
  assert.equal((await state()).replay,null);assert(!((await state()).engine?.running));step('real-quit-clears-replay-and-engine',{});
  assert.deepEqual(report.pageErrors,[]);assert.deepEqual(report.unknownExternal,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;report.failureState=await state().catch(()=>null);await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});process.exitCode=1;console.error(error);}
 finally{held?.();report.finishedAt=new Date().toISOString();report.uniqueCachedFiles=loaded.size;report.uniqueCachedBytes=[...loaded.values()].reduce((n,b)=>n+b.length,0);fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,steps:report.steps.length,error:report.error}));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
