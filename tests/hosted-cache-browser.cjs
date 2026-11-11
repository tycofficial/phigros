'use strict';
// The shipped PhiHostedMedia -> PhiTransfer chain with native local responses and original OGG bytes.
// Component/API lifecycle checks, not an official UI comparison or an external CORS measurement.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/hosted-cache-browser');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(process.env.PHI_TEST_HOSTED_MEDIA_SOURCE||'js/hosted-media.js','utf8');
const catalog=JSON.parse(fs.readFileSync('js/full-catalog.js','utf8').split('globalThis.PhiFullCatalog=')[1].trim().replace(/;$/,''));
const samples=['catalog-361f4eb30d8a76d8-music','catalog-84917d440c46be92-music','catalog-5cc92af80e1ec083-music','catalog-384b5dc064832ba8-music'].map(id=>{
 const a=catalog.assets.find(a=>a.id===id),data=fs.readFileSync(a.url);
 assert.equal(a.method,0);assert.equal(data.length,a.byteLength);assert.equal(crypto.createHash('sha256').update(data).digest('hex'),a.sha256);
 return {id,url:a.url,bytes:a.byteLength,SHA256:a.sha256};
});
const report={scope:'Original-byte local component lifecycle; programmatic fulfilled-Promise cancellation and aligned native response delivery are controlled schedules, not physical-click incidence, live CORS or official fidelity',startedAt:new Date().toISOString(),sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),samples,results:[],pageErrors:[]};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});report.browser=browser.version();
 try{for(const mode of ['obsolete-success','obsolete-failure','shared-consumer','release-budget']){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
  try{
   // Isolate the public component from unrelated application startup downloads.
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort('blockedbyclient');
    if(url.pathname==='/__hosted_cache_probe__')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Hosted media lifecycle probe</title>'});
    if(url.pathname==='/js/hosted-media.js')return route.fulfill({contentType:'application/javascript',body:source});
    return route.continue();
   });
   await page.goto(base+'/__hosted_cache_probe__');
   for(const name of ['performance-policy','hosted-manifest','resource-transfer','hosted-media'])await page.addScriptTag({url:base+'/js/'+name+'.js'});
   const result=await page.evaluate(async({mode,samples})=>{
    const media=PhiHostedMedia,nativeFetch=window.fetch.bind(window),transfer=PhiTransfer,requests=[],transfers=[],gates=[];
    const [marker,target,third,fourth]=samples,controller=new AbortController();let replacement,initial=true;
    const until=async predicate=>{const end=performance.now()+10000;while(!predicate()){if(performance.now()>end)throw Error('Hosted cache boundary timed out');await new Promise(r=>setTimeout(r,5));}};
    const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
    const absolute=spec=>new URL(spec.url,document.baseURI).href;
    window.fetch=async function(url,options){
     const response=await nativeFetch(url,options),data=await response.clone().arrayBuffer(),spec=samples.find(s=>absolute(s)===String(url));
     if(!spec)throw Error('Unexpected component request');
     const row={id:spec.id,status:response.status,bytes:data.byteLength,SHA256:await digest(data),signalAborted:options.signal.aborted};requests.push(row);
     if(response.status!==200||row.bytes!==spec.bytes||row.SHA256!==spec.SHA256)throw Error('Original bytes differ');
     if(mode==='release-budget'&&initial){await new Promise(resolve=>{gates.push(resolve);if(gates.length===3)for(const release of gates)release();});}
     else if((mode==='obsolete-failure'||mode==='shared-consumer')&&requests.length===1){await new Promise(resolve=>gates.push(resolve));}
     // Align already verified complete native bodies into one buffered chunk.
     // This explicitly controlled delivery makes simultaneous completion repeatable.
     return mode==='release-budget'?new Response(data,{status:response.status,headers:response.headers}):response;
    };
    let targetCalls=0;
    window.PhiTransfer={...transfer,download(...args){
     const pending=transfer.download(...args),row={url:args[0],signal:args[1].signal,status:'pending'};transfers.push(row);
     pending.then(()=>row.status='resolved',e=>row.status=e.name);
     if(mode==='obsolete-success'&&args[0]===absolute(target)&&++targetCalls===1){
      pending.then(async()=>{
       controller.abort();await Promise.resolve();row.abortedBeforeReplacement=row.signal.aborted;
       replacement=media.bytes(target.url);
      });
     }
     return pending; // The exact original Promise; only the observer's completion order is controlled.
    }};
    const fail=message=>{throw Error(message);};
    let observations;
    try{
     if(mode==='obsolete-success'){
      await media.bytes(marker.url);
      const cancelled=await media.bytes(target.url,{signal:controller.signal}).then(()=> 'resolved',e=>e.name);
      await until(()=>replacement);const data=await replacement;
      const before=requests.length;await media.bytes(marker.url);await media.bytes(target.url);
      observations={cancelled,oldSignalAborted:transfers.find(r=>r.url===absolute(target)).abortedBeforeReplacement,replacementSHA256:await digest(data),cacheReadRequests:requests.length-before,markerRequests:requests.filter(r=>r.id===marker.id).length,retainedOriginalBytes:marker.bytes+target.bytes};
      if(cancelled!=='AbortError'||!observations.oldSignalAborted||observations.replacementSHA256!==target.SHA256||observations.cacheReadRequests!==0)fail('Obsolete success evicted valid original bytes');
     }else if(mode==='release-budget'){
      const group=[target,third,fourth],loaded=await Promise.all(group.map(s=>media.bytes(s.url)));initial=false;
      // Re-read together so a cache miss cannot evict an idle hit before it is observed.
      // Active protection can change which entry becomes the first eligible victim.
      const before=requests.length,reread=await Promise.all(group.map(s=>media.bytes(s.url)));
      const hits=group.filter((s,i)=>reread[i]===loaded[i]);
      observations={delivery:'Verified native original bodies, buffered and released together',completedOriginalBytes:group.reduce((n,s)=>n+s.bytes,0),budget:12*1024*1024,initialRequests:before,cacheReadRequests:requests.length-before,cacheHits:hits.map(s=>s.id),retainedBytesBeforeReread:hits.reduce((n,s)=>n+s.bytes,0)};
      if(before!==3||observations.cacheReadRequests!==1||hits.length!==2||observations.retainedBytesBeforeReread>observations.budget)fail('Released active originals do not retain two objects within the byte budget');
     }else{
      const first=media.bytes(target.url,{signal:controller.signal}).then(()=> 'resolved',e=>e.name);
      const second=mode==='shared-consumer'?media.bytes(target.url):null;
      await until(()=>gates.length===1);controller.abort();const cancelled=await first;
      const oldAborted=transfers[0].signal.aborted;
      const valid=second||media.bytes(target.url);
      if(second)gates[0]();const data=await valid;
      if(!second)gates[0]();await until(()=>transfers[0].status!=='pending');
      const before=requests.length;await media.bytes(target.url);
      observations={cancelled,oldAborted,oldTransferOutcome:transfers[0].status,validSHA256:await digest(data),cacheReadRequests:requests.length-before};
      if(cancelled!=='AbortError'||oldAborted!==!second||observations.validSHA256!==target.SHA256||observations.cacheReadRequests!==0||requests.length!==(second?1:2)||(!second&&observations.oldTransferOutcome!=='AbortError'))fail('Shared/replacement consumer ownership changed');
     }
     return {mode,status:'passed',observations,requests,transfers:transfers.map(({signal,...row})=>({...row,signalAborted:signal.aborted}))};
    }catch(error){return {mode,status:'failed',error:error.message,observations,requests,transfers:transfers.map(({signal,...row})=>({...row,signalAborted:signal.aborted}))};}
    finally{for(const release of gates)release();window.fetch=nativeFetch;window.PhiTransfer=transfer;}
   },{mode,samples});report.results.push(result);console.log(JSON.stringify(result));
  }finally{await context.close();}
 }report.status=report.results.every(r=>r.status==='passed')&&!report.pageErrors.length?'passed':'failed';if(report.status!=='passed')process.exitCode=1;
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,pageErrors:report.pageErrors}));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
