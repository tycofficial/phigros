'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./helpers/engine.cjs');
const app=fs.readFileSync('js/app.js','utf8');
const functions=app.slice(app.indexOf('  function isAppleTouchDevice()'),app.indexOf('  function canvasBlob('));
function capability(userAgent,maxTouchPoints,ontouchstart=true){
  const navigator={userAgent};if(maxTouchPoints!==undefined)navigator.maxTouchPoints=maxTouchPoints;
  const window=ontouchstart?{ontouchstart:null}:{};
  const c=vm.createContext({window,navigator});
  vm.runInContext(functions+'\nglobalThis.result={apple:isAppleTouchDevice(),native:supportsNativeTouchInput(isAppleTouchDevice())};',c);
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
