'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
const context=vm.createContext({});
vm.runInContext(source.slice(source.indexOf('  const BLOCK_EASE_TABLES='),source.indexOf('  class NativeBlockTimeline'))+'\nglobalThis.api={blockEase,prepareNativeBlocks,nativeBlockTransform};',context);
const {blockEase,prepareNativeBlocks,nativeBlockTransform}=context.api;

// These are the documented formulas in PhiraiAd's noise_area.rs, pinned at
// a60b49ad30b4748327df9a5fae794278a3978520. Sample table points exactly so
// differences in interpolation precision do not conceal a wrong easing family.
function reference(type,t){
  if(type===0)return t;
  if(type===1)return 1-Math.cos(t*Math.PI/2);
  if(type===2)return Math.sin(t*Math.PI/2);
  if(type===3)return (1-Math.cos(Math.PI*t))/2;
  if(type===13)return 0;if(type===14)return 1;
  const p=Math.floor((type-4)/3)+2,mode=(type-4)%3;
  if(mode===0)return t**p;
  if(mode===1)return 1-(1-t)**p;
  return t<.5?2**(p-1)*t**p:1-(2-2*t)**p/2;
}
test('all native noise-area easing modes match their authored curve families',()=>{
  for(let type=0;type<=14;type++)for(const value of [.15,.25,.35,.5,.65,.75,.85])
    assert.ok(Math.abs(blockEase(type,value)-reference(type,value))<1e-6,`mode ${type} at ${value}`);
});
test('Message IN noise area follows the authored ease-in-sine horizontal movement',()=>{
  const area=JSON.parse(fs.readFileSync('tests/fixtures/noise-message-in-area93.json','utf8'));
  // Preserve the real event but isolate translation from its other rotations;
  // horizontal movement maps percent coordinates x directly to 2*x-1.
  area.rotateEvents=[];area.scaleEvents=[];
  const b=prepareNativeBlocks([area])[0],start=area.moveEvents[4],end=area.moveEvents[5],u=.25;
  const time=start.time+(end.time-start.time)*u,pose=nativeBlockTransform(b,time,16/9);
  const expected=2*(start.endPosition.x+(end.endPosition.x-start.endPosition.x)*reference(1,u))-1;
  assert.ok(Math.abs(pose.center.x-expected)<1e-6,`expected ${expected}, got ${pose.center.x}`);
});
