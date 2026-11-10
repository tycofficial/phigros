'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
function setup(){
 const media=deferred(),calls=[],f=fixture(),p=f.probe;
 f.context.Engine.ensureAudioContextRunning=async()=>({});
 f.context.Engine.ensureHitMixer=async()=>null;
 Object.assign(p,{musicUsingWebAudio:false,audioURL:'fixture',stopAudioPump(){},streamSession:null,pauseMusic:f.context.Engine.prototype.pauseMusic});
 Object.assign(p.audio,{currentTime:12,muted:false,pause(){calls.push('pause');this.paused=true;},play(){calls.push('play');this.paused=false;return media.promise;}});
 return {...f,media,calls};
}
for(const outcome of ['resolved','rejected'])test(`current gesture prime ${outcome} restores the original mute state`,async()=>{
 const {probe:p,media}=setup(),prime=p.beginAudioWakeFromGesture();assert.equal(p.audio.muted,true);
 if(outcome==='resolved')media.resolve();else media.reject(Error('native play rejected'));await prime;
 assert.equal(p.audio.muted,false);if(outcome==='resolved'){assert.equal(p.audio.paused,true);assert.equal(p.audio.currentTime,12);}
});
for(const boundary of ['startMusic','pauseMusic','stopMusic'])for(const outcome of ['resolved','rejected'])test(`${boundary} cancels a delayed ${outcome} gesture prime before reusing the media`,async()=>{
 const {probe:p,media,calls}=setup(),prime=p.beginAudioWakeFromGesture();
 if(boundary==='startMusic'){
  p.audio.play=()=>{calls.push('replacement');p.audio.paused=false;return Promise.resolve();};
  await p.startMusic(30);assert.equal(p.audio.muted,false,'replacement starts with the old prime mute state');
 }else p[boundary]();
 // The next owner may use either mute state and position. A stale callback owns neither.
 p.audio.muted=true;p.audio.currentTime=35;p.audio.paused=false;const before=calls.length;
 if(outcome==='resolved')media.resolve();else media.reject(Error('old native play rejected'));await prime;
 assert.equal(calls.length,before,'late prime paused replacement media');assert.equal(p.audio.currentTime,35);assert.equal(p.audio.muted,true);assert.equal(p.audio.paused,false);
});
test('a second gesture prime inherits the real mute state rather than the temporary mute of the first',async()=>{
 const {probe:p,media}=setup(),first=p.beginAudioWakeFromGesture(),secondMedia=deferred();
 p.audio.play=()=>secondMedia.promise;const second=p.beginAudioWakeFromGesture();
 media.resolve();await first;assert.equal(p.audio.muted,true,'old completion changed the new pending prime');
 secondMedia.resolve();await second;assert.equal(p.audio.muted,false);
});
test('a timed-out prime restores paused media before session preparation continues',async()=>{
 const f=setup(),p=f.probe,prime=p.beginAudioWakeFromGesture();
 f.context.withTimeout=async(promise,ms)=>{if(ms===2200)throw Error('controlled timeout');return promise;};
 await p.ensureAudioSessionReady(prime);assert.equal(p.audio.muted,false);assert.equal(p.audio.paused,true);
 p.audio.currentTime=31;p.audio.paused=false;f.media.resolve();await prime;
 assert.equal(p.audio.currentTime,31);assert.equal(p.audio.paused,false);
});
test('an old session timeout cannot cancel a replacement prime',async()=>{
 const f=setup(),p=f.probe,first=p.beginAudioWakeFromGesture(),timeout=deferred();
 f.context.withTimeout=(promise,ms)=>ms===2200?timeout.promise:promise;
 const preparation=p.ensureAudioSessionReady(first),secondMedia=deferred();p.audio.play=()=>secondMedia.promise;const second=p.beginAudioWakeFromGesture();
 timeout.reject(Error('old timeout'));await preparation;assert.equal(p.audio.muted,true);
 secondMedia.resolve();await second;assert.equal(p.audio.muted,false);
 f.media.resolve();await first;await flush();assert.equal(p.audio.muted,false);
});
