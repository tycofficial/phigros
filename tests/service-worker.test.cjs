const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const version=fs.readFileSync('js/app.js','utf8').match(/runtime:\s*"([^"]+)"/)[1];
const futureVersion=version.replace(/pages-(\d+)/,(_,n)=>'pages-'+(Number(n)+1));
const html=(label='page',build=version)=>`<script id="phiBuildMetadata" type="application/json">{"runtime":"${build}"}</script><script src="./js/app.js?v=${build}"></script><link href="./css/style.css?v=${build}"><p>${label}</p>`;
function runtime(network=async()=>new Response('network'),overrides={}){
  const stores=new Map(),handlers={};let calls=0,keysCalls=0,skipCalls=0;
  const name='tycphigros-4.0.1.2-stability-2';
  const caches={async keys(){return [...stores.keys()];},async delete(key){return stores.delete(key);},async open(key){
    if(!stores.has(key))stores.set(key,new Map());const entries=stores.get(key);
    const keyFor=req=>typeof req==='string'?req:req.url;
    return {async match(req){return entries.get(keyFor(req))?.clone();},async put(req,res){if(overrides.failPut?.(key,req))throw Error('quota');entries.set(keyFor(req),res);},async keys(){keysCalls++;return [...entries.keys()];},async delete(req){return entries.delete(keyFor(req));}};
  }};
  const context=vm.createContext({URL,Response,Headers,AbortController,setTimeout,clearTimeout,console,caches,Date,
    self:{location:{origin:'https://example.test',href:'https://example.test/phigros/sw.js'},addEventListener:(name,fn)=>handlers[name]=fn,clients:{claim(){}},async skipWaiting(){skipCalls++;}},
    fetch:async(req,opts)=>{calls++;return network(req,opts);},...overrides});
  vm.runInContext(fs.readFileSync(process.env.PHI_TEST_SW_SOURCE||'sw.js','utf8'),context);
  const codeName=vm.runInContext('APP_CACHE',context);
  const req=(path,{range,mode='same-origin'}={})=>({method:'GET',url:'https://example.test'+path,mode,headers:new Headers(range?{Range:range}:{})});
  function dispatch(request){let response;const pending=[];handlers.fetch({request,respondWith:p=>response=p,waitUntil:p=>pending.push(p)});return {response:Promise.resolve(response),settled:Promise.resolve(response).then(()=>Promise.all(pending),()=>Promise.allSettled(pending))};}
  async function fetch(request){const event=dispatch(request),result=await event.response;await event.settled;return result;}
  return {fetch,dispatch,req,caches,name,codeName,install(){let pending;handlers.install({waitUntil:p=>pending=p});return pending;},get skipCalls(){return skipCalls;},get calls(){return calls;},get keysCalls(){return keysCalls;}};
}
test('repeat code loads use the current build cache and avoid another network trip',async()=>{
  const r=runtime();await r.fetch(r.req('/phigros/js/app.js?v=3'));await r.fetch(r.req('/phigros/js/app.js?v=3'));
  assert.equal(r.calls,1);
});
test('media from the previous release remains available in the shared media cache',async()=>{
  const r=runtime();const cache=await r.caches.open(r.name);
  await cache.put(r.req('/phigros/assets/cover.jpg'),new Response('cover'));
  assert.equal(await (await r.fetch(r.req('/phigros/assets/cover.jpg'))).text(),'cover');assert.equal(r.calls,0);
});
test('updated replay manifests never reuse the prior binary-media cache',async()=>{
  const options=[],r=runtime(async(_req,opts)=>{options.push(opts);return new Response('new replay manifest');}),old=await r.caches.open(r.name);
  for(const path of ['/phigros/assets/meta/vision-media.json','/phigros/assets/meta/vision-audio.json','/phigros/assets/vision-replay/chapter8-about-us.json']){
    await old.put(r.req(path),new Response('old replay manifest'));
    assert.equal(await(await r.fetch(r.req(path))).text(),'new replay manifest');
    assert.equal(await(await r.fetch(r.req(path))).text(),'new replay manifest');
    assert.equal(await(await old.match(r.req(path))).text(),'old replay manifest');
  }
  assert.equal(r.calls,3);assert(options.every(x=>x.cache==='no-cache'));
});
test('versioned replay manifest URL also bypasses a cached pre-upgrade address',async()=>{
  const r=runtime(async()=>new Response('new clips')),old=await r.caches.open(r.name),path='/phigros/assets/meta/vision-media.json';
  await old.put(r.req(path),new Response('only seven old clips'));
  assert.equal(await(await r.fetch(r.req(path+'?v=new-replay-build'))).text(),'new clips');
  assert.equal(r.calls,1);
});
test('native audio ranges retain exact byte offsets including suffixes',async()=>{
  const r=runtime(),cache=await r.caches.open(r.name),path='/phigros/assets/song.m4a';
  await cache.put(r.req(path),new Response('0123456789',{headers:{'Content-Type':'audio/mp4','Content-Length':'10'}}));
  const middle=await r.fetch(r.req(path,{range:'bytes=2-5'}));
  assert.equal(middle.status,206);assert.equal(middle.headers.get('Content-Range'),'bytes 2-5/10');assert.equal(await middle.text(),'2345');
  assert.equal(await (await r.fetch(r.req(path,{range:'bytes=-3'}))).text(),'789');
  assert.equal((await r.fetch(r.req(path,{range:'bytes=12-'}))).status,416);assert.equal(r.calls,0);
});
test('network partial responses never poison the full audio cache',async()=>{
  const r=runtime(async()=>new Response('01',{status:206,headers:{'Content-Range':'bytes 0-1/10'}}));
  await r.fetch(r.req('/phigros/assets/song.m4a',{range:'bytes=0-1'}));
  const cache=await r.caches.open(r.name);assert.equal(await cache.match(r.req('/phigros/assets/song.m4a')),undefined);
});
test('navigation checks the network but falls back to the cached page during an outage',async()=>{
  let offline=false;const r=runtime(async()=>{if(offline)throw Error('offline');return new Response(html('page'));});
  const req=r.req('/phigros/',{mode:'navigate'});await r.fetch(req);offline=true;
  assert.equal(await (await r.fetch(req)).text(),html('page'));assert.equal(r.calls,2);
});
test('a batch of skin requests runs one cache maintenance sweep',async()=>{
  const r=runtime();await Promise.all([1,2,3,4].map(i=>r.fetch(r.req('/phigros/assets/skin/'+i+'.webp'))));
  assert.equal(r.keysCalls,1);
});

