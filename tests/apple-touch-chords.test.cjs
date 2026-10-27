const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./helpers/engine.cjs');
const source=fs.readFileSync('js/app.js','utf8');
function playable(count){
  const f=fixture({nativeBlockTouchBlocked:()=>false,judgeTimingLead:0,specialJudgeDelay:0,keyboardInput:null});
  vm.runInContext(source.slice(source.indexOf('  function lowerBoundNumeric('),source.indexOf('  function eventValueFast(')),f.context);
  const p=f.probe;
  p.nativeTouchAuthoritative=true;
  p.tryTap=f.context.Engine.prototype.tryTap;
  p.eventAudioTime=f.context.Engine.prototype.eventAudioTime;
  p.lineScreen=()=>({cx:500,cy:250,ux:1,uy:0});
  p.candidateScratch={};p.pendingJudge=new Set();p.judgeFeedIndex=0;
  p.noteItems=Array.from({length:count},()=>{const item={L:{id:0},n:{type:1,time:40,x:0,state:0,fake:false}};item.n._item=item;return item;});
  p.noteTimes=Float64Array.from(p.noteItems,x=>x.n.time);
  p.commits=[];p.commit=(n,j,diff)=>{n.state=1;p.commits.push({n,j,diff});};
  return f;
}
function touch(i,x=500){return {identifier:i,clientX:x,clientY:250};}
function begin(p,changed,touches,timeStamp=1000){p.touchStart({changedTouches:changed,touches,timeStamp,cancelable:true,preventDefault(){}});}
test('Apple TouchEvent authority judges six simultaneous blue notes at the same location independently',()=>{
  const {probe:p}=playable(6),all=Array.from({length:6},(_,i)=>touch(i));
  // Same coordinates are intentionally realistic for stacked notes. PointerEvent
  // echoes arrive with different IDs and must never score another note.
  begin(p,all,all);
  for(let i=0;i<6;i++)p.pointerDown({pointerId:30+i,pointerType:'touch',clientX:500,clientY:250,timeStamp:1000});
  assert.equal(p.commits.length,6);assert.equal(p.inputStats.edges,6);assert.equal(p.pointer.size,6);
  p.touchEnd({changedTouches:all,touches:[],timeStamp:1010});assert.equal(p.pointer.size,0);
});
test('Apple sequential four-finger chord retains each contact with empty/partial changedTouches snapshots',()=>{
  const {probe:p,setNow}=playable(4),all=Array.from({length:4},(_,i)=>touch(i));
  for(let i=0;i<4;i++){
    const at=1000+i*4;setNow(at);p.time=40+i*.004;
    // The third native start omits its new changedTouches contact, which must be
    // recovered from touches without consuming another finger's contact.
    begin(p,i===2?[]:[all[i]],all.slice(0,i+1),at);
  }
  assert.equal(p.commits.length,4);assert.equal(p.inputStats.edges,4);assert.equal(p.pointer.size,4);
});
