'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const app=fs.readFileSync(process.env.PHI_TEST_APP_SOURCE||'js/app.js','utf8');
const source=app.slice(app.indexOf('  async function phiHostedBytes('),app.indexOf('  function mimeForEmbeddedName('));
const turn=()=>new Promise(resolve=>setImmediate(resolve));
const outcome=promise=>promise.then(value=>({value}),error=>({error}));
const bytes=new Uint8Array([1,2,3,4]);
function baseContext(overrides={}){
  const context=vm.createContext({URL,DOMException,AbortController,Uint8Array,performance,console,
    document:{baseURI:'https://game.test/'},location:{origin:'https://game.test',protocol:'https:'},
    navigator:{},PhiHostedManifest:{audio:{},artwork:{}},PhiRemoteAssets:{info:()=>false},
    $:()=>({classList:{contains:()=>true}}),...overrides});
  vm.runInContext(fs.readFileSync('js/performance-policy.js','utf8'),context);
  vm.runInContext('globalThis.phiHostedBundleCache=new PhiPerformance.ResourceCache(1024,32)',context);
  return context;
}
function install(context){vm.runInContext(source+'\nglobalThis.testAsset=phiHostedAssetBytes;',context);return context;}
function remoteFixture(hasHosted){
  let seen;const download=(_,options)=>{
    seen=options.signal;
    return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>reject(new DOMException('stopped','AbortError')),{once:true}));
  };
  return {context:install(baseContext({PhiRemoteAssets:{info:()=>true,download},PhiHostedMedia:hasHosted?{bytes:download}:undefined})),seen:()=>seen};
}
for(const hasHosted of [true,false])test(`chart cancellation reaches verified remote loader (hosted=${hasHosted})`,async()=>{
  const {context,seen}=remoteFixture(hasHosted),controller=new AbortController();
  const pending=context.testAsset({url:'https://raw.githubusercontent.com/x',byteLength:4},{signal:controller.signal});
  assert.equal(seen(),controller.signal);controller.abort();await assert.rejects(pending,{name:'AbortError'});
});
function localFixture(hasHosted,{deferAbort=false}={}){
  const calls=[];
  const request=(url,options={})=>new Promise((resolve,reject)=>{
    const call={url,signal:options.signal,aborted:false,resolve:()=>resolve(hasHosted?bytes:{ok:true,arrayBuffer:async()=>bytes.buffer}),reject};
    const abort=()=>{call.aborted=true;if(!deferAbort)reject(new DOMException('stopped','AbortError'));};
    calls.push(call);
    if(options.signal?.aborted)abort();else options.signal?.addEventListener('abort',abort,{once:true});
  });
  const context=baseContext(hasHosted?{PhiTransfer:{download:request}}:{fetch:request});
  if(hasHosted)vm.runInContext(fs.readFileSync('js/hosted-media.js','utf8'),context);
  install(context);
  const get=signal=>context.testAsset({id:'local',url:'./assets/chart.bin',byteLength:4},{signal});
  const finish=()=>{for(const call of calls)call.aborted?call.reject(new DOMException('stopped','AbortError')):call.resolve();};
  return {context,calls,get,finish};
}
for(const hasHosted of [true,false]){
  const name=hasHosted?'same-origin hosted consumers':'same-origin fetch fallback';
  test(`${name}: pre-aborted caller never starts a request`,async()=>{
    const f=localFixture(hasHosted),controller=new AbortController();controller.abort();
    const pending=outcome(f.get(controller.signal));await turn();f.finish();const result=await pending;
    assert.equal(result.error?.name,'AbortError');assert.equal(f.calls.length,0);
  });
  test(`${name}: cancelling the only caller aborts its transfer`,async()=>{
    const f=localFixture(hasHosted),controller=new AbortController(),pending=outcome(f.get(controller.signal));
    await turn();controller.abort();await turn();f.finish();const result=await pending;
    assert.equal(result.error?.name,'AbortError');assert.equal(f.calls.length,1);
    assert.equal(f.calls[0].signal?.aborted,true);assert.equal(f.context.phiHostedBundleCache.size,0);
  });
  test(`${name}: cancelling one of two callers preserves the other`,async()=>{
    const f=localFixture(hasHosted),controller=new AbortController();
    const first=outcome(f.get(controller.signal)),second=outcome(f.get());
    await turn();controller.abort();await turn();
    const surviving=f.calls.filter(call=>!call.aborted);f.finish();
    const [a,b]=await Promise.all([first,second]);
    assert.equal(a.error?.name,'AbortError');assert.deepEqual(Array.from(b.value),Array.from(bytes));
    assert.equal(surviving.length,1);assert.equal(f.calls.length,hasHosted?1:2);
  });
  test(`${name}: a new caller never reuses an aborted pending request`,async()=>{
    const f=localFixture(hasHosted,{deferAbort:true}),controller=new AbortController();
    const first=outcome(f.get(controller.signal));await turn();controller.abort();await turn();
    const second=outcome(f.get());await turn();const countBeforeOldFailure=f.calls.length;
    // Settle the old rejection only after the replacement request has started.
    f.finish();const [a,b]=await Promise.all([first,second]);
    assert.equal(a.error?.name,'AbortError');assert.deepEqual(Array.from(b.value),Array.from(bytes));
    assert.equal(countBeforeOldFailure,2);
    const cached=await f.get();assert.deepEqual(Array.from(cached),Array.from(bytes));assert.equal(f.calls.length,2);
  });
}
test('same-origin fallback caches complete bytes and still rejects a cancelled cache reader',async()=>{
  const f=localFixture(false),pending=f.get();await turn();f.finish();await pending;
  assert.deepEqual(Array.from(await f.get()),Array.from(bytes));assert.equal(f.calls.length,1);
  assert(f.context.phiHostedBundleCache.get('https://game.test/assets/chart.bin') instanceof Uint8Array);
  const controller=new AbortController();controller.abort();await assert.rejects(f.get(controller.signal),{name:'AbortError'});
});
test('same-origin fallback cannot cache a body that completes after cancellation',async()=>{
  let finishBody;
  const context=install(baseContext({fetch:async()=>({ok:true,arrayBuffer:()=>new Promise(resolve=>{finishBody=()=>resolve(bytes.buffer);})})}));
  const controller=new AbortController(),pending=outcome(context.testAsset({url:'./assets/chart.bin',byteLength:4},{signal:controller.signal}));
  await turn();controller.abort();finishBody();const result=await pending;
  assert.equal(result.error?.name,'AbortError');assert.equal(context.phiHostedBundleCache.size,0);
});
