'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const rules=require('../js/chapter8-replay-rules.js');
const api=require('../js/interactive-replay.js');

const flush=async()=>{for(let n=0;n<6;n++)await Promise.resolve();};
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
const entry=(key,tier='IN')=>({name:key,meta:{name:key,difficultyClass:tier}});

// The actual runtime and actual rules run here. Only browser media, RAF and the
// chart engine are injected; this catches event contracts across controller swaps.
function harness(options={}) {
  let now=1000,nextRAF=1,currentEngine=null,visible=false,exitCount=0;
  const queue=new Map(),tracks=[],effects=[],scenes=[],paints=[],errors=[],stops=[],cancelled=[],audio=[];
  const media={clipId:'',videoTime:0,videoPlaying:false,videoDuration:0,videoPrepared:true,
    mediaLoading:false,mediaBlocked:false,audioLoading:false,ambientTime:0,ambientPlaying:false};
  const durations={DF_Touch2Start:rules.TIMES.touchDuration,DF_Unlock:47,'321_Unlock':27.5,QD:rules.ENDINGS.qdDuration};
  const env={document:{hidden:false},PhiChapter8ReplayRules:rules,
    requestAnimationFrame(fn){const id=nextRAF++;queue.set(id,fn);return id;},
    cancelAnimationFrame(id){queue.delete(id);}};
  const ui={
    show(){visible=true;},hide(){visible=false;},scene(scene){scenes.push(scene);},
    status(text,error){if(error)errors.push(text);},disposeGame(){},drawGame(){},
    mediaState(){return {...media};},
    stop(){media.videoPlaying=false;media.videoTime=0;media.videoDuration=0;media.clipId='';},
    stopAmbient(){media.ambientPlaying=false;},
    async play(id,event){
      if(options.play)await options.play(id,event);
      if(event.signal.aborted||!event.isCurrent())return;
      media.clipId=id;media.videoTime=event.seek||0;media.videoDuration=durations[id];media.videoPlaying=true;
    },
    seek(time,playing){media.videoTime=time;media.videoPlaying=playing;},
    pause(){media.videoPlaying=false;},async resume(){media.videoPlaying=true;},
    effect(event){effects.push({...event});if(event.type==='ambient-play'){media.ambientTime=0;media.ambientPlaying=true;}},
    paint(state){paints.push({...state});},paintGame(state){paints.push({...state});},
  };
  const adapter={ui,async prepare(){},findEntry:(key,tier)=>entry(key,tier),
    async startSong(next,record){
      if(options.startSong)await options.startSong(next,record);
      const engine={record,time:0,musicPlaying:true,musicBuffer:{duration:180},counts:[0,0,0,0],maxCombo:0,running:true,paused:false,
        rawScore:()=>1000000,score:()=>1000000,musicCurrentTime(){return this.time;}};
      currentEngine=engine;tracks.push({key:api.songKey(next),record,engine});return engine;
    },
    stopSong(id){stops.push(id);if(currentEngine?.record.visionReplay.id===id){currentEngine.running=false;currentEngine=null;}},
    cancelPreparation(id){cancelled.push(id);},onExit(){exitCount++;},
    settleSong(engine){audio.push(['settle',engine.time]);},
    fadeAudio(engine,duration){audio.push(['fade',duration]);},
    stutterAudio(engine,event){audio.push(['stutter',event.duration,event.interval,event.pitch]);},
    stopAudio(){audio.push(['stop']);},
  };
  const runtime=api.createRuntime(adapter,env);
  async function step(dt=.05){
    if(!env.document.hidden){
      if(media.videoPlaying){media.videoTime=Math.min(media.videoDuration,media.videoTime+dt);if(media.videoTime>=media.videoDuration)media.videoPlaying=false;}
      if(media.ambientPlaying){media.ambientTime=Math.min(16.2192063492,media.ambientTime+dt);if(media.ambientTime>=16.2192063492)media.ambientPlaying=false;}
    }
    now+=dt*1000;
    if(currentEngine?.running&&!currentEngine.paused&&!env.document.hidden){currentEngine.time+=dt;runtime.updateSong(currentEngine,currentEngine.time,dt);}
    const callbacks=[...queue.values()];queue.clear();for(const fn of callbacks)fn(now);await flush();
  }
  async function advance(seconds){for(let elapsed=0;elapsed<seconds-1e-8;elapsed+=.05)await step();}
  async function until(predicate,seconds=60){for(let n=0;n<seconds*20;n++){if(predicate())return;await step();}assert.ok(predicate(),`condition timed out; ${JSON.stringify(runtime.current)}`);}
  function frame(time,dt=0){assert.ok(currentEngine,'a playable chart engine must exist');currentEngine.time=time;runtime.updateSong(currentEngine,time,dt);}
  function finish(){const engine=currentEngine;assert.ok(engine);engine.musicPlaying=false;return runtime.finishSong(engine);}
  return {runtime,env,ui,media,tracks,effects,scenes,paints,errors,stops,cancelled,audio,
    get engine(){return currentEngine;},get visible(){return visible;},get exitCount(){return exitCount;},
    step,advance,until,frame,finish};
}

