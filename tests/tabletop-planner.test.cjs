'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),crypto=require('node:crypto'),zlib=require('node:zlib');
const {ContactPlanner}=require('../js/tabletop-planner.js');
function fixture(notes,blocked=()=>false){
  const e={chart:{offset:0},w:1000,h:750,surfaceW:1000,surfaceH:750,viewScale:1,viewX:0,viewY:0,
    noteItems:notes.map(n=>({L:{},n:{time:1,end:1,type:1,px:500,py:375,...n}})),
    noteJudgePointInto(L,n,t){return{x:n.px,y:n.py+(n.motion||0)*(t-n.time),line:{ux:1,uy:0}};},
    judgeHalfWidth:()=>65,
    touchCoordinatesMatchNote(L,n,x){return Math.abs(x-n.px)<=65;}};
  return new ContactPlanner(e,{blocked});
}
test('all real notes have valid contacts while fake notes are excluded',async()=>{
  const p=fixture([{px:300},{px:700},{time:1.2},{fake:true}]);await p.build();
  assert.equal(p.stats.notes,3);assert.equal(p.events.reduce((n,e)=>n+e.items.length,0),3);
  for(const event of p.events){const pose=p.pose(event.track,event.start);assert(pose.contact);assert(Math.abs(pose.x*1000-event.item.n.px)<=65);}
});
test('six coincident blue taps use six separate presses and spaced fingertips',async()=>{
  const p=fixture(Array.from({length:6},()=>({type:1,px:500,py:375})));await p.build();
  assert.equal(p.events.length,6);assert.equal(p.stats.sharedNotes,0);
  const contacts=p.poses(1).filter(p=>p.contact);assert.equal(contacts.length,6);
  for(let i=0;i<contacts.length;i++)for(let j=i+1;j<contacts.length;j++)assert(Math.hypot(contacts[i].x-contacts[j].x,contacts[i].y-contacts[j].y)>.037);
});
test('moving holds stay in their real judge strip and avoid an active noise rectangle',async()=>{
  const blocked=(e,x,y,t)=>t>=1&&t<2&&x>=420&&x<=580&&y>=280&&y<=470;
  const p=fixture([{type:3,end:2,motion:30}],blocked);await p.build();
  for(let t=1;t<2;t+=1/240){const pose=p.pose(p.events[0].track,t);assert(pose.contact);assert(!blocked(p.engine,pose.x*1000,pose.y*750,t));assert(Math.abs(pose.x*1000-500)<=65);}
  assert(p.stats.avoided>0);
});
test('flick moves before its judgement and lifts before the following full-screen noise',async()=>{
  const p=fixture([{type:4}],(e,x,y,t)=>t>1.003);await p.build();
  const event=p.events[0];assert(event.start<1);assert(event.end<=1.003);
  assert(p.pose(event.track,1).contact);assert(!p.pose(event.track,1.02).contact);
});
test('sampling order and export FPS cannot accumulate animation drift',async()=>{
  const p=fixture([{time:1,px:300},{time:1.2,px:700},{time:1.4,px:350}]);await p.build();
  const before=p.poses(1.18);for(let t=0;t<2;t+=1/120)p.poses(t);assert.deepEqual(p.poses(1.18),before);
});
test('short hover phases meet their travel phase without a midpoint jump',()=>{
  const p=fixture([{}]),item=p.engine.noteItems[0],event=(start,end,x)=>({start,end,item,items:[item],samples:[{time:start,x,y:.5}],hold:false});
  p.tracks[0].events=[event(1,1.016,.3),event(1.5,1.516,.8)];
  const seam=1.5-.42,a=p.pose(0,seam-1e-7),b=p.pose(0,seam+1e-7);
  assert(Math.hypot(a.x-b.x,a.y-b.y)<1e-5,'a short dwell must finish at the midpoint before travel starts');
});
test('lift-off and landing start at the glass without a fixed height jump',()=>{
  const p=fixture([{}]),item=p.engine.noteItems[0];item.n.time=1;
  p.tracks[0].events=[{start:1,end:1.016,item,items:[item],samples:[{time:1,x:.5,y:.5}],hold:false}];
  assert(p.pose(0,1.016+1e-7).z<1e-6);
  assert(p.pose(0,1-1e-7).z<1e-6);
});
test('an existing valid Hold contact can trigger a later Drag without an extra overlapping finger',async()=>{
  const p=fixture([{type:3,time:1,end:2,px:500,py:100},{type:2,time:1.5,end:1.5,px:500,py:650}]);
  await p.build();assert.equal(p.events.length,1);assert.equal(p.stats.sharedNotes,1);
  for(let t=1;t<2;t+=1/240)assert(p.pose(p.events[0].track,t).contact);
});
test('a changing disconnected noise mask uses an overlapping handoff with no invalid contact',async()=>{
  const blocked=(e,x,y,t)=>t<1.5?y>=500:y<=400;
  const p=fixture([{type:3,time:1,end:2}],blocked);
  // Fixed-lane mode keeps its initial contact; free Phigros depth placement
  // can otherwise choose the overlap before the noise changes.
  p.engine.chart.kind='pjsk';await p.build();
  assert(p.stats.handoffs>0);
  for(let t=1;t<2;t+=1/240){const contacts=p.poses(t).filter(pose=>pose.contact);assert(contacts.length);for(const pose of contacts)assert(!blocked(p.engine,pose.x*1000,pose.y*750,t));}
});
test('unreachable noise coverage rejects a video instead of silently fabricating contacts',async()=>{
  const p=fixture([{}],()=>true);await assert.rejects(()=>p.build(),/没有可避开噪域/);
});
test('cancelled preflight stops contact planning',async()=>{
  const p=fixture([{}]);await assert.rejects(()=>p.build(()=>{throw new DOMException('cancelled','AbortError');}),{name:'AbortError'});
});
test('extracted tablet retains the original rounded display and excludes both accessory groups',()=>{
  const dir='assets/tabletop/ipad/',m=JSON.parse(fs.readFileSync(dir+'ipad.json')),bytes=zlib.gunzipSync(fs.readFileSync(dir+m.binary));
  assert.equal(m.meshes.length,59);assert.equal(m.removedComponents.length,2);assert(m.screen.originalRoundedMesh);
  assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),m.binarySha256);
  assert(m.bounds.max[1]-m.bounds.min[1]<.8);assert(m.screen.width>26&&m.screen.width<27);
  const screen=m.meshes.find(x=>x.screen);assert.equal(screen.vertices,243);
  const vertices=new Float32Array(bytes.buffer,bytes.byteOffset+screen.vertexOffset,screen.vertices*8);
  let minY=Infinity,maxY=-Infinity,cornerFound=false;
  for(let i=0;i<vertices.length;i+=8){minY=Math.min(minY,vertices[i+1]);maxY=Math.max(maxY,vertices[i+1]);if(Math.abs(vertices[i])>12.8&&Math.abs(vertices[i+2])>9.5)cornerFound=true;assert(Number.isFinite(vertices[i]));}
  assert(maxY-minY<.00001);assert(cornerFound);
  // The rectangular corner is absent; the model's own curved boundary remains.
  assert(!Array.from({length:screen.vertices},(_,i)=>Math.abs(vertices[i*8])>m.screen.width/2-.001&&Math.abs(vertices[i*8+2])>m.screen.height/2-.001).some(Boolean));
});
test('analytic finger IK preserves all bone lengths and reaches near-full-extension contacts',async()=>{
  const {solveFinger}=await import('../js/tabletop-hand.mjs'),T=await import('../js/vendor/three/three.module.js');
  const base=new T.Vector3(2,3,10),lengths=[4.2,2.5,1.3];
  for(let i=0;i<1000;i++){
    const d=.5+i/1000*7.49,target=base.clone().add(new T.Vector3(Math.sin(i)*.4,-.2,-1).normalize().multiplyScalar(d));
    const result=solveFinger(base,target,lengths);
    assert(result.error<1e-9);
    for(let k=0;k<3;k++)assert(Math.abs(result.points[k+1].distanceTo(result.points[k])-lengths[k])<1e-8);
  }
});
test('finger bend stays continuous when a target crosses directly below the knuckle',async()=>{
  const {solveFinger}=await import('../js/tabletop-hand.mjs'),{Vector3}=await import('../js/vendor/three/three.module.js');
  const base=new Vector3(0,5,0),a=solveFinger(base,new Vector3(-.00001,1,0),[4.2,2.5,1.3]),b=solveFinger(base,new Vector3(.00001,1,0),[4.2,2.5,1.3]);
  assert(a.points[1].distanceTo(b.points[1])<.0001,'the elbow must not flip to the other side of the finger');
  for(const result of [a,b])assert(result.error<1e-9);
});
test('subdivided continuous hand skins keep 25 joints and normalized bone weights',()=>{
  for(const name of ['left','right']){
    const raw=zlib.gunzipSync(fs.readFileSync('assets/tabletop/hands/'+name+'.glb.gz')),size=raw.readUInt32LE(12),doc=JSON.parse(raw.subarray(20,20+size));
    assert.equal(doc.skins[0].joints.length,25);
    const index=doc.meshes[0].primitives[0].attributes.WEIGHTS_0,a=doc.accessors[index],v=doc.bufferViews[a.bufferView];
    assert.equal(a.count,18514);
    for(let i=0;i<a.count;i++){let sum=0;for(let k=0;k<4;k++)sum+=raw.readFloatLE(28+size+v.byteOffset+i*16+k*4);assert(Math.abs(sum-1)<1e-6);}
  }
});

