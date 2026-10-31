'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./helpers/engine.cjs');
const fxContext={};vm.runInNewContext(fs.readFileSync('js/chapter8-community-effects.js','utf8'),fxContext);const fx=fxContext.PhiChapter8CommunityEffects;
function presentation(){
  const f=fixture(),p=f.probe;f.context.PhiChapter8CommunityEffects=fx;
  const values=new Set(),view=f.node('#gameView');view.classList={remove(...v){v.forEach(x=>values.delete(x));},toggle(k,on){if(on)values.add(k);else values.delete(k);},contains:k=>values.has(k)};
  let time=0;p.musicCurrentTime=()=>time;p.chapter8CommunityFrame={};p.chapter8CommunityProfile='distorted-fate';p.chapter8HideMetadata=false;p.chapter8HideCombo=false;
  return {p,values,context:f.context,seek:n=>time=n};
}
test('music-clock boundaries and backward seeks hide and restore DOM HUD independently',()=>{
  const {p,values,seek}=presentation();seek(96);p.sampleChapter8CommunityPresentation();assert(values.has('chapter8HideMetadata'));assert(!values.has('chapter8HideCombo'));
  seek(130);let frame=p.sampleChapter8CommunityPresentation();assert(frame.showCountdown);assert(values.has('chapter8HideCombo'));
  seek(40);frame=p.sampleChapter8CommunityPresentation();assert(!frame.showCountdown);assert.equal(values.size,0);
  seek(130);p.sampleChapter8CommunityPresentation();p.clearChapter8CommunityPresentation();assert.equal(values.size,0);
});
test('switching to PJSK and other charts cannot retain the community HUD',()=>{
  const {p,values,seek}=presentation();seek(130);p.sampleChapter8CommunityPresentation();assert.equal(values.size,2);
  p.chart.kind='pjsk';assert.equal(p.sampleChapter8CommunityPresentation(),null);assert.equal(values.size,0);
  p.chart.kind='pgr';p.chapter8CommunityProfile=null;assert.equal(p.sampleChapter8CommunityPresentation(),null);assert.equal(values.size,0);
});
test('only trusted matching SHA triggers the module and changed chart bytes never receive an effect',async()=>{
  const source=fs.readFileSync('js/app.js','utf8'),code=source.slice(source.indexOf('  const CHAPTER8_COMMUNITY_HASHES'),source.indexOf('  async function startBuiltinPack('));
  const good='9f4508d425c0c241e9cfca064256a54b2509aa5e9169c12b6f131b848a1f828b';let reads=0,actual=good;
  const c=vm.createContext({Set,Map,DOMException,BUILTIN_ASSET_MAP:new Map([['good',{sha256:good}],['other',{sha256:'other'}]]),
    PhiChapter8CommunityEffects:fx,materializeBuiltinAsset:async()=>{reads++;return {};},sha256Blob:async()=>actual,Diagnostics:{warn(){}},Promise});
  vm.runInContext(code+'\nglobalThis.prepareEffect=prepareChapter8CommunityEffect;',c);
  const entry=asset=>({meta:{chart:'chart.json'},files:[{name:'chart.json',asset}]});
  assert.equal(await c.prepareEffect(entry('other')),null);assert.equal(reads,0);
  assert.equal(await c.prepareEffect(entry('good')),'distorted-fate');assert.equal(reads,1);
  actual='modified';assert.equal(await c.prepareEffect(entry('good')),null);assert.equal(reads,2);
  const abort=new AbortController();abort.abort();await assert.rejects(c.prepareEffect(entry('good'),abort.signal),{name:'AbortError'});
});

test('chapter replay mode does not suppress ordinary in-song visuals',()=>{
  const {p,values,context,seek}=presentation();context.PhiVisionMode={enabled:true};seek(130);assert(p.sampleChapter8CommunityPresentation().showCountdown);assert.equal(values.size,2);context.PhiVisionMode.enabled=false;assert(p.sampleChapter8CommunityPresentation().showCountdown);assert.equal(values.size,2);seek(40);assert(!p.sampleChapter8CommunityPresentation().showCountdown);assert.equal(values.size,0);
});
