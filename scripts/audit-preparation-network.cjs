'use strict';
// Fresh native CORS through the current app's real materialization cache.
// One fixed 23413-byte chart, no music, mirror probing or complete resource sweep.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),assert=require('node:assert/strict');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/preparation-network');fs.mkdirSync(out,{recursive:true});
const catalog=JSON.parse(fs.readFileSync('js/full-catalog.js','utf8').split('globalThis.PhiFullCatalog=')[1].trim().replace(/;$/,''));
const id='catalog-2bd25eaa9c1f1ecc-ez',entry=catalog.entries.find(e=>e.id===id),asset=catalog.assets.find(a=>a.id===id);
assert(entry&&asset&&asset.method===0&&asset.byteLength===23413&&asset.url.startsWith('https://raw.githubusercontent.com/'));
const report={scope:'Current preparation cache and native CORS for one fixed real chart; not the 1091-address matrix or official fidelity',startedAt:new Date().toISOString(),appSHA256:crypto.createHash('sha256').update(fs.readFileSync('js/app.js')).digest('hex'),TLSVerificationDisabled:false,sample:{id,url:asset.url,bytes:asset.byteLength,SHA256:asset.sha256},results:[],pageErrors:[]};
const cached=process.env.PHI_PREPARATION_NETWORK_CACHED==='1';report.transport=cached?'Controlled previously measured cache; NOT external native CORS':'Actual native external fetch; normal browser HTTP cache permitted';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});report.browser=browser.version();
 try{for(const mode of ['surviving-consumer','replacement-after-abort','hosted-settled-replacement']){
  const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();page.on('pageerror',e=>report.pageErrors.push(e.message));
  try{
   // Stop unexpected remote addresses rather than testing a fallback host.
   await context.route('**/*',route=>{const url=route.request().url();if(cached&&url===asset.url){const body=fs.readFileSync('work/remote-resource-audit/cache/'+asset.sha256+'.bin');assert.equal(body.length,asset.byteLength);assert.equal(crypto.createHash('sha256').update(body).digest('hex'),asset.sha256);return route.fulfill({status:200,headers:{'access-control-allow-origin':'*','content-type':'application/json'},body});}return new URL(url).origin===new URL(base).origin||url===asset.url?route.continue():route.abort('blockedbyclient');});
   await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiOfflineNext?.modules.BuiltinCatalog);
   const result=await page.evaluate(async({mode,id,asset})=>{
    const originalFetch=window.fetch.bind(window),requests=[],gate={release:null,signal:null,returned:false};
    const until=async fn=>{const deadline=performance.now()+10000;while(!fn()){if(performance.now()>deadline)throw Error('Current materialization boundary timed out');await new Promise(r=>setTimeout(r,10));}};
    const digest=async data=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',data)),b=>b.toString(16).padStart(2,'0')).join('');
    window.fetch=async function(url,options){
     const address=new URL(url instanceof Request?url.url:url,location.href).href;if(address!==asset.url)return originalFetch(url,options);
     const response=await originalFetch(url,options),data=await response.clone().arrayBuffer(),row={url:response.url,status:response.status,type:response.type,bytes:data.byteLength,SHA256:await digest(data),options:{method:options?.method||'GET',mode:options?.mode,credentials:options?.credentials,redirect:options?.redirect}};requests.push(row);
     if(response.status!==200||response.type!=='cors'||row.bytes!==asset.byteLength||row.SHA256!==asset.sha256)throw Error('Native sample bytes/CORS differ');
     if(requests.length===1&&mode!=='hosted-settled-replacement'){gate.signal=options.signal;await new Promise(resolve=>{gate.release=resolve;});gate.returned=true;}
     return response;
    };
    try{
     if(mode==='hosted-settled-replacement'){
      const remote=PhiRemoteAssets,caller=new AbortController();let observed=false,replacement,oldSignalAborted;
      window.PhiRemoteAssets={...remote,download(...args){
       const pending=remote.download(...args);
       if(!observed){observed=true;pending.then(async()=>{
        caller.abort();await Promise.resolve();oldSignalAborted=args[1].signal.aborted;
        replacement=PhiHostedMedia.bytes(asset.url);
       });}
       return pending;
      }};
      try{
       const cancelled=await PhiHostedMedia.bytes(asset.url,{signal:caller.signal}).then(()=> 'resolved',e=>e.name);
       await until(()=>replacement);const bytes=await replacement,hash=await digest(bytes),beforeReuse=requests.length;
       const reused=await PhiHostedMedia.bytes(asset.url);
       if(cancelled!=='AbortError'||!oldSignalAborted||hash!==asset.sha256||reused!==bytes||requests.length!==2||requests.length!==beforeReuse)throw Error('Settled remote producer ownership differs');
       return {mode,status:'passed',cancelled,oldSignalAborted,preparedSHA256:hash,cacheReused:true,schedule:'Programmatic abort at original fulfilled remote Promise; same producer Promise returned',requests};
      }finally{window.PhiRemoteAssets=remote;}
     }
     const catalog=PhiOfflineNext.modules.BuiltinCatalog,record=catalog.entries.find(e=>e.id===id);if(!record)throw Error('Actual entry missing');
     const a=new AbortController(),b=new AbortController();
     const first=catalog.materialize(record,{streaming:true,signal:a.signal}).then(()=>({outcome:'resolved'}),e=>({outcome:e.name}));
     let second;if(mode==='surviving-consumer'){second=catalog.materialize(record,{streaming:true,signal:b.signal});second.catch(()=>{});}
     await until(()=>gate.release);a.abort();const firstResult=await first;
     if(firstResult.outcome!=='AbortError')throw Error('Cancelled caller was not released');
     const transportAbortedAfterFirst=gate.signal.aborted;
     if(mode==='surviving-consumer'){
      if(transportAbortedAfterFirst)throw Error('One cancellation aborted a valid consumer');gate.release();
     }else{
      if(!transportAbortedAfterFirst)throw Error('Last cancellation did not abort transport');second=catalog.materialize(record,{streaming:true,signal:b.signal});
     }
     const prepared=await second,hash=await digest(new TextEncoder().encode(prepared.chartText));if(hash!==asset.sha256||prepared.builtinEntryId!==id)throw Error('Wrong prepared original record');
     if(mode==='replacement-after-abort'){gate.release();await until(()=>gate.returned);await new Promise(r=>setTimeout(r,100));}
     const beforeReuse=requests.length,reused=await catalog.materialize(record,{streaming:true});
     if(reused!==prepared||requests.length!==beforeReuse)throw Error('Late cleanup evicted completed record');
     if(requests.length!==(mode==='surviving-consumer'?1:2))throw Error('Unexpected resource duplication');
     return {mode,status:'passed',cancelled:firstResult,transportAbortedAfterFirst,preparedSHA256:hash,preparedCharacters:prepared.chartText.length,cacheReused:true,requests};
    }finally{gate.release?.();window.fetch=originalFetch;}
   },{mode,id,asset});report.results.push(result);console.log(JSON.stringify(result));
  }finally{await context.close();}
 }assert.deepEqual(report.pageErrors,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;console.error(error);}
 finally{report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({status:report.status,measuredBodies:report.results.reduce((n,r)=>n+r.requests.length,0),scope:report.scope}));await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
