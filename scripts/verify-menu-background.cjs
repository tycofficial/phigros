'use strict';
// Original thumbnail bytes and actual CSS pixels; no official visual-parity claim.
const {chromium}=require('playwright'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const asset='assets/ui/thumbs/94886c5c89d6efa3.webp';
const root=path.resolve(__dirname,'..'),sha=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
async function verifyMenuBackground(base,out){
 fs.mkdirSync(out,{recursive:true});
 const expectedBytes=fs.readFileSync(path.join(root,asset)),expectedURL=new URL(asset,base).href;
 const report={scope:'Original collection background URL, bytes and painted pixels; not official fidelity or noise rendering',base,expectedURL,expectedBytes:expectedBytes.length,expectedSHA256:sha(expectedBytes),responses:[],steps:[],pageErrors:[],startedAt:new Date().toISOString()};
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required']}),context=await browser.newContext({viewport:{width:1280,height:720},deviceScaleFactor:1,locale:'zh-CN',serviceWorkers:'allow'}),page=await context.newPage(),pending=[];
 page.setDefaultTimeout(45000);page.on('pageerror',e=>report.pageErrors.push(e.message));
 page.on('response',response=>{if(!response.url().includes('94886c5c89d6efa3.webp'))return;const item={url:response.url(),status:response.status(),fromServiceWorker:response.fromServiceWorker()};report.responses.push(item);pending.push(response.body().then(body=>Object.assign(item,{bytes:body.length,SHA256:sha(body)}),error=>{item.error=error.message;}));});
 async function collection(){
  for(let n=0;n<3&&!await page.locator('#refCollection').isVisible();n++)await page.locator('#refHome').click({position:{x:100,y:100}});
  await page.waitForSelector('#refCollection:not(.hidden)');
 }
 async function sample(label){
  const state=await page.evaluate(()=>({runtime:PhiOfflineNext.versions.runtime,property:document.documentElement.style.getPropertyValue('--ref-menu-image'),backgrounds:['#refCollection','.refCollectionCard.main'].map(selector=>({selector,value:getComputedStyle(document.querySelector(selector)).backgroundImage}))}));
  report.steps.push({name:label,...state});
  for(const bg of state.backgrounds)assert.equal(bg.value,`url("${expectedURL}")`,'CSS background must resolve from the document base, including its project path');
  await page.evaluate(async url=>{const image=new Image();image.src=url;await image.decode();await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));},expectedURL);
  const screenshot=await page.screenshot({path:path.join(out,label+'.png'),animations:'disabled'});
  const pixels=await page.evaluate(async({url,screenshot})=>{
   const image=new Image();image.src=url;await image.decode();
   const shot=new Image();shot.src='data:image/png;base64,'+screenshot;await shot.decode();
   const card=document.querySelector('.refCollectionCard.main'),box=card.getBoundingClientRect(),scale=Math.max(box.width/image.naturalWidth,box.height/image.naturalHeight),canvas=document.createElement('canvas');
   canvas.width=shot.naturalWidth;canvas.height=shot.naturalHeight;const ctx=canvas.getContext('2d',{willReadFrequently:true});ctx.drawImage(shot,0,0);
   const reference=document.createElement('canvas');reference.width=canvas.width;reference.height=canvas.height;const ref=reference.getContext('2d',{willReadFrequently:true});ref.drawImage(image,box.x+(box.width-image.naturalWidth*scale)/2,box.y+(box.height-image.naturalHeight*scale)/2,image.naturalWidth*scale,image.naturalHeight*scale);
   const samples=[];for(const x of [.35,.5,.65])for(const y of [.38,.45,.52]){const px=Math.floor(box.x+box.width*x),py=Math.floor(box.y+box.height*y),actual=Array.from(ctx.getImageData(px,py,1,1).data),expected=Array.from(ref.getImageData(px,py,1,1).data);samples.push({x:px,y:py,actual,expected,maxDifference:Math.max(...actual.map((v,i)=>Math.abs(v-expected[i])))});}
   return {width:image.naturalWidth,height:image.naturalHeight,samples};
  },{url:expectedURL,screenshot:screenshot.toString('base64')});
  report.steps.at(-1).pixels=pixels;
  assert(pixels.width>0&&pixels.height>0);assert(pixels.samples.filter(p=>p.maxDifference<=8).length>=6,'Visible card pixels must contain the original cover image');
 }
 try{
  const response=await page.goto(base,{waitUntil:'domcontentloaded'});assert.equal(response.status(),200);
  await page.waitForFunction(()=>window.PhiOfflineNext?.modules.StorageManager.mode()==='persistent');await collection();await sample('initial-collection');
  await page.locator('[data-reference-open-library]').first().click();await page.waitForSelector('#libraryView:not(.hidden)');await page.locator('#refLibraryBack').click();await page.waitForSelector('#refCollection:not(.hidden)');await sample('return-to-collection');
  const runtime=await page.evaluate(()=>PhiOfflineNext.versions.runtime),cache='tycphigros-app-'+runtime.match(/pages-\d+$/)[0];
  await page.waitForFunction(async name=>!!navigator.serviceWorker.controller&&(await caches.keys()).includes(name),cache);
  const reload=await page.reload({waitUntil:'domcontentloaded'});assert(reload.fromServiceWorker());await page.waitForFunction(()=>window.PhiOfflineNext);await collection();await sample('worker-cached-collection');
  report.worker=await page.evaluate(async()=>({controller:navigator.serviceWorker.controller.scriptURL,caches:await caches.keys()}));
  await Promise.all(pending);assert(report.responses.some(r=>r.url===expectedURL&&r.status===200&&r.bytes===expectedBytes.length&&r.SHA256===sha(expectedBytes)),'Original background response bytes must match');
  assert(!report.responses.some(r=>new URL(r.url).pathname.includes('/css/assets/')),'No stylesheet-relative background request may remain');assert.deepEqual(report.pageErrors,[]);report.status='passed';
 }catch(error){report.status='failed';report.error=error.stack;process.exitCode=1;await page.screenshot({path:path.join(out,'failure.png')}).catch(()=>{});}
 finally{await Promise.all(pending);report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(out,'report.json'),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report));await context.close();await browser.close();}
 return report;
}
module.exports={verifyMenuBackground};
if(require.main===module)verifyMenuBackground(process.argv[2],path.resolve(process.argv[3]||'work/menu-background')).catch(error=>{console.error(error);process.exitCode=1;});
