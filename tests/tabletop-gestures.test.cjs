'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ContactPlanner}=require('../js/tabletop-planner.js');
function fixture(notes,blocked=()=>false){
  const e={chart:{offset:0},w:1000,h:750,surfaceW:1000,surfaceH:750,viewScale:1,viewX:0,viewY:0,
    noteItems:notes.map(n=>({L:{},n:{time:1,end:1,type:1,px:300,py:375,...n}})),
    noteJudgePointInto(L,n,t){return{x:n.px,y:n.py,line:{ux:1,uy:0}};},
    judgeHalfWidth:()=>65,touchCoordinatesMatchNote(L,n,x){return Math.abs(x-n.px)<=65;}};
  return new ContactPlanner(e,{blocked});
}
function assertHits(p){
  for(const item of p.engine.noteItems){
    const hit=item.n.time,contacts=p.poses(hit).filter(pose=>pose.contact&&pose.event.items.includes(item));
    assert(contacts.length,`the actual hit at ${hit} must remain in a contact`);
    for(const pose of contacts)assert(p.engine.touchCoordinatesMatchNote(item.L,item.n,pose.x*1000,pose.y*750,hit));
  }
}
test('single-note phrases translate the hand and retain the index instead of selecting a nearby ring finger',async()=>{
  const p=fixture(Array.from({length:12},(_,i)=>({time:1+i*.15,px:250+(i%4)*50})));await p.build();
  assert(p.events.every(event=>event.track%5===0));assertHits(p);
});
test('a chain of yellow notes remains one continuous glide with no artificial down edges',async()=>{
  const p=fixture([{type:1,time:1},{type:2,time:1.12},{type:2,time:1.24,px:330},{type:2,time:1.36,px:360}]);await p.build();
  assert.equal(p.events.length,1);assert.equal(p.stats.glides,3);assert.equal(p.events[0].items.length,4);
  for(let time=1;time<=1.38;time+=1/480)assert(p.pose(p.events[0].track,time).contact);
  assertHits(p);
});
test('a blue note flows into a nearby Flick on the same touching index finger',async()=>{
  for(const gap of [.02,.10]){
    const p=fixture([{type:1,time:1},{type:4,time:1+gap}]);await p.build();
    assert.equal(p.stats.linkedFlicks,1);assert.equal(p.events.length,1);assert.equal(p.events[0].track%5,0);
    for(let time=1;time<=1+gap;time+=1/480)assert(p.pose(p.events[0].track,time).contact);
    const a=p.pose(p.events[0].track,1),b=p.pose(p.events[0].track,1+gap);
    assert(Math.hypot((a.x-b.x)*26.346,(a.y-b.y)*19.807)>.35,'a Flick must include a real stroke before its hit');
    assertHits(p);
  }
});
test('isolated yellow notes glide across their hit instead of imitating a blue press',async()=>{
  const p=fixture([{type:2,time:1}]);await p.build();const event=p.events[0];
  assert(event.start<.98);assert(event.end>1.02);
  const a=p.pose(event.track,event.start),b=p.pose(event.track,1);
  assert(a.contact&&b.contact);assert(Math.abs(a.y-b.y)>.008);assertHits(p);
});
test('each following blue note still releases and creates a separate press',async()=>{
  const p=fixture([{time:1},{type:2,time:1.1},{time:1.3}]);await p.build();assert.equal(p.events.length,2);
  assert(p.events[0].end<p.events[1].start);assert(!p.pose(p.events[0].track,1.2).contact);assertHits(p);
});
test('a red mask in the gap rejects a continuous gesture and lifts safely above it',async()=>{
  const blocked=(e,x,y,t)=>t>1.04&&t<1.08;
  const p=fixture([{time:1},{type:2,time:1.16}],blocked);await p.build();assert.equal(p.events.length,2);
  for(let time=1.041;time<1.08;time+=1/480)assert(p.poses(time).every(pose=>!pose.contact));assertHits(p);
});
test('large valid gesture displacements do not silently truncate a later required hit',async()=>{
  const p=fixture([]),a={L:{},n:{type:1,time:1,end:1,px:300}},b={L:{},n:{type:2,time:1.1,end:1.1,px:350}};
  const event={item:a,items:[a,b],start:1,end:1.12,hold:false,track:0,samples:[{time:1,x:.3,y:.6},{time:1.1,x:.35,y:.6},{time:1.12,x:.35,y:.6}]};
  p.events=[event];p.tracks[0].events=[event];await p.resolveTransitions(()=>{});assert(event.end>=1.1);assert(p.pose(0,1.1).contact);
});
test('finger preference never assigns a simultaneous span that the real hand cannot reach',()=>{
  const p=fixture([]),item={L:{},n:{type:3,time:1,end:2,px:50}};
  p.events=[{item,items:[item],start:1,end:2,hold:true,track:0,samples:[{time:1,x:.05,y:.8},{time:2,x:.05,y:.8}]}];
  const planned={start:1,end:2,track:3,samples:[{time:1,x:.95,y:.8},{time:2,x:.95,y:.8}]};
  assert.equal(p.handCanReach(3,planned),false,'left index/pinky cannot span the full display');
  assert.equal(p.handCanReach(5,planned),true,'the other hand can play the far side');
  planned.samples=[{time:1,x:.02,y:.8},{time:2,x:.02,y:.8}];assert.equal(p.handCanReach(1,planned),true);
  planned.samples=[{time:1,x:.02,y:.8},{time:2,x:.95,y:.8}];assert.equal(p.handCanReach(3,planned),false,'test the whole future overlap, not just the first frame');
});
test('a fast distant blue transition uses a prepared finger instead of teleporting the recent index',async()=>{
  const p=fixture([{time:1,px:300},{time:1.04,px:460}]);await p.build();
  assert.notEqual(p.events[0].track,p.events[1].track);assertHits(p);
  const old=p.events[0],next={start:1.04,end:1.056,samples:[{time:1.04,x:.46,y:.86}]};
  assert.equal(p.trackCanTravel(old.track,next),false);
  next.start=1.2;assert.equal(p.trackCanTravel(old.track,next),true);
});
test('Hold handoff availability checks travel to the following authored press as well',()=>{
  const p=fixture([]),item={L:{},n:{type:1,time:2,end:2,px:900}};
  p.tracks[0].events=[{item,items:[item],track:0,start:2,end:2.016,samples:[{time:2,x:.9,y:.8},{time:2.016,x:.9,y:.8}]}];
  const handoff={start:1,end:1.985,samples:[{time:1,x:.2,y:.8},{time:1.985,x:.2,y:.8}]};
  assert.equal(p.trackCanTravel(0,handoff),false);
  handoff.end=1.5;assert.equal(p.trackCanTravel(0,handoff),true);
});
test('a judged blue press holds its physical pixel instead of chasing a decorative rotating line',async()=>{
  const p=fixture([{time:1,px:300}]),e=p.engine;
  e.noteJudgePointInto=(L,n,t)=>({x:n.px+10000*(t-n.time),y:375,line:{ux:1,uy:0}});
  e.touchCoordinatesMatchNote=(L,n,x,y,t)=>Math.abs(x-n.px-10000*(t-n.time))<=65;
  await p.build();const event=p.events[0],head=p.pose(event.track,1),tail=p.pose(event.track,1.015);
  assert.equal(tail.x,head.x);assert.equal(tail.y,head.y);assertHits(p);
});
test('incoming red after a judged press makes the finger lift rather than teleport to another free region',async()=>{
  const p=fixture([{time:1}],(e,x,y,t)=>t>1.01&&y>550);await p.build();const event=p.events[0];
  assert(event.end<1.01);assert(p.poses(1.015).every(pose=>!pose.contact));assertHits(p);
});
test('same-depth simultaneous fingers retain the MCP lateral order',()=>{
  const p=fixture([]),item={L:{},n:{type:3,time:1,end:2,px:840}};
  p.events=[{item,items:[item],start:1,end:2,hold:true,track:5,samples:[{time:1,x:.84,y:.65},{time:2,x:.84,y:.65}]}];
  const planned={start:1,end:2,samples:[{time:1,x:.7,y:.65},{time:2,x:.7,y:.65}]};
  assert.equal(p.handCanReach(6,planned),false,'a right middle finger cannot pass through the touching index');
  planned.samples=[{time:1,x:.86,y:.65},{time:2,x:.86,y:.65}];assert.equal(p.handCanReach(6,planned),true);
  planned.samples=[{time:1,x:.7,y:.85},{time:2,x:.7,y:.85}];assert.equal(p.handCanReach(6,planned),true,'genuinely separate depth remains available');
});
test('a new finger on the same hand cannot demand a distant palm immediately after another releases',()=>{
  const p=fixture([]),item={L:{},n:{type:1,time:1,end:1,px:50}};
  p.events=[{item,items:[item],start:.98,end:1,track:0,samples:[{time:.98,x:.05,y:.8},{time:1,x:.05,y:.8}]}];
  const planned={start:1.01,end:1.026,samples:[{time:1.01,x:.95,y:.8},{time:1.026,x:.95,y:.8}]};
  assert.equal(p.handCanReach(3,planned),false);
  assert.equal(p.handCanReach(5,planned),true,'the prepared other hand can play the distant contact');
});
