'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const context={};vm.runInNewContext(fs.readFileSync('js/chapter8-stage-effects.js','utf8'),context);const api=context.PhiChapter8StageEffects;
const near=(a,b,e=1e-6)=>assert(Math.abs(a-b)<e,`${a} should equal ${b}`);
test('DF timeline preserves countdown duration, inversion and absolute seeking',()=>{
  assert.equal(api.sampleNative('luminescence',130),null);assert.equal(api.sampleNative('distorted-fate',NaN),null);
  const start=api.metadata.countdownStart,first=api.sampleNative('distorted-fate',start);
  near(first.countDownTime,24.799999237060547);assert.equal(first.showCountdown,false);
  assert.equal(api.sampleNative('distorted-fate',start+.001).showCountdown,true);
  near(api.sampleNative('distorted-fate',150).countDownTime,0);assert.equal(api.sampleNative('distorted-fate',150).showCountdown,false);
  near(api.sampleNative('distorted-fate',150.5).contrast,-1);
  const at=JSON.stringify(api.sampleNative('distorted-fate',142.47));api.sampleNative('distorted-fate',160);api.sampleNative('distorted-fate',87);
  assert.equal(JSON.stringify(api.sampleNative('distorted-fate',142.47)),at);
  assert.equal(api.metadata.verifiedCurrentOfficial,false);
});
test('affine color matrix matches native shader order, preserving alpha and negative contrast',()=>{
  const p={exposure:1.4,saturation:.3,contrast:-.8,averageColor:[.3,.4,.2]},rgb=[.1,.6,.9],m=api.colorMatrix(p),luma=rgb.reduce((v,c,i)=>v+c*[.212500006,.715399981,.0720999986][i],0);
  for(let row=0;row<3;row++)near(m[row*5]*rgb[0]+m[row*5+1]*rgb[1]+m[row*5+2]*rgb[2]+m[row*5+4],p.exposure*(p.contrast*(p.saturation*(rgb[row]-luma)+luma-p.averageColor[row])+p.averageColor[row]));
  assert.deepEqual(Array.from(m.slice(15)),[0,0,0,1,0]);
  assert.deepEqual(Array.from(api.colorMatrix()),[1,0,0,0,0,0,1,0,0,0,0,0,1,0,0,0,0,0,1,0]);
});
function mockCanvas(fail=false){
  const state={alpha:.4,composite:'multiply',filter:'blur(2px)',shadow:8,transform:[2,0,0,2,4,5]},stack=[];
  const ctx={save(){stack.push({...state,transform:state.transform.slice()});},restore(){Object.assign(state,stack.pop());},setTransform(...x){state.transform=x;},fillRect(){if(fail)throw Error('draw failed');},createRadialGradient(){return{addColorStop(){}};}};
  for(const [key,prop]of[['globalAlpha','alpha'],['globalCompositeOperation','composite'],['filter','filter'],['shadowBlur','shadow']])Object.defineProperty(ctx,key,{get:()=>state[prop],set:v=>state[prop]=v});
  return{state,stack,canvas:{width:960,height:540,style:{},getContext:()=>ctx}};
}
test('stage compositing restores shared canvas state and performs no frame uploads',()=>{
  const f=mockCanvas(),before=JSON.stringify(f.state),fx=api.create(f.canvas,{forceCanvas:true});
  const result=fx.sample({songKey:'distorted-fate',time:94});assert.equal(result.active,true);assert.equal(result.frameUploads,0);assert.equal(result.vignette,true);
  assert.equal(JSON.stringify(f.state),before);assert.equal(f.stack.length,0);
  assert.equal(fx.sample({songKey:'other',time:94}).active,false);fx.dispose();assert.equal(fx.sample({songKey:'distorted-fate',time:94}).active,false);fx.dispose();
  const g=mockCanvas(true),previous=JSON.stringify(g.state),failed=api.create(g.canvas,{forceCanvas:true});assert.throws(()=>failed.sample({songKey:'distorted-fate',time:94}),/draw failed/);assert.equal(JSON.stringify(g.state),previous);assert.equal(g.stack.length,0);
});
