'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const {fixture}=require('./helpers/engine.cjs'),rules=require('../js/chapter8-replay-rules.js');
function lumi(tier='IN'){
  const f=fixture({PhiChapter8ReplayRules:rules,PhiVisionMode:{enabled:false},JUDGE_NAMES:['perfect','good','bad','miss']}),p=f.probe,classes=new Set(),props=new Map(),draws=[],disposed=[];
  f.node('#gameView').classList={remove:x=>classes.delete(x),toggle(x,on){if(on)classes.add(x);else classes.delete(x);}};
  f.node('#gameView').style={setProperty:(k,v)=>props.set(k,v),removeProperty:k=>props.delete(k)};
  f.context.PhiChapter8ReplayVisuals={create:()=>({sample:value=>draws.push(value),dispose:()=>disposed.push(true)})};
  let time=0;p.musicCurrentTime=()=>time;
  Object.assign(p,{record:{builtin:true,audioHash:'reference-song:Luminescence.米虾Fomiki初云CLoudie',meta:{difficultyClass:tier}},total:1000,counts:[800,0,0,0],actualCounts:[0,0,0,0],maxCombo:800,actualMaxCombo:0,combo:0,actualCombo:0,pendingJudge:new Set(),earlyLate:[0,0],canvas:{width:960,height:540}});
  p.resetLumiInSongPresentation();return{...f,p,classes,props,draws,disposed,at(t,dt=0){time=t;return p.sampleLumiInSongPresentation(dt);}};
}
test('ordinary Lumi uses native success score and real cached-window judgements with replay OFF',()=>{
  const h=lumi();assert(h.p.lumiInSongController);h.at(rules.LUMI.eventStart);h.p.commit({type:1,state:0},3,0,{});assert(h.p.lumiInSongController.snapshot().stage1Failed);
  const failed=h.at(136);h.p.drawLumiInSongPresentation();assert.equal(failed.timeTag,0);assert.equal(h.draws[0].branch,'failed');assert.equal(h.p.counts[3],1);
  const good=lumi();good.p.hitEffect=()=>{};good.p.playSound=()=>{};good.at(rules.LUMI.eventStart);good.p.commit({type:1,state:0},1,0,{});
  good.at(rules.LUMI.scoreCheck);const pass=good.at(136);good.p.drawLumiInSongPresentation();assert.equal(pass.stage1Failed,false);assert.equal(pass.stage2Failed,false);assert.equal(good.draws[0].branch,'success');assert.equal(good.draws[0].time,136);assert.equal(good.draws[0].clear,false);
});
test('native raw float threshold is latched on the first score check for each tier',()=>{
  for(const tier of ['EZ','HD','IN']){
    const h=lumi(tier),threshold=rules.LUMI.targets[tier];h.p.rawScore=()=>threshold-.0625;h.at(rules.LUMI.scoreCheck);h.p.rawScore=()=>1000000;
    assert.equal(h.at(136).stage2Failed,true);h.p.drawLumiInSongPresentation();assert.equal(h.draws[0].branch,'failed');
    h.p.resetLumiInSongPresentation();h.p.rawScore=()=>threshold;h.at(rules.LUMI.scoreCheck);assert.equal(h.at(136).stage2Failed,false);
  }
});
test('ordinary success fades HUD, retains score state and never dispatches chapter transitions',()=>{
  const h=lumi();h.at(rules.LUMI.scoreCheck);for(let i=0;i<15;i++)h.at(131+i/10,.1);
  assert(h.classes.has('visionReplayDimUI'));assert.equal(h.props.get('--vision-hud-opacity'),0);
  const counts=h.p.counts.slice();h.at(151,.1);h.at(180,.1);assert.equal(h.p.record.visionReplay,undefined);assert.deepEqual(h.p.counts,counts);assert.equal(h.p.running,true);
  h.p.drawLumiInSongPresentation();h.p.clearLumiInSongPresentation();assert.equal(h.disposed.length,1);assert.equal(h.classes.size,0);assert.equal(h.props.size,0);assert.equal(h.p.lumiInSongController,null);
});
test('restart and backward seek clear prior failure and release the old renderer',()=>{
  const h=lumi();h.at(90);h.p.commit({type:1,state:0},3,0,{});h.at(136);h.p.drawLumiInSongPresentation();assert.equal(h.draws[0].branch,'failed');
  h.at(10);assert.equal(h.disposed.length,1);assert.equal(h.p.lumiInSongController.snapshot().stage1Failed,false);
  h.at(rules.LUMI.scoreCheck);h.at(136);h.p.drawLumiInSongPresentation();assert.equal(h.draws[1].branch,'success');
  h.p.resetLumiInSongPresentation();assert.equal(h.disposed.length,2);assert.equal(h.p.lumiInSongFrame,null);assert.equal(h.p.lumiInSongController.snapshot().timeTag,0);
});
test('imports, other songs, unsupported tiers and replay-owned tracks never get a second controller',()=>{
  for(const change of [p=>p.record.builtin=false,p=>p.record.audioHash+='-other',p=>p.record.meta.difficultyClass='SP',p=>p.chart.kind='pjsk',p=>p.record.visionReplay={id:1}]){
    const h=lumi();change(h.p);h.p.resetLumiInSongPresentation();assert.equal(h.p.lumiInSongController,null);assert.equal(h.at(136),null);h.p.drawLumiInSongPresentation();assert.equal(h.draws.length,0);
  }
});
