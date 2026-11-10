'use strict';
// Shipped Engine pause/resume/restart/transport methods with controlled media promises.
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
function setup(){
 const oldPlay=deferred(),newReady=deferred(),messages=[];
 const f=fixture({keyboardInput:null,chartRevealEnabled:false,syncAssistIndicators(){},syncGameViewportCSS(){},syncChartRevealUI(){},syncPauseTransportUI(){},syncPausedPjskControls(){},resetPjskState(){},performanceMonitor:{refresh(){}},FRAME_TARGET_MS:1000/60,HIGH_REFRESH_PROBE_MS:1000,toast:message=>messages.push(message)}),p=f.probe;
 f.context.Engine.ensureAudioContextRunning=async()=>({});
 Object.assign(p,{record:{name:'stream lifecycle fixture'},chart:{kind:'pjsk'},musicUsingWebAudio:false,audioURL:'fixture',mediaMusicSource:{},musicRate:1,musicToken:0,
  streamRecoveryPending:false,streamRecoveryAbort:null,inputClockPauses:[],effects:[],badGhosts:[],pendingJudge:new Set(),noteItems:[],
  clearChapter8CommunityPresentation(){},resetLumiInSongPresentation(){},clearPendingHitEffects(){},paintProgress(){},updateHUD(){},
  hideCountdown(){},beginAudioWakeFromGesture:()=>Promise.resolve(),ensureAudioSessionReady:async()=>{},countdown:async()=>true,
  resize(){},mountGameplayBackground(){},seekJudgeFeed(){},clearPointerStates(){},stopAudioPump(){}});
 p.pause=f.context.Engine.prototype.pause;p.resume=f.context.Engine.prototype.resume;p.pauseMusic=f.context.Engine.prototype.pauseMusic;
 for(const id of ['#pauseMoreBtn','#pauseMoreSheet'])f.node(id).setAttribute=()=>{};
 let recoveryWaits=0,playCalls=0,pauseCalls=0;
 p.streamSession={wait(){
  if(p.starting||p.resumePending){p.audio.readyState=3;return Promise.resolve();}
  if(++recoveryWaits===1){p.audio.readyState=3;return Promise.resolve();}
  return newReady.promise;
 }};
 p.audio.pause=()=>{pauseCalls++;p.audio.paused=true;};
 p.audio.play=()=>{playCalls++;p.audio.paused=false;return playCalls===1?oldPlay.promise:playCalls===2&&f.transportGate?f.transportGate.promise:Promise.resolve();};
 Object.assign(f,{oldPlay,newReady,messages,getWaits:()=>recoveryWaits,getPlays:()=>playCalls,getPauses:()=>pauseCalls});return f;
}
async function begin(f){const pending=f.probe.recoverStreamBuffer();await flush();assert.equal(f.getPlays(),1);return {pending,controller:f.probe.streamRecoveryAbort};}
async function replace(f,action){if(action==='restart')await f.probe.restart();else{f.probe.pause();await f.probe.resume();}}
for(const action of ['pause','restart'])test(`${action} releases an old recovery before its media play promise settles`,async()=>{
 const f=setup(),{probe:p}=f,{pending,controller}=await begin(f);
 try{if(action==='pause')p.pause();else await p.restart();assert.equal(controller.signal.aborted,true);assert.equal(p.streamRecoveryPending,false);assert.equal(p.streamRecoveryAbort,null);assert.equal(p.streamBuffering,false);}
 finally{f.oldPlay.resolve();await pending;}
});
for(const action of ['resume','restart'])for(const outcome of ['resolved','rejected'])test(`late ${outcome} recovery cannot clear the new ${action} buffer owner`,async()=>{
 const f=setup(),{probe:p,node,setNow}=f,{pending,controller}=await begin(f);let current;
 try{
  setNow(1200);await replace(f,action);p.audio.readyState=2;p.audio.ahead=0;setNow(2000);
  current=p.recoverStreamBuffer();await flush();assert.equal(f.getWaits(),2,'new recovery is blocked by the old play promise');
  const owner=p.streamRecoveryAbort,progress=p.streamSession.onProgress,interval=p.inputClockPauses.at(-1),loops=p.scheduledLoops;
  assert.notEqual(owner,controller);setNow(2200);
  if(outcome==='resolved')f.oldPlay.resolve();else f.oldPlay.reject(Error('old media callback failed'));await pending;
  assert.equal(p.streamRecoveryAbort,owner);assert.equal(owner.signal.aborted,false);assert.equal(p.streamRecoveryPending,true);assert.equal(p.streamBuffering,true);
  assert.equal(p.streamSession.onProgress,progress);assert.equal(node('#streamBufferStatus').classList.contains('hidden'),false);assert.equal(interval.end,Infinity);assert.equal(p.scheduledLoops,loops);assert.deepEqual(f.messages,[]);
  p.audio.readyState=3;p.audio.ahead=2;setNow(3000);f.newReady.resolve();await current;
  assert.equal(p.streamBuffering,false);assert.equal(p.streamRecoveryPending,false);assert.equal(p.scheduledLoops,loops+1);
 }finally{f.oldPlay.resolve();f.newReady.resolve();await Promise.allSettled([pending,current]);}
});
for(const action of ['resume','restart'])test(`old recovery completion cannot pause a pending ${action} media start`,async()=>{
 const f=setup(),p=f.probe,{pending}=await begin(f);f.transportGate=deferred();
 const replacement=action==='restart'?p.restart():(p.pause(),p.resume());
 try{
  await flush();assert.equal(f.getPlays(),2);const pauses=f.getPauses();f.oldPlay.resolve();await pending;
  assert.equal(f.getPauses(),pauses,'old recovery paused the replacement media start');assert.equal(p.audio.paused,false);
 }finally{f.oldPlay.resolve();f.transportGate.resolve();await Promise.allSettled([pending,replacement]);}
});
test('manual resume ends the old buffered-input interval at cancellation, not at a late callback',async()=>{
 const f=setup(),{probe:p,setNow}=f,{pending}=await begin(f);const interval=p.inputClockPauses[0];
 try{
  setNow(1200);p.pause();await p.resume();setNow(2000);
  assert.equal(p.inputCapturedWhileBuffered(1800),false,'input after resume is still classified as buffered');assert.equal(interval.end,1200);
  f.oldPlay.resolve();await pending;assert.equal(interval.end,1200,'old finally extended a cancelled interval');
 }finally{f.oldPlay.resolve();await pending;}
});
test('a current recovery failure still pauses and reports the real playback error',async()=>{
 const f=setup(),{pending}=await begin(f);f.oldPlay.reject(Error('current media failure'));await pending;
 assert.equal(f.probe.paused,true);assert.equal(f.probe.pauseReason,'buffering-error');assert.equal(f.probe.streamRecoveryPending,false);assert.equal(f.messages.length,1);assert.match(f.messages[0],/current media failure/);
});
