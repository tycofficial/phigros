'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {ContactPlanner}=require('../js/tabletop-planner.js');

function fixture(options={}){
  const notes=[
    {tag:'hold',type:3,time:1,end:1.5,px:800},
    {tag:'press',type:1,time:1.1,end:1.1,px:200},
    {tag:'shared',type:2,time:1.15,end:1.15,px:800},
    {tag:'later',type:1,time:1.8,end:1.8,px:500},
  ];
  const engine={chart:{offset:0},w:1000,h:750,surfaceW:1000,surfaceH:750,viewScale:1,viewX:0,viewY:0,
    noteItems:notes.map(n=>({L:{},n:{py:375,...n}})),judgeHalfWidth:()=>65,
    noteJudgePointInto(L,n){return{x:n.px,y:n.py,line:{ux:1,uy:0}};},
    touchCoordinatesMatchNote(L,n,x){return Math.abs(x-n.px)<=65;}};
  const planner=new ContactPlanner(engine,{blocked:()=>false},options),reachable=planner.handCanReach.bind(planner);
  // A later constraint rules out the initially preferred index assignment.
  // This isolates search/rollback from the already-tested anatomy solver.
  planner.handCanReach=(id,planned,...rest)=>{
    const press=planner.events.find(event=>event.item.n.tag==='press');
    if(planned.start>=1.79&&press?.track===0)return false;
    return reachable(id,planned,...rest);
  };
  return planner;
}

test('bounded replanning revisits an earlier finger choice without leaking shared-note mutations',async()=>{
  const greedy=fixture({maxRepairs:0});await assert.rejects(()=>greedy.build(),error=>error.code==='TABLETOP_ASSIGNMENT');
  const planner=fixture();await planner.build();await planner.verify();
  assert(planner.stats.replans>0);assert.equal(planner.stats.notes,4);assert.equal(planner.stats.sharedNotes,1);
  const hold=planner.events.find(event=>event.item.n.tag==='hold');
  assert.deepEqual(hold.items.map(item=>item.n.tag),['hold','shared'],'a shared note from a discarded branch must not be duplicated');
  assert.notEqual(planner.events.find(event=>event.item.n.tag==='press').track,0);
  assert.equal(planner.events.reduce((sum,event)=>sum+event.items.length,0),4);
  assert.equal(new Set(planner.events.flatMap(event=>event.items)).size,4);
});

test('replanned poses remain independent of sampling direction',async()=>{
  const planner=fixture();await planner.build();const reference=planner.poses(1.12);
  for(let time=2;time>=0;time-=1/120)planner.poses(time);
  assert.deepEqual(planner.poses(1.12),reference);
});

test('cancellation interrupts assignment retries rather than starting another branch',async()=>{
  const planner=fixture();let calls=0;
  await assert.rejects(()=>planner.build(()=>{if(++calls>5)throw new DOMException('cancelled','AbortError');}),{name:'AbortError'});
  assert(calls<=6);
});

function rotatingHolds(maxRepairs){
  const engine={chart:{offset:0},w:1000,h:750,surfaceW:1000,surfaceH:750,viewScale:1,viewX:0,viewY:0,
    noteItems:[850,600,400,150].map((px,index)=>({L:{},n:{type:3,time:1+index*.12,end:3,px,py:[200,600,600,200][index]}})),
    judgeHalfWidth:()=>20,
    holdContactEndTime:n=>n.end-.18,holdContactGrace:()=>.16,
    noteJudgePointInto(L,n,time){
      const angle=Math.max(0,Math.min(1,(time-1.4)))*Math.PI/2;
      return{x:n.px,y:n.py,line:{ux:Math.cos(angle),uy:Math.sin(angle)}};
    },
    touchCoordinatesMatchNote(L,n,x,y,time){const p=this.noteJudgePointInto(L,n,time);return Math.abs((x-p.x)*p.line.ux+(y-p.y)*p.line.uy)<=20;}};
  return new ContactPlanner(engine,{blocked:()=>false},{maxRepairs});
}
test('rotating long-Hold chords preserve authored heads and native-grace body coverage',async()=>{
  const planner=rotatingHolds(64);await planner.build();await planner.verify();
  assert.equal(planner.stats.notes,4);assert((planner.stats.maxHoldGapSeconds||0)<=.16+1e-7);
  for(const item of planner.engine.noteItems){
    assert(planner.poses(item.n.time).some(pose=>pose.contact&&pose.event.items.includes(item)));
    for(let time=item.n.time;time<=planner.requiredUntil(item);time+=1/120){
      const contacts=planner.poses(time).filter(pose=>pose.contact&&pose.event.items.includes(item));
      for(const pose of contacts){const point=planner.world(pose);assert(planner.engine.touchCoordinatesMatchNote(item.L,item.n,point.x,point.y,time));}
    }
  }
});
