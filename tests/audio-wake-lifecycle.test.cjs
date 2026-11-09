'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs');
function deferred(){let resolve;const promise=new Promise(r=>{resolve=r;});return {promise,resolve};}
function setup(){
 const wake=deferred(),calls=[];
 const f=fixture({chartRevealEnabled:false,syncAssistIndicators(){},syncGameViewportCSS(){calls.push('viewport');}}),p=f.probe;
 Object.assign(p,{paused:true,chart:{kind:'pjsk'},reset(){},hideCountdown(){},beginAudioWakeFromGesture(){return Promise.resolve();},ensureAudioSessionReady(){calls.push('wake');return wake.promise;},countdown:async()=>true,resize(){calls.push('resize');},mountGameplayBackground(){calls.push('background');},startMusic:async()=>{calls.push('music');throw Error('test playback boundary');}});
 // Use the shipped method, not fixture's deliberate manual-resume trap.
 p.resume=f.context.Engine.prototype.resume;
 return {...f,wake,calls};
}
for(const method of ['start','resume'])for(const change of ['stopped','superseded']){
 test(`${method}: ${change} session cannot continue after delayed audio activation`,async()=>{
  const {probe:p,wake,calls}=setup(),pending=method==='start'?p.start(false):p.resume();
  await new Promise(setImmediate);assert(calls.includes('wake'));
  ++p.transitionToken;if(change==='stopped')p.running=false;
  wake.resolve();await pending;
  assert.deepEqual(calls,['wake']);
 });
}
test('current resume still reaches playback after audio activation',async()=>{
 const {probe:p,wake,calls}=setup(),pending=p.resume();await Promise.resolve();wake.resolve();await pending;assert.deepEqual(calls,['wake','viewport','resize','background','music']);
});