async function enterDFChart(h) {
  await h.until(()=>h.runtime.current?.snapshot.awaitingInput,8);
  assert.equal(h.runtime.current.snapshot.stage,'df-touch-wait');
  h.runtime.input('activate');
  assert.equal(h.media.videoTime,rules.TIMES.touchResume);
  await h.until(()=>h.tracks.at(-1)?.key==='distorted-fate',55);
}
async function enterCredits(h) {
  h.frame(180);assert.equal(h.finish(),true);
  await h.until(()=>h.runtime.current?.snapshot.stage==='credits-wait',50);
  await h.advance(1.1);h.runtime.input('activate');
  assert.equal(h.runtime.current.snapshot.stage,'credits-playing');
}

test('Lumi → fresh Retribution phase 2 → touch unlock → DF → QD → AboutUs → hold skip',async()=>{
  const h=harness();assert.equal(await h.runtime.begin(entry('luminescence','HD')),true);
  h.frame(86.5);h.runtime.judge(h.engine,'Good');h.frame(rules.LUMI.scoreCheck);h.frame(151);
  assert.equal(h.finish(),true);
  await h.until(()=>h.tracks.length===2,40);
  assert.equal(h.tracks[1].key,'retribution');
  assert.equal(h.tracks[1].record.visionReplay.phase,2);
  assert.equal(h.runtime.current.snapshot.songKey,'retribution-phase2');
  assert.equal(h.runtime.current.snapshot.complete,false);
  h.frame(102);assert.equal(h.runtime.current.snapshot.locked,true);
  h.frame(179,2);assert.equal(h.runtime.current.snapshot.blackOpacity,1);
  h.engine.musicPlaying=false;h.frame(180);
  assert.equal(h.runtime.current.scene,'DFUnlock');
  for(const key of ['blackOpacity','hudOpacity','lockProgress','infoVisible'])assert.equal(h.runtime.current.snapshot[key],undefined,`${key} must be owned by the destroyed scene`);
  assert.equal(h.runtime.current.snapshot.locked,false);
  await enterDFChart(h);assert.equal(h.runtime.current.snapshot.songKey,'distorted-fate');
  await enterCredits(h);
  assert.deepEqual(h.effects.filter(e=>e.type==='subtitle'&&e.text).map(e=>e.text),rules.ENDINGS.captions.map(c=>c.text));
  assert.ok(h.effects.some(e=>e.type==='message'&&e.text===rules.ENDINGS.qdMessage));
  assert.ok(h.effects.some(e=>e.type==='credits-audio'&&e.track===0));
  h.runtime.input('hold-start');await h.until(()=>!h.runtime.current,3);
  assert.equal(h.exitCount,1);assert.equal(h.visible,false);
  assert.ok(h.effects.some(e=>e.type==='chapter-flag'&&e.key==='chapter8Passed'));
  assert.deepEqual(h.errors,[]);
});

