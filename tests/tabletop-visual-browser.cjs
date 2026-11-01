'use strict';
// Keyframes across the entire AT 18 chart, plus actual skin-surface diagnostics.
// Run with Playwright on NODE_PATH, CHROMIUM_PATH and TABLETOP_OUTPUT configured.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.m4a':'audio/mp4','.woff2':'font/woff2'};
(async()=>{
  const dir=process.env.TABLETOP_OUTPUT;fs.mkdirSync(dir,{recursive:true});
  const server=http.createServer((req,res)=>{let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';const file=path.resolve('.'+name);if(!file.startsWith(process.cwd()+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream'});fs.createReadStream(file).pipe(res);});
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH,headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.exposeFunction('qaSaveFrame',(png,time)=>fs.writeFileSync(path.join(dir,`at-${time.toFixed(3)}.png`),Buffer.from(png.split(',')[1],'base64')));
    await page.goto(`http://127.0.0.1:${server.address().port}/?skipIntro`);
    await page.waitForFunction(()=>window.PhiOfflineNext);
    const report=await page.evaluate(async()=>{
      const m=PhiOfflineNext.modules,record=m.BuiltinCatalog.entries.find(e=>e.id==='chapter9-DesultorySignals.technoplanet-at');
      const frames=[],motion={maxWristStep:0,time:0},output={frames,motion};
      const height=886,width=Math.round(height*26.34622478485108/19.807105189400612);
      const viewport=await m.VideoExporter.Viewport.create(720*width/height,720);
      let scene;
      try{
        const full=await m.BuiltinCatalog.materialize(record);
        await m.GameStateManager.startChart(full,true,{mode:'phigros',offlineExport:true,exportDpr:height/720});
        const e=m.GameStateManager.current(),base=new m.VideoExporter.OfflineSession(e,width,height);
        await import('./js/tabletop-planner.js');const planner=await new PhiTabletopPlanner.ContactPlanner(e,{blocked:m.LandscapeLayout.blocked}).build();
        await planner.verify();
        const {TabletopScene}=await import('./js/tabletop-renderer.mjs');
        scene=await TabletopScene.create({engine:e,session:base,planner,width:1920,height:1080});
        output.audit=await scene.audit();
        const T=await import('./js/vendor/three/three.module.js'),floor=scene.model.screen.y+.006;
        motion.maxWristStep=output.audit.maxWristStepCm;motion.time=output.audit.worstMotionTime;
        scene.renderer.setSize(1280,720,false);
        for(const time of [0,4.75,14.99,27,35,50,74.111,87.125,103.37,104.04,125.94,143.6,150]){
          scene.render(time);const row={time,hands:[],wrists:scene.hands.map(h=>h.lastWrist.toArray()),contacts:scene.planner.poses(time).flatMap((p,i)=>p.contact?[{track:i,x:p.x,y:p.y,start:p.event.start,end:p.event.end,type:p.event.item.n.type}]:[])};
          for(const hand of scene.hands){
            const p=new T.Vector3(),g=hand.mesh.geometry;let minY=Infinity,deep=0;
            for(const i of new Set(g.index.array)){hand.mesh.getVertexPosition(i,p);p.applyMatrix4(hand.mesh.matrixWorld);minY=Math.min(minY,p.y);if(p.y<floor-.25)deep++;}
            row.hands.push({rawMinY:minY-floor,deepVertices:deep,reachError:hand.reachError});
          }
          frames.push(row);await window.qaSaveFrame(scene.canvas.toDataURL('image/png'),time);
        }
      }finally{scene?.close();await m.GameStateManager.backToLibrary();viewport.close();}
      return output;
    });
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify(report,null,2));
    assert.equal(report.frames.length,13);assert(report.audit.maxReach<.04);assert(report.motion.maxWristStep<1,'AT 18 wrist movement must stay below 1 cm per 120 Hz sample');assert.deepEqual(errors,[]);console.log(JSON.stringify(report));
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(e=>{console.error(e);process.exitCode=1;});
