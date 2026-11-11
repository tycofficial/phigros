'use strict';
// Public component API: original local bytes with controlled chunk delivery, no engine or UI-state substitution.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/hosted-progress');fs.mkdirSync(out,{recursive:true});
const source=fs.readFileSync(process.env.PHI_TEST_HOSTED_MEDIA_SOURCE||'js/hosted-media.js','utf8');
const catalog=JSON.parse(fs.readFileSync('js/full-catalog.js','utf8').split('globalThis.PhiFullCatalog=')[1].trim().replace(/;$/,''));
const asset=catalog.assets.find(a=>a.id==='catalog-a3c296e4da096d36-art'),sample={id:asset.id,url:asset.url,bytes:asset.byteLength,SHA256:asset.sha256};
const original=fs.readFileSync(asset.url);assert.equal(original.length,sample.bytes);assert.equal(crypto.createHash('sha256').update(original).digest('hex'),sample.SHA256);
const report={scope:'Shared progress callback API ownership; native original body is verified then re-streamed in controlled chunks. No current UI same-function path or physical network failure incidence is claimed.',startedAt:new Date().toISOString(),sourceSHA256:crypto.createHash('sha256').update(source).digest('hex'),sample,results:[],pageErrors:[]};
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});report.browser=browser.version();
 try{for(const mode of ['shared-cancel','shared-rejoin','all-cancel','failure-retry','distinct-callbacks']){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));let injected=false;
  try{
   await context.route('**/*',route=>{
    const url=new URL(route.request().url());if(url.origin!==new URL(base).origin)return route.abort('blockedbyclient');
    if(url.pathname==='/__hosted_progress_probe__')return route.fulfill({contentType:'text/html',body:'<!doctype html><title>Hosted progress probe</title>'});
    if(url.pathname==='/js/hosted-media.js')return route.fulfill({contentType:'application/javascript',body:source});
    if(mode==='failure-retry'&&url.pathname===new URL(sample.url,base+'/').pathname&&!injected){injected=true;return route.fulfill({status:404,body:''});}
    return route.continue();
   });
   await page.goto(base+'/__hosted_progress_probe__');
   for(const name of ['performance-policy','hosted-manifest','resource-transfer','hosted-media'])await page.addScriptTag({url:base+'/js/'+name+'.js'});
   const result=await page.evaluate(async({mode,sample})=>{
    const media=PhiHostedMedia,nativeFetch=window.fetch.bind(window),transfer=PhiTransfer,requests=[],streams=[],producers=[],shared=[],other=[],controls=[];
    const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),v=>v.toString(16).padStart(2,'0')).join('');
    const until=async fn=>{const end=performance.now()+10000;while(!fn()){if(performance.now()>end)throw Error('Progress boundary timed out');await new Promise(r=>setTimeout(r,5));}};
    const onProgress=(done,total)=>shared.push([done,total]),different=(done,total)=>other.push([done,total]);
    const outcome=p=>p.then(bytes=>({outcome:'resolved',bytes}),error=>({outcome:error.name}));
    window.fetch=async function(url,options){
     const response=await nativeFetch(url,options),row={status:response.status,url:response.url,signal:options.signal};requests.push(row);
     if(response.status!==200)return response; // One explicit injected 404 exercises retry; no claim that the source failed.
     const data=new Uint8Array(await response.arrayBuffer());row.bytes=data.byteLength;row.SHA256=await digest(data);
     if(row.bytes!==sample.bytes||row.SHA256!==sample.SHA256)throw Error('Original local bytes differ');
     const stream={data,at:0,request:requests.length-1,body:null};streams.push(stream);
     return new Response(new ReadableStream({start(controller){stream.body=controller;}}),{status:200,headers:response.headers});
    };
    window.PhiTransfer={...transfer,download(url,options){
     const row={signal:options.signal,progress:[],status:'pending'};producers.push(row);
     const pending=transfer.download(url,{...options,onProgress:(done,total)=>{row.progress.push([done,total]);options.onProgress?.(done,total);}});
     pending.then(()=>row.status='resolved',e=>row.status=e.name);return pending;
    }};
    async function emit(index,end,close=false){
     const stream=streams[index],producer=producers[stream.request];stream.body.enqueue(stream.data.subarray(stream.at,end));stream.at=end;if(close)stream.body.close();
     await until(()=>producer.progress.some(([done])=>done===end));
    }
    async function finish(index){const n=sample.bytes;await emit(index,Math.floor(n/3));await emit(index,Math.floor(n*2/3));await emit(index,n,true);}
    const expected=[Math.floor(sample.bytes/3),Math.floor(sample.bytes*2/3),sample.bytes];
    const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b),fail=message=>{throw Error(message);};let observations;
    try{
     let valid;
     if(mode==='failure-retry'){
      const failed=await Promise.all([outcome(media.bytes(sample.url,{onProgress})),outcome(media.bytes(sample.url,{onProgress}))]);
      if(!failed.every(r=>r.outcome!=='resolved')||requests.length!==1)fail('Shared failure was not deduplicated');
      valid=media.bytes(sample.url,{onProgress});await until(()=>streams.length===1);await finish(0);
      observations={failed:failed.map(r=>r.outcome),failureWasInjected:true};
     }else{
      const a=new AbortController(),b=new AbortController();controls.push(a,b);
      const first=outcome(media.bytes(sample.url,{signal:a.signal,onProgress})),second=outcome(media.bytes(sample.url,{signal:b.signal,onProgress:mode==='distinct-callbacks'?different:onProgress}));
      await until(()=>streams.length===1);await emit(0,expected[0]);a.abort();a.abort();const cancelled=await first;
      if(cancelled.outcome!=='AbortError')fail('First cancellation did not settle');
      if(mode==='all-cancel'){
       b.abort();b.abort();const cancelledSecond=await second;
       if(cancelledSecond.outcome!=='AbortError'||!producers[0].signal.aborted)fail('Last cancellation did not abort producer');
       valid=media.bytes(sample.url,{onProgress});await until(()=>streams.length===2);
       await emit(0,sample.bytes,true);await until(()=>producers[0].status==='AbortError');const afterOld=shared.slice();
       await finish(1);observations={cancelled:cancelled.outcome,cancelledSecond:cancelledSecond.outcome,afterLateOld:afterOld};
       if(!same(afterOld,[[expected[0],sample.bytes]]))fail('Released old subscriptions received late progress');
      }else{
       if(producers[0].signal.aborted)fail('Surviving caller lost its producer');
       if(mode==='shared-rejoin'){
        valid=media.bytes(sample.url,{onProgress});await emit(0,expected[1]);b.abort();b.abort();
        if((await second).outcome!=='AbortError')fail('Second cancellation did not settle');await emit(0,sample.bytes,true);
       }else{
        valid=second.then(r=>{if(r.outcome!=='resolved')throw Error('Valid caller rejected');return r.bytes;});
        await emit(0,expected[1]);await emit(0,sample.bytes,true);
       }
       observations={cancelled:cancelled.outcome};
      }
     }
     const bytes=await valid,hash=await digest(bytes),before=requests.length,callbacksBefore=shared.length+other.length;
     if(await media.bytes(sample.url,{onProgress})!==bytes||requests.length!==before||shared.length+other.length!==callbacksBefore)fail('Completed cache/release behavior changed');
     const expectedShared=mode==='all-cancel'?[expected[0],...expected]:mode==='distinct-callbacks'?[expected[0]]:expected;
     observations={...observations,sharedProgress:shared,otherProgress:other,expectedShared,actualRequests:requests.length,validSHA256:hash,cacheReused:true};
     if(!same(shared.map(([done])=>done),expectedShared)||!same(other.map(([done])=>done),mode==='distinct-callbacks'?expected:[])||hash!==sample.SHA256||requests.length!==(['all-cancel','failure-retry'].includes(mode)?2:1))fail('Progress subscription ownership/deduplication differs');
     return {mode,status:'passed',observations,requests:requests.map(({signal,...r})=>({...r,signalAborted:signal.aborted})),producers:producers.map(({signal,...r})=>({...r,signalAborted:signal.aborted}))};
    }catch(error){return {mode,status:'failed',error:error.message,observations,sharedProgress:shared,otherProgress:other,requests:requests.map(({signal,...r})=>({...r,signalAborted:signal.aborted})),producers:producers.map(({signal,...r})=>({...r,signalAborted:signal.aborted}))};}
    finally{for(const controller of controls)controller.abort();for(const stream of streams){try{stream.body.close();}catch{}}window.fetch=nativeFetch;window.PhiTransfer=transfer;}
   },{mode,sample});report.results.push(result);console.log(JSON.stringify(result));
  }finally{await context.close();}
 }report.status=report.results.every(r=>r.status==='passed')&&!report.pageErrors.length?'passed':'failed';if(report.status!=='passed')process.exitCode=1;
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,pageErrors:report.pageErrors}));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
