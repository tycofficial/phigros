'use strict';
// Real chart/engine preflight across boss charts, without 3D or video encoding.
// NODE_PATH must include Playwright. TABLETOP_CHARTS accepts comma-separated
// name fragments. TABLETOP_ALLOW_FAILURES=1 retains diagnostics during repair.
// TABLETOP_3D=1 also runs the full-song joint, reach and continuity audit.
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require('playwright');
const mime={'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.json':'application/json','.css':'text/css','.png':'image/png','.jpg':'image/jpeg','.ogg':'audio/ogg','.m4a':'audio/mp4','.woff2':'font/woff2'};
(async()=>{
  const dir=process.env.TABLETOP_OUTPUT||'/workspace/scratch/tabletop-multichart';fs.mkdirSync(dir,{recursive:true});
  const server=http.createServer((req,res)=>{
    let name=decodeURIComponent(new URL(req.url,'http://localhost').pathname);if(name==='/')name='/index.html';
    const file=path.resolve('.'+name);if(!file.startsWith(process.cwd()+path.sep)||!fs.existsSync(file)||!fs.statSync(file).isFile()){res.writeHead(404);res.end();return;}
    res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});fs.createReadStream(file).pipe(res);
  });
  await new Promise(r=>server.listen(0,'127.0.0.1',r));
  const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox','--autoplay-policy=no-user-gesture-required','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader']});
  try{
    const page=await browser.newPage({viewport:{width:1280,height:720}}),errors=[];
    page.on('pageerror',e=>errors.push(e.message));
    await page.addInitScript(()=>localStorage.setItem('phi.visionReplayEnabled','false'));
    await page.goto(`http://127.0.0.1:${server.address().port}/?skipIntro`);await page.waitForFunction(()=>window.PhiOfflineNext);
    const filters=(process.env.TABLETOP_CHARTS||'Entrance,Desultory,Igallta,DistortedFate,Rrhar,ReEnd').split(',');
    const records=await page.evaluate(filters=>{
      const compact=s=>String(s).normalize('NFKD').replace(/[^\p{L}\p{N}]/gu,'').toLowerCase();
      return filters.map(filter=>{
        const wanted=compact(filter),entry=PhiOfflineNext.modules.BuiltinCatalog.entries.find(e=>/-at$/.test(e.id)&&compact(e.id+' '+e.name+' '+e.meta?.name).includes(wanted));
        return entry?{id:entry.id,name:entry.meta?.name||entry.name||entry.id}:null;
      }).filter(Boolean);
    },filters);
    assert(records.length,'No requested charts found');const results=[];
    for(const record of records){
      const result=await page.evaluate(async({record,audit3D})=>{
        const m=PhiOfflineNext.modules,height=886,width=Math.round(height*26.34622478485108/19.807105189400612),viewport=await m.VideoExporter.Viewport.create(720*width/height,720);
        let e,p,scene,base,phase='load';const rejected=[];
        const reject=entry=>{rejected.push(entry);if(rejected.length>4096)rejected.splice(0,2048);};
        const summarizeEvent=event=>({start:event.start,end:event.end,track:event.track,hold:event.hold,items:event.items.map(({n})=>({time:n.time,end:n.end,type:n.type})),samples:event.samples.length<=12?event.samples:[...event.samples.slice(0,3),...event.samples.slice(-6)]});
        try{
          const source=m.BuiltinCatalog.entries.find(entry=>entry.id===record.id),full=await m.BuiltinCatalog.materialize(source);await m.GameStateManager.startChart(full,true,{mode:'phigros',offlineExport:true,exportDpr:height/720});e=m.GameStateManager.current();
          await import('./js/tabletop-planner.js');p=new PhiTabletopPlanner.ContactPlanner(e,{blocked:m.LandscapeLayout.blocked});
          const travel=p.trackCanTravel,reach=p.handCanReach;
          p.trackCanTravel=function(id,planned){const okay=travel.call(this,id,planned);if(!okay)reject({kind:'travel',id,start:planned.start,point:planned.samples[0]});return okay;};
          p.handCanReach=function(id,planned,replacing){const okay=reach.call(this,id,planned,replacing);if(!okay)reject({kind:'reach',id,start:planned.start,point:planned.samples[0]});return okay;};
          const began=performance.now();phase='planning';await p.build();phase='contacts';const verified=await p.verify();
          let audit=null;
          if(audit3D){
            phase='motion';base=new m.VideoExporter.OfflineSession(e,width,height);
            const {TabletopScene}=await import('./js/tabletop-renderer.mjs');scene=await TabletopScene.create({engine:e,session:base,planner:p,width:1920,height:1080});
            audit=await scene.audit();
            if(audit.maxWristStepCm>=1){
              audit.wristTransition=[-1,0,1].map(offset=>{
                const time=audit.worstMotionTime+offset/120,poses=p.poses(time),floor=scene.model.screen.y+.006;
                return{time,hands:scene.hands.map((hand,h)=>{const seed=scene.motion.at(h,time),plan=hand.plan(poses.slice(h*5,h*5+5),scene.model.screen,floor,0,seed);return{seed:seed.toArray(),actual:plan.wrist.toArray(),poses:poses.slice(h*5,h*5+5).map(p=>({x:p.x,y:p.y,z:p.z,contact:p.contact}))};})};
              });
            }
            const checks={reach:audit.maxReach<.04,wrist:audit.maxWristStepCm<1,joints:audit.maxJointStepCm<2,glass:audit.minJointHeightCm>=0,spacing:audit.minContactSeparationCm==null||audit.minContactSeparationCm>=1.4-1e-4};
            const failed=Object.entries(checks).filter(([,valid])=>!valid).map(([name])=>name);
            if(failed.length)return{...record,success:false,plannerSuccess:true,phase,error:'Motion audit failed: '+failed.join(', '),stats:{...p.stats},verified,audit,seconds:(performance.now()-began)/1000,noiseAreas:(e.chart.blockAreas||[]).length};
          }
          return{...record,success:true,plannerSuccess:true,audit,seconds:(performance.now()-began)/1000,stats:{...p.stats},verified,noiseAreas:(e.chart.blockAreas||[]).length,nativeHoldPolicy:typeof e.holdContactEndTime==='function',chartKeys:Object.keys(e.chart)};
        }catch(error){
          const time=Number(error.message.match(/([0-9]+\.[0-9]+) 秒/)?.[1]);
          return{...record,success:false,phase,error:error.message,time,stats:p?{...p.stats}:null,engine:e?{w:e.w,h:e.h,surfaceW:e.surfaceW,surfaceH:e.surfaceH,viewScale:e.viewScale,viewX:e.viewX,viewY:e.viewY,noiseAreas:(e.chart.blockAreas||[]).length,nativeHoldPolicy:typeof e.holdContactEndTime==='function',chartKeys:Object.keys(e.chart)}:null,
            events:p?.events.filter(event=>event.start<time+.05&&event.end>time-.05).map(event=>{
              const point=p.sample(event,time),world=p.world(point);
              return{...summarizeEvent(event),atFailure:point,nearSamples:event.samples.filter(s=>Math.abs(s.time-time)<.05),blocked:p.blocked(world,time),valid:p.valid(event,time,point),itemValidity:event.items.map(item=>({type:item.n.type,time:item.n.time,end:item.n.end,requiredUntil:p.requiredUntil(item),relevant:p.relevant(item,time),matches:e.touchCoordinatesMatchNote(item.L,item.n,world.x,world.y,time-p.offset)}))};
            }),
            rejected:rejected.filter(r=>Math.abs(r.start-time)<.25).slice(-512),tracks:p?.tracks.map(track=>({id:track.id,last:track.last,point:track.point,events:track.events.slice(-3).map(summarizeEvent),nearEvents:track.events.filter(event=>event.start<time+2&&event.end>time-1).slice(0,20).map(summarizeEvent)})),
            notes:e?.noteItems.filter(({n})=>Math.abs(n.time+(p?.offset||0)-time)<.2).map(item=>({type:item.n.type,time:item.n.time,end:item.n.end,fake:item.n.fake,target:p.target(item,time)}))};
        }finally{scene?.close();if(!scene)base?.close();await m.GameStateManager.backToLibrary();viewport.close();}
      },{record,audit3D:process.env.TABLETOP_3D==='1'});
      results.push(result);fs.writeFileSync(path.join(dir,record.id.replace(/[^a-zA-Z0-9_-]/g,'_')+'.json'),JSON.stringify(result,null,2));
      console.log(JSON.stringify({id:result.id,success:result.success,error:result.error,seconds:result.seconds,notes:result.stats?.notes}));
    }
    fs.writeFileSync(path.join(dir,'report.json'),JSON.stringify({results,errors},null,2));
    if(process.env.TABLETOP_ALLOW_FAILURES!=='1')assert(results.every(r=>r.success),'A boss chart failed tabletop preflight; inspect report.json');
    assert.deepEqual(errors,[]);
  }finally{await browser.close();await new Promise(r=>server.close(r));}
})().catch(error=>{console.error(error);process.exitCode=1;});
