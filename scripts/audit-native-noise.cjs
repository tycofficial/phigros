'use strict';
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const base=process.argv[2]||'http://127.0.0.1:4182',out=process.argv[3]||'work/native-noise',song=process.argv[4]||'Message',tier=process.argv[5]||'IN';fs.mkdirSync(out,{recursive:true});
(async()=>{const b=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']}),context=await b.newContext({viewport:{width:1280,height:720},serviceWorkers:'allow'}),p=await context.newPage();
 const r={scope:'Actual local UI/engine with recorded runtime; original URL when an HTTPS base is supplied; software WebGL, not physical-device coverage',pageErrors:[],consoleErrors:[],httpErrors:[],requests:[],startedAt:new Date().toISOString()};
 p.on('pageerror',e=>r.pageErrors.push(e.message));p.on('console',m=>{if(m.type()==='error')r.consoleErrors.push(m.text());});p.on('response',response=>{if(response.status()>=400)r.httpErrors.push({url:response.url(),status:response.status()});if(/native-block|afa450a810b74638|cb60d40405b9af2a|13c6ef3641945cc1|bf216f44ac21bf2c/.test(response.url())){const h=response.headers();r.requests.push({url:response.url(),status:response.status(),contentRange:h['content-range'],contentLength:h['content-length'],contentEncoding:h['content-encoding']});}});p.on('requestfailed',q=>r.requests.push({url:q.url(),error:q.failure()?.errorText}));
 try{
  await p.goto(base);await p.waitForFunction(()=>window.PhiOfflineNext);r.runtime=await p.evaluate(()=>PhiOfflineNext.versions.runtime);assert.equal(r.runtime,process.env.PHI_NOISE_EXPECTED_RUNTIME||fs.readFileSync('sw.js','utf8').split("const RUNTIME='")[1].split("'")[0]);r.url=p.url();r.browser=b.version();
  await p.evaluate(()=>{
   const api=PhiHostedMedia;window.__phiNoiseManifestReads=[];
   window.PhiHostedMedia=Object.freeze({...api,bytes(...args){
    const pending=api.bytes(...args);
    if(String(args[0]).includes('native-block-resources.json'))pending.then(async bytes=>{
     const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),v=>v.toString(16).padStart(2,'0')).join('');
     __phiNoiseManifestReads.push({bytes:bytes.byteLength,SHA256:hash});
    },error=>__phiNoiseManifestReads.push({error:error.name})).catch(error=>__phiNoiseManifestReads.push({error:error.message}));
    return pending;
   }});
  });
  for(let n=0;n<3&&!await p.locator('#refCollection').isVisible();n++)await p.locator('#refHome').click({position:{x:100,y:100}});
  await p.waitForSelector('#refCollection:not(.hidden)');await p.locator('[data-reference-open-library]').first().click();await p.waitForSelector('#libraryView:not(.hidden)');
  await p.locator('#chartList .card').filter({hasText:song}).first().click();await p.waitForFunction(name=>document.querySelector('#libraryFocusTitle').textContent===name,song);
  await p.locator('#libraryFocusDifficulty [data-tier="'+tier+'"]').click();r.selected=await p.locator('#libraryFocusTitle').textContent();await p.locator('#libraryFocusPlay').click();
  try{await p.waitForFunction(()=>window.__phiEngine?.running&&!__phiEngine.starting&&__phiEngine.musicCurrentTime()>.2,null,{timeout:60000});}catch(e){r.startError=e.message;}
  r.engine=await p.evaluate(()=>{const e=window.__phiEngine;if(!e)return null;const areas=e.chart.blockAreas||[],renderer=e.nativeBlockRenderer,overlay=e.nativeNoiseOverlay;return {name:e.record.name,id:e.record.id,tier:e.record.meta?.difficultyClass,kind:e.chart.kind,chartKeys:Object.keys(e.chart),areas:areas.length,firstAreas:areas.slice(0,4).map(b=>({appearTime:b.appearTime,enableTime:b.enableTime,disableTime:b.disableTime,disappearTime:b.disappearTime})),earliest:areas.length?Math.min(...areas.map(b=>b.appearTime)):null,earliestActive:areas.length?Math.min(...areas.filter(b=>b.enableTime<b.disableTime).map(b=>b.enableTime)):null,visibleAtCurrent:PhiOfflineNext.modules.LandscapeLayout.zones(e,e.time).length,renderer:!!renderer,rendererGL:!!renderer?.gl,contextLost:renderer?.gl?.isContextLost(),lastRenderTime:renderer?.lastTime,renderError:e.nativeBlockRenderError?.message,noiseDataset:{...e.canvas.dataset},overlay:overlay?{width:overlay.width,height:overlay.height,display:getComputedStyle(overlay).display,opacity:getComputedStyle(overlay).opacity,zIndex:getComputedStyle(overlay).zIndex}:null,time:e.time,music:e.musicCurrentTime(),running:e.running,paused:e.paused};});
  const pixelState=()=>p.evaluate(()=>{const e=window.__phiEngine,c=e?.nativeNoiseOverlayCtx;if(!e||!c)return null;const data=c.getImageData(0,0,c.canvas.width,c.canvas.height).data;let opaque=0,rgb=0;for(let i=0;i<data.length;i+=4){if(data[i+3])opaque++;if(data[i]||data[i+1]||data[i+2])rgb++;}return {time:e.time,music:e.musicCurrentTime(),zones:PhiOfflineNext.modules.LandscapeLayout.zones(e,e.time).length,activeZones:PhiOfflineNext.modules.LandscapeLayout.zones(e,e.time).filter(z=>z.active).length,nontransparentPixels:opaque,coloredPixels:rgb,renderError:e.nativeBlockRenderError?.message,paused:e.paused,lastRenderTime:e.nativeBlockRenderer?.lastTime,geometry:e.nativeBlockRenderer?Array.from(e.nativeBlockRenderer.geometryArena.counts):null};});
  r.beforePixels=await pixelState();
  if(r.engine?.areas){
   r.samples=[];const targets=song==='Leave All Behind'?[46.8,50,54,60]:[r.engine.earliestActive+.3];
   for(const target of targets){
    await p.waitForFunction(t=>window.__phiEngine&&(!!__phiEngine.nativeBlockRenderError||__phiEngine.time>=t),target,{timeout:Math.min(90000,Math.max(30000,Math.ceil(target*1000+8000)))});
    r.activePixels=await pixelState();r.samples.push({target,...r.activePixels});
    const png=await p.evaluate(()=>window.__phiEngine?.nativeNoiseOverlay?.toDataURL('image/png'));if(png)fs.writeFileSync(path.join(out,'overlay-'+target+'.png'),Buffer.from(png.split(',')[1],'base64'));
    await p.screenshot({path:path.join(out,'state-'+target+'.png')});fs.writeFileSync(path.join(out,'interim.json'),JSON.stringify(r,null,2));
    if(r.activePixels?.renderError)break;
   }
  }
  r.dialog=await p.locator('#dialog').textContent();await p.screenshot({path:path.join(out,'state.png')});r.serviceWorker=await p.evaluate(async()=>({controller:navigator.serviceWorker?.controller?.scriptURL||null,caches:await caches.keys()}));
  assert(!r.startError);assert.equal(r.engine.kind,'pgr');assert.equal(r.engine.rendererGL,true);assert.equal(r.engine.contextLost,false);assert.equal(r.engine.noiseDataset.noiseRenderer,'webgl-native');assert(r.engine.areas>0);
  const visible=song==='Leave All Behind'?r.samples.filter(x=>x.target>=50):r.samples;
  assert(visible.length>0);for(const frame of visible){assert(frame.activeZones>0);assert(frame.nontransparentPixels>0);assert(frame.coloredPixels>0);assert(!frame.renderError);assert.equal(frame.paused,false);}
  const original=fs.readFileSync('assets/meta/native-block-resources.json'),expectedHash=crypto.createHash('sha256').update(original).digest('hex');
  r.manifestReads=await p.evaluate(()=>__phiNoiseManifestReads);assert(r.manifestReads.some(x=>x.bytes===original.length&&x.SHA256===expectedHash),'Assembled native manifest bytes differ');
  const responses=r.requests.filter(q=>new URL(q.url).pathname.endsWith('/native-block-resources.json'));assert(responses.length>0,'No native manifest response observed');const ranges=[];
  for(const q of responses){assert([200,206].includes(q.status),'Native manifest HTTP status '+q.status);if(q.status===206){const m=String(q.contentRange||'').match(new RegExp('^bytes ([0-9]+)-([0-9]+)/([0-9]+)$'));assert(m,'Invalid Content-Range');const [start,end,total]=m.slice(1).map(Number);assert.equal(total,original.length);assert(start<=end&&end<total);if(q.contentLength&&!q.contentEncoding)assert.equal(Number(q.contentLength),end-start+1);ranges.push([start,end]);}}
  if(!responses.some(q=>q.status===200)){let cursor=0;for(const [start,end]of ranges.sort((a,b)=>a[0]-b[0])){assert(start<=cursor,'Native range gap');cursor=Math.max(cursor,end+1);}assert.equal(cursor,original.length,'Native ranges do not cover the complete manifest');}
  r.manifestValidation={bytes:original.length,SHA256:expectedHash,ranges,completeOriginalBytesVerified:true};
  for(const suffix of ['afa450a810b74638.png','cb60d40405b9af2a.png','13c6ef3641945cc1.png','bf216f44ac21bf2c.png'])assert(r.requests.some(q=>new URL(q.url).pathname.endsWith('/'+suffix)&&q.status===200),'Missing native texture: '+suffix);
  assert.deepEqual(r.pageErrors,[]);r.status='passed';console.log(JSON.stringify(r));
 }catch(e){r.status='failed';r.error=e.stack;process.exitCode=1;console.error(e);console.log(JSON.stringify(r));}
 finally{r.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(r,null,2)+'\n');await context.close();await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