test('short dwell intervals cannot squeeze half the move into a few milliseconds',()=>{
  const p=fixture([{}]),item=p.engine.noteItems[0],event=(start,end,x,y)=>({start,end,item,items:[item],samples:[{time:start,x,y}],hold:false});
  p.tracks[0].events=[event(1,1.016,.1,.1),event(1.443,1.459,.9,.9)];
  const a=p.pose(0,1.017),b=p.pose(0,1.025);
  assert(Math.hypot(a.x-b.x,a.y-b.y)<.01);
});
test('palm projection satisfies every simultaneous reach constraint and rejects disjoint reach',async()=>{
  const {projectReachDisks}=await import('../js/tabletop-hand.mjs');
  const disks=[{x:-2,z:0,r:3},{x:2,z:0,r:3},{x:0,z:1,r:2.5}],desired={x:10,z:8};
  const projected=projectReachDisks(desired,disks);assert(projected);
  for(const disk of disks)assert(Math.hypot(projected.x-disk.x,projected.z-disk.z)<=disk.r+1e-6);
  assert.deepEqual(projectReachDisks(projected,disks),projected);
  assert.equal(projectReachDisks(desired,[{x:-3,z:0,r:1},{x:3,z:0,r:1}]),null);
});
test('real hand surfaces have nail regions and join their open wrists to the forearms',async()=>{
  const T=await import('../js/vendor/three/three.module.js'),{GLTFLoader}=await import('../js/vendor/three/GLTFLoader.js'),{SkinnedHand}=await import('../js/tabletop-hand.mjs');
  for(const [name,side]of [['left',-1],['right',1]]){
    const bytes=zlib.gunzipSync(fs.readFileSync('assets/tabletop/hands/'+name+'.glb.gz'));
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const hand=new SkinnedHand(side,new T.Scene(),new T.MeshPhysicalMaterial(),.1);hand.initialize(gltf.scene);
    assert(hand.nailVertices.every(n=>n>20));
    const mask=hand.mesh.geometry.attributes.phiNail.array;assert([...mask].every(n=>n>=0&&n<=1));
    const c=hand.forearm.cuff;assert(c.ring.length>20);
    for(const wrist of [new T.Vector3(0,3.55,15),new T.Vector3(side*8,4,21)]){
      hand.forearm.update(wrist,.1);
      const p=hand.forearm.geometry.attributes.position;
      for(let i=0;i<c.ring.length;i++){
        const actual=new T.Vector3().fromBufferAttribute(p,i),expected=c.ring[i].clone().add(wrist);
        assert(actual.distanceTo(expected)<1e-5,'the forearm must start on the exact open wrist ring');
      }
    }
  }
});

