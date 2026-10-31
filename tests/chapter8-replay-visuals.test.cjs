'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={};vm.runInNewContext(fs.readFileSync('js/chapter8-replay-visuals.js','utf8'),context);const fx=context.PhiChapter8ReplayVisuals;
function mockCanvas({throwDraw=false}={}){
  const state={alpha:.37,composite:'multiply',transform:[2,0,0,2,17,31],filter:'blur(3px)',fill:'pink',shadow:8},stack=[],calls=[];
  const ctx={save(){stack.push({...state,transform:state.transform.slice()});},restore(){Object.assign(state,stack.pop());},
    setTransform(...v){state.transform=v;},clearRect(){calls.push('clear');},fillRect(){calls.push('background');if(throwDraw)throw Error('injected draw failure');},
    beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},stroke(){},drawImage(){calls.push('image');}};
  for(const [k,p] of [['globalAlpha','alpha'],['globalCompositeOperation','composite'],['filter','filter'],['fillStyle','fill'],['shadowBlur','shadow']])Object.defineProperty(ctx,k,{get:()=>state[p],set:v=>state[p]=v});
  const canvas={width:960,height:540,style:{pointerEvents:'auto'},getContext:()=>ctx};return {canvas,state,calls,stack};
}
test('native scene keeps verified trigger times and recovered mesh provenance',()=>{
  assert.equal(fx.metadata.start,130.5);assert.equal(fx.metadata.explosion,133);assert.equal(fx.metadata.stop,150);
  assert.equal(fx.metadata.vertices,203);assert.equal(fx.metadata.triangles,344);assert.equal(fx.metadata.verifiedCurrentOfficial,false);
  for(const digest of Object.values(fx.metadata.sourceSHA256))assert.match(digest,/^[0-9a-f]{64}$/);
});
test('success branch emits on native rate intervals, subemitters and lifetimes',()=>{
  assert.equal(fx.inspect(130.5).length,0);assert.equal(fx.inspect(130.9).length,0);
  const first=fx.inspect(131.01);assert.equal(first.length,1);assert.equal(first[0].name,'ShootUp');assert.equal(first[0].birth,131);
  assert(first[0].life>=4&&first[0].life<=5);assert(first[0].size>=.05&&first[0].size<=.2);
  assert(fx.inspect(131.21).some(p=>p.name==='SubTail'));
  assert(!fx.inspect(133.6).some(p=>p.name==='Explode'));
  const explode=fx.inspect(133.68);assert.equal(explode.filter(p=>p.name==='Explode').length,1);assert.equal(explode.filter(p=>p.name==='SubSpark').length,50);
  assert.equal(fx.inspect(140,'failed').length,0);assert.equal(fx.inspect(140,'pending').length,0);
  assert(fx.inspect(150.01).length>0);assert(fx.inspect(153).every(p=>p.birth<150));assert.equal(fx.inspect(155).length,0);
});
test('sampling backward, repeated pause frames and new instances are deterministic',()=>{
  const expected=JSON.stringify(fx.inspect(138.25));fx.inspect(151);fx.inspect(131);
  assert.equal(JSON.stringify(fx.inspect(138.25)),expected);assert.equal(JSON.stringify(fx.inspect(138.25)),expected);
  assert.notEqual(JSON.stringify(fx.inspect(138.25,'success',13)),expected);
  for(const p of fx.inspect(143.37))for(const value of [...p.position,p.size,p.life,...p.color])assert(Number.isFinite(value));
});
test('weighted Bezier curve inverts time and preserves endpoint tangents',()=>{
  const k=[[0,0,0,10,2,1/3,.08],[1,1,0,0,1,.5,1/3]];
  assert.equal(fx.evaluateCurve(k,0),0);assert.equal(fx.evaluateCurve(k,1),1);
  const a=fx.evaluateCurve(k,.1);assert(a>.4&&a<1);assert(Math.abs(fx.evaluateCurve([[0,0,1,1,0,0,0],[1,1,1,1,0,0,0]],.35)-.35)<1e-6);
});
test('compositing restores gameplay Canvas state, never installs input or clock work',async()=>{
  const f=mockCanvas(),before=JSON.stringify(f.state),r=fx.create(f.canvas,{forceCanvas:true});await r.ready;
  const frame=r.sample({time:138,phase:'luminescence',branch:'success'});assert(frame.particleCount>0);assert(frame.meshCount>0);assert(frame.sparkCount>0);
  assert.equal(JSON.stringify(f.state),before);assert.equal(f.stack.length,0);assert.equal(f.canvas.style.pointerEvents,'auto');assert(!f.calls.includes('clear'));
  assert.equal(r.sample({time:138,phase:'retribution',branch:'success'}).active,false);assert.equal(r.stats.backgroundOpacity,0);
  r.dispose();assert.equal(r.sample({time:138,branch:'success'}).active,false);r.dispose();
});
test('failed branches have no successful particle burst and drawing errors restore state',()=>{
  const f=mockCanvas(),r=fx.create(f.canvas,{forceCanvas:true});assert.equal(r.sample({time:140,branch:'failed'}).particleCount,0);assert.equal(f.calls.length,0);
  const e=mockCanvas({throwDraw:true}),before=JSON.stringify(e.state),renderer=fx.create(e.canvas,{forceCanvas:true});
  assert.throws(()=>renderer.sample({time:90,branch:'failed'}),/injected draw/);assert.equal(JSON.stringify(e.state),before);assert.equal(e.stack.length,0);
});
