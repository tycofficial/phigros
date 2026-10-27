const {test}=require('node:test');
const assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs');
function contact(identifier=1){return {identifier,clientX:500,clientY:250};}
function setup(){
  const f=fixture({keyboardInput:null});f.probe.nativeTouchAuthoritative=true;
  f.probe.tapEdges=[];f.probe.tryTap=id=>f.probe.tapEdges.push(id);
  return f;
}
function start(p,t,stamp,all=[t]){
  p.touchStart({changedTouches:[t],touches:all,timeStamp:stamp,cancelable:true,preventDefault(){}});
}

test('a delayed cancellation cannot deactivate a newer finger reusing the same identifier',()=>{
  const {probe:p,setNow}=setup(),t=contact();
  start(p,t,1000);setNow(1050);p.touchEnd({changedTouches:[t],touches:[],timeStamp:1050});
  setNow(1100);start(p,t,1100);const current=p.pointer.get(-2);
  setNow(1200);p.touchCancel({changedTouches:[t],touches:[],timeStamp:1040});
  assert.equal(p.pointer.get(-2),current);assert.equal(current.active,true);assert.equal(current.cancelled,false);
  assert.equal(p.tapEdges.length,2);
});

test('old motion cannot revive a cancelled contact, while a fresh native sample resumes without another Tap',()=>{
  const {probe:p,setNow}=setup(),t=contact();start(p,t,1000);
  setNow(1100);p.touchCancel({changedTouches:[t],touches:[],timeStamp:1100});
  setNow(1200);p.touchMove({changedTouches:[t],touches:[t],timeStamp:1050});
  assert.equal(p.pointer.get(-2).active,false,'the older sample is not evidence that the cancelled finger is still down');
  p.touchMove({changedTouches:[t],touches:[t],timeStamp:1200});
  assert.equal(p.pointer.get(-2).active,true);assert.equal(p.tapEdges.length,1);
});

test('confirmation of a snapshot-recovered start does not poison later real presses after a lost touchend',()=>{
  const {probe:p,setNow}=setup(),t=contact();
  p.touchStart({changedTouches:[],touches:[t],timeStamp:1000,cancelable:true,preventDefault(){}});
  setNow(1016);start(p,t,1016);
  assert.equal(p.tapEdges.length,1,'the recovered edge is confirmed once');
  // The old finger then lifts, but WebKit omits that end notification. A later
  // real start with a recycled identifier must be a new press.
  setNow(1100);start(p,t,1100);
  assert.equal(p.tapEdges.length,2);assert.equal(p.pointer.get(-2).downT,1100);
});

test('a cancel with an omitted changedTouches list retains only a bounded recovery window for missing fingers',()=>{
  const {probe:p,setNow}=setup(),a=contact(1),b=contact(2);
  start(p,a,1000,[a,b]);setNow(1100);
  p.touchCancel({changedTouches:[],touches:[b],timeStamp:1100});
  assert.equal(p.pointer.get(-2).active,false);assert.equal(p.pointer.get(-2).cancelled,true);
  assert.equal(p.pointer.get(-3).active,true,'the other live finger stays independent');
  const deadline=p.pointer.get(-2).ghostUntil;setNow(1200);
  p.touchCancel({changedTouches:[a],touches:[b],timeStamp:1200});
  assert.equal(p.pointer.get(-2).ghostUntil,deadline,'repeated system cancellations cannot extend a ghost indefinitely');
  p.touchMatchesNote=()=>true;p.pointer.delete(-3);setNow(1600);
  assert.equal(p.findTouchForNote({}, {},40,true,1.6,-2),null);
});

test('touch diagnostics count the largest browser snapshot and raw system cancellations',()=>{
  const {probe:p,setNow}=setup(),all=Array.from({length:6},(_,i)=>contact(i));
  p.touchStart({changedTouches:all,touches:all,timeStamp:1000,cancelable:true,preventDefault(){}});
  setNow(1100);p.touchCancel({changedTouches:all.slice(0,2),touches:all.slice(2),timeStamp:1100});
  assert.equal(p.inputStats.nativeTouchMax,6);assert.equal(p.inputStats.touchCancelEvents,1);assert.equal(p.inputStats.touchCancelContacts,2);
});

test('non-passive fallback cancels a tracked game move but leaves non-game controls alone',()=>{
  const {probe:p,setNow}=setup(),t=contact();p.nativeTouchMovePassive=false;
  start(p,t,1000);setNow(1010);let prevented=0;
  p.touchMove({changedTouches:[t],touches:[t],timeStamp:1010,cancelable:true,preventDefault(){prevented++;}});
  assert.equal(prevented,1);
  p.touchEnd({changedTouches:[t],touches:[],timeStamp:1011});
  setNow(1020);const outside={...contact(2),clientX:-20};
  p.touchMove({changedTouches:[outside],touches:[outside],timeStamp:1020,cancelable:true,preventDefault(){prevented++;}});
  assert.equal(prevented,1);
});
