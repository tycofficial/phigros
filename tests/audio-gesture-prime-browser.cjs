'use strict';
// Real local music, HTML media and resume/countdown/timeouts; only the first muted
// play observation is delayed. This measures controlled ordering, not Safari frequency.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/audio-gesture-prime');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(process.env.PHI_TEST_APP_SOURCE||'js/app.js','utf8');
async function scenario(page,mode){return page.evaluate(async mode=>{
 const e=__phiEngine,a=e.audio,originalPlay=a.play;
 let settle,reject,observed=false,primeCalls=0;const delayed=new Promise((yes,no)=>{settle=yes;reject=no;});
 a.play=function(...args){const prime=this.muted&&primeCalls++===0;return originalPlay.apply(this,args).then(()=>{if(prime){observed=true;return delayed;}});};
 const state=()=>({paused:a.paused,muted:a.muted,time:a.currentTime,running:e.running,resumePending:e.resumePending});
 let resume;
 try{
  e.pause();const preserved=a.currentTime,at=performance.now();resume=e.resume();
  const deadline=at+4000;while(!observed){if(performance.now()>deadline)throw Error('native muted prime did not start');await new Promise(r=>setTimeout(r,10));}
  if(mode==='cancel-resume'){e.pause();await resume;resume=e.resume();}
  await resume;await new Promise(r=>setTimeout(r,350));const before=state();
  if(before.paused||before.resumePending)throw Error('replacement media has not started at overlap');
  if(mode==='timeout-rejection')reject(new Error('controlled old play rejection'));else settle();
  await new Promise(r=>setTimeout(r,50));const after=state();await new Promise(r=>setTimeout(r,250));
  return {mode,preserved,before,after,later:state(),elapsed:performance.now()-at};
 }finally{settle();await Promise.allSettled([resume]);a.play=originalPlay;}
},mode);}
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();
 const report={scope:'Controlled delayed gesture-prime observation on native HTML media; official/Safari timing unverified',browser:browser.version(),appSHA256:crypto.createHash('sha256').update(source).digest('hex'),pageErrors:[],scenarios:[]};
 try{
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  if(process.env.PHI_TEST_APP_SOURCE)await context.route('**/js/app.js*',route=>route.fulfill({contentType:'application/javascript',body:source}));
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext&&document.querySelector('#libraryFocusTitle').textContent==='Leave All Behind');
  await page.evaluate(()=>{const E=PhiOfflineNext.modules.RenderEngine.Engine;window.__originalPrepareMusic=E.prototype.prepareMusicBuffer;E.prototype.prepareMusicBuffer=async()=>{throw new DOMException('Controlled Web Audio unavailability','NotSupportedError');};});
  await page.locator('#libraryFocusDifficulty [data-tier="EZ"]').click();await page.locator('#libraryFocusPlay').click();
  await page.waitForFunction(()=>window.__phiEngine?.running&&!__phiEngine.starting&&!__phiEngine.musicUsingWebAudio&&__phiEngine.musicCurrentTime()>.5,null,{timeout:90000});
  await page.evaluate(()=>{__phiEngine.constructor.prototype.prepareMusicBuffer=window.__originalPrepareMusic;delete window.__originalPrepareMusic;});
  for(const mode of ['timeout-fulfillment','timeout-rejection','cancel-resume']){
   const result=await scenario(page,mode);report.scenarios.push(result);
   assert.equal(result.before.muted,false,'resume still carries the prime temporary mute');assert.equal(result.after.paused,false,'old prime paused replacement playback');
   assert.equal(result.after.muted,false);assert(result.after.time>=result.before.time-.03,'old prime rewound replacement playback');
   assert(result.later.time>result.after.time+.1,'replacement music clock stopped');
  }
  assert.deepEqual(report.pageErrors,[]);report.status='passed';await page.screenshot({path:path.join(out,'after-prime.png')});
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