test('whole-clip wrist planning anticipates contacts and stays identical when seeking backwards',async()=>{
  const T=await import('../js/vendor/three/three.module.js'),{GLTFLoader}=await import('../js/vendor/three/GLTFLoader.js'),{SkinnedHand}=await import('../js/tabletop-hand.mjs'),{WristTrajectory}=await import('../js/tabletop-motion.mjs');
  const hands=[];
  for(const [name,side]of [['left',-1],['right',1]]){
    const bytes=zlib.gunzipSync(fs.readFileSync('assets/tabletop/hands/'+name+'.glb.gz'));
    const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
    const hand=new SkinnedHand(side,new T.Scene(),new T.MeshPhysicalMaterial(),.1);hand.initialize(gltf.scene);hands.push(hand);
  }
  const planner=fixture([{time:.6,px:100},{time:.8,px:900},{time:1,px:200},{time:1.2,px:800},{time:1.5,px:500}]);await planner.build();
  const screen={width:26.35,height:19.81},trajectory=await WristTrajectory.create(hands,planner,screen,.1,2),snapshots=[];
  let previous=null,maxStep=0;
  for(let tick=0;tick<=240;tick++){
    const time=tick/120,poses=planner.poses(time),wrists=[];
    for(let h=0;h<2;h++){
      const part=poses.slice(h*5,h*5+5),plan=hands[h].plan(part,screen,.1,0,trajectory.at(h,time));hands[h].update(part,screen,.1,plan);
      assert(hands[h].reachError<.04);wrists.push(plan.wrist);
    }
    if(previous)for(let h=0;h<2;h++)maxStep=Math.max(maxStep,wrists[h].distanceTo(previous[h]));
    previous=wrists;snapshots.push(trajectory.at(0,time).toArray());
  }
  assert(maxStep<.9,'preposition the wrist before contact instead of snapping at the tap');
  for(let tick=240;tick>=0;tick--)assert.deepEqual(trajectory.at(0,tick/120).toArray(),snapshots[tick]);
  await assert.rejects(()=>WristTrajectory.create(hands,planner,screen,.1,2,AbortSignal.abort()),{name:'AbortError'});
});
