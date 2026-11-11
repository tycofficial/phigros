'use strict';
// Native CORS is checked in the browser. Body hashes are verified separately by
// the resumable byte audit; read/cancel a first chunk here to avoid downloading 3GB twice.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/remote-cors'),planPath=process.argv[4]||'docs/evidence/2026-11-10-remote-resources/plan.json.gz';
const raw=fs.readFileSync(planPath),planBytes=planPath.endsWith('.gz')?zlib.gunzipSync(raw):raw,plan=JSON.parse(planBytes);
const hash=data=>crypto.createHash('sha256').update(data).digest('hex');
if(hash(fs.readFileSync('js/remote-assets.js'))!==plan.manifestSHA256)throw Error('Plan does not match current manifest');
fs.mkdirSync(out,{recursive:true});
(async()=>{
 const proxy=process.env.https_proxy||process.env.HTTPS_PROXY;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,proxy:proxy?{server:proxy,bypass:'127.0.0.1,localhost'}:undefined,args:['--no-sandbox']});
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 const report={scope:'Native CORS and first readable chunk at the production primary URL/options; four full shipped-loader probes. Not full browser body rehashing or official fidelity.',startedAt:new Date().toISOString(),planSHA256:hash(planBytes),origin:new URL(base).origin,browser:browser.version(),TLSVerificationDisabled:false,concurrency:3,startIntervalMs:200,headerOnlyResults:[],fullLoaderResults:[],requestFailures:[],pageErrors:[]};
 const stoppedHosts=new Map();let cursor=0,startSlot=Date.now();
 try{
  page.on('pageerror',e=>report.pageErrors.push(e.message));
  page.on('requestfailed',r=>{if(!plan.resources.some(s=>s.url===r.url()||s.mirror===r.url()))return;const item={at:new Date().toISOString(),url:r.url(),error:r.failure()?.errorText};item.kind=item.error==='net::ERR_ABORTED'?'intentional-read-stop':'request-failure';report.requestFailures.push(item);if(item.error==='net::ERR_CERT_AUTHORITY_INVALID')stoppedHosts.set(new URL(r.url()).hostname,item.error);});
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiHostedMedia&&window.PhiRemoteAssets);
  async function worker(){
   for(;;){const index=cursor++;if(index>=plan.resources.length)return;const spec=plan.resources[index],host=new URL(spec.url).hostname;let row;
    if(stoppedHosts.has(host))row={url:spec.url,status:'not-run',reason:stoppedHosts.get(host),at:new Date().toISOString()};
    else{
     const slot=Math.max(Date.now(),startSlot);startSlot=slot+200;await new Promise(r=>setTimeout(r,Math.max(0,slot-Date.now())));
     row=stoppedHosts.has(host)?{url:spec.url,status:'not-run',reason:stoppedHosts.get(host),at:new Date().toISOString()}:await page.evaluate(async spec=>{
      const current=PhiRemoteAssets.info(spec.url),startedAt=new Date().toISOString();
      if(!current||current.bytes!==spec.expectedBytes||current.sha256!==spec.expectedSHA256)throw Error('Browser allowlist differs from plan');
      const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),20000);
      const options={method:'GET',mode:'cors',credentials:'omit',redirect:'error'};let reader;
      try{
       const response=await fetch(spec.url,{...options,signal:controller.signal});reader=response.body?.getReader();const first=await reader?.read();
       return {url:spec.url,startedAt,finishedAt:new Date().toISOString(),requestOptions:options,responseURL:response.url,httpStatus:response.status,responseType:response.type,redirected:response.redirected,firstChunkBytes:first?.value?.byteLength||0,status:response.status===200&&response.type==='cors'&&!response.redirected&&response.url===spec.url&&first?.value?.byteLength>0?'passed':'failed',bodyScope:'first chunk only; remaining body intentionally cancelled'};
      }catch(error){return {url:spec.url,startedAt,finishedAt:new Date().toISOString(),requestOptions:options,status:'failed',error:error.name+': '+error.message};}
      finally{await reader?.cancel().catch(()=>{});controller.abort();clearTimeout(timer);}
     },spec);
     if([401,403,429,451].includes(row.httpStatus))stoppedHosts.set(host,'HTTP '+row.httpStatus+'; remaining host checks skipped without retry/mirror');
    }
    row.planSHA256=report.planSHA256;row.source=spec.source;
    report.headerOnlyResults.push(row);fs.appendFileSync(path.join(out,'results.jsonl'),JSON.stringify(row)+'\n');
    if(report.headerOnlyResults.length%50===0)console.log(JSON.stringify({at:new Date().toISOString(),completed:report.headerOnlyResults.length,passed:report.headerOnlyResults.filter(x=>x.status==='passed').length}));
   }
  }
  // This output belongs to this run; never append to another run's evidence.
  fs.writeFileSync(path.join(out,'results.jsonl'),'');await Promise.all([worker(),worker(),worker()]);
  for(const sample of plan.historicalSamples){
   if(stoppedHosts.size){report.fullLoaderResults.push({url:sample.url,status:'not-run',reason:'Earlier source/trust block; no retries'});continue;}
   report.fullLoaderResults.push(await page.evaluate(async sample=>{
    const at=new Date().toISOString();try{const bytes=await PhiHostedMedia.bytes(sample.url),digest=await crypto.subtle.digest('SHA-256',bytes),actualSHA256=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');return {url:sample.url,at,actualBytes:bytes.length,actualSHA256,status:bytes.length===sample.actualBytes&&actualSHA256===sample.actualSHA256?'passed':'failed',method:'Original PhiHostedMedia.bytes -> PhiRemoteAssets.download, full body'};}catch(error){return {url:sample.url,at,status:'failed',error:error.message};}
   },sample));
  }
  report.expected=plan.resources.length;report.passed=report.headerOnlyResults.filter(x=>x.status==='passed').length;
  report.status=report.passed===report.expected&&report.fullLoaderResults.every(x=>x.status==='passed')&&report.pageErrors.length===0?'passed':'blocked-or-failed';
  if(report.status!=='passed')process.exitCode=1;
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,expected:report.expected,passed:report.passed,fullLoaderResults:report.fullLoaderResults,pageErrors:report.pageErrors}));await context.close();await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
