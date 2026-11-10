'use strict';
// Separate native CORS, full small-loader probes and controlled fault checks.
// Known CDN size denials are recorded and not retried or worked around.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/vision-cors'),dir='docs/evidence/2026-11-10-vision-resources';
const plan=JSON.parse(fs.readFileSync(dir+'/plan.json')),ledger=fs.readFileSync(dir+'/content-results.jsonl','utf8').trim().split('\n').map(JSON.parse),blocked=ledger.filter(r=>r.status==='blocked');fs.mkdirSync(out,{recursive:true});
(async()=>{
 const proxy=process.env.https_proxy||process.env.HTTPS_PROXY,browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,proxy:proxy?{server:proxy,bypass:'127.0.0.1,localhost'}:undefined,args:['--no-sandbox']});
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage(),report={scope:'Vision primary/mirror native CORS first chunks; four small full original-loader probes; cached-byte fault injection. Not official fidelity or full remote playback.',startedAt:new Date().toISOString(),browser:browser.version(),origin:new URL(base).origin,TLSVerificationDisabled:false,headerResults:[],fullLoaderResults:[],controlledChecks:[],pageErrors:[]};
 const stopped=new Set();
 try{
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiVisionReplay);
  await page.evaluate(async()=>{PhiVisionReplay.installManifest(await(await fetch('./assets/meta/vision-media.json')).json());PhiVisionReplay.installAudioManifest(await(await fetch('./assets/meta/vision-audio.json')).json());window.__visionMeasuredBytes=new Map();});
  for(const spec of plan.resources){
   const knownBlock=blocked.find(r=>r.url===spec.url),host=new URL(spec.url).hostname;
   if(knownBlock||stopped.has(host)){report.headerResults.push({url:spec.url,variant:spec.variant,status:'not-run-blocked',reason:knownBlock?.reason||'Host stopped after current access denial',priorCheckedAt:knownBlock?.checkedAt,expectedBytes:spec.bytes});continue;}
   const row=await page.evaluate(async spec=>{
    const s=PhiVisionReplay.info(spec.url);if(!s||s.bytes!==spec.bytes||s.sha256!==spec.sha256)throw Error('Vision allowlist differs from plan');
    const options={method:'GET',mode:'cors',credentials:'omit',redirect:'error'},controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);let reader;
    try{const response=await fetch(spec.url,{...options,signal:controller.signal});reader=response.body?.getReader();const first=await reader?.read();return {url:spec.url,variant:spec.variant,at:new Date().toISOString(),requestOptions:options,responseURL:response.url,httpStatus:response.status,responseType:response.type,firstChunkBytes:first?.value?.byteLength||0,status:response.status===200&&response.type==='cors'&&!response.redirected&&response.url===spec.url&&first?.value?.byteLength>0?'passed':'failed',bodyScope:'first chunk; full URL bytes were measured separately'};}
    catch(error){return {url:spec.url,variant:spec.variant,at:new Date().toISOString(),status:'failed',error:error.name+': '+error.message};}
    finally{await reader?.cancel().catch(()=>{});controller.abort();clearTimeout(timer);}
   },spec);report.headerResults.push(row);if([401,403,429,451].includes(row.httpStatus))stopped.add(host);console.log(JSON.stringify({variant:spec.variant,url:spec.url,status:row.status}));
  }
  const samples=[plan.contents.filter(s=>s.mime==='video/mp4').sort((a,b)=>a.bytes-b.bytes)[0],plan.contents.filter(s=>s.mime==='audio/mp4').sort((a,b)=>a.bytes-b.bytes)[0]];
  for(const sample of samples)for(const variant of ['primary','mirror']){
   if(stopped.size){report.fullLoaderResults.push({id:sample.id,variant,status:'not-run-blocked'});continue;}
   report.fullLoaderResults.push(await page.evaluate(async({sample,variant})=>{
    const native=fetch,attempts=[],responses=[],sources=[];
    window.fetch=async function(input,init){const url=String(input?.url||input);if(url===sample.url||url===sample.mirror){attempts.push({url,mode:init?.mode,credentials:init?.credentials,redirect:init?.redirect,controlled:variant==='mirror'&&url===sample.url});if(variant==='mirror'&&url===sample.url)throw new TypeError('Controlled primary outage for mirror audit');}
     const r=await native.apply(this,arguments);if(url===sample.url||url===sample.mirror)responses.push({url:r.url,status:r.status,type:r.type});return r;};
    try{const bytes=await PhiVisionReplay.download(sample.url,{onSource:i=>sources.push(i)}),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),x=>x.toString(16).padStart(2,'0')).join(''),actual=responses.at(-1);if(bytes.length===sample.bytes&&hash===sample.sha256)__visionMeasuredBytes.set(actual.url,bytes);return {id:sample.id,variant,at:new Date().toISOString(),actualBytes:bytes.length,actualSHA256:hash,sources,attempts,responses,status:bytes.length===sample.bytes&&hash===sample.sha256&&actual.url===(variant==='primary'?sample.url:sample.mirror)&&actual.type==='cors'?'passed':'failed'};}
    catch(error){return {id:sample.id,variant,status:'failed',error:error.message,sources,attempts,responses};}finally{window.fetch=native;}
   },{sample,variant}));
  }
  if(report.fullLoaderResults.every(r=>r.status==='passed')){
   report.controlledChecks=await page.evaluate(async({sample,blocked})=>{
    const native=fetch,checks=[];let mode='normal',calls=[];
    window.fetch=async function(input,init){const url=String(input?.url||input);if(![sample.url,sample.mirror,...blocked.flatMap(x=>[x.url,PhiVisionReplay.info(x.url).url])].includes(url))return native.apply(this,arguments);calls.push(url);
     if(mode.startsWith('native-'))return native.apply(this,arguments);
     if(mode==='both-fail')throw new TypeError('Controlled source outage');
     if(mode==='blocked-mirror'){if(!url.startsWith('https://cdn.'))throw new TypeError('Controlled primary outage');const r=new Response('File size exceeded the configured limit of 20 MB.',{status:403});Object.defineProperty(r,'url',{value:url});return r;}
     const data=__visionMeasuredBytes.get(url);if(!data)throw Error('No independently measured cache for source');const bytes=data.slice();if(mode==='corrupt'&&url===sample.url)bytes[0]^=1;const r=new Response(bytes);Object.defineProperty(r,'url',{value:url});return r;};
    const run=async(name,action)=>{calls=[];try{const result=await action();checks.push({name,transport:result.nativeFetch?'Original loader with native fetch; normal browser HTTP cache permitted':'controlled response/failure around independently measured real bytes; no fresh CORS claim',...result});}catch(error){checks.push({name,status:'failed',error:error.message});}};
    try{
     await run('cancel-after-progress-no-fallback',async()=>{mode='native-cancel';const controller=new AbortController(),sources=[];let error;try{await PhiVisionReplay.download(sample.url,{signal:controller.signal,onSource:i=>sources.push(i),onProgress:done=>{if(done>0)controller.abort();}});}catch(e){error=e.name;}return {status:error==='AbortError'&&sources.join(',')==='0'?'passed':'failed',nativeFetch:true,error,sources,calls:[...calls]};});
     await run('both-source-failure',async()=>{mode='both-fail';let error;try{await PhiVisionReplay.download(sample.url);}catch(e){error=e.message;}return {status:error&&calls.length===2?'passed':'failed',error,calls:[...calls]};});
     await run('recovery-new-session',async()=>{mode='native-recovery';const bytes=await PhiVisionReplay.download(sample.url);return {status:bytes.length===sample.bytes?'passed':'failed',nativeFetch:true,calls:[...calls]};});
     await run('same-length-corruption-falls-back',async()=>{mode='corrupt';const sources=[],bytes=await PhiVisionReplay.download(sample.url,{onSource:i=>sources.push(i)});return {status:bytes.length===sample.bytes&&sources.join(',')==='0,1'?'passed':'failed',sources,calls:[...calls]};});
     await run('mirror-alias-still-prefers-primary',async()=>{mode='normal';const sources=[];await PhiVisionReplay.download(sample.mirror,{onSource:i=>sources.push(i)});return {status:sources.join(',')==='0'&&calls[0]===sample.url?'passed':'failed',sources,calls:[...calls]};});
     for(const denied of blocked)await run('blocked-mirror-error-'+denied.source.path,async()=>{mode='blocked-mirror';let error;try{await PhiVisionReplay.download(PhiVisionReplay.info(denied.url).url);}catch(e){error=e.message;}return {status:error&&calls.length===2?'passed':'failed',error,calls:[...calls],priorRealHTTPStatus:denied.httpStatus};});
    }finally{window.fetch=native;}
    return checks;
   },{sample:samples[0],blocked});
  }
  report.availableCORS=report.headerResults.filter(r=>r.status==='passed').length;report.externalBlocked=report.headerResults.filter(r=>r.status==='not-run-blocked').length;
  report.executableChecksPassed=report.headerResults.filter(r=>r.status!=='not-run-blocked').every(r=>r.status==='passed')&&report.fullLoaderResults.every(r=>r.status==='passed')&&report.controlledChecks.length===7&&report.controlledChecks.every(r=>r.status==='passed')&&!report.pageErrors.length;
  report.status=report.executableChecksPassed?(report.externalBlocked?'blocked':'passed'):'failed';if(report.status!=='passed')process.exitCode=1;
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,availableCORS:report.availableCORS,externalBlocked:report.externalBlocked,executableChecksPassed:report.executableChecksPassed,fullLoaderResults:report.fullLoaderResults,controlledChecks:report.controlledChecks,pageErrors:report.pageErrors}));await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
