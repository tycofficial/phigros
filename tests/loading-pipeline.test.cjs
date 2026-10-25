const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
const entry={id:'song',name:'Song',parser:'pgr',files:[{name:'chart.json',asset:'chart'},{name:'music.ogg',asset:'music'},{name:'cover.png',asset:'art'}],meta:{chart:'chart.json',music:'music.ogg',illustration:'cover.png'}};
test('hosted music enters Web Audio only after its complete local Blob is ready',async()=>{
  const {fixture}=require('./helpers/engine.cjs');
  const ready=deferred(),blob=new Blob(['whole song']);let decodes=0;
  const {probe:p}=fixture({audioBufferFromBlob:async(input,timeout)=>{
    decodes++;assert.equal(input,blob);assert.equal(timeout,0);return {duration:160};
  }});
  p.record={builtin:true,streamAudioURL:'./music.m4a',_streamReady:ready.promise};
  p.streamSession={blob:null};
  const pending=p.prepareMusicBuffer();await Promise.resolve();assert.equal(decodes,0);
  p.streamSession.blob=blob;ready.resolve();assert.equal((await pending).duration,160);assert.equal(decodes,1);
});
function deferred(){let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};}
test('a playable record never waits for its optional cover download',async()=>{
  let artworkCalls=0;
  const context=vm.createContext({Blob,Promise,normalizeMeta:x=>x,blobText:b=>b.text(),
    PhiHostedMedia:{manifest:{audio:{music:{url:'./song.m4a',duration:160}}},artwork:()=>{artworkCalls++;return new Promise(()=>{});}},
    materializeBuiltinAsset:async id=>{assert.equal(id,'chart');return new Blob(['{"formatVersion":3}']);}});
  vm.runInContext(fs.readFileSync('js/performance-policy.js','utf8'),context);
  vm.runInContext('const builtinStreamingRecords=new PhiPerformance.ResourceCache(8*1024*1024,6);\n'+source.slice(source.indexOf('  async function materializeStreamingBuiltinPack('),source.indexOf('  async function materializeBuiltinPack('))+'\nglobalThis.prepare=materializeStreamingBuiltinPack;',context);
  const record=await context.prepare(entry);assert.equal(record.chartText,'{"formatVersion":3}');assert.equal(record.bgBlob,null);assert.equal(artworkCalls,0);
});
test('stream buffering, skin, fonts and chart loading begin together before the chart finishes',async()=>{
  const chart=deferred(),skin=deferred(),font=deferred(),buffer=deferred(),steps=[];let result;
  class Stream{constructor(audio){steps.push('audio');this.audio=audio;this.controller=new AbortController();}wait(){steps.push('buffer');return buffer.promise;}destroy(){throw Error('unexpected destroy');}}
  const context=vm.createContext({Promise,AbortController,Audio:class{},songLoadToken:0,songLoadStream:null,libraryFocusBgBlob:new Blob(['cover']),
    Engine:{_primedMusicElement:{}},PhiHostedMedia:{manifest:{audio:{music:{url:'./song.m4a'}}},Stream},
    ensureBuiltinMaterialForPlay:()=>{steps.push('skin');return skin.promise;},loadSavedOrAdjacentOfficialFont:()=>{steps.push('font');return font.promise;},
    materializeBuiltinPack:()=>{steps.push('chart');return chart.promise;},beginLoadingPresentation:async()=>{},
    assertSongLoad(){},updateLoadingPresentation(){},cancelLoadingPresentation(){},toast:message=>{throw Error(message);},
    startChart:async(rec,_prepared,options)=>{await options.preparation;await rec._streamReady;result=rec;}});
  vm.runInContext(source.slice(source.indexOf('  async function startBuiltinPack('),source.indexOf('  function builtinSearchText('))+'\nglobalThis.begin=startBuiltinPack;',context);
  const pending=context.begin(entry);
  assert.deepEqual([...steps],['audio','buffer','skin','font','chart']);
  chart.resolve({bgBlob:null});skin.resolve();font.resolve();buffer.resolve();await pending;
  assert(result._preparedStream);assert.equal(result.bgBlob,context.libraryFocusBgBlob);
});
