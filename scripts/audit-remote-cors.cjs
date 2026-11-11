'use strict';
// One bounded native-browser probe through the shipped loader. Keep TLS checks
// enabled: a trust failure is an environment blocker, never a CORS pass.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4180',out=path.resolve(process.argv[3]||'work/remote-resource-audit/browser-probe.json');
const url=process.argv[4]||'https://raw.githubusercontent.com/7aGiven/Phigros_Resource/5d40bfdf05bee53f5107a6ea5620ca0e953de815/Glaciaxion.SunsetRay.0/EZ.json';
(async()=>{
 const proxy=process.env.https_proxy||process.env.HTTPS_PROXY;
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,proxy:proxy?{server:proxy,bypass:'127.0.0.1,localhost'}:undefined,args:['--no-sandbox']});
 const context=await browser.newContext({serviceWorkers:'block'}),page=await context.newPage();
 const report={scope:'One resource through original PhiHostedMedia.bytes/PhiRemoteAssets.download; not a full remote-resource or official audit',startedAt:new Date().toISOString(),browser:browser.version(),origin:new URL(base).origin,url,TLSVerificationDisabled:false,inheritedProxyUsed:!!proxy,requestFailures:[],pageErrors:[],sourceHashes:{}};
 for(const name of ['js/remote-assets.js','js/hosted-media.js','js/site-network-guard.js'])report.sourceHashes[name]=crypto.createHash('sha256').update(fs.readFileSync(name)).digest('hex');
 try{
  page.on('requestfailed',request=>{if(request.url().includes('raw.githubusercontent.com')||request.url().includes('cdn.jsdelivr.net'))report.requestFailures.push({at:new Date().toISOString(),url:request.url(),error:request.failure()?.errorText});});
  page.on('pageerror',error=>report.pageErrors.push(error.message));
  await page.goto(base+'/?skipIntro=1',{waitUntil:'domcontentloaded'});await page.waitForFunction(()=>window.PhiHostedMedia&&window.PhiRemoteAssets);
  report.result=await page.evaluate(async url=>{
   const spec=PhiRemoteAssets.info(url);if(!spec)throw Error('URL is outside the shipped fixed allowlist');
   const original=fetch,attempts=[],responses=[];
   window.fetch=async function(input,init){
    const address=String(input?.url||input),relevant=address===url||address===spec.mirror;
    if(relevant)attempts.push({at:new Date().toISOString(),url:address,method:init?.method||'GET',mode:init?.mode,credentials:init?.credentials,redirect:init?.redirect});
    const response=await original.apply(this,arguments);
    if(relevant)responses.push({at:new Date().toISOString(),url:response.url,status:response.status,type:response.type,redirected:response.redirected});
    return response;
   };
   try{
    const bytes=await PhiHostedMedia.bytes(url),hex=buffer=>Array.from(new Uint8Array(buffer),x=>x.toString(16).padStart(2,'0')).join('');
    const hash=hex(await crypto.subtle.digest('SHA-256',bytes));
    return {status:bytes.length===spec.bytes&&hash===spec.sha256&&responses.some(r=>r.type==='cors')?'passed':'failed',actualBytes:bytes.length,actualSHA256:hash,attempts,responses};
   }catch(error){return {status:'failed',error:error.message,attempts,responses};}
   finally{window.fetch=original;}
  },url);
  const certificateFailure=report.requestFailures.some(r=>r.error==='net::ERR_CERT_AUTHORITY_INVALID');
  report.status=certificateFailure?'blocked':report.result.status;
  report.CORSVerified=report.status==='passed';
  if(certificateFailure)report.blocker='The supplied proxy CA is not trusted by this Chromium NSS database; TLS failed before a CORS result was available.';
  if(report.status!=='passed')process.exitCode=1;
 }catch(error){report.status='failed';report.error=error.stack;report.CORSVerified=false;process.exitCode=1;}
 finally{report.finishedAt=new Date().toISOString();fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await context.close();await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
