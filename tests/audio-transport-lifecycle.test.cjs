'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs');
function deferred(){let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
function setup(webAudio=true){
 const calls=[],activation=deferred(),buffer=deferred();
 const ac={currentTime:5,createBufferSource(){calls.push('source');return {playbackRate:{},connect(){},start(){calls.push('start');},stop(){calls.push('stop');}};}};
 const f=fixture({AUDIO_START_GUARD:.035,FRAME_TARGET_MS:1000/60,HIGH_REFRESH_PROBE_MS:1000,setTimeout:()=>0,syncAssistIndicators(){},syncGameViewportCSS(){},chartRevealEnabled:false});
 f.context.Engine.ensureAudioContextRunning=()=>activation.promise;
 const p=f.probe;
 Object.assign(p,{musicUsingWebAudio:webAudio,musicToken:0,musicBuffer:{duration:160},musicRate:1,
  ensureMediaAudioSource(){calls.push('media-source');},ensureMusicGain:()=>({}),
  cancelAutoplayAudio(){calls.push('cancel-auto');},prepareAutoplayScheduler(){},prepareAutoJudge(){},
  audio:{currentTime:0,play(){calls.push('play');return Promise.resolve();},pause(){calls.push('pause');}},
  streamSession:webAudio?null:{wait(){calls.push('buffer');return buffer.promise;}},
  mediaMusicSource:{}});
 return {...f,calls,activation,buffer,ac};
}
for(const outcome of ['resolved','rejected'])for(const change of ['stopped','superseded']){
 test(`Web Audio ${outcome} activation cannot start or change a ${change} session`,async()=>{
  const {probe:p,calls,activation,ac}=setup(),pending=p.startMusic(12);
  ++p.transitionToken;if(change==='stopped')p.running=false;
  if(outcome==='resolved')activation.resolve(ac);else activation.reject(Error('old activation failed'));
  await pending;
  assert.deepEqual(calls,[]);assert.equal(p.musicUsingWebAudio,true);assert.equal(p.musicSource,undefined);
 });
}
for(const boundary of ['activation','buffer'])for(const change of ['stopped','superseded']){
 test(`stream ${boundary} cannot play or seek after ${change}`,async()=>{
  const {probe:p,calls,activation,buffer,ac}=setup(false),pending=p.startMusic(12);
  if(boundary==='buffer'){activation.resolve(ac);await new Promise(setImmediate);assert(calls.includes('buffer'));}
  ++p.transitionToken;if(change==='stopped')p.running=false;
  activation.resolve(ac);buffer.resolve();await pending;
  assert(!calls.includes('play'));if(boundary==='activation')assert.equal(p.audio.currentTime,0);
 });
}
test('current Web Audio activation starts the requested source',async()=>{
 const {probe:p,calls,activation,ac}=setup(),pending=p.startMusic(12);activation.resolve(ac);await pending;
 assert(calls.includes('start'));assert.equal(p.musicOffset,12);assert.equal(p.musicPlaying,true);
});
test('current stream still waits for its buffer before playing',async()=>{
 const {probe:p,calls,activation,buffer,ac}=setup(false),pending=p.startMusic(12);
 activation.resolve(ac);await new Promise(setImmediate);assert(!calls.includes('play'));
 buffer.resolve();await pending;assert(calls.includes('play'));assert.equal(p.audio.currentTime,12);
});
for(const method of ['start','resume'])for(const outcome of ['resolved','rejected']){
 test(`late ${method} ${outcome} completion cannot affect replacement playback`,async()=>{
  const {probe:p,context,calls}=setup(),oldPlayback=deferred();let starts=0;
  Object.assign(p,{paused:true,chart:{kind:'pjsk'},reset(){},hideCountdown(){},countdown:async()=>true,
   beginAudioWakeFromGesture:()=>Promise.resolve(),ensureAudioSessionReady:async()=>{},
   resize(){},mountGameplayBackground(){},seekJudgeFeed(){},
   startMusic(){return ++starts===1?oldPlayback.promise:Promise.resolve();},pauseMusic(){calls.push('pause-replacement');}});
  p.resume=context.Engine.prototype.resume;
  const old=method==='start'?p.start(false):p.resume();await new Promise(setImmediate);
  assert.equal(starts,1);await p.start(false);assert.equal(starts,2);assert.equal(p.paused,false);
  if(outcome==='resolved')oldPlayback.resolve();else oldPlayback.reject(Error('old playback failed'));
  await old;assert.deepEqual(calls,[]);assert.equal(p.paused,false);
 });
}
test('current activation failure retains the existing media fallback',async()=>{
 const {probe:p,calls,activation}=setup(),pending=p.startMusic(12);activation.reject(Error('context unavailable'));await pending;
 assert.equal(p.musicUsingWebAudio,false);assert(calls.includes('play'));assert.equal(p.audio.currentTime,12);
});
test('current start playback failure still rejects and restores the pause panel',async()=>{
 const {probe:p,node}=setup();Object.assign(p,{chart:{kind:'pjsk'},reset(){},hideCountdown(){},
  ensureAudioSessionReady:async()=>{},startMusic:async()=>{throw Error('current playback failed');}});
 await assert.rejects(p.start(false),/current playback failed/);assert.equal(p.paused,true);assert.equal(p.starting,false);
 assert.equal(node('#pausePanel').classList.contains('hidden'),false);
});
for(const outcome of ['resolved','rejected']){
 test(`late watchdog fallback ${outcome} completion cannot alter a replacement`,async()=>{
  const timers=[],{probe:p,context,calls,activation,ac}=setup(),playback=deferred();
  context.setTimeout=callback=>{timers.push(callback);return 0;};
  p.syncClock=()=>calls.push('sync');p.pause=()=>calls.push('pause-session');context.toast=()=>calls.push('toast');
  p.audio.play=()=>{calls.push('play');return playback.promise;};
  const pending=p.startMusic(12);activation.resolve(ac);await pending;
  timers[0]();assert(calls.includes('play'));++p.transitionToken;const before=[...calls];
  if(outcome==='resolved')playback.resolve();else playback.reject(Error('old media failed'));
  await new Promise(setImmediate);assert.deepEqual(calls,before);
 });
}
