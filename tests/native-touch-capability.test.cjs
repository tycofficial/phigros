'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./helpers/engine.cjs');
const app=fs.readFileSync('js/app.js','utf8');
const functions=app.slice(app.indexOf('  function isAppleTouchDevice()'),app.indexOf('  function canvasBlob('));
function capability(userAgent,maxTouchPoints,ontouchstart=true){
  const navigator={userAgent};if(maxTouchPoints!==undefined)navigator.maxTouchPoints=maxTouchPoints;
  const window=ontouchstart?{ontouchstart:null}:{};
  const c=vm.createContext({window,navigator});
  vm.runInContext(functions+'\nglobalThis.result={apple:isAppleTouchDevice(),native:supportsNativeTouchInput(isAppleTouchDevice()),pending:needsNativeTouchConfirmation(isAppleTouchDevice())};',c);
  return c.result;
}
test('legacy iPhone and iPad WebKit use touch events without a TouchEvent constructor or maxTouchPoints',()=>{
  for(const ua of ['Mozilla/5.0 (iPhone; CPU iPhone OS 12_5 like Mac OS X)','Mozilla/5.0 (iPad; CPU OS 12_5 like Mac OS X)']){
    const r=capability(ua,undefined);assert.equal(r.apple,true);assert.equal(r.native,true);
  }
});
test('native touch selection respects real event support and desktop touch capabilities',()=>{
  assert.equal(capability('iPad',undefined,false).native,false);
  assert.equal(capability('Mozilla/5.0 (Macintosh)',5).native,true);
  assert.equal(capability('Mozilla/5.0 (Macintosh)',0).native,false);
  assert.equal(capability('Mozilla/5.0 (Linux; Android)',5).native,true);
});
test('ambiguous desktop-mode iPad enables touch discovery without changing desktop render policy',()=>{
  const ua='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15) AppleWebKit/605.1.15';
  const unknown=capability(ua,undefined,true);
  assert.equal(unknown.apple,false);assert.equal(unknown.native,true);assert.equal(unknown.pending,true);
  const desktop=capability(ua,0,true);
  assert.equal(desktop.apple,false);assert.equal(desktop.native,false);assert.equal(desktop.pending,false);
  assert.equal(capability(ua,undefined,false).native,false);
});
test('Apple live-contact snapshots avoid rescanning historical pointer receipts',()=>{
  const {probe:p,setNow}=fixture();p.nativeTouchAuthoritative=true;
  const touches=Array.from({length:6},(_,identifier)=>({identifier,clientX:400+identifier*15,clientY:250}));
  p.touchStart({changedTouches:touches,touches,timeStamp:1000,cancelable:true,preventDefault(){}});
  const original=p.inputDownReceipts;
  const history=Array.from({length:122},(_,i)=>({at:500+i,touchId:-100-i,ended:true,endAt:900})).concat(original);
  let itemReads=0;p.inputDownReceipts=new Proxy(history,{get(target,key,receiver){if(/^\d+$/.test(String(key)))itemReads++;return Reflect.get(target,key,receiver);}});
  setNow(1010);p.recoverNativeTouchSnapshot({touches,timeStamp:1010},{synthesizeMissingDown:true,reconcileMissing:true});
  assert.equal(itemReads,0);assert.equal(p.pointer.size,6);
  for(const touch of touches)assert.equal(p.pointer.get(-1-touch.identifier).active,true);
});
test('an older snapshot cannot move a reused identifier backwards on Apple',()=>{
  const {probe:p,setNow}=fixture();p.nativeTouchAuthoritative=true;
  const t={identifier:1,clientX:500,clientY:250},start=stamp=>p.touchStart({changedTouches:[t],touches:[t],timeStamp:stamp,cancelable:true,preventDefault(){}});
  start(1000);setNow(1050);p.touchEnd({changedTouches:[t],touches:[],timeStamp:1050});
  setNow(1100);start(1100);const active=p.pointer.get(-2);
  setNow(1200);p.touchMove({changedTouches:[{...t,clientX:25}],touches:[{...t,clientX:25}],timeStamp:1040});
  assert.equal(p.pointer.get(-2),active);assert.equal(active.x,500);assert.equal(active.active,true);
});
for(const apple of [true,false])test(`pen and finger at the same place stay independent (Apple authority=${apple})`,()=>{
  const {probe:p}=fixture();p.nativeTouchAuthoritative=apple;
  const hits=[];p.tryTap=id=>hits.push(id);
  p.pointerDown({pointerType:'pen',pointerId:9,clientX:500,clientY:250,timeStamp:1000,cancelable:true,preventDefault(){}});
  const touch={identifier:1,clientX:500,clientY:250};
  p.touchStart({changedTouches:[touch],touches:[touch],timeStamp:1000,cancelable:true,preventDefault(){}});
  assert.deepEqual(hits,[9,-2]);assert.equal(p.pointer.size,2);
});
for(const pointerFirst of [true,false])test(`ambiguous WebKit confirms native touch after reconciling the first edge (pointer first=${pointerFirst})`,()=>{
  const {probe:p}=fixture();p.nativeTouchPendingAuthority=true;p.nativeTouchAuthoritative=false;
  const hits=[];p.tryTap=id=>hits.push(id);
  const pointer={pointerType:'touch',pointerId:9,clientX:500,clientY:250,timeStamp:1000,cancelable:true,preventDefault(){}};
  const touch={identifier:1,clientX:500,clientY:250},native={changedTouches:[touch],touches:[touch],timeStamp:1000,cancelable:true,preventDefault(){}};
  if(pointerFirst){p.pointerDown(pointer);p.touchStart(native);}else{p.touchStart(native);p.pointerDown(pointer);}
  assert.equal(hits.length,1);assert.equal(p.pointer.size,1);assert.equal(p.pointer.has(-2),true);
  assert.equal(p.nativeTouchAuthoritative,true);assert.equal(p.nativeTouchPendingAuthority,false);
});
test('ambiguous non-touch desktop mouse remains independent while awaiting a native event',()=>{
  const {probe:p}=fixture();p.nativeTouchPendingAuthority=true;p.nativeTouchAuthoritative=false;
  const hits=[];p.tryTap=id=>hits.push(id);
  p.pointerDown({pointerType:'mouse',pointerId:9,clientX:500,clientY:250,timeStamp:1000,cancelable:true,preventDefault(){}});
  assert.deepEqual(hits,[9]);assert.equal(p.pointer.has(9),true);assert.equal(p.nativeTouchAuthoritative,false);
});
test('ambiguous WebKit can confirm native authority after a missing start and an observed touch move',()=>{
  const {probe:p}=fixture();p.nativeTouchPendingAuthority=true;p.nativeTouchAuthoritative=false;
  const hits=[];p.tryTap=id=>hits.push(id);
  p.pointerDown({pointerType:'touch',pointerId:9,clientX:500,clientY:250,timeStamp:1000,cancelable:true,preventDefault(){}});
  const touch={identifier:1,clientX:500,clientY:250};
  p.touchMove({changedTouches:[touch],touches:[touch],timeStamp:1000,cancelable:true,preventDefault(){}});
  assert.equal(hits.length,1);assert.equal(p.pointer.has(-2),true);assert.equal(p.nativeTouchAuthoritative,true);
});
for(const method of ['touchStart','touchMove'])test(`delayed first ${method} preserves the existing edge and note ownership`,()=>{
  const {probe:p,setNow}=fixture();p.nativeTouchPendingAuthority=true;p.nativeTouchAuthoritative=false;
  const hits=[];p.tryTap=id=>hits.push(id);
  p.pointerDown({pointerType:'touch',pointerId:9,clientX:500,clientY:250,timeStamp:1000});
  const state=p.pointer.get(9),hold={holdPointer:9,releaseAt:Infinity},special={dragPointer:9,flickPointer:9};
  p.activeHolds.add({n:hold});p.pendingJudge=[{n:special}];
  setNow(1100);
  const touch={identifier:1,clientX:500,clientY:250};
  p[method]({changedTouches:[touch],touches:[touch],timeStamp:1100});
  assert.deepEqual(hits,[9]);assert.equal(p.pointer.size,1);assert.equal(p.pointer.get(-2),state);
  assert.equal(hold.holdPointer,-2);assert.equal(hold.releaseAt,Infinity);
  assert.equal(special.dragPointer,-2);assert.equal(special.flickPointer,-2);
  p.pointerUp({pointerType:'touch',pointerId:9,timeStamp:1100});
  assert.equal(p.pointer.get(-2),state);
  setNow(1110);p.touchEnd({changedTouches:[touch],touches:[],timeStamp:1110});
  assert.equal(p.pointer.size,0);assert.equal(p.nativePointerLinks.size,0);
});
test('first native snapshot retires absent touch fallbacks while preserving pen and mouse contacts',()=>{
  const {probe:p,setNow}=fixture();p.nativeTouchPendingAuthority=true;p.nativeTouchAuthoritative=false;
  const hits=[];p.tryTap=id=>hits.push(id);
  for(const [pointerType,pointerId,clientX] of [['touch',9,100],['pen',10,500],['mouse',11,500]])
    p.pointerDown({pointerType,pointerId,clientX,clientY:250,timeStamp:1000});
  setNow(1100);const touch={identifier:1,clientX:500,clientY:250};
  p.touchStart({changedTouches:[touch],touches:[touch],timeStamp:1100});
  assert.deepEqual(hits,[9,10,11,-2]);assert.equal(p.pointer.has(9),false);
  assert.equal(p.pointer.has(10),true);assert.equal(p.pointer.has(11),true);assert.equal(p.pointer.has(-2),true);
});
