'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
function setup(boundary){
 const gate=deferred(),calls=[],f=fixture(),p=f.probe,E=f.context.Engine;
 E.ensureAudioContextRunning=()=>{calls.push('context');return boundary==='context'?gate.promise:Promise.resolve({});};
 E.ensureHitMixer=()=>{calls.push('mixer');return boundary==='mixer'?gate.promise:Promise.resolve(null);};
 Object.assign(p,{pack:null,customHitSounds:null,musicUsingWebAudio:true,musicPlaying:true,musicToken:1,musicSource:{stop(){calls.push('stop');}},stopAudioPump(){},cancelAutoplayAudio(){},ensureMediaAudioSource(){calls.push('fallback');}});
 return {...f,gate,calls};
}
for(const boundary of ['context','mixer'])for(const outcome of ['resolved','rejected'])for(const change of ['superseded','stopped'])test(`${boundary} ${outcome} session preparation cannot alter ${change} playback`,async()=>{
 const f=setup(boundary),p=f.probe,pending=p.ensureAudioSessionReady();await flush();
 assert(f.calls.includes(boundary));++p.transitionToken;if(change==='stopped')p.running=false;
 const source=p.musicSource,before=[...f.calls];if(outcome==='resolved')f.gate.resolve({});else f.gate.reject(Error('old preparation failed'));
 const result=await pending;assert.deepEqual(f.calls,before);assert.equal(p.musicSource,source);assert.equal(p.musicPlaying,true);assert.equal(p.musicUsingWebAudio,true);assert.equal(result,false);
});
for(const change of ['superseded','stopped'])test(`delayed prime in ${change} preparation cannot request context or mixer`,async()=>{
 const f=setup('none'),prime=deferred(),pending=f.probe.ensureAudioSessionReady(prime.promise);
 ++f.probe.transitionToken;if(change==='stopped')f.probe.running=false;prime.resolve();
 assert.equal(await pending,false);assert.deepEqual(f.calls,[]);
});
for(const boundary of ['context','mixer'])test(`current ${boundary} failure preserves the existing HTML fallback`,async()=>{
 const f=setup(boundary),pending=f.probe.ensureAudioSessionReady();await flush();f.gate.reject(Error('current preparation failed'));
 assert.equal(await pending,true);assert(f.calls.includes('stop'));assert(f.calls.includes('fallback'));assert.equal(f.probe.musicUsingWebAudio,false);
});
test('current session preparation still initializes context and mixer',async()=>{
 const f=setup('none');assert.equal(await f.probe.ensureAudioSessionReady(),true);assert.deepEqual(f.calls,['context','mixer']);assert.equal(f.probe.musicUsingWebAudio,true);
});
