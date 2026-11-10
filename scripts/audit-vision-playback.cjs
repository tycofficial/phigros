'use strict';
// Reuse measured cache bytes on loopback. Native media and the shipped surface
// run unchanged; this does not prove remote CORS or complete chapter timelines.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/vision-resource-audit/playback'),planPath=process.argv[4]||'docs/evidence/2026-11-10-vision-resources/plan.json',cacheURL=process.argv[5]||'/work/vision-resource-audit/cache/';
const plan=JSON.parse(fs.readFileSync(planPath)),source=fs.readFileSync('js/interactive-replay.js','utf8');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 const context=await browser.newContext({viewport:{width:1280,height:720},serviceWorkers:'block'}),page=await context.newPage();
 const report={scope:'Verified cache bytes, original createSurface, native muted playback at start/end and loop/codec-selection checks; not remote CORS, full real-time playthrough or official reference matching',browser:browser.version(),startedAt:new Date().toISOString(),sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),externalRequests:[],pageErrors:[],results:[]};
 try{
  page.on('pageerror',e=>report.pageErrors.push(e.message));page.on('request',r=>{if(new URL(r.url()).origin!==new URL(base).origin&&!r.url().startsWith('blob:')&&!r.url().startsWith('data:'))report.externalRequests.push(r.url());});
  page.on('console',message=>{if(message.text().startsWith('natural-playback '))console.log(message.text());});
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiVisionReplay);
  await page.addScriptTag({content:source.slice(source.indexOf('  function createSurface('),source.indexOf('  let installed='))+'\nglobalThis.__auditSurfaceFactory=createSurface;'});
  await page.evaluate(async({contents,cacheURL})=>{
   window.__auditCache=new Map();window.__auditSelections=[];window.__auditMediaErrors=[];
   for(const s of contents){const response=await fetch(cacheURL+s.sha256+'.bin'),data=new Uint8Array(await response.arrayBuffer()),digest=await crypto.subtle.digest('SHA-256',data),hash=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');if(data.length!==s.bytes||hash!==s.sha256)throw Error('Cached bytes differ: '+s.id);__auditCache.set(s.sha256,data);}
   const real=PhiVisionReplay;window.PhiVisionReplay={...real,download:async(value,options)=>{if(options.signal?.aborted)throw new DOMException('cancelled','AbortError');const s=real.info(value);if(!s||!__auditCache.has(s.sha256))throw Error('No measured cache for requested media');__auditSelections.push({id:s.id,url:s.url});return __auditCache.get(s.sha256);}};
   const NativeAudio=window.Audio,created=[];window.Audio=function(...args){const a=new NativeAudio(...args);created.push(a);return a;};window.Audio.prototype=NativeAudio.prototype;
   try{window.__auditUI=__auditSurfaceFactory({input(){},cancel(){},error:e=>__auditMediaErrors.push(e.message)},window);}finally{window.Audio=NativeAudio;}
   window.__auditCredits=created.at(-1);__auditCredits.muted=true;window.__auditNativeCanPlay=__auditCredits.canPlayType.bind(__auditCredits);
  },{contents:plan.contents,cacheURL:new URL(cacheURL,base).href});
  const filter=process.env.PHI_VISION_MEDIA_IDS?.split(',');report.selectedMediaIDs=filter||plan.contents.map(s=>s.id);
  for(const spec of plan.contents.filter(s=>!filter||filter.includes(s.id))){
   const result=await page.evaluate(async spec=>{
    const until=async(condition,timeout=6000)=>{const limit=performance.now()+timeout;while(!condition()){if(performance.now()>limit)throw Error('Native media boundary timed out: '+spec.id);await new Promise(r=>setTimeout(r,10));}};
    const options={signal:new AbortController().signal,isCurrent:()=>true,muted:true,loop:spec.id==='iga_loop'};let media;
    __auditUI.show({family:'chapter8',chapter:spec.chapter});
    if(spec.mime==='video/mp4'){__auditUI.scene('DFUnlock');await __auditUI.play(spec.id,options);media=document.querySelector('#interactiveVisionScene video');}
    else{__auditUI.stop();__auditUI.stopAmbient();__auditUI.scene('AboutUs');const forceAAC=spec.mime==='audio/mp4';__auditCredits.canPlayType=mime=>forceAAC&&mime==='audio/flac'?'':__auditNativeCanPlay(mime);await __auditUI.effect({type:'credits-audio',track:spec.track,...options});media=__auditCredits;}
    await until(()=>media.readyState>=2&&Number.isFinite(media.duration)&&media.duration>0&&!media.paused);
    const before=media.currentTime;await new Promise(r=>setTimeout(r,400));const after=media.currentTime;
    const start={before,after,paused:media.paused,duration:media.duration,width:media.videoWidth||null,height:media.videoHeight||null,frames:media.getVideoPlaybackQuality?.().totalVideoFrames||null};
    const selection=__auditSelections.at(-1),target=Math.max(0,media.duration-.18);
    if(spec.naturalEnd){const timer=setInterval(()=>console.log('natural-playback '+JSON.stringify({id:spec.id,time:media.currentTime,duration:media.duration,paused:media.paused,rate:media.playbackRate})),15000);try{await until(()=>media.ended,(media.duration+10)*1000);}finally{clearInterval(timer);}}
    else{media.currentTime=target;if(media.loop)await until(()=>!media.seeking&&media.currentTime<media.duration/2);else await until(()=>media.ended);}
    const end={time:media.currentTime,ended:media.ended,loop:media.loop,paused:media.paused};
    const passed=after>before+.1&&selection.id===spec.id&&(spec.mime!=='video/mp4'||start.frames>0)&&(media.loop?end.time<start.duration/2:end.ended);
    return {id:spec.id,checkedAt:new Date().toISOString(),mime:spec.mime,selected:selection,start,end,naturalEnd:!!spec.naturalEnd,controlledFlacUnsupported:spec.mime==='audio/mp4',nativeCanPlay:__auditNativeCanPlay(spec.mime),status:passed?'passed':'failed',mediaErrors:__auditMediaErrors.slice()};
   },{...spec,naturalEnd:process.env.PHI_VISION_NATURAL_END==='1'});
   report.results.push(result);if(spec.mime==='video/mp4')await page.screenshot({path:path.join(out,spec.id+'-end.png')});
   console.log(JSON.stringify({id:spec.id,status:result.status}));
  }
  report.mediaErrors=await page.evaluate(()=>__auditMediaErrors);report.status=report.results.every(r=>r.status==='passed')&&!report.pageErrors.length&&!report.mediaErrors.length?'passed':'failed';if(report.status!=='passed')process.exitCode=1;
 }catch(error){report.status='failed';report.error=error.stack;report.failureState=await page.evaluate(()=>({selected:globalThis.__auditSelections?.at(-1),mediaErrors:globalThis.__auditMediaErrors,credits:globalThis.__auditCredits&&{currentTime:__auditCredits.currentTime,duration:__auditCredits.duration,readyState:__auditCredits.readyState,paused:__auditCredits.paused,ended:__auditCredits.ended,seeking:__auditCredits.seeking,loop:__auditCredits.loop,error:__auditCredits.error?.message}})).catch(()=>null);process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,results:report.results.length,pageErrors:report.pageErrors}));await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
