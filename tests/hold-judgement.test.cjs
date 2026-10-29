const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./helpers/engine.cjs');
const source=fs.readFileSync('js/app.js','utf8');
function playable(notes){
  const f=fixture({keyboardInput:null,judgeTimingLead:0,specialJudgeDelay:0,nativeBlockTouchBlocked:()=>false,
    finiteNumber:(value,fallback)=>Number.isFinite(Number(value))?Number(value):fallback});
  vm.runInContext(source.slice(source.indexOf('  function lowerBoundNumeric('),source.indexOf('  function eventValueFast(')),f.context);
  const p=f.probe;p.tryTap=f.context.Engine.prototype.tryTap;p.candidateScratch={};p.pendingJudge=new Set();p.judgeFeedIndex=0;
  p.noteItems=notes.map(n=>{const item={L:{id:0},n:{type:3,time:40,end:42,x:0,state:2,judge:'perfect',releaseAt:Infinity,holdGrace:.04,holdFxAt:Infinity,...n}};item.n._item=item;return item;}).sort((a,b)=>a.n.time-b.n.time);
  p.noteTimes=Float64Array.from(p.noteItems,item=>item.n.time);p.activeHolds=new Set(p.noteItems.filter(item=>item.n.state===2));
  p.lineScreen=()=>({cx:500,cy:250,ux:1,uy:0});p.touchMatchesNote=(_L,n,contact)=>Math.abs(contact.x-(500+n.x*500))<50;
  p.effects=[];p.badGhosts=[];p.nextHudPerf=p.nextProgressPerf=Infinity;p.commits=[];p.playSound=()=>{};p.hitEffect=()=>{};
  p.commit=(n,j,diff)=>{if(n.state===1)return;n.state=1;p.activeHolds.delete(n._item);p.pendingJudge.delete(n._item);p.commits.push({n,j,diff});};
  function at(time,stamp){f.setNow(stamp);p.time=time;p.update(time,stamp,time);}
  return {...f,p,at};
}
const touch=id=>({id,x:500,y:250,active:true});
test('one captured press starts simultaneous overlapping Hold heads and sustains both',()=>{
  const {p,setNow,at}=playable([{state:0},{state:0}]);p.pointer.set(1,touch(1));
  setNow(1250);p.time=40.25;p.tryTap(1,500,250,40);
  assert.equal(p.activeHolds.size,2);assert.deepEqual(p.noteItems.map(item=>item.n.holdPointer),[1,1]);
  assert(p.noteItems.every(item=>item.n.judge==='perfect'&&item.n.holdHeadDiff===0));
  at(40.26,1260);assert.equal(p.commits.length,0);at(42,3000);assert.equal(p.commits.length,2);assert(p.commits.every(result=>result.j===0));
});
test('shared Hold head press excludes different timestamps, uncovered heads and Tap notes',()=>{
  const {p}=playable([{state:0,tag:'anchor'},{state:0,tag:'overlap',x:.1},
    {state:0,tag:'uncovered',x:.8},{state:0,type:1,tag:'tap'},
    {state:0,time:40.001,tag:'later'}]);p.pointer.set(1,touch(1));p.tryTap(1,500,250,40);
  const state=tag=>p.noteItems.find(item=>item.n.tag===tag).n.state;
  assert.equal(state('anchor'),2);assert.equal(state('overlap'),2);
  assert.equal(state('uncovered'),0);assert.equal(state('later'),0);assert.equal(state('tap'),0);assert.equal(p.commits.length,0);
});
test('same-position Tap plus Hold accepts two distinct presses without consuming either twice',()=>{
  const {p}=playable([{state:0,type:1},{state:0,type:3}]);p.pointer.set(1,touch(1));p.pointer.set(2,touch(2));
  p.tryTap(1,500,250,40);p.tryTap(2,500,250,40);
  assert.equal(p.commits.length,1);assert.equal(p.commits[0].j,0);assert.equal(p.activeHolds.size,1);
});
test('one remaining touch continues both overlapping Hold bodies through their tails',()=>{
  const {p,at}=playable([{holdPointer:1},{holdPointer:2}]);p.pointer.set(1,touch(1));p.pointer.set(2,touch(2));
  at(40.05,1050);p.pointer.delete(1);p.noteItems[0].n.releaseAt=1.1;
  at(40.31,1310);
  assert.equal(p.commits.length,0);assert.deepEqual(p.noteItems.map(item=>item.n.holdPointer),[2,2]);
  at(42,3000);assert.equal(p.commits.length,2);assert(p.commits.every(result=>result.j===0));
});
test('a valid overlapping touch is reusable even when a second free touch also exists',()=>{
  const {p,at}=playable([{holdPointer:1},{holdPointer:2}]);p.pointer.set(2,touch(2));p.pointer.set(3,touch(3));
  at(40.1,1100);assert.equal(p.commits.length,0);
  assert.deepEqual(p.noteItems.map(item=>item.n.holdPointer),[2,2]);
});
test('a single contact can sustain overlapping Holds with different end times',()=>{
  const {p,at}=playable([{holdPointer:1,end:41},{holdPointer:1,end:42}]);p.pointer.set(1,touch(1));
  at(40.5,1500);assert.equal(p.commits.length,0);
  at(41,2000);assert.equal(p.commits.length,1);assert.equal(p.commits[0].j,0);
  at(42,3000);assert.equal(p.commits.length,2);assert(p.commits.every(result=>result.j===0));
});
test('touch sharing still requires actual coverage of each Hold body',()=>{
  const {p,at}=playable([{holdPointer:1,x:0},{holdPointer:2,x:.8,releaseAt:1.1}]);p.pointer.set(1,touch(1));
  at(40.31,1310);assert.equal(p.commits.length,1);assert.equal(p.commits[0].n,p.noteItems[1].n);assert.equal(p.commits[0].j,3);
  assert.equal(p.noteItems[0].n.state,2);
});
test('one remaining full-area keyboard contact continues overlapping Holds',()=>{
  const {p,at,context}=playable([{holdPointer:'keyboard:KeyA'},{holdPointer:'keyboard:KeyS'}]);
  const down=new Set(['KeyA']);context.keyboardInput={down,hasGameplayKey:()=>down.size>0};
  at(40.3,1300);assert.equal(p.commits.length,0);
  assert.deepEqual(p.noteItems.map(item=>item.n.holdPointer),['keyboard:KeyA','keyboard:KeyA']);
  at(42,3000);assert.equal(p.commits.length,2);assert(p.commits.every(result=>result.j===0));
});
test('shared keyboard release starts at the last captured keyup even without an intermediate frame',()=>{
  const {p,at,context,setNow}=playable([{holdPointer:'keyboard:KeyA'},{holdPointer:'keyboard:KeyS'}]);
  const down=new Set(['KeyA','KeyS']);context.keyboardInput={down,hasGameplayKey:()=>down.size>0};
  setNow(1900);p.time=40.9;down.delete('KeyA');p.keyboardUp('KeyA',{timeStamp:1100});
  assert(p.noteItems.every(item=>item.n.releaseAt===Infinity));
  down.delete('KeyS');p.keyboardUp('KeyS',{timeStamp:1850});
  assert(p.noteItems.every(item=>item.n.releaseAt===1.85));
  at(40.95,1950);assert.equal(p.commits.length,0);
  at(41.1,2100);assert.equal(p.commits.length,2);assert(p.commits.every(result=>result.j===3));
});
test('a stalled frame crossing the Hold tail cannot turn a much earlier release into a hit',()=>{
  const {p,at}=playable([{holdPointer:1,releaseAt:1.1}]);
  at(42,3000);assert.equal(p.commits.length,1);assert.equal(p.commits[0].j,3);
});
test('release already inside the existing Hold tail window remains successful after a slow frame',()=>{
  const {p,at}=playable([{holdPointer:1,releaseAt:2.85}]);
  at(42.5,3500);assert.equal(p.commits.length,1);assert.equal(p.commits[0].j,0);
});
test('brief genuine hand-swap gaps retain the existing Hold release tolerance',()=>{
  const {p,at}=playable([{holdPointer:1,releaseAt:1.1}]);at(40.2,1200);assert.equal(p.commits.length,0);
  p.pointer.set(2,touch(2));at(40.22,1220);assert.equal(p.noteItems[0].n.holdPointer,2);assert.equal(p.noteItems[0].n.releaseAt,Infinity);
});
