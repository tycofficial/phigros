'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ContactPlanner}=require('../js/tabletop-planner.js');

function fixture(notes,blocked=()=>false){
  const engine={chart:{offset:0},w:1000,h:750,surfaceW:1000,surfaceH:750,viewScale:1,viewX:0,viewY:0,
    noteItems:notes.map(n=>({L:{},n:{time:1,end:1,type:1,px:500,py:375,...n}})),
    holdContactEndTime:n=>Math.max(n.time,n.end-.18),judgeHalfWidth:()=>65,
    noteJudgePointInto(L,n,t){return{x:n.px,y:t<(n.appearAt??-Infinity)?-1000:n.py,line:{ux:n.vertical?0:1,uy:n.vertical?1:0}};},
    touchCoordinatesMatchNote(L,n,x,y,t){const p=this.noteJudgePointInto(L,n,t);return Math.abs(n.vertical?y-p.y:x-p.x)<=65;}};
  return new ContactPlanner(engine,{blocked});
}
test('long holds release at the native completed tail rather than pinning a hand until the visual end',async()=>{
  const p=fixture([{type:3,end:2}]);await p.build();
  assert.equal(p.events[0].end,1.82);assert(p.pose(p.events[0].track,1.819).contact);
  assert(!p.pose(p.events[0].track,1.9).contact);await p.verify();
});
test('a hold shorter than the native tail window retains a real independent head press',async()=>{
  const p=fixture([{type:3,end:1.08}]);await p.build();
  assert(p.events[0].end>=1.016);assert(p.pose(p.events[0].track,1).contact);await p.verify();
});
test('a rotated judgement strip preserves the preferred hand side instead of targeting the decorative centre',()=>{
  const p=fixture([{vertical:true}]),item=p.engine.noteItems[0],point=p.safe(item,1,{x:.9,y:.9});
  assert(Math.abs(point.x-.9)<1e-9);assert(p.engine.touchCoordinatesMatchNote(item.L,item.n,point.x*1000,point.y*750,1));
});
test('a centre graphic can be played beside an outer held hand along its real rotated strip',async()=>{
  const p=fixture([{type:3,time:1,end:4,px:40},{type:3,time:1,end:4,px:960},{time:2,vertical:true,py:375}]);
  p.engine.judgeHalfWidth=()=>5;p.engine.touchCoordinatesMatchNote=function(L,n,x,y,t){const point=this.noteJudgePointInto(L,n,t);return Math.abs(n.vertical?y-point.y:x-point.x)<=5;};
  await p.build();await p.verify();const note=p.engine.noteItems[2],pose=p.poses(2).find(pose=>pose.contact&&pose.event.items.includes(note));
  assert(pose);assert(pose.x<.32||pose.x>.68,'the free normal position of the strip should remain available beside a held hand');
});
test('Drag prepositions at its real hit pixel while the decorative line is still off-screen',async()=>{
  const p=fixture([{type:2,vertical:true,appearAt:.995}]);await p.build();await p.verify();
  assert.equal(p.stats.adaptiveStarts,0);assert(p.events[0].start<.995);assert(p.events[0].start<=1);
  assert(p.poses(1).some(pose=>pose.contact));
});
test('a grid timestamp rounding below a warped Drag head uses the authored head geometry',async()=>{
  const hit=1.00000000000001,p=fixture([{type:2,time:hit,end:hit,vertical:true,appearAt:hit}]);
  await p.build();await p.verify();
  assert(p.poses(1).some(pose=>pose.contact),'floating-point equivalents of the exact hit cannot select pre-warp geometry');
});
test('off-screen geometry and actual noise coverage produce distinct failure reasons',()=>{
  const hidden=fixture([{vertical:true,py:-1000}]),masked=fixture([{}],()=>true);
  assert.throws(()=>hidden.safe(hidden.engine.noteItems[0],1),error=>error.code==='TABLETOP_OFFSCREEN'&&!error.message.includes('噪域'));
  assert.throws(()=>masked.safe(masked.engine.noteItems[0],1),error=>error.code==='TABLETOP_NOISE'&&error.message.includes('噪域'));
});
test('a prepositioned finger can sustain a warping Hold across a native grace interval',async()=>{
  const p=fixture([{type:3,end:2,px:200}]);
  p.engine.holdContactGrace=()=>.16;
  p.engine.noteJudgePointInto=(L,n,t)=>({x:t<1.5?200:800,y:375,line:{ux:1,uy:0}});
  p.engine.touchCoordinatesMatchNote=(L,n,x,y,t)=>Math.abs(x-(t<1.5?200:800))<=65;
  await p.build();await p.verify();assert(p.stats.handoffs>0);assert(p.stats.holdGaps>0);
  assert(p.stats.maxHoldGapSeconds<.16);
  assert(p.poses(1.49).some(pose=>pose.contact));assert(p.poses(1.51).some(pose=>pose.contact));
});
test('Hold reacquisition searches the native grace window instead of demanding the first warped frame',async()=>{
  const p=fixture([{type:3,end:2,px:200}]);p.engine.holdContactGrace=()=>.16;
  p.engine.noteJudgePointInto=(L,n,t)=>({x:t<1.5?200:800,y:375,line:{ux:1,uy:0}});
  p.engine.touchCoordinatesMatchNote=(L,n,x,y,t)=>Math.abs(x-(t<1.5?200:800))<=65;
  const travel=p.trackCanTravel.bind(p);p.trackCanTravel=(id,planned)=>!(planned.handoff&&planned.start<1.56)&&travel(id,planned);
  await p.build();await p.verify();assert(p.stats.maxHoldGapSeconds>=.06);assert(p.stats.maxHoldGapSeconds<.16);
});
test('a close Hold handoff releases the old fingertip before the new one lands',async()=>{
  const p=fixture([{type:3,end:2}]);p.engine.holdContactGrace=()=>.16;
  const reachable=p.handCanReach.bind(p);p.handCanReach=(id,planned,...rest)=>!(id===p.events[0]?.track&&planned.start>=1.5)&&reachable(id,planned,...rest);
  await p.build();await p.verify();assert(p.stats.handoffs>0);
  for(let time=1.48;time<1.56;time+=1/240)assert(p.poses(time).filter(pose=>pose.contact).length<=1,'one Hold must not create overlapping fingertip contacts at its handoff');
});
