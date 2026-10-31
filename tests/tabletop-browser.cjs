'use strict';
// Starts the server in the same network namespace as Chromium.
// NODE_PATH must contain Playwright; CHROMIUM_PATH may select a local binary.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.m4a':'audio/mp4','.woff2':'font/woff2'};
async function main(){
  const root=process.cwd(),server=http.createServer((req,res)=>{
    let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';
    const file=path.resolve(root,'.'+name);
    if(!file.startsWith(root+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
    page.on('requestfailed',r=>{if(r.failure()?.errorText!=='net::ERR_ABORTED')console.log('REQUEST_FAILED',r.url().slice(0,240),r.failure());});
    page.on('pageerror',e=>{errors.push(e.message);console.log('PAGEERROR',e.message);});
    page.on('console',m=>{if((m.type()==='error'&&!m.text().includes('404'))||(/^(HAND_AUDIT|ENCODE_FRAME)/.test(m.text())))console.log('CONSOLE',(/^(HAND_AUDIT|ENCODE_FRAME)/.test(m.text()))?m.text():m.text().slice(0,300));});
    await page.addInitScript(()=>localStorage.setItem('phi.visionReplayEnabled','false'));
    await page.goto(`http://127.0.0.1:${server.address().port}/?skipIntro`);
    await page.waitForFunction(()=>!!window.PhiOfflineNext,{},{timeout:30000});
    console.log('APP_READY');
    if(process.env.TABLETOP_SMOKE==='1'){console.log(await page.evaluate(()=>Object.keys(PhiOfflineNext.modules)));return;}
    await page.evaluate(()=>{const m=PhiOfflineNext.modules;window.tabletopTest={record:m.BuiltinCatalog.entries.find(e=>e.id==='chapter9-DesultorySignals.technoplanet-at')};if(!tabletopTest.record)throw Error('Missing AT 18');m.VideoExporter.open(tabletopTest.record);});
    await page.waitForSelector('#videoExportScene');
    assert.equal(await page.locator('#videoExportScene').inputValue(),'ipad');
    await page.screenshot({path:process.env.TABLETOP_OUTPUT+'/export-dialog.png'});
    console.log('DIALOG_READY');await page.evaluate(value=>Object.assign(tabletopTest,value),{seconds:process.env.TABLETOP_AUDIT_ONLY?.04:Number(process.env.TABLETOP_SECONDS)||2,fps:Number(process.env.TABLETOP_FPS)||30});
    await page.exposeFunction('saveTabletopFrame',async(data,index)=>{fs.writeFileSync(process.env.TABLETOP_OUTPUT+`/frame-${index}.png`,Buffer.from(data.split(',')[1],'base64'));});
    const result=await page.evaluate(async()=>{
      const exporter=PhiOfflineNext.modules.VideoExporter;
      let result;try{result=await exporter.run(tabletopTest.record,{scene:'ipad',mode:'phigros',aspect:'16:9',resolution:1080,fps:tabletopTest.fps,start:35,clipSeconds:tabletopTest.seconds,
        onScene:async scene=>{const audit=scene.diagnostics.audit;console.log('HAND_AUDIT',JSON.stringify(audit));tabletopTest.audit=audit;},
        onFrame:async(canvas,index)=>{if(index%60===0)console.log('ENCODE_FRAME',index);if(index===0||index===15||index===30)await window.saveTabletopFrame(canvas.toDataURL('image/png'),index);}});}catch(e){throw Error(e.name+': '+e.message+' STATUS: '+document.querySelector('#videoExportStatus')?.textContent+' STACK '+e.stack);}
      window.tabletopTest.result=result;
      return{frames:result.frames,packets:result.packets,counts:result.counts,handPlan:result.handPlan,model:result.model,path:result.path,scene:result.scene,width:result.width,height:result.height,seconds:result.seconds,audioSamples:result.audioSamples,handDiagnostics:result.handDiagnostics};
    });
    console.log('EXPORT_RESULT',JSON.stringify(result));assert.equal(result.frames,Math.ceil((process.env.TABLETOP_AUDIT_ONLY?.04:Number(process.env.TABLETOP_SECONDS)||2)*(Number(process.env.TABLETOP_FPS)||30)-1e-8));assert(result.handDiagnostics.audit.maxReach<.04);assert.equal(result.scene,'ipad');assert.equal(result.handPlan.notes,2026);
    const b64=await page.evaluate(async()=>{const file=tabletopTest.result.file;return await new Promise(r=>{const reader=new FileReader();reader.onload=()=>r(reader.result);reader.readAsDataURL(file);});});
    fs.writeFileSync(process.env.TABLETOP_OUTPUT+'/Desultory-Signals-AT18-iPad-test.mp4',Buffer.from(b64.split(',')[1],'base64'));
    const cleanup=await page.evaluate(async()=>{
      const exporter=PhiOfflineNext.modules.VideoExporter;
      const first=tabletopTest.result.path;
      const direct=await exporter.run(tabletopTest.record,{scene:'gameplay',aspect:'4:3',resolution:1080,fps:30,start:0,end:.1});
      let cancelled=false;
      try{await exporter.run(tabletopTest.record,{scene:'gameplay',aspect:'4:3',resolution:1080,fps:30,start:0,end:.2,onFrame:(canvas,i)=>{if(i===1)exporter.cancel();}});}catch(e){cancelled=e.name==='AbortError';}
      await exporter.saved.list();
      return{directFrames:direct.frames,directScene:direct.scene,cancelled,active:exporter.active(),restored:document.querySelector('#gameView')?.ownerDocument===document,retained:exporter.saved.entries.some(e=>e.path===first)};
    });
    assert.deepEqual(cleanup,{directFrames:3,directScene:'gameplay',cancelled:true,active:false,restored:true,retained:true});
    console.log('CLEANUP_PASSED',JSON.stringify(cleanup));
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
