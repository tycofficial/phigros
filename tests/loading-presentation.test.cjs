'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {create}=require('../js/loading-presentation.js');
function fixture(options={}){
  const nodes=new Map(),frames=[],waits=[],revoked=[],made=[],lengths=[];let now=100,token=1;
  function lookup(id){if(!nodes.has(id)){const classes=new Set(id==='#loadingView'?['hidden']:[]);nodes.set(id,{textContent:'',dataset:{},style:{},classes,classList:{add(...items){items.forEach(x=>classes.add(x));},remove(...items){items.forEach(x=>classes.delete(x));},contains(x){return classes.has(x);}}});}return nodes.get(id);}
  const ui=create({lookup,Blob,URL:{createObjectURL(blob){made.push(blob);return 'blob:test-'+made.length;},revokeObjectURL(url){revoked.push(url);}},
    difficultyInfoFor:record=>record?.difficulty||{tier:'IN',level:12},cleanSongName:value=>value.replace(/_IN$/,''),applyLengthClass:(el,name)=>lengths.push(name),
    now:()=>now,frame:fn=>frames.push(fn),sleep:async ms=>{waits.push(ms);await options.sleep?.(ms);},reducedMotion:()=>!!options.reduced,
    assertCurrent:current=>{if(token!==current)throw new DOMException('cancelled','AbortError');}});
  const flushFrames=()=>{while(frames.length)frames.shift()();};
  return {ui,lookup,frames,waits,revoked,made,lengths,flushFrames,setNow:value=>now=value,setToken:value=>token=value};
}
test('metadata and difficulty fallbacks preserve existing loading presentation',()=>{
  const f=fixture();f.ui.update({name:'Title_IN',difficulty:{tier:'AT',level:-1},meta:{artist:'Artist',chartDesigner:'Designer',illustrator:'Art'}});
  assert.equal(f.lookup('#loadingSongTitle').textContent,'Title');assert.deepEqual(f.lengths,['Title']);
  assert.equal(f.lookup('#loadingLevel').textContent,'?');assert.equal(f.lookup('#loadingLevel').dataset.tier,'AT');
  for(const id of ['#loadingComposer','#loadingTitleComposer'])assert.equal(f.lookup(id).textContent,'Artist');
  assert.equal(f.lookup('#loadingCharter').textContent,'Designer');assert.equal(f.lookup('#loadingIllustrator').textContent,'Art');
});
test('record artwork wins over fallback and replacing/clearing releases each URL once',()=>{
  const f=fixture(),record=new Blob(['record']),fallback=new Blob(['fallback']);f.ui.update({bgBlob:record},fallback);
  assert.deepEqual(f.made,[record]);f.ui.setArtwork(fallback);assert.deepEqual(f.revoked,['blob:test-1']);
  assert.equal(f.lookup('#loadingArtwork').style.backgroundImage,'url("blob:test-2")');
  f.ui.clearArtwork();f.ui.clearArtwork();assert.deepEqual(f.revoked,['blob:test-1','blob:test-2']);
  assert.equal(f.lookup('#loadingBackdrop').style.backgroundImage,'');
});
test('invalid artwork releases the prior URL but update without artwork keeps the current preview',()=>{
  const f=fixture();f.ui.setArtwork(new Blob(['art']));f.ui.update({name:'New metadata'});assert.equal(f.revoked.length,0);
  f.ui.setArtwork(null);assert.equal(f.revoked.length,1);assert.equal(f.lookup('#loadingArtwork').style.backgroundImage,'');
});
test('begin sets entry classes and waits two frames before preparation status',async()=>{
  const f=fixture(),pending=f.ui.begin({name:'Song'});const view=f.lookup('#loadingView');
  assert(!view.classes.has('hidden'));assert(view.classes.has('loadingEnter'));assert(f.lookup('#libraryView').classes.has('libraryLeavingForLoad'));
  assert.equal(f.frames.length,1);assert.equal(f.lookup('#loadingProgress').textContent,'');
  f.frames.shift()();assert.equal(f.frames.length,1);assert.equal(f.lookup('#loadingProgress').textContent,'');
  f.frames.shift()();await pending;assert.equal(f.lookup('#loadingProgress').textContent,'正在准备谱面…');
});
test('finish preserves remaining 850ms presentation and 300ms exit then releases artwork',async()=>{
  const f=fixture(),pending=f.ui.begin({bgBlob:new Blob(['art'])});f.flushFrames();await pending;f.setNow(500);await f.ui.finish(1);
  assert.deepEqual(f.waits,[450,300]);assert(f.lookup('#loadingView').classes.has('hidden'));assert(!f.lookup('#libraryView').classes.has('libraryLeavingForLoad'));assert.equal(f.revoked.length,1);
});
test('elapsed loading has no remaining hold and reduced-motion exit stays 20ms',async()=>{
  const f=fixture({reduced:true}),pending=f.ui.begin({});f.flushFrames();await pending;f.setNow(2000);await f.ui.finish(1);assert.deepEqual(f.waits,[0,20]);
});
test('finish on a hidden view is a no-op',async()=>{const f=fixture();await f.ui.finish(1);assert.deepEqual(f.waits,[]);});
test('stale load token rejects before exit animation mutates the current view',async()=>{
  const f=fixture(),pending=f.ui.begin({});f.flushFrames();await pending;f.setToken(2);
  await assert.rejects(f.ui.finish(1),{name:'AbortError'});assert(f.lookup('#loadingView').classes.has('loadingEnter'));assert(!f.lookup('#loadingView').classes.has('loadingExit'));
});
test('token is checked after exit delay so an older load cannot hide its replacement',async()=>{
  let sleeps=0;const f=fixture({sleep:()=>{if(++sleeps===2)f.setToken(2);}}),pending=f.ui.begin({});f.flushFrames();await pending;
  await assert.rejects(f.ui.finish(1),{name:'AbortError'});assert(!f.lookup('#loadingView').classes.has('hidden'));
});
test('cancel resets presentation and repeated starts own independent artwork URLs',async()=>{
  const f=fixture();for(let i=0;i<3;i++){const pending=f.ui.begin({bgBlob:new Blob([String(i)])});f.flushFrames();await pending;f.ui.cancel();assert(f.lookup('#loadingView').classes.has('hidden'));assert(!f.lookup('#loadingView').classes.has('loadingEnter'));assert(!f.lookup('#libraryView').classes.has('libraryLeavingForLoad'));}
  assert.equal(f.made.length,3);assert.equal(f.revoked.length,3);
});
test('app keeps loader ownership and includes presentation module before app bootstrap',()=>{
  const app=fs.readFileSync('js/app.js','utf8'),html=fs.readFileSync('index.html','utf8');
  assert(html.indexOf('src="./js/loading-presentation.js')<html.indexOf('src="./js/app.js'));
  assert.match(app,/function assertSongLoad\(token\)\{if\(token!==songLoadToken\)/);
  assert.match(app,/async function beginLoadingPresentation[^]*?focusedArtworkAbort\?\.abort\(\);focusedArtworkGeneration\+\+;[^]*?loadingViewController\(\)\.begin/);
  assert.match(app,/function cancelLoadingPresentation[^]*?Engine\._primedMusicElement\?\.pause\(\);Engine\._primedMusicElement=null;[^]*?loadingViewController\(\)\.cancel/);
});
test('a cancelled or superseded begin cannot overwrite the current loading progress',async()=>{
  const f=fixture(),old=f.ui.begin({name:'Old'});f.ui.cancel();f.ui.setStatus('Cancelled');f.flushFrames();await old;assert.equal(f.lookup('#loadingProgress').textContent,'Cancelled');
  const older=f.ui.begin({name:'Old'}),newer=f.ui.begin({name:'New'});
  // Finish newer frames before the old frame continuation, as may happen after background suspension.
  const oldFrame=f.frames.shift(),newFrame=f.frames.shift();newFrame();f.frames.shift()();await newer;
  f.ui.setStatus('New transfer 50%');oldFrame();f.frames.shift()();await older;
  assert.equal(f.lookup('#loadingProgress').textContent,'New transfer 50%');
});
