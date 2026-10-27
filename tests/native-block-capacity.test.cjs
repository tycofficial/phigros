'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib');
const source=fs.readFileSync('js/app.js','utf8');
const timeline=source.slice(source.indexOf('  class NativeBlockTimeline'),source.indexOf('  function nativeBlockZones'));
const start=source.indexOf('  class NativeBlockRenderer'),ctorEnd=source.indexOf('    program(vert,frag){',start),
  buildStart=source.indexOf('    buildGeometry(zones){',ctorEnd),buildEnd=source.indexOf('    renderMask(group){',buildStart);
const canvas=()=>({addEventListener(){},getContext(type){return type==='webgl'?{}:{};}});
const context=vm.createContext({document:{createElement:canvas},nativeBlockViewport:()=>({aspect:16/9}),nativeBlockTransform(){}});
vm.runInContext(timeline+'\n'+source.slice(start,ctorEnd)+source.slice(buildStart,buildEnd)+'}\nglobalThis.api={NativeBlockTimeline,NativeBlockRenderer};',context);
const {NativeBlockTimeline,NativeBlockRenderer}=context.api;
const intervals=JSON.parse(zlib.gunzipSync(fs.readFileSync('tests/fixtures/hate-at-noise-intervals.json.gz')));
const areas=intervals.map(([appearTime,disappearTime])=>({appearTime,disappearTime}));
function naive(time){let count=0;for(const [a,b] of intervals)if(a<=time&&time<b)count++;return count;}
test('Hate AT timeline peak and samples preserve every actual visible noise area',()=>{
  assert.equal(areas.length,14355);
  const t=new NativeBlockTimeline(areas);
  assert.equal(t.peak,1400);assert.equal(t.at(124.01361).length,1400);
  // Sweep every distinct authored boundary independently, rather than only
  // measuring the peak. Ends sort before starts for half-open intervals.
  const events=intervals.flatMap(([a,b])=>a<b?[[a,1],[b,-1]]:[]).sort((a,b)=>a[0]-b[0]||a[1]-b[1]);
  let live=0;
  for(let i=0;i<events.length;){const time=events[i][0];while(i<events.length&&events[i][0]===time)live+=events[i++][1];assert.equal(t.at(time).length,live,`boundary ${time}`);}
  for(let time=0;time<=180;time+=.37)assert.equal(t.at(time).length,naive(time),`at ${time}`);
  // Seek back and forth, including exact endpoints.
  for(const time of [124.01361,0,155,124.01361,20,179])assert.equal(t.at(time).length,naive(time),`seek ${time}`);
});
test('equal timestamp handoffs do not overcount peak visible areas',()=>{
  const t=new NativeBlockTimeline([{appearTime:0,disappearTime:1},{appearTime:1,disappearTime:2},{appearTime:1,disappearTime:1}]);
  assert.equal(t.peak,1);assert.equal(t.at(1).length,1);assert.equal(t.at(2).length,0);
});
test('renderer preallocates for peak, then grows without dropping noise vertices',()=>{
  const renderer=new NativeBlockRenderer({w:1280,h:720,chart:{blockAreas:areas}});
  assert.equal(renderer.geometryArena.capacity,131072);
  const totalBytes=[...renderer.geometryArena.a,...renderer.geometryArena.b].reduce((n,a)=>n+a.byteLength,0);
  assert.equal(totalBytes,6*1024*1024);
  renderer.activeBounds=new Float64Array(4);renderer.disabledBounds=new Float64Array(4);
  // A larger-than-planned live set still expands. Verify all 3000 quads,
  // including ready quads copied into the combined disabled group.
  const zones=Array.from({length:3000},(_,i)=>({center:{x:0,y:0},hx:.1,hy:.1,cos:1,sin:0,active:i<1500,ready:i>=1500,invert:false,opacity:1}));
  renderer.buildGeometry(zones);
  assert.ok(renderer.geometryArena.capacity>=zones.length*54);
  assert.equal(renderer.geometry[0].length,1500*54);
  assert.equal(renderer.geometry[2].length,1500*54);
  assert.equal(renderer.geometry[4].length,1500*54);
});
