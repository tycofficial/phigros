'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs');
const deferred=()=>{let resolve,reject;const promise=new Promise((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};};
const flush=()=>new Promise(setImmediate);
function setup(){
 const gates=[],created=[],warnings=[],f=fixture({AudioWorkletNode:function(){},HIT_AUDIO_VOICE_LIMIT:44,Diagnostics:{info(){},warn(...args){warnings.push(args);}},PhiHitAudioMixer:{create(ac){const gate=deferred();gates.push(gate);created.push(ac);return gate.promise;}}}),E=f.context.Engine;
 const context=()=>({state:'running',audioWorklet:{addModule(){}},close(){this.state='closed';return Promise.resolve();}});
 E._ac=context();E.hitSoundOutput=()=>({});
 const mixer=ac=>({context:ac,destroyed:0,resets:0,flushes:0,registered:[],destroy(){this.destroyed++;},reset(){this.resets++;},flush(){this.flushes++;},register(buffer){this.registered.push(buffer);}});
 return {...f,E,gates,created,warnings,newContext:context,mixer};
}
for(const outcome of ['resolved','rejected'])for(const nextState of ['pending','ready'])test(`old ${outcome} mixer creation cannot overwrite or release the ${nextState} replacement`,async()=>{
 const f=setup(),{E}=f,oldContext=E._ac,oldMixer=f.mixer(oldContext),old=E.ensureHitMixer({sounds:{old:{id:'old'}}});
 E.resetSharedAudioContext('ownership-test');E._ac=f.newContext();const nextMixer=f.mixer(E._ac),sample={id:'next'},next=E.ensureHitMixer({sounds:{next:sample}}),owner=E._hitMixerPromise;
 if(nextState==='ready'){f.gates[1].resolve(nextMixer);await next;}
 if(outcome==='resolved')f.gates[0].resolve(oldMixer);else f.gates[0].reject(Error('old module failed'));const stale=await old;
 assert.equal(stale,null,'old preparation returned a mixer belonging to another context');assert.deepEqual(f.warnings,[],'obsolete failure reported a fallback for the active context');
 if(nextState==='pending'){
  assert.equal(E._hitMixerPromise,owner,'old finally cleared the new pending factory');assert.notEqual(E._hitMixer,oldMixer);
  const same=E.ensureHitMixer({sounds:{next:sample}});await flush();assert.equal(f.created.length,2,'another factory was started for the same context');
  f.gates[1].resolve(nextMixer);await Promise.all([next,same]);
 }
 assert.equal(E._hitMixer,nextMixer);assert.equal(E._hitMixer.context,E._ac);assert.deepEqual(Array.from(E._hitMixerSamples),[sample]);
 if(outcome==='resolved')assert.equal(oldMixer.destroyed,1,'discarded native mixer was not disconnected');
});
test('a naturally closed context does not reuse a pending mixer from that context',async()=>{
 const f=setup(),{E}=f,oldContext=E._ac,oldMixer=f.mixer(oldContext),old=E.ensureHitMixer();
 oldContext.state='closed';E._ac=f.newContext();const nextMixer=f.mixer(E._ac),next=E.ensureHitMixer();
 assert.equal(f.created.length,2);f.gates[1].resolve(nextMixer);assert.equal(await next,nextMixer);
 f.gates[0].resolve(oldMixer);assert.equal(await old,null);assert.equal(E._hitMixer,nextMixer);assert.equal(oldMixer.destroyed,1);
});
test('current factory errors retain fallback and allow retry',async()=>{
 const f=setup(),pending=f.E.ensureHitMixer();f.gates[0].reject(Error('current module failed'));assert.equal(await pending,null);assert.equal(f.warnings.length,1);assert.equal(f.E._hitMixerPromise,null);
 const retry=f.E.ensureHitMixer(),mixer=f.mixer(f.E._ac);f.gates[1].resolve(mixer);assert.equal(await retry,mixer);
});
test('same-context callers share a factory and retain deduplication, reset and flush behavior',async()=>{
 const f=setup(),sample={id:'tap'},pack={sounds:{tap:sample,drag:sample}},custom=new Map([['custom',sample]]),one=f.E.ensureHitMixer(pack,custom),two=f.E.ensureHitMixer(pack,custom),mixer=f.mixer(f.E._ac);
 assert.equal(f.created.length,1);f.gates[0].resolve(mixer);assert.equal(await one,mixer);assert.equal(await two,mixer);
 assert.equal(mixer.resets,1);assert.equal(mixer.flushes,1);assert.deepEqual(mixer.registered,[sample]);
});
