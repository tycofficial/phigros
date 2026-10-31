'use strict';
// NODE_PATH=/opt/codex/runtimes/codex-primary-runtime/dependencies/node/node_modules node tests/chapter8-stage-browser.cjs [http://127.0.0.1:8784]
const assert=require('node:assert/strict'),{chromium}=require('playwright'),{PNG}=require('pngjs');
(async()=>{
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:960,height:600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
    const base=process.argv[2]||'http://127.0.0.1:8784';await page.goto(base+'/tests/previews/chapter8-stage.html');
    await page.waitForFunction(()=>document.querySelector('pre').textContent.includes('renderer'));
    const rendered=await page.evaluate(async()=>{
      const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;const ctx=canvas.getContext('2d'),fx=PhiChapter8StageEffects.create(canvas,{adaptive:false});await fx.ready;
      const image=()=>{const data=ctx.getImageData(0,0,960,540).data;let sum=0,lit=0;for(let i=0;i<data.length;i+=4){sum=(sum+data[i]*3+data[i+1]*5+data[i+2]*7)>>>0;if(data[i]+data[i+1]+data[i+2]>20)lit++;}return{sum,lit};};
      const blank=()=>{ctx.setTransform(1,0,0,1,0,0);ctx.fillStyle='#000';ctx.fillRect(0,0,960,540);};
      blank();const grid=fx.sample({songKey:'distorted-fate',time:103}),a=image();blank();fx.sample({songKey:'distorted-fate',time:103});const paused=image();
      blank();const noise=fx.sample({songKey:'distorted-fate',time:154}),b=image();
      ctx.setTransform(2,0,0,2,17,31);ctx.globalAlpha=.4;ctx.globalCompositeOperation='screen';ctx.filter='blur(2px)';const before=[ctx.getTransform().toString(),ctx.globalAlpha,ctx.globalCompositeOperation,ctx.filter];fx.sample({songKey:'distorted-fate',time:154});const after=[ctx.getTransform().toString(),ctx.globalAlpha,ctx.globalCompositeOperation,ctx.filter];
      fx.dispose();const f=PhiChapter8StageEffects.create(canvas,{forceCanvas:true});await f.ready;const fallback=f.sample({songKey:'distorted-fate',time:94});f.dispose();
      return{grid,a,paused,noise,b,before,after,fallback};
    });
    assert.equal(rendered.grid.renderer,'webgl-composite');assert.equal(rendered.grid.grid,true);assert(rendered.a.lit>500);assert.deepEqual(rendered.a,rendered.paused);
    assert.equal(rendered.noise.noise,true);assert.equal(rendered.noise.scanlines,true);assert.equal(rendered.noise.vignette,true);assert(rendered.b.lit>1000);assert.equal(rendered.grid.frameUploads,0);assert.deepEqual(rendered.before,rendered.after);assert.equal(rendered.fallback.renderer,'canvas-composite');
    await page.setContent('<style>body{margin:0}canvas{display:block}</style><canvas width="64" height="64"></canvas>');
    await page.addScriptTag({url:base+'/js/chapter8-stage-effects.js'});
    await page.evaluate(()=>{const canvas=document.querySelector('canvas'),ctx=canvas.getContext('2d');ctx.fillStyle='rgb(100,150,200)';ctx.fillRect(0,0,64,64);window.colorFX=PhiChapter8StageEffects.create(canvas,{forceCanvas:true});colorFX.sample({songKey:'other',time:1,params:{exposure:1,saturation:1,contrast:-1}});});
    await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
    const invert=PNG.sync.read(await page.screenshot({clip:{x:1,y:1,width:1,height:1}})).data;
    for(const [i,v]of[155,105,55].entries())assert(Math.abs(invert[i]-v)<=2,`inversion screenshot channel ${i}: ${invert[i]} != ${v}`);
    await page.evaluate(()=>colorFX.dispose());await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(resolve)));
    const restored=PNG.sync.read(await page.screenshot({clip:{x:1,y:1,width:1,height:1}})).data;assert.deepEqual(Array.from(restored),[100,150,200,255]);assert.deepEqual(errors,[]);
    console.log(JSON.stringify({gridPixels:rendered.a.lit,noisePixels:rendered.b.lit,renderer:rendered.grid.renderer,invertedPixel:Array.from(invert),restoredPixel:Array.from(restored),frameUploads:rendered.grid.frameUploads}));
  }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
