'use strict';
// Fault/completion ordering is controlled. Contexts, worklet factories, decoded
// music and original resume/restart paths are native; no organic/Safari claim.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/audio-session-ownership');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(process.env.PHI_TEST_APP_SOURCE||'js/app.js','utf8');
async function mixerScenario(page,mode){return page.evaluate(async mode=>{
 const E=PhiOfflineNext.modules.RenderEngine.Engine,M=PhiOfflineNext.modules.AudioEngine.PhiHitAudioMixer,original=M.create;
 const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
 const oldGate=defer(),newGate=defer();let oldMixer,newMixer,calls=0,oldDestroyed=0,old,next,same;
 const until=async predicate=>{const limit=performance.now()+10000;while(!predicate()){if(performance.now()>limit)throw Error('native worklet boundary did not arrive');await new Promise(r=>setTimeout(r,10));}};
 M.create=async function(...args){const index=++calls,mixer=await original.apply(this,args);if(index===1){oldMixer=mixer;const destroy=mixer.destroy;mixer.destroy=function(){oldDestroyed++;return destroy.call(this);};await oldGate.promise;}if(index===2){newMixer=mixer;if(mode==='pending')await newGate.promise;}return mixer;};
 try{
  E.resetSharedAudioContext('native-ownership-test');await E.ensureAudioContextRunning();const oldContext=E._ac;old=E.ensureHitMixer();await until(()=>oldMixer);
  E.resetSharedAudioContext('native-ownership-replacement');await E.ensureAudioContextRunning();next=E.ensureHitMixer();await until(()=>newMixer);const owner=E._hitMixerPromise;
  if(mode==='ready')await next;
  oldGate.resolve();const stale=await old;
  const retained={promise:mode==='ready'?E._hitMixerPromise===null:E._hitMixerPromise===owner,mixer:E._hitMixer===newMixer,staleIsNull:stale===null,oldDestroyed,oldState:oldContext.state};
  if(mode==='pending'){same=E.ensureHitMixer();await new Promise(r=>setTimeout(r,50));}
  const creationCount=calls;newGate.resolve();await Promise.all([next,same]);
  return {mode,retained,creationCount,finalCurrent:E._hitMixer===newMixer&&E._hitMixer.context===E._ac};
 }finally{oldGate.resolve();newGate.resolve();await Promise.allSettled([old,next,same]);M.create=original;oldMixer?.destroy();if(newMixer!==E._hitMixer)newMixer?.destroy();E.resetSharedAudioContext('native-ownership-cleanup');}
},mode);}
async function sessionScenario(page,boundary){return page.evaluate(async boundary=>{
 const e=__phiEngine,E=e.constructor,key=boundary==='context'?'ensureAudioContextRunning':'ensureHitMixer',original=E[key];
 let reject,observed=false,held=false;const failure=new Promise((_,no)=>reject=no);
 E[key]=function(...args){if(!held&&e.resumePending&&(boundary==='mixer'||args[0]===1600)){held=true;return original.apply(this,args).then(()=>{observed=true;return failure;});}return original.apply(this,args);};
 let old;
 try{
  e.pause();old=e.resume();const deadline=performance.now()+8000;while(!observed){if(performance.now()>deadline)throw Error('session preparation boundary did not arrive');await new Promise(r=>setTimeout(r,10));}
  await e.restart();const replacement=e.musicSource;await new Promise(r=>setTimeout(r,350));const before=e.musicCurrentTime();
  if(!replacement||!e.musicUsingWebAudio||!e.musicPlaying)throw Error('replacement native source did not start');
  reject(new Error('controlled obsolete '+boundary+' failure'));await old;
  const retained={source:e.musicSource===replacement,webAudio:e.musicUsingWebAudio,playing:e.musicPlaying,running:e.running,paused:e.paused};
  await new Promise(r=>setTimeout(r,350));return {boundary,before,after:e.musicCurrentTime(),retained};
 }finally{reject(new Error('test cleanup'));await Promise.allSettled([old]);E[key]=original;}
},boundary);}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'});
 const report={scope:'Controlled obsolete failures and native worklet creation completion order; official/Safari/physical latency unverified',browser:browser.version(),appSHA256:crypto.createHash('sha256').update(source).digest('hex'),pageErrors:[],mixers:[],sessions:[],failures:[]};
 async function open(){const page=await context.newPage();page.on('pageerror',error=>report.pageErrors.push(error.message));await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext&&document.querySelector('#libraryFocusTitle').textContent==='Leave All Behind');return page;}
 try{
  if(process.env.PHI_TEST_APP_SOURCE)await context.route('**/js/app.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
  const mixerPage=await open();for(const mode of ['ready','pending']){
   const r=await mixerScenario(mixerPage,mode);report.mixers.push(r);
   if(!r.retained.promise||!r.retained.staleIsNull||r.retained.oldDestroyed!==1||r.creationCount!==2||!r.finalCurrent||(mode==='ready'&&!r.retained.mixer))report.failures.push('obsolete '+mode+' mixer changed replacement ownership');
  }await mixerPage.close();
  for(const boundary of ['context','mixer']){
   const page=await open();await page.locator('#libraryFocusDifficulty [data-tier="EZ"]').click();await page.locator('#libraryFocusPlay').click();
   await page.waitForFunction(()=>window.__phiEngine?.musicUsingWebAudio&&!__phiEngine.starting&&__phiEngine.musicCurrentTime()>.5,null,{timeout:90000});
   const r=await sessionScenario(page,boundary);report.sessions.push(r);
   if(!r.retained.source||!r.retained.webAudio||!r.retained.playing||!r.retained.running||r.retained.paused||!(r.after>r.before+.15))report.failures.push('obsolete '+boundary+' failure stopped replacement playback');
   await page.screenshot({path:path.join(out,'after-'+boundary+'.png')});await page.close();
  }
  if(report.pageErrors.length)report.failures.push('page errors');report.status=report.failures.length?'failed':'passed';if(report.failures.length)process.exitCode=1;
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
