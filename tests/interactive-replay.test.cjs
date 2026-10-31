'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../js/interactive-replay.js'),boss=require('../js/boss-replay-rules.js'),chapter8=require('../js/chapter8-replay-rules.js');
function fixture(){
  let callback=null,now=1000,playing=false,videoTime=0,clipId='',duration=0,blocked=false;
  const tracks=[],scenes=[],effects=[],stops=[],plays=[];
  const durations={DF_Touch2Start:3.166667,DF_Unlock:47,'321_Unlock':21,iga_loop:5,iga_main:18.55,time_reverse:10,rr_unlock:35.435,spas_unlock:27.67};
  const ui={show(){},hide(){},status(message,error){if(error)throw Error(message);},scene(name){scenes.push(name);},stop(){playing=false;clipId='';videoTime=0;},
    async play(id,options){plays.push(id);clipId=id;duration=durations[id]||10;videoTime=options.seek||0;playing=true;},
    seek(at){videoTime=at;playing=true;},pause(){playing=false;},async resume(){playing=true;},effect(event){effects.push(event);},paint(){},paintGame(){},disposeGame(){},stopAmbient(){},
    mediaState(){return {clipId,videoTime,videoPlaying:playing,videoDuration:duration,videoPrepared:true,mediaBlocked:blocked};}};
  const env={PhiBossReplayRules:boss,PhiChapter8ReplayRules:chapter8,document:{hidden:false},requestAnimationFrame(fn){callback=fn;return 1;},cancelAnimationFrame(){callback=null;}};
  const runtime=api.createRuntime({ui,findEntry(key,tier){return {name:key,meta:{name:key,difficultyClass:tier}};},
    async startSong(entry,options){const engine={record:{...entry,visionReplay:options.visionReplay},counts:[0,0,0,0],maxCombo:0,score:()=>0,rawScore:()=>0,musicCurrentTime:()=>0,musicBuffer:{duration:180},musicPlaying:true};tracks.push({entry,options,engine});return engine;},stopSong(id){stops.push(id);}},env);
  async function tick(seconds){for(let elapsed=0;elapsed<seconds-1e-8;elapsed+=.05){if(playing){videoTime=Math.min(duration,videoTime+.05);if(videoTime>=duration)playing=false;}now+=50;callback?.(now);await Promise.resolve();}}
  return {runtime,tracks,scenes,effects,plays,stops,ui,env,tick,block(value){blocked=value;playing=!value&&!!clipId;}};
}
test('only actual chapter songs route; SP remixes and ordinary charts remain ordinary',()=>{
  assert.equal(api.routeForSong({name:'Spasmodic(Haocore Mix)',meta:{difficultyClass:'SP'}}),null);
  assert.equal(api.routeForSong({name:'Glaciaxion',meta:{difficultyClass:'EZ'}}),null);
  assert.equal(api.routeForSong({name:"Rrhar’il · 联网",meta:{difficultyClass:'IN'}}).chapter,7);
  assert.equal(api.routeForSong({name:'Distorted Fate',meta:{difficultyClass:'IN'}}).controller,'df-unlock');
});
test('DF starts its real scene, waits for the actual touch gate, then enters the selected chart',async()=>{
  const f=fixture();await f.runtime.begin({name:'Distorted Fate',meta:{difficultyClass:'HD'}});
  assert.deepEqual(f.scenes,['DFUnlock']);assert.equal(f.tracks.length,0);
  f.runtime.input('activate');assert.equal(f.tracks.length,0,'early press cannot skip the scene');
  await f.tick(5);assert.equal(f.runtime.current.snapshot.awaitingInput,true);assert.equal(f.tracks.length,0);
  f.runtime.input('activate');await f.tick(54);
  assert.equal(f.tracks.length,1);assert.equal(f.tracks[0].entry.name,'distorted-fate');assert.equal(f.tracks[0].entry.meta.difficultyClass,'HD');
  assert(f.plays.includes('DF_Touch2Start'));assert(f.plays.includes('DF_Unlock'));
  assert(f.tracks[0].options.visionContinuation);assert(f.tracks[0].engine.record.visionReplay);
});
test('Igallta intro never fabricates a chart result; only real gameplay can finish replay',async()=>{
  const f=fixture();await f.runtime.begin({name:'Igallta',meta:{difficultyClass:'IN'}});await f.tick(1.2);f.runtime.input('activate');
  await f.tick(15);assert.equal(f.tracks.length,0);await f.tick(6);assert.equal(f.tracks.length,1);
  const engine=f.tracks[0].engine;engine.score=()=>699999;
  assert.equal(f.runtime.finishSong(engine),false,'real result uses the normal result page');assert.equal(f.runtime.current.snapshot.result.passed,false);
});
test('native scene clocks pause while browser audio activation is blocked',async()=>{
  const f=fixture();await f.runtime.begin({name:'Igallta',meta:{difficultyClass:'IN'}});await f.tick(1.2);f.runtime.input('activate');f.block(true);
  await f.tick(30);assert.equal(f.tracks.length,0);f.block(false);await f.tick(21);assert.equal(f.tracks.length,1);
});
test('cancelled scene cannot advance or start a chart and a new replay has independent state',async()=>{
  const f=fixture();await f.runtime.begin({name:'Distorted Fate',meta:{difficultyClass:'IN'}});await f.tick(5);f.runtime.cancel();await f.tick(60);assert.equal(f.tracks.length,0);assert.equal(f.runtime.current,null);
  await f.runtime.begin({name:'Distorted Fate',meta:{difficultyClass:'EZ'}});assert.equal(f.runtime.current.snapshot.awaitingInput,false);assert.equal(f.runtime.current.snapshot.difficulty,'EZ');
});
