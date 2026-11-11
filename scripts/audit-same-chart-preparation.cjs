'use strict';
// Real UI and original local bytes/engine. Only the timing of an original
// transfer result (including its real AbortError) is controlled.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://127.0.0.1:4191',out=path.resolve(process.argv[3]||'work/same-chart-preparation');fs.mkdirSync(out,{recursive:true});
const report={scope:'Same Luminescence EZ entry cancel/re-enter, original cache/transfer/engine, controlled original completion order; not official fidelity',startedAt:new Date().toISOString(),sourceSHA256:crypto.createHash('sha256').update(fs.readFileSync('js/app.js')).digest('hex'),results:[]};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']});report.browser=browser.version();
 try{for(const scenario of ['immediate-abort','late-resolve','late-abort']){
  const dir=path.join(out,scenario);fs.mkdirSync(dir,{recursive:true});
  const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();page.setDefaultTimeout(15000);
  const row={scenario,steps:[],requests:[],pageErrors:[],consoleErrors:[],externalRequests:[]};let releaseRoute;
  const step=async(name)=>{const state=await page.evaluate(()=>({session:PhiInteractiveReplay.current,engine:window.__phiEngine?{name:__phiEngine.record.name,id:__phiEngine.record.visionReplay?.id,tier:__phiEngine.record.meta.difficultyClass,running:__phiEngine.running,time:__phiEngine.musicCurrentTime()}:null,playDisabled:document.querySelector('#libraryFocusPlay').disabled,loading:!document.querySelector('#loadingView').classList.contains('hidden'),calls:__chartCalls.map(c=>({call:c.call,signalAborted:c.signal.aborted,outcome:c.outcome,returned:!!c.returned})),settlements:__startSettlements,cache:__cacheTrace}));row.steps.push({name,at:new Date().toISOString(),state});console.log(JSON.stringify({scenario,step:name,session:state.session?.id,loading:state.loading,calls:state.calls,engine:state.engine}));return state;};
  async function select(){
   await page.waitForSelector('#libraryView:not(.hidden)');await page.locator('#libraryMoreBtn').click();const search=page.locator('#librarySearch');
   if(await search.inputValue()!=='Luminescence'){const previous=await page.locator('#chartList .card').first().elementHandle();await search.fill('Luminescence');if(previous)await page.waitForFunction(node=>!node.isConnected,previous);}
   await page.locator('#chartList .card').filter({hasText:'Luminescence'}).first().click();const difficulty=page.locator('#libraryFocusDifficulty [data-tier="EZ"]');await difficulty.click();assert.equal(await difficulty.getAttribute('aria-pressed'),'true');await page.locator('#libraryFocusPlay').click();
  }
  try{
   page.on('pageerror',e=>row.pageErrors.push(e.message));page.on('console',m=>{if(m.type()==='error')row.consoleErrors.push(m.text());});
   await context.addInitScript(()=>{
    window.__cacheTrace=[];window.__chartCalls=[];window.__startSettlements=[];window.__chartGate=null;
    let perf,exposed,next=0;const tokens=new WeakMap(),token=value=>{if(!value||!['object','function'].includes(typeof value))return null;if(!tokens.has(value))tokens.set(value,++next);return tokens.get(value);};
    Object.defineProperty(window,'PhiPerformance',{configurable:true,get:()=>perf,set:api=>{perf=api;for(const method of ['has','get','set','delete']){const original=api.ResourceCache.prototype[method];api.ResourceCache.prototype[method]=function(key,...args){const previous=this.entries.get(key),result=original.call(this,key,...args);if(key==='catalog-41c50afe2d44ef97-ez')__cacheTrace.push({method,capacity:this.maxEntries,key,previous:token(previous),value:token(method==='get'?result:args[0]),at:performance.now()});return result;};}}});
    Object.defineProperty(window,'PhiInteractiveReplay',{configurable:true,get:()=>exposed,set:api=>{const d=Object.getOwnPropertyDescriptors(api);d.configure={value(adapter){const original=adapter.startSong;return api.configure({...adapter,startSong:async function(...args){const id=args[1].visionReplay.id;let error;try{return await original.apply(adapter,args);}catch(e){error=e.message;throw e;}finally{__startSettlements.push({id,error,at:performance.now()});}}});}};exposed=Object.defineProperties({},d);}});
   });
   let firstRequest=true;
   await context.route('**/*',async route=>{
    const url=new URL(route.request().url());if(url.origin!==new URL(base).origin){row.externalRequests.push(url.href);return route.abort('blockedbyclient');}
    if(url.pathname.endsWith('/41c50afe2d44ef97-ez-bc051f9f49.json.gz')){
     row.requests.push({at:new Date().toISOString(),url:url.href});
     if(firstRequest&&scenario!=='late-resolve'){firstRequest=false;await new Promise(resolve=>{releaseRoute=resolve;});try{return await route.continue();}catch{return;}}
    }
    return route.continue();
   });
   await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext?.modules.BuiltinCatalog&&PhiOfflineNext.modules.StorageManager.mode()==='persistent');
   await page.evaluate(scenario=>{
    const original=PhiHostedMedia;
    window.PhiHostedMedia={...original,bytes:async(url,options)=>{
     if(!url.endsWith('/41c50afe2d44ef97-ez-bc051f9f49.json.gz'))return original.bytes(url,options);
     const call={call:__chartCalls.length+1,signal:options.signal,outcome:'pending'};__chartCalls.push(call);
     try{const bytes=await original.bytes(url,options);call.outcome='resolved';
      if(call.call===1&&scenario==='late-resolve')await new Promise(resolve=>{window.__chartGate={resolve,outcome:'resolved',bytes:bytes.length};});return bytes;
     }catch(error){call.outcome=error.name;call.originalError={name:error.name,message:error.message};
      if(call.call===1&&scenario==='late-abort')await new Promise(resolve=>{window.__chartGate={resolve,outcome:error.name};});throw error;
     }finally{call.returned=true;}
    }};
   },scenario);
   await select();await page.waitForFunction(()=>__chartCalls.length===1&&PhiInteractiveReplay.current?.loading);
   if(scenario==='late-resolve')await page.waitForFunction(()=>__chartGate?.outcome==='resolved');
   const old=await step('old-original-preparation-pending');await page.locator('#loadingBack').click();await page.waitForFunction(()=>!PhiInteractiveReplay.current);const cancelled=await step('cancelled-before-original-completion');assert.equal(cancelled.session,null);
   if(scenario==='late-abort')await page.waitForFunction(()=>__chartGate?.outcome==='AbortError');
   await select();await page.waitForFunction(id=>PhiInteractiveReplay.current?.id!==id,old.session.id);const replacement=await step('same-entry-started-before-old-result');assert(replacement.session);assert.notEqual(replacement.session.id,old.session.id);assert.equal(replacement.session.route.tier,'EZ');
   releaseRoute?.();releaseRoute=null;
   if(scenario!=='immediate-abort')await page.evaluate(()=>__chartGate.resolve());
   await page.waitForFunction(()=>__chartCalls[0].returned);
   await page.waitForFunction(id=>__startSettlements.some(s=>s.id===id),old.session.id);
   await page.waitForFunction(()=>window.__phiEngine?.running&&__phiEngine.record.visionReplay&&__phiEngine.musicCurrentTime()>.25);
   const playing=await step('new-session-after-old-settlement');assert.equal(playing.session.id,replacement.session.id);assert.equal(playing.engine.id,replacement.session.id);assert.equal(playing.engine.tier,'EZ');const start=playing.engine.time;await page.waitForFunction(t=>__phiEngine.musicCurrentTime()>t+.2,start);await step('new-music-clock-continues');
   await page.locator('#pauseBtn:visible,#innerPauseBtn:visible').first().click();await page.waitForFunction(()=>__phiEngine.paused);await page.locator('#quitBtn').click();await page.waitForFunction(()=>!PhiInteractiveReplay.current);await step('normal-quit-clears-ownership');
   assert.deepEqual(row.pageErrors,[]);assert.deepEqual(row.externalRequests,[]);row.status='passed';
  }catch(error){row.status='failed';row.error=error.stack;await step('failure-state').catch(()=>{});await page.screenshot({path:path.join(dir,'failure.png')}).catch(()=>{});process.exitCode=1;}
  finally{releaseRoute?.();row.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(row,null,2)+'\n');report.results.push(row);await context.close();}
 }}finally{report.finishedAt=new Date().toISOString();report.status=report.results.every(r=>r.status==='passed')?'passed':'failed';fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,results:report.results.map(r=>({scenario:r.scenario,status:r.status,error:r.error}))}));await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
