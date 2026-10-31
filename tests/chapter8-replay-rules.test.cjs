'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../js/chapter8-replay-rules.js');
const {LUMI,TIMES,createController,rawScore}=rules;
const has=(events,type)=>events.some(e=>e.type===type);
function flash(controller){
  controller.update({ambientTime:15,ambientPlaying:true});
  for(const deltaTime of [Math.fround(.2),Math.fround(.1),.5,Math.fround(.1),.5,Math.fround(.1)])controller.update({deltaTime,ambientPlaying:true});
  controller.update({ambientPlaying:false});
  controller.update({deltaTime:.5,ambientPlaying:false});
  return controller.update({deltaTime:2});
}
test('raw score retains single precision native order at the target boundary',()=>{
  assert.equal(rawScore(0,0,0,100),0);
  assert.equal(rawScore(100,0,100,100),1000000);
  const f=Math.fround,p=513,g=83,c=204,n=800;
  const expected=f(f(f(f(f(g)*f(.65))+f(p))/f(n))*900000)+f(f(f(c)*100000)/f(n));
  assert.equal(rawScore(p,g,c,n),f(expected));
  assert.equal(rawScore(100,0,0,100,true),1000000);
});
test('Lumi uses cached inclusive judgement window and a permanent failure latch',()=>{
  const c=createController('luminescence','IN');
  c.update({time:LUMI.eventStart});c.judge('Miss');
  c.update({time:LUMI.eventEnd+1});
  assert.equal(c.snapshot().stage1Failed,true);
  assert.equal(c.snapshot().eventActive,false);
  assert.equal(has(c.update({time:151,rawScore:1000000}),'particle'),false);
});
test('Good in Lumi window passes and the first eligible raw score sample is final',()=>{
  const c=createController('luminescence','IN');
  c.update({time:LUMI.eventEnd});c.judge('Good');
  const events=c.update({time:LUMI.scoreCheck,rawScore:784842.75});
  assert.equal(events[0].passed,false);
  c.update({time:151,rawScore:1000000});
  assert.equal(c.snapshot().stage2Failed,true);
  assert.equal(c.snapshot().timeTag,0);
});
test('Lumi accepts exact target and applies the three consecutive strict time branches',()=>{
  const c=createController('luminescence','EZ');
  c.update({time:130.5,rawScore:LUMI.targets.EZ});
  assert.equal(c.snapshot().timeTag,0);
  const events=c.update({time:151,rawScore:LUMI.targets.EZ});
  assert.equal(c.snapshot().timeTag,3);
  assert.deepEqual(events.filter(e=>e.type==='particle').map(e=>[e.name,e.playing]),[
    ['ShootUp',true],['Explode',true],['ShootUp',false],['Explode',false]
  ]);
});
test('Lumi schedules recovered dialogue and starts ambient on second message',()=>{
  const c=createController('luminescence','HD',{random:()=>0});
  c.update({time:151,rawScore:1000000});
  const intro=c.update({deltaTime:1});
  assert.equal(has(intro,'message'),false);
  assert.equal(intro.find(e=>e.type==='message-ambient-play').volume,1);
  const first=c.update({deltaTime:4.5});
  assert.equal(first.find(e=>e.type==='message').index,0);
  assert.equal(has(first,'ambient-play'),false);
  const second=c.update({deltaTime:4.5});
  assert.equal(second.find(e=>e.type==='message').index,1);
  assert.equal(has(second,'ambient-play'),true);
});
test('Lumi waits on ambient float time, its stop and black screen before phase 2',()=>{
  const c=createController('luminescence','IN');
  c.update({time:151,rawScore:1000000});
  assert.equal(has(c.update({ambientTime:14.7}),'post-effect'),false);
  assert.equal(c.snapshot().stage,'lumi-ambient-wait');
  const events=flash(c);
  assert.equal(events[0].type,'next-song');
  assert.equal(events[0].songKey,'retribution-phase2');
  assert.equal(events[0].phase,2);
  assert.equal(c.snapshot().flags.C8LuminescenceUnlocked,true);
  assert.equal(c.update({deltaTime:20}).length,0);
});
test('The Chariot retains its own identity and gates phase 1 at 920000',()=>{
  const c=createController('the-chariot','HD');
  c.update({time:145.5,rawScore:920000});
  assert.equal(c.snapshot().songKey,'the-chariot');
  assert.equal(c.snapshot().targetScore,920000);
  c.update({deltaTime:1});
  const events=flash(c);
  assert.equal(events[0].songKey,'retribution-phase1');
  assert.equal(events[0].phase,1);
  assert.deepEqual(c.snapshot().flags,{});
  const failed=createController('the-chariot','IN');
  failed.update({time:145.5,rawScore:919999.9});
  assert.equal(failed.snapshot().stage2Failed,true);
  assert.equal(failed.snapshot().stage,'playing');
});
test('phase 1 HP exhaustion is the recovered 321 unlock continuation',()=>{
  const c=createController('retribution-phase1','IN');
  c.update({time:TIMES.phase1Start});
  for(let i=0;i<41;i++)c.judge('Miss');
  const death=c.update({time:TIMES.phase1Start});
  assert.equal(death.find(e=>e.type==='death').continues,true);
  assert.equal(c.snapshot().dead,true);
  assert.equal(c.snapshot().hp<=0,true);
  assert.equal(c.update({deltaTime:1.49}).length,0);
  assert.equal(c.update({deltaTime:.02}).find(e=>e.type==='black-screen').target,'321Unlock');
  assert.equal(c.update({deltaTime:2}).find(e=>e.type==='scene').scene,'321Unlock');
  assert.equal(c.snapshot().songKey,'d321-unlock');
});
test('phase 1 is not replaced with a fake fixed successful ending at 141.4737',()=>{
  const c=createController('retribution-phase1','EZ');
  c.update({time:TIMES.phase1Start});
  for(let i=0;i<500;i++)c.judge('Perfect');
  const events=c.update({time:141.4737});
  assert.equal(has(events,'next-song'),false);
  assert.equal(has(events,'scene'),false);
});
test('phase 2 judgement callbacks accept their actual clock and ignore locked guard',()=>{
  const c=createController('retribution-phase2','IN');
  c.update({time:0});c.judge('Perfect',TIMES.phase2Start);
  assert.equal(c.snapshot().totalNoteAffect,.006);
  c.update({time:TIMES.phase2Lock+.01});
  assert.equal(c.snapshot().locked,true);
  const before=c.snapshot().totalNoteAffect;
  c.judge('Miss',102);
  assert.equal(c.snapshot().totalNoteAffect,before-.06);
});
test('phase 2 checks HP exactly at threshold, but strictly later locks first',()=>{
  const exact=createController('retribution-phase2','IN');
  const death=exact.update({time:TIMES.phase2Lock});
  assert.equal(has(death,'death'),true);
  const late=createController('retribution-phase2','IN');
  const lock=late.update({time:TIMES.phase2Lock+.001});
  assert.equal(has(lock,'hp-lock'),true);
  assert.equal(late.snapshot().dead,false);
});
test('phase 2 actual failure goes to Loading after 1.5s',()=>{
  const c=createController('retribution-phase2','IN');
  c.update({time:TIMES.phase2Start});
  for(let i=0;i<17;i++)c.judge('Miss');
  c.update({time:TIMES.phase2Start});
  const events=c.update({deltaTime:1.5});
  assert.equal(events.find(e=>e.type==='scene').scene,'Loading');
  assert.equal(c.snapshot().complete,true);
});
test('phase 2 completion requires both the decremented outro and stopped audio',()=>{
  const c=createController('retribution-phase2','IN');
  c.update({time:102});
  c.update({audioTime:133.5,clipLength:140,deltaTime:2,audioPlaying:false});
  assert.equal(c.snapshot().scene,'Level');
  c.update({audioTime:134,clipLength:140,deltaTime:2,audioPlaying:true});
  assert.equal(c.snapshot().outro,0);
  assert.equal(c.snapshot().scene,'Level');
  assert.equal(c.update({audioTime:140,clipLength:140,audioPlaying:false})[0].scene,'DFUnlock');
  assert.equal(c.snapshot().stage,'df-prepare');
});
test('DF requires its 3s lead and actual paused touch gate; touch consumes once',()=>{
  const c=createController('df-unlock','IN');
  assert.equal(c.input('touch').length,0);
  assert.equal(has(c.update({deltaTime:2.99}),'play-clip'),false);
  assert.equal(c.update({deltaTime:.02}).find(e=>e.type==='play-clip').clip,'DF_Touch2Start');
  assert.equal(c.update({videoTime:1.49,videoPlaying:true}).length,0);
  assert.equal(has(c.update({videoTime:1.5,videoPlaying:true}),'pause-video'),true);
  assert.equal(c.snapshot().awaitingInput,true);
  const touch=c.input('touch');
  assert.equal(touch.find(e=>e.type==='seek-video').time,2.066);
  assert.equal(c.input('touch').length,0);
  assert.equal(c.snapshot().awaitingInput,false);
});
test('DF touch, main film, info and stopped ending close onto Distorted Fate',()=>{
  const c=createController('df-unlock','HD');
  c.update({deltaTime:3});c.update({videoTime:1.5,videoPlaying:true});c.input('touch');
  c.update({videoTime:2.066,videoPlaying:true});
  assert.equal(has(c.update({videoTime:2.7,videoPlaying:true}),'black-mask'),true);
  c.update({videoTime:3.1667,videoPlaying:false});
  c.update({deltaTime:.21});
  assert.equal(c.update({videoPrepared:true}).find(e=>e.type==='play-clip').clip,'DF_Unlock');
  assert.equal(has(c.update({videoTime:.005,videoPlaying:true}),'black-mask'),true);
  assert.equal(has(c.update({videoTime:26.8,videoPlaying:true}),'music-info'),true);
  assert.equal(has(c.update({videoTime:46.5,videoPlaying:true}),'black-mask'),true);
  assert.equal(has(c.update({videoTime:47,videoPlaying:false}),'black-screen'),true);
  const done=c.update({deltaTime:2});
  assert.equal(done[0].songKey,'distorted-fate');
  assert.equal(done[0].difficulty,'HD');
});
test('321 scene also waits for playback before accepting its stopped ending',()=>{
  const c=createController('d321-unlock','EZ');
  assert.equal(c.update({videoPrepared:false}).length,1);
  c.update({videoPrepared:true});
  assert.equal(c.update({videoPlaying:false}).length,0);
  c.update({videoPlaying:true});
  assert.equal(has(c.update({videoTime:11.56666666,videoPlaying:true}),'music-info'),true);
  c.update({videoPlaying:false});
  assert.equal(c.update({deltaTime:2})[0].songKey,'destruction-321');
});
test('exit is always usable, snapshots are isolated and the module owns no save writes',()=>{
  const c=createController('df-unlock','EZ');
  const state=c.snapshot();assert.equal(Object.isFrozen(state.flags),true);
  assert.equal(c.input('exit')[0].type,'exit');
  assert.equal(c.snapshot().stage,'exited');
  assert.equal(c.update({deltaTime:100}).length,0);
  assert.equal(c.input('touch').length,0);
});
test('Distorted Fate finishes onto the actual four-second QDEvent black screen',()=>{
  const c=createController('distorted-fate','IN');
  c.update({time:180,rawScore:920000});
  const events=c.finish({score:920000});
  assert.equal(has(events,'result'),false);
  assert.equal(events.find(e=>e.type==='black-screen').duration,4);
  assert.equal(c.snapshot().flags.DistortedFateINSGrade,true);
  assert.equal(c.update({deltaTime:3.99}).length,0);
  assert.equal(c.update({deltaTime:.02})[0].scene,'QDEvent');
  assert.equal(c.snapshot().flags.chapter8Passed,undefined);
});
test('QDEvent waits for actual playback before opening the original five subtitles',()=>{
  const c=createController('qd-event','IN');
  assert.equal(c.update({videoPrepared:true}).find(e=>e.type==='play-clip').clip,'QD');
  c.update({videoTime:14.4,videoPlaying:false});
  assert.equal(c.snapshot().stage,'qd-starting');
  c.update({videoTime:0,videoPlaying:true});c.update({videoTime:.005,videoPlaying:true});
  for(const caption of rules.ENDINGS.captions){
    const events=c.update({videoTime:caption.time});
    assert.equal(events.find(e=>e.type==='subtitle'&&e.text).text,caption.text);
    assert.equal(c.snapshot().subtitle,caption.text);
    assert.equal(c.update({deltaTime:1}).find(e=>e.type==='subtitle').text,'');
  }
});
test('QDEvent completes its random-timed Latin message, two-second fade and AboutUs',()=>{
  const c=createController('qd-event','IN',{random:()=>0});
  c.update({});c.update({videoPlaying:true});c.update({videoTime:.005});
  assert.equal(c.update({videoTime:21.15,videoDuration:24.066667}).length,1); // caption, not message
  assert.equal(c.snapshot().stage,'qd-main');
  c.update({videoTime:23.6,videoDuration:24.066667});
  assert.equal(has(c.update({videoTime:24.066667,videoPlaying:false}),'messages-start'),true);
  c.update({deltaTime:1});
  const latin=c.update({deltaTime:4.5});
  assert.equal(latin.find(e=>e.type==='message').text,rules.ENDINGS.qdMessage);
  assert.equal(has(latin,'ambient-play'),false);
  assert.equal(has(c.update({deltaTime:4.5}),'message-hide'),true);
  assert.equal(c.update({deltaTime:.5}).find(e=>e.type==='message-ambient-stop').duration,2);
  assert.equal(c.update({deltaTime:2}).find(e=>e.type==='black-screen').target,'AboutUs');
  assert.equal(c.update({deltaTime:.5}).find(e=>e.type==='scene').scene,'AboutUs');
  assert.equal(c.snapshot().awaitingInput,true);
});
test('AboutUs preserves the original click-to-start, scroll and music switch times',()=>{
  const c=createController('about-us','HD');
  assert.equal(c.input('touch').length,0);
  c.update({deltaTime:1});
  assert.equal(c.snapshot().creditsProgress,0);
  assert.equal(c.input('touch').find(e=>e.type==='credits-audio').track,0);
  assert.equal(c.snapshot().stage,'credits-playing');
  assert.equal(has(c.update({deltaTime:127}),'credits-audio'),false);
  assert.equal(c.update({deltaTime:.01}).find(e=>e.type==='credits-audio').track,1);
  c.update({deltaTime:193.99});
  assert.equal(c.snapshot().creditsProgress,1);
  assert.equal(has(c.update({deltaTime:.01}),'credits-audio-stop'),true);
  c.update({deltaTime:6});
  assert.equal(c.snapshot().flags.chapter8Passed,true);
  assert.equal(c.snapshot().flags.C8DistortedFateUnlocked,true);
  assert.equal(c.update({deltaTime:.67})[0].type,'return-selection');
});
test('AboutUs skip follows the original 1.5s opacity curve and reverses on release',()=>{
  assert.equal(rules.creditsSkipOpacity(0),0);
  assert.equal(rules.creditsSkipOpacity(.2),Math.fround(.4));
  assert.equal(rules.creditsSkipOpacity(.5),Math.fround(.4));
  assert.equal(rules.creditsSkipOpacity(1.5),1);
  const c=createController('about-us','IN');c.update({deltaTime:1});c.input('touch');
  c.input('hold-start');c.update({deltaTime:0});c.update({deltaTime:.4});
  assert.equal(c.snapshot().skipOpacity,Math.fround(.4));
  c.input('hold-end');c.update({deltaTime:.1});c.update({deltaTime:.1});
  assert.equal(c.snapshot().skipOpacity,0);
  assert.equal(c.snapshot().stage,'credits-playing');
  c.input('hold-start');c.update({deltaTime:0});
  const skip=c.update({deltaTime:1.49});
  assert.equal(has(skip,'credits-exit'),true);
  assert.equal(c.snapshot().stage,'credits-leave');
  assert.equal(has(c.update({deltaTime:.67}),'return-selection'),true);
});
test('321 ending preserves its original crash dialogue and quit action after stutter',()=>{
  const c=createController('destruction-321','IN');
  assert.equal(has(c.update({time:rules.ENDINGS.destructionEnd}),'audio-stutter'),false);
  const ending=c.update({time:156.151,rawScore:930000});
  assert.equal(ending[0].type,'audio-stutter');
  assert.equal(c.finish().length,0);
  assert.equal(has(c.update({deltaTime:4.01}),'dialog'),true);
  assert.equal(c.snapshot().flags.chapter8UnlockSecondPhase,true);
  assert.equal(c.snapshot().flags.DESTRUCTION321INSGrade,true);
  const result=c.input('confirm');
  assert.equal(result[0].type,'return-selection');
  assert.equal(result[0].nativeAction,'Application.Quit');
  assert.equal(c.snapshot().complete,true);
});
