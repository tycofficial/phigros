'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
const helper=source.slice(source.indexOf('  const builtinPreparationRequests = new WeakMap();'),source.indexOf('  async function phiHostedBytes('));
function fixture(){
 const context=vm.createContext({AbortController,DOMException,Promise});vm.runInContext(fs.readFileSync('js/performance-policy.js','utf8'),context);vm.runInContext(helper+'\nglobalThis.prepare=prepareBuiltinResource;',context);
 const cache=new context.PhiPerformance.ResourceCache(100,4);return {cache,prepare:(signal,load,key='chart')=>context.prepare(cache,key,signal,load,value=>value.size)};
}
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const flush=async()=>{for(let i=0;i<12;i++)await Promise.resolve();};
test('valid callers share preparation while one cancellation leaves the other signal alive',async()=>{
 const f=fixture(),gate=deferred(),a=new AbortController(),b=new AbortController();let calls=0,shared;
 const load=signal=>{calls++;shared=signal;return gate.promise;},old=f.prepare(a.signal,load).catch(e=>e.name),current=f.prepare(b.signal,load);await flush();
 assert.equal(calls,1);assert.notEqual(shared,a.signal);a.abort();assert.equal(await old,'AbortError');assert.equal(shared.aborted,false);
 const value={size:7};gate.resolve(value);assert.equal(await current,value);assert.equal(f.cache.get('chart'),value);assert.equal(f.cache.bytes,7);
 assert.equal(await f.prepare(undefined,()=>{throw Error('completed value must be reused');}),value);
});
for(const outcome of ['resolve','reject'])test(`last caller aborts; a late old ${outcome} cannot commit over or evict a replacement`,async()=>{
 const f=fixture(),oldGate=deferred(),newGate=deferred(),a=new AbortController(),b=new AbortController();let calls=0,oldSignal,newSignal;
 const load=signal=>{calls++;if(calls===1){oldSignal=signal;return oldGate.promise;}newSignal=signal;return newGate.promise;};
 const old=f.prepare(a.signal,load).catch(e=>e.name);await flush();a.abort();assert.equal(await old,'AbortError');assert(oldSignal.aborted);
 const replacement=f.prepare(b.signal,load);await flush();assert.equal(calls,2);assert.equal(newSignal.aborted,false);
 if(outcome==='resolve')oldGate.resolve({size:90,old:true});else oldGate.reject(new DOMException('original cancelled loader','AbortError'));await flush();
 assert.equal(f.cache.has('chart'),false);const another=f.prepare(undefined,load);await flush();assert.equal(calls,2,'late cleanup must not erase the replacement pending task');
 const value={size:9};newGate.resolve(value);assert.equal(await replacement,value);assert.equal(await another,value);assert.equal(f.cache.get('chart'),value);assert.equal(f.cache.bytes,9);
});
test('a current failure releases the request for a real retry',async()=>{
 const f=fixture();let calls=0;const load=async()=>{if(++calls===1)throw Error('decode failed');return {size:5};};
 await assert.rejects(f.prepare(undefined,load),/decode failed/);assert.equal(f.cache.has('chart'),false);assert.equal((await f.prepare(undefined,load)).size,5);assert.equal(calls,2);
});
test('a late failed owner cannot remove a replacement that has already been cached',async()=>{
 const f=fixture(),gate=deferred(),a=new AbortController();let calls=0;
 const load=async()=>{if(++calls===1)return gate.promise;return {size:6};};
 const old=f.prepare(a.signal,load).catch(e=>e.name);await flush();a.abort();assert.equal(await old,'AbortError');
 const replacement=await f.prepare(undefined,load);gate.reject(Error('old delayed failure'));await flush();
 assert.equal(await f.prepare(undefined,load),replacement);assert.equal(calls,2);assert.equal(f.cache.bytes,6);
});
test('an already cancelled reader cannot consume or remove a completed cached value',async()=>{
 const f=fixture(),value={size:3};await f.prepare(undefined,async()=>value);const a=new AbortController();a.abort();
 await assert.rejects(f.prepare(a.signal,()=>{throw Error('not called');}),{name:'AbortError'});assert.equal(f.cache.get('chart'),value);assert.equal(f.cache.bytes,3);
});