test('entry and uncached code requests revalidate the HTTP cache after a deployment',async()=>{
  const options=[];const r=runtime(async(_req,opts)=>{options.push(opts);return new Response('fresh');});
  await r.fetch(r.req('/phigros/',{mode:'navigate'}));
  await r.fetch(r.req('/phigros/js/app.js?v=6'));
  assert.equal(options.length,2);assert(options.every(x=>x.cache==='no-cache'));
});

test('a slow entry request returns the cached page promptly and still updates it in the background',async()=>{
  let finish,fail,second=false;const timers=[];
  const later=new Promise((resolve,reject)=>{finish=resolve;fail=reject;});
  const r=runtime(async(_req,opts)=>{
    if(!second)return new Response(html('previous'));
    opts.signal?.addEventListener('abort',()=>fail(new DOMException('aborted','AbortError')),{once:true});
    return later;
  },{setTimeout:fn=>{timers.push(fn);return fn;},clearTimeout(){}});
  const request=r.req('/phigros/',{mode:'navigate'});
  await r.fetch(request);second=true;
  const event=r.dispatch(request);await new Promise(setImmediate);
  assert.equal(timers.length,1);timers[0]();
  assert.equal(await (await event.response).text(),html('previous'));
  finish(new Response(html('new release')));await event.settled;
  const cache=await r.caches.open(r.codeName);
  assert.equal(await (await cache.match(request)).text(),html('new release'));
});

