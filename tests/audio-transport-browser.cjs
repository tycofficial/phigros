'use strict';
// Real decoded music and AudioBufferSource playback with a controlled activation delay.
// This verifies lifecycle isolation, not official timing or physical audio latency.
const {chromium}=require('playwright'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/audio-transport');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();
 const source=fs.readFileSync(process.env.PHI_TEST_APP_SOURCE||'js/app.js','utf8');
 const report={scope:'Engineering audio transport lifecycle only; official equivalence unverified',browser:browser.version(),appSHA256:crypto.createHash('sha256').update(source).digest('hex'),pageErrors:[]};
 try{
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  if(process.env.PHI_TEST_APP_SOURCE)await context.route('**/js/app.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.PhiOfflineNext&&document.querySelector('#libraryFocusTitle').textContent==='Leave All Behind');
  await page.locator('#libraryFocusDifficulty [data-tier="EZ"]').click();await page.locator('#libraryFocusPlay').click();
  await page.waitForFunction(()=>window.__phiEngine?.musicUsingWebAudio&&!__phiEngine.starting&&__phiEngine.musicCurrentTime()>.5,null,{timeout:90000});
  report.superseded=await page.evaluate(async()=>{
   const e=__phiEngine,E=e.constructor,original=E.ensureAudioContextRunning,ac=E.sharedAudioContext();let release,held=false;
   E.ensureAudioContextRunning=function(...args){if(!held){held=true;return new Promise(resolve=>{release=()=>resolve(ac);});}return original.apply(this,args);};
   try{
    const old=e.startMusic(0);await e.start(false);
    const replacement=e.musicSource,before=e.musicCurrentTime();release();await old;
    const retained=e.musicSource===replacement;
    await new Promise(resolve=>setTimeout(resolve,350));
    return {retained,before,after:e.musicCurrentTime(),playing:e.musicPlaying,running:e.running,paused:e.paused,autoplay:e.autoplay};
   }finally{E.ensureAudioContextRunning=original;}
  });
  assert.equal(report.superseded.retained,true,'Stale activation replaced the new AudioBufferSource');
  assert.equal(report.superseded.playing,true);assert.equal(report.superseded.autoplay,false);
  assert(report.superseded.after>report.superseded.before+.15);
  report.stopped=await page.evaluate(async()=>{
   const e=__phiEngine,E=e.constructor,original=E.ensureAudioContextRunning,ac=E.sharedAudioContext();let release;
   E.ensureAudioContextRunning=()=>new Promise(resolve=>{release=()=>resolve(ac);});
   try{
    const pending=e.startMusic(0);e.stop();release();await pending;
    return {running:e.running,playing:e.musicPlaying,hasSource:!!e.musicSource};
   }finally{E.ensureAudioContextRunning=original;}
  });
  assert.deepEqual(report.stopped,{running:false,playing:false,hasSource:false});
  assert.deepEqual(report.pageErrors,[]);report.status='passed';
  await page.screenshot({path:path.join(out,'after-cancel.png')});
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