test('The Chariot → phase 1 death → 321 unlock → 4-second stutter → visible native crash confirmation',async()=>{
  const h=harness();await h.runtime.begin(entry('the-chariot'));
  h.frame(145.5);assert.equal(h.finish(),true);
  await h.until(()=>h.tracks.length===2,40);
  assert.equal(h.tracks[1].record.visionReplay.phase,1);
  h.frame(rules.TIMES.phase1Start);for(let i=0;i<41;i++)h.runtime.judge(h.engine,'Miss');h.frame(rules.TIMES.phase1Start);
  assert.equal(h.runtime.current.snapshot.dead,true);
  await h.until(()=>h.tracks.length===3,40);
  assert.equal(h.tracks[2].key,'destruction-321');
  h.frame(rules.ENDINGS.destructionEnd+.01);
  assert.deepEqual(h.audio.find(e=>e[0]==='stutter'),['stutter',4,.03125,.75]);
  await h.until(()=>h.runtime.current?.snapshot.stage==='destruction-dialog',5);
  const dialog=h.effects.find(e=>e.type==='dialog');assert.equal(dialog.title,'PhigrOS已崩溃');
  assert.equal(h.visible,true,'the dialog must be on a visible scene after gameplay hid the scene surface');
  assert.equal(h.engine,null,'the ended chart must release ownership before confirmation');
  h.runtime.input('confirm');assert.equal(h.runtime.current,null);assert.equal(h.exitCount,1);assert.deepEqual(h.errors,[]);
});

test('cancel during deferred chart preparation stops a late engine without reviving the session',async()=>{
  const gate=deferred(),h=harness({startSong:()=>gate.promise});
  const beginning=h.runtime.begin(entry('luminescence'));await flush();
  const id=h.runtime.current.id;h.runtime.cancel();assert.ok(h.cancelled.includes(id));
  gate.resolve();assert.equal(await beginning,false);
  assert.equal(h.engine,null);assert.equal(h.runtime.current,null);assert.equal(h.exitCount,1);
  assert.ok(h.stops.filter(value=>value===id).length>=2);assert.deepEqual(h.errors,[]);
});

test('a stale video failure after cancel cannot poison a new chapter session',async()=>{
  const gate=deferred(),h=harness({play:()=>gate.promise});
  await h.runtime.begin(entry('distorted-fate'));await h.advance(3.2);
  h.runtime.cancel();await h.runtime.begin(entry('luminescence','EZ'));
  gate.reject(Error('cancelled clip transport'));await flush();
  assert.equal(h.runtime.current.snapshot.songKey,'luminescence');assert.equal(h.runtime.current.error,undefined);
  assert.equal(h.engine.running,true);assert.deepEqual(h.errors,[]);h.runtime.cancel();
});

test('credits audio loading freezes scroll but still permits original hold-to-skip',async()=>{
  const h=harness();await h.runtime.begin(entry('distorted-fate'));await enterDFChart(h);await enterCredits(h);
  h.media.audioLoading=true;const before=h.runtime.current.snapshot.creditsTime;await h.advance(10);
  assert.equal(h.runtime.current.snapshot.creditsTime,before);
  assert.equal(h.runtime.current.snapshot.creditsAudioLoading,true);
  h.runtime.input('hold-start');await h.until(()=>!h.runtime.current,3);
  assert.equal(h.exitCount,1);assert.deepEqual(h.errors,[]);
});

test('hidden-document RAF time never counts toward the touch preparation gate',async()=>{
  const h=harness();await h.runtime.begin(entry('distorted-fate'));await h.advance(1);
  const before=h.runtime.current.snapshot.sceneTime;h.env.document.hidden=true;await h.advance(30);
  assert.equal(h.runtime.current.snapshot.sceneTime,before);assert.equal(h.media.clipId,'');
  h.env.document.hidden=false;await h.until(()=>h.runtime.current.snapshot.awaitingInput,6);
  assert.equal(h.runtime.current.snapshot.stage,'df-touch-wait');h.runtime.cancel();
});
