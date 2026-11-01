'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ContactPlanner}=require('../js/tabletop-planner.js');

function planner(){
  const e={chart:{offset:0},w:1000,h:750,surfaceW:1000,surfaceH:750,viewScale:1,viewX:0,viewY:0,noteItems:[],touchCoordinatesMatchNote:()=>true};
  return new ContactPlanner(e,{blocked:()=>false});
}
test('hover meets separated simultaneous contacts continuously at landing and lift-off',()=>{
  const p=planner(),event=(track)=>({track,start:1,end:1.016,item:{n:{time:1,type:1}},items:[],samples:[{time:1,x:.5,y:.7}]});
  p.tracks[0].events=[event(0)];p.tracks[5].events=[event(5)];
  for(const id of [0,5]){
    const landing=p.poses(1)[id],before=p.poses(1-1e-7)[id],lift=p.poses(1.016)[id],after=p.poses(1.016+1e-7)[id];
    assert(Math.hypot(landing.x-before.x,landing.y-before.y)<1e-6);
    assert(Math.hypot(lift.x-after.x,lift.y-after.y)<1e-6);
  }
});
test('preflight rejects an event ending before its own authored note',async()=>{
  const p=planner(),item={n:{time:1,type:4,fake:false}};
  const event={track:0,start:.965,end:.99,item,items:[item],samples:[{time:.965,x:.4,y:.7}]};
  p.engine.noteItems=[item];p.events=[event];p.tracks[0].events=[event];
  await assert.rejects(()=>p.verify(),/1\.0000 秒缺少音符触点/);
});
test('hover rounds velocity changes into held contacts without moving the actual touch',async()=>{
  const T=await import('../js/vendor/three/three.module.js'),{FingerTrajectory}=await import('../js/tabletop-motion.mjs');
  const hand={fingers:Array.from({length:5},()=>({lengths:[4,3,2]})),plan:poses=>({poses}),fingerTargets:poses=>poses.map(p=>({base:new T.Vector3(),target:new T.Vector3(p.x,p.y,p.z)}))};
  const p={poses(time){return Array.from({length:10},()=>{const u=Math.max(0,Math.min(1,(time-.25)/.4));return{x:2-4*u,y:2,z:-5,contact:time<=.25||time>=.65};});}};
  const motion={hz:120,count:121,at:()=>new T.Vector3()},trajectory=await FingerTrajectory.create([hand,hand],p,{},-5,motion,1);
  let previous=null,velocity=null,velocityChange=0;
  for(let frame=0;frame<=120;frame++){
    const time=frame/120,actual=trajectory.at(0,time).offsets[0],pose=p.poses(time)[0];
    if(pose.contact)assert(actual.distanceTo(new T.Vector3(pose.x,pose.y,pose.z))<1e-5,'contact constraints remain exact');
    if(previous){const next=actual.clone().sub(previous);if(velocity)velocityChange+=next.distanceToSquared(velocity);velocity=next;}
    previous=actual;
  }
  assert(velocityChange<.007,'landing and lift-off must round the velocity corner of a linear hover');
  const snapshot=trajectory.at(0,.48).offsets[0].toArray();trajectory.at(0,.9);trajectory.at(0,.1);assert.deepEqual(trajectory.at(0,.48).offsets[0].toArray(),snapshot);
});
test('transported bend planes retain bounded rotation while turning around the wrist',async()=>{
  const T=await import('../js/vendor/three/three.module.js'),{transportBend}=await import('../js/tabletop-motion.mjs');
  let previous=new T.Vector3(0,-.5,-1).normalize(),pole=new T.Vector3(0,1,0).addScaledVector(previous,-previous.y).normalize();
  for(let i=1;i<=900;i++){
    const angle=i/900*Math.PI*4,direction=new T.Vector3(Math.sin(angle)*.4,-.5,-Math.cos(angle)).normalize();
    const next=transportBend(previous,pole,direction);
    assert(Math.abs(next.dot(direction))<1e-8);assert(next.distanceTo(pole)<.15,'hemisphere projection cannot flip the bend plane');
    previous=direction;pole=next;
  }
});

test('near-vertical contact corrections cannot snap the transported bend azimuth',async()=>{
  const {Vector3}=await import('../js/vendor/three/three.module.js'),{transportBend}=await import('../js/tabletop-motion.mjs');
  const before=new Vector3(-.001,-1,.001).normalize(),after=new Vector3(.001,-1,-.001).normalize();
  const pole=new Vector3(1,0,0).addScaledVector(before,-before.x).normalize();
  const next=transportBend(before,pole,after);
  assert(next.distanceTo(pole)<.02,'a tiny fingertip direction change cannot rotate the knuckle around the vertical axis');
  assert(Math.abs(next.dot(after))<1e-8);
});

test('a brief low wrist contact cannot cause a height jump beyond the lookahead window',async()=>{
  const {anticipateWristHeight}=await import('../js/tabletop-motion.mjs');
  const path=new Float64Array(121*3);for(let i=0;i<121;i++)path[i*3+1]=8;
  path[60*3+1]=3;const original=path.slice();anticipateWristHeight(path,120);
  assert.equal(path[60*3+1],3);
  for(let i=0;i<121;i++){
    assert(path[i*3+1]<=original[i*3+1],'smoothing preserves the contact reach ceiling');
    if(i)assert(Math.abs(path[i*3+1]-path[(i-1)*3+1])<=.05000001,'the height bound also applies outside the old 24-frame window');
  }
  assert.deepEqual([path[0],path[2]],[0,0]);
});
