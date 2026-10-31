/* Chapter 5–7 scene rules recovered from the local 3.0.0.1 historical sample.
 * This module drives real chart play; a movie ending never counts as a result.
 * Native method RVAs and serialized UI bindings are in assets/meta/boss-replay-source.json.
 */
(() => {
  'use strict';
  const BOSSES = Object.freeze({
    spasmodic: Object.freeze({chapter:5,songKey:'Spasmodic',songId:'Spasmodic.姜米條颶風元力上人.0',scene:'FakeAboutUs',clip:'spas_unlock',guard:0.7,introSeconds:29.5}),
    igallta: Object.freeze({chapter:6,songKey:'Igallta',songId:'Igallta.SeURa.0',scene:'IgalltaUnlock',clip:'iga_main',loop:'iga_loop',guard:1,introSeconds:20}),
    rrharil: Object.freeze({chapter:7,songKey:'Rrharil',songId:'Rrharil.TeamGrimoire.0',scene:'RrharilEnter',clip:'rr_unlock',guard:0.7,introSeconds:31.58333396911621})
  });
  const TIERS = Object.freeze(['EZ','HD','IN','AT']);
  function bossKey(value) {
    const text=String(typeof value==='object'?(value?.songKey||value?.key||value?.id||value?.songId||value?.title||''):value||'').toLowerCase().replace(/[’'\s_-]/g,'');
    return Object.keys(BOSSES).find(key=>text===key||text===BOSSES[key].songId.toLowerCase())||null;
  }
  function routeForSong(song,enabled=true) { const key=enabled?bossKey(song):null;return key?Object.freeze({boss:key,...BOSSES[key]}):null; }
  function number(value,fallback=0) { return Number.isFinite(Number(value))?Number(value):fallback; }
  function create(options={}) {
    const boss=bossKey(options.boss||options.songKey||options.songId), spec=BOSSES[boss];
    if(!spec)throw Error('Unknown chapter boss replay');
    const tier=String(options.tier||options.difficulty||'IN').toUpperCase();
    if(!TIERS.includes(tier))throw Error('Unknown chart difficulty');
    let phase=boss==='rrharil'?'reverse':'entry',scene=spec.scene,sceneTime=0,now=0,phaseAt=0,startedAt=null,clip=null,result=null,cancelled=false;
    let held=false,cameraZ=-10,cameraSpeed=0,activationAt=null;
    const queue=[];
    const emit=event=>queue.push(Object.freeze(event));
    const change=(next,nextScene=scene)=>{phase=next;scene=nextScene;phaseAt=now;sceneTime=0;emit({type:'scene',scene,phase});};
    function startSong(songKey=spec.songKey,mod=null) {
      change('playing','Level');clip=null;emit({type:'stop-clip'});emit({type:'start-song',songKey,tier,...(mod?{mod}:{}),replay:true});
    }
    function wait(action='activate',guardSeconds=spec.guard||0) {emit({type:'wait-input',action,guardSeconds,scene});}
    function drain() {return queue.splice(0);}
    function snapshot() {
      return Object.freeze({boss,tier,phase,scene,sceneTime,clip,cancelled,result,held,cameraZ,cameraSpeed,clockProgress:Math.max(0,Math.min(1,(cameraZ+10)/980)),elapsed:now-phaseAt,introElapsed:startedAt===null?0:now-startedAt,
        instruction:phase==='clock'?'按住画面，继续前进':phase==='clock-ready'?'Play':phase==='ready'?'Play':phase==='entry'?(boss==='igallta'?'触碰画面，开始重演':boss==='spasmodic'?'touch to start':'触碰画面，继续'):phase==='complete'?(result?.passed?'重演完成':'重演未通过'):''});
    }
    emit({type:'scene',scene,phase});
    if(boss==='rrharil'){clip='time_reverse';emit({type:'play-clip',id:clip,loop:false});}
    else {if(spec.loop){clip=spec.loop;emit({type:'play-clip',id:clip,loop:true});}wait();}
    function input(action,payload={}) {
      if(cancelled||phase==='complete')return drain();
      if(action==='cancel'){cancelled=true;change('cancelled');emit({type:'stop-clip'});emit({type:'return-selection',reason:'cancelled'});return drain();}
      if(action==='hold-start')held=true;
      if(action==='hold-end')held=false;
      if(action==='activate'&&phase==='clock-ready'){change('clock-exit');return drain();}
      if(action==='activate'&&phase==='ready'){change('song-start');return drain();}
      if(action==='activate'&&phase==='entry'&&sceneTime>=spec.guard) {
        change('intro');activationAt=now;startedAt=boss==='spasmodic'?now:null;clip=spec.clip;emit({type:'stop-clip'});
        if(boss==='spasmodic')emit({type:'transition',name:'VideoIn',duration:0.75});
        else emit({type:'play-clip',id:clip,loop:false});
      }
      return drain();
    }
    function update(frame={}) {
      if(cancelled||phase==='complete')return drain();
      const previousPhase=phase;
      const dt=Math.max(0,number(frame.deltaTime,0));now+=dt;sceneTime+=dt;
      // sceneTime is relative to the scene emitted by this controller.
      if(Number.isFinite(frame.sceneTime))sceneTime=Math.max(0,frame.sceneTime);
      if(typeof frame.held==='boolean')held=frame.held;
      if(phase==='intro'&&boss==='spasmodic'&&activationAt!==null&&now-activationAt>=0.75){activationAt=null;emit({type:'play-clip',id:clip,loop:false});}
      if(phase==='reverse'&&startedAt===null&&frame.videoPlaying===true&&number(frame.videoTime)>=0.01&&(!frame.clipId||frame.clipId===clip))startedAt=now;
      if(phase==='reverse'&&startedAt!==null&&now-startedAt>9){
        startedAt=null;clip=null;change('clock','RrharilEventLevelStart001');emit({type:'stop-clip'});emit({type:'wait-input',action:'hold-start',scene});
      }
      if(phase==='clock'&&previousPhase==='clock'){
        // Native Update applies one Mathf.Lerp per rendered frame. There is no
        // coordinate test: any active touch sets the two serialized targets.
        if(cameraZ>970){cameraZ=970;change('clock-ready');wait('activate',0);}
        else {const target=held?200:0,lerp=held?200:16;cameraSpeed+=(target-cameraSpeed)*Math.min(1,60/lerp*dt);cameraZ+=cameraSpeed*dt;}
      }
      if(phase==='clock-exit'&&now-phaseAt>0.6700000166893005){change('entry','RrharilUnlock');wait('activate');}
      if(phase==='intro'&&startedAt===null&&frame.videoPlaying===true&&number(frame.videoTime)>=0.01&&(!frame.clipId||frame.clipId===clip))startedAt=now;
      if(phase==='intro'&&startedAt!==null&&now-startedAt>spec.introSeconds){
        if(boss==='rrharil'){change('ready');wait('activate',0);}else startSong();
      }
      if(phase==='song-start'&&now-phaseAt>0.5)startSong(spec.songKey,'001UiChange');
      return drain();
    }
    function finish(value={}) {
      if(cancelled||phase!=='playing')return drain();
      const score=Number(value.score);
      if(!Number.isFinite(score)||score<0||score>1000000)throw Error('A real chart score is required');
      result=Object.freeze({...value,score,passed:score>=700000});change('complete','SettleAccounts');
      emit({type:'complete',boss,tier,result});return drain();
    }
    return Object.freeze({update,input,finish,drain,snapshot,get state(){return snapshot();}});
  }
  const api=Object.freeze({BOSSES,TIERS,routeForSong,create});
  globalThis.PhiBossReplayRules=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
