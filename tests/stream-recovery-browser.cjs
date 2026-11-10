'use strict';
// Real HTML media fallback and shipped Engine lifecycles; only I/O observation timing is controlled.
// This is not a live-network measurement or an official/Safari timing comparison.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/stream-recovery');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(process.env.PHI_TEST_APP_SOURCE||'js/app.js','utf8');
const scenario=(page,mode)=>page.evaluate(async mode=>{
 const e=__phiEngine,a=e.audio,s=e.streamSession,originalPlay=a.play,originalWait=s.wait;
 const ready=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'readyState').get,buffered=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'buffered').get;
 const oldReady=Object.getOwnPropertyDescriptor(a,'readyState'),oldBuffered=Object.getOwnPropertyDescriptor(a,'buffered');
 const defer=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};
 const oldPlay=defer(),nextPlay=defer(),nextReady=defer();let starved=true,plays=0,started=0,waits=0,oldDone=false,oldRecovery,replacement,current;
 const until=async predicate=>{const deadline=performance.now()+4000;while(!predicate()){if(performance.now()>deadline)throw Error('controlled media boundary did not arrive');await new Promise(r=>setTimeout(r,10));}};
 Object.defineProperty(a,'readyState',{configurable:true,get:()=>starved?2:ready.call(a)});
 Object.defineProperty(a,'buffered',{configurable:true,get:()=>starved?{length:0}:buffered.call(a)});
 a.play=function(...args){if(this.muted)return originalPlay.apply(this,args);const call=++plays;return originalPlay.apply(this,args).then(()=>{started++;return call===1?oldPlay.promise:call===2&&mode==='pending-start'?nextPlay.promise:undefined;});};
 s.wait=function(...args){
  if(e.starting||e.resumePending){starved=false;return originalWait.apply(this,args);}
  waits++;
  if(waits===1){starved=false;return originalWait.apply(this,args);}
  return nextReady.promise.then(()=>{starved=false;return originalWait.apply(this,args);});
 };
 try{
  const at=performance.now();oldRecovery=e.recoverStreamBuffer().then(()=>{oldDone=true;});await until(()=>started===1);
  const cancelled=e.streamRecoveryAbort;
  if(mode==='pending-start'){
   replacement=e.restart();await until(()=>started===2);
   if(oldDone)throw Error('old recovery settled before the requested overlap');
   const before={paused:a.paused,starting:e.starting};if(before.paused)throw Error('replacement media was not playing at the requested overlap');oldPlay.resolve();await oldRecovery;
   const during={paused:a.paused,starting:e.starting};nextPlay.resolve();await replacement;
   const timeBefore=a.currentTime;await new Promise(r=>setTimeout(r,300));
   return {mode,before,during,after:{paused:a.paused,running:e.running,starting:e.starting,timeBefore,timeAfter:a.currentTime},elapsed:performance.now()-at};
  }
  e.pause();replacement=e.resume();await replacement;
  if(oldDone)throw Error('old recovery settled before the requested overlap');
  const resumeInput={buffered:e.inputCapturedWhileBuffered(performance.now()),pending:e.streamRecoveryPending};
  starved=true;current=e.recoverStreamBuffer();await until(()=>waits===2);
  const owner=e.streamRecoveryAbort,progress=s.onProgress;oldPlay.resolve();await oldRecovery;
  const retained={controller:e.streamRecoveryAbort===owner,progress:s.onProgress===progress,pending:e.streamRecoveryPending,buffering:e.streamBuffering,visible:!document.querySelector('#streamBufferStatus').classList.contains('hidden'),oldAborted:cancelled.signal.aborted};
  nextReady.resolve();await current;return {mode,resumeInput,retained,after:{pending:e.streamRecoveryPending,buffering:e.streamBuffering,paused:a.paused},elapsed:performance.now()-at};
 }finally{
  starved=false;oldPlay.resolve();nextPlay.resolve();nextReady.resolve();await Promise.allSettled([oldRecovery,replacement,current]);
  a.play=originalPlay;s.wait=originalWait;
  if(oldReady)Object.defineProperty(a,'readyState',oldReady);else delete a.readyState;
  if(oldBuffered)Object.defineProperty(a,'buffered',oldBuffered);else delete a.buffered;
 }
},mode);
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();
 const report={scope:'Controlled callback ordering on real HTML media and Engine lifecycles; no official or physical latency conclusion',browser:browser.version(),appSHA256:crypto.createHash('sha256').update(source).digest('hex'),pageErrors:[]};
 try{
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  if(process.env.PHI_TEST_APP_SOURCE)await context.route('**/js/app.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext&&document.querySelector('#libraryFocusTitle').textContent==='Leave All Behind');
  // Force the existing fallback selection; music still uses the actual local song/decoder.
  await page.evaluate(()=>{const E=PhiOfflineNext.modules.RenderEngine.Engine;window.__originalPrepareMusic=E.prototype.prepareMusicBuffer;E.prototype.prepareMusicBuffer=async()=>{throw new DOMException('Controlled Web Audio unavailability','NotSupportedError');};});
  await page.locator('#libraryFocusDifficulty [data-tier="EZ"]').click();await page.locator('#libraryFocusPlay').click();
  await page.waitForFunction(()=>window.__phiEngine?.running&&!__phiEngine.starting&&!__phiEngine.musicUsingWebAudio&&__phiEngine.musicCurrentTime()>.5,null,{timeout:90000});
  await page.evaluate(()=>{__phiEngine.constructor.prototype.prepareMusicBuffer=window.__originalPrepareMusic;delete window.__originalPrepareMusic;});
  report.pendingStart=await scenario(page,'pending-start');
  assert.equal(report.pendingStart.during.paused,false,'old recovery paused the actual replacement media');assert.equal(report.pendingStart.after.paused,false);
  assert(report.pendingStart.after.timeAfter>report.pendingStart.after.timeBefore+.1,'replacement music clock did not advance');
  report.resumeOwner=await scenario(page,'resume-owner');
  assert.deepEqual(report.resumeOwner.resumeInput,{buffered:false,pending:false});
  assert.deepEqual(report.resumeOwner.retained,{controller:true,progress:true,pending:true,buffering:true,visible:true,oldAborted:true});
  assert.deepEqual(report.resumeOwner.after,{pending:false,buffering:false,paused:false});
  assert.deepEqual(report.pageErrors,[]);report.status='passed';await page.screenshot({path:path.join(out,'after-recovery.png')});
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
