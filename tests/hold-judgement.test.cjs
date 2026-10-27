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
  p.noteItems=notes.map(n=>{const item={L:{id:0},n:{type:3,time:40,end:42,x:0,state:2,judge:'perfect',releaseAt:Infinity,holdGrace:.04,holdFxAt:Infinity,...n}};item.n._item=item;return item;});
  p.noteTimes=Float64Array.from(p.noteItems,item=>item.n.time);p.activeHolds=new Set(p.noteItems.filter(item=>item.n.state===2));
  p.lineScreen=()=>({cx:500,cy:250,ux:1,uy:0});p.touchMatchesNote=(_L,n,contact)=>Math.abs(contact.x-(500+n.x*500))<50;
  p.effects=[];p.badGhosts=[];p.nextHudPerf=p.nextProgressPerf=Infinity;p.commits=[];p.playSound=()=>{};p.hitEffect=()=>{};
  p.commit=(n,j,diff)=>{if(n.state===1)return;n.state=1;p.activeHolds.delete(n._item);p.pendingJudge.delete(n._item);p.commits.push({n,j,diff});};
  function at(time,stamp){f.setNow(stamp);p.time=time;p.update(time,stamp,time);}
  return {...f,p,at};
}
const touch=id=>({id,x:500,y:250,active:true});
test('two genuine same-position Hold heads start independently at their captured times',()=>{
  const {p,setNow,at}=playable([{state:0},{state:0}]);p.pointer.set(1,touch(1));p.pointer.set(2,touch(2));
  setNow(1250);p.time=40.25;p.tryTap(1,500,250,40);p.tryTap(2,500,250,40);
  assert.equal(p.activeHolds.size,2);assert.deepEqual(p.noteItems.map(item=>item.n.holdPointer),[1,2]);
  assert(p.noteItems.every(item=>item.n.judge==='perfect'&&item.n.holdHeadDiff===0));
  at(40.26,1260);assert.equal(p.commits.length,0);
});
test('same-position Tap plus Hold accepts two distinct presses without consuming either twice',()=>{
  const {p}=playable([{state:0,type:1},{state:0,type:3}]);p.pointer.set(1,touch(1));p.pointer.set(2,touch(2));
  p.tryTap(1,500,250,40);p.tryTap(2,500,250,40);
  assert.equal(p.commits.length,1);assert.equal(p.commits[0].j,0);assert.equal(p.activeHolds.size,1);
});
test('releasing one of two same-position Holds cannot borrow the other live Hold owner',()=>{
  const {p,at}=playable([{holdPointer:1},{holdPointer:2}]);p.pointer.set(1,touch(1));p.pointer.set(2,touch(2));
  at(40.05,1050);p.pointer.delete(1);p.noteItems[0].n.releaseAt=1.1;
  at(40.31,1310);
  assert.equal(p.commits.length,1);assert.equal(p.commits[0].n,p.noteItems[0].n);assert.equal(p.commits[0].j,3);
  assert.equal(p.noteItems[1].n.state,2);assert.equal(p.noteItems[1].n.holdPointer,2);
});
test('Hold handoff still uses a free replacement touch and keeps another Hold owner intact',()=>{
  const {p,at}=playable([{holdPointer:1},{holdPointer:2}]);p.pointer.set(2,touch(2));p.pointer.set(3,touch(3));
  at(40.1,1100);assert.equal(p.commits.length,0);
  assert.deepEqual(p.noteItems.map(item=>item.n.holdPointer),[3,2]);
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
