'use strict';
// Run: node tests/chapter8-replay-browser.cjs [http://127.0.0.1:8768]
const assert=require('node:assert/strict'),{chromium}=require('playwright');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1180,height:950}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto((process.argv[2]||'http://127.0.0.1:8768')+'/tests/previews/chapter8-replay.html');
    await page.waitForFunction(()=>document.querySelector('#stats').textContent.length>5);
    const result=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
      const ctx=canvas.getContext('2d'),fx=PhiChapter8ReplayVisuals.create(canvas,{quality:1,adaptiveQuality:false,clear:true,background:false});await fx.ready;
      const snapshot=()=>{const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;let lit=0,sum=0;for(let i=0;i<d.length;i+=4){if(d[i]+d[i+1]+d[i+2]>40)lit++;sum=(sum+d[i]*3+d[i+1]*5+d[i+2]*7+d[i+3])>>>0;}return{lit,sum}};
      fx.sample({time:136.8,branch:'success'});const a=snapshot(),renderer=fx.stats.renderer,drawCalls=fx.stats.drawCalls;
      fx.sample({time:136.8,branch:'failed'});const failed=snapshot();
      fx.sample({time:131.2,branch:'success'});const early=snapshot();
      fx.sample({time:136.8,branch:'success'});const back=snapshot();
      // A frame at an unchanged music position must have unchanged geometry.
      fx.sample({time:136.8,branch:'success'});const paused=snapshot();fx.dispose();
      const c2=document.createElement('canvas');c2.width=960;c2.height=540;const fallback=PhiChapter8ReplayVisuals.create(c2,{forceCanvas:true,quality:.5,clear:true,background:false});await fallback.ready;fallback.sample({time:136.8,branch:'success'});const fallbackStats=fallback.stats;fallback.dispose();
      return{a,failed,early,back,paused,renderer,drawCalls,fallbackStats};
    });
    assert.equal(result.renderer,'webgl');assert(result.drawCalls>10);assert(result.a.lit>1000);assert.equal(result.failed.lit,0);assert.equal(result.failed.sum,0);assert(result.a.lit>result.early.lit);assert.deepEqual(result.paused,result.back);assert.equal(result.a.lit,result.back.lit);assert(Math.abs(result.a.sum-result.back.sum)<result.a.sum*.001);assert.equal(result.fallbackStats.renderer,'canvas');assert(result.fallbackStats.meshCount>0);assert.equal(errors.length,0,errors.join('\n'));
    console.log(JSON.stringify(result,null,2));console.log('WebGL shaders, native textures, success/failure, seek, pause and Canvas fallback passed.');
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