test('installation prepares the real entry and bootstrap dependencies before taking control',async()=>{
  let complete;const delayed=new Promise(resolve=>complete=resolve),options=[];
  const r=runtime(async(url,opts)=>{options.push(opts);if(url.endsWith('/phigros/'))return new Response(html());if(url.includes('/js/app.js'))return delayed;return new Response('style');});
  const pending=r.install();await new Promise(setImmediate);assert.equal(r.skipCalls,0);
  complete(new Response('app'));await pending;
  assert.equal(r.skipCalls,1);assert(options.every(x=>x.cache==='no-cache'));
  const cache=await r.caches.open(r.codeName);
  assert.equal(await(await cache.match('https://example.test/phigros/')).text(),html());
  assert.equal(await(await cache.match('https://example.test/phigros/index.html')).text(),html());
  assert.equal(await(await cache.match('https://example.test/phigros/js/app.js?v='+version)).text(),'app');
  assert.equal(await(await cache.match('https://example.test/phigros/css/style.css?v='+version)).text(),'style');
});
test('a missing bootstrap dependency rejects the installation and preserves existing caches',async()=>{
  const r=runtime(async url=>url.endsWith('/phigros/')?new Response(html()):new Response('missing',{status:404}));
  const old=await r.caches.open('tycphigros-app-previous');await old.put('https://example.test/phigros/',new Response('previous'));
  await assert.rejects(r.install(),/dependency is not ready/);assert.equal(r.skipCalls,0);
  assert.equal((await r.caches.keys()).includes(r.codeName),false);
  assert.equal(await(await old.match('https://example.test/phigros/')).text(),'previous');
});
test('stale deployment metadata cannot activate a new worker',async()=>{
  const r=runtime(async()=>new Response(html('old','4.0.1.2-pages-32')));
  await assert.rejects(r.install(),/entry is not ready/);assert.equal(r.skipCalls,0);assert.equal(r.calls,1);
});
test('a shell write failure removes only the unfinished new cache',async()=>{
  const r=runtime(async url=>new Response(url.endsWith('/phigros/')?html():'dependency'),{failPut:key=>key.startsWith('tycphigros-app-pages-')});
  const media=await r.caches.open(r.name);await media.put('/saved-audio',new Response('audio'));
  await assert.rejects(r.install(),/quota/);assert.equal(r.skipCalls,0);
  assert.equal((await r.caches.keys()).includes(r.codeName),false);assert.equal(await(await media.match('/saved-audio')).text(),'audio');
});
test('an installed shell supports offline root queries and the index alias',async()=>{
  let offline=false;const r=runtime(async url=>{if(offline)throw Error('offline');return new Response(url.endsWith('/phigros/')?html():'dependency');});
  await r.install();offline=true;
  for(const target of ['/phigros/?skipIntro=1','/phigros/index.html?skipIntro=1'])assert.equal(await(await r.fetch(r.req(target,{mode:'navigate'}))).text(),html());
  await assert.rejects(r.fetch(r.req('/phigros/tests/missing.html',{mode:'navigate'})),/offline/);
});
test('a future entry cannot overwrite this worker\'s working offline shell',async()=>{
  let generation=0;const r=runtime(async()=>{if(generation===2)throw Error('offline');return new Response(html('entry',generation===1?futureVersion:version));});
  const request=r.req('/phigros/',{mode:'navigate'});await r.fetch(request);generation=1;
  assert.equal(await(await r.fetch(request)).text(),html('entry',futureVersion));
  generation=2;assert.equal(await(await r.fetch(request)).text(),html('entry'));
});
test('installation drains an earlier response body before queued dependency headers arrive',async()=>{
  let release;const queued=new Promise(resolve=>release=resolve);
  const r=runtime(async url=>{
    if(url.endsWith('/phigros/'))return new Response(html());
    if(url.includes('/js/app.js'))return new Response(new ReadableStream({pull(controller){controller.enqueue(new TextEncoder().encode('app'));controller.close();release(new Response('style'));}},{highWaterMark:0}));
    return queued;
  });
  await r.install();assert.equal(r.skipCalls,1);
  assert.equal(await(await(await r.caches.open(r.codeName)).match('https://example.test/phigros/css/style.css?v='+version)).text(),'style');
});
test('cached decoded bootstrap bytes have consistent encoding and length headers',async()=>{
  const r=runtime(async url=>url.endsWith('/phigros/')?new Response(html()):new Response('decoded',{headers:{'Content-Encoding':'gzip','Content-Length':'999'}}));
  await r.install();const response=await(await r.caches.open(r.codeName)).match('https://example.test/phigros/js/app.js?v='+version);
  assert.equal(response.headers.get('Content-Encoding'),null);assert.equal(response.headers.get('Content-Length'),'7');assert.equal(await response.text(),'decoded');
});
