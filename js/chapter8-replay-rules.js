/* Historical chapter 8 control rules, recovered from the modified 3.0.0.1 ARM64
 * archive. This is not a claim of parity with current official 4.x. Pure control
 * state only: the host owns chart judgement, audio, video, drawing and routing.
 * No localStorage or real unlock/save writes occur here. See the evidence note.
 */
(function (root) {
  'use strict';
  const F = Math.fround;
  const LUMI = Object.freeze({eventStart:86.08699798583984,eventEnd:96.52100372314453,
    scoreCheck:130.4340057373047,shoot:130.5,explode:133,stop:150,
    targets:Object.freeze({EZ:684796.5,HD:677965.5,IN:784842.8125}),ambientFlash:14.7});
  const HP = Object.freeze({
    1:{EZ:{begin:.9,loss:.001628459272,note:.012},HD:{begin:.7,loss:.001835141443,note:.013},IN:{begin:.6,loss:.002103500983,note:.015}},
    2:{EZ:{begin:1,loss:.000284977021,Miss:-.03,Bad:-.03,Good:.0024,Perfect:.0048},HD:{begin:1,loss:.000576304506,Miss:-.04,Bad:-.04,Good:.0026,Perfect:.0052},IN:{begin:1,loss:.000897002881,Miss:-.06,Bad:-.06,Good:.003,Perfect:.006}}
  });
  const TIMES = Object.freeze({phase1Start:101.68419647216797,phase2Start:40.421051025390625,
    phase2Lock:101.68419647216797,deathDelay:1.5,blackScreen:2,lockAnimation:1,
    phase2Outro:1.7999999523162842,touchPrepare:3,touchPause:1.5,touchResume:2.066,
    touchDuration:3.1666666666666665,unlockDuration:47,videoLead:.5,betweenVideos:.20000000298023224,
    infoAt:26.8,d321InfoAt:11.56666666});
  const MESSAGES=Object.freeze(['你也许也意识到了这件事。','旅船是掩盖未来的虚像，战车正指引着我们的命运。','硬币掷出之后，正逆的转换从未停止。','前方是毁灭亦是重生。']);
  const ENDINGS=Object.freeze({dfBlack:4,qdDuration:24.066666666666666,qdMessageGate:21.15,
    captions:Object.freeze([{time:14.4,text:'...九....鸟..'},{time:15.85,text:'...鸠...!'},
      {time:18.4,text:'......喂？'},{time:20.15,text:'...听得到吗？'},{time:21.9,text:'鸠？！'}].map(Object.freeze)),
    qdMessage:'O Fortuna velut luna statu variabilis……',creditsDuration:321,
    creditsClip1:127,creditsClip2:194,creditsAutomaticBack:327,creditsLeave:0.6600000262260437,
    creditsSkipDuration:1.5,destructionEnd:156.14999389648438,destructionDuration:4});
  const freezeEvents = events => Object.freeze(events.map(event => Object.freeze(event)));
  function number(value,label) { if(typeof value!=='number'||!Number.isFinite(value))throw new TypeError(label+' must be finite');return value; }
  function keyOf(value) {
    const key=String(value).toLowerCase().replace(/[ _]/g,'-');
    const aliases={'luminescence':'luminescence','lumi':'luminescence','retribution':'retribution-phase1',
      'retribution-1':'retribution-phase1','retribution-phase1':'retribution-phase1',
      'retribution-2':'retribution-phase2','retribution-phase2':'retribution-phase2',
      'df-unlock':'df-unlock','dfunlock':'df-unlock','distorted-fate':'distorted-fate',
      'distortedfate':'distorted-fate','d321-unlock':'d321-unlock','321unlock':'d321-unlock',
      'destruction-321':'destruction-321','the-chariot':'the-chariot','thechariot':'the-chariot',
      'qd':'qd-event','qdevent':'qd-event','qd-event':'qd-event','about-us':'about-us','aboutus':'about-us'};
    if(!aliases[key])throw new RangeError('Unsupported chapter 8 replay: '+value);
    return aliases[key];
  }
  // ScoreControl.Update 0x2206504..0x22065c8. Each instruction uses s-registers.
  function rawScore(perfect,good,maxCombo,total,accuracyOnly) {
    for(const [name,value] of Object.entries({perfect,good,maxCombo,total}))number(value,name);
    if(total<=0)return 0;
    const ratio=F(F(F(F(good)*F(.65))+F(perfect))/F(total));
    return accuracyOnly?F(ratio*1000000):F(F(ratio*900000)+F(F(F(maxCombo)*100000)/F(total)));
  }
  // Original sharedassets21 AnimationClip pathID 3, m_Color.a, four linear keys.
  function creditsSkipOpacity(time) {
    if(time<=0)return 0;
    if(time<F(.05))return time*8;
    if(time<=.5)return F(.4);
    return Math.min(1,F(.4)+(time-.5)*F(.6));
  }
  function createController(songKey,difficulty,options) {
    songKey=keyOf(songKey);difficulty=String(difficulty||'IN').toUpperCase();options=options||{};
    const entrySongKey=songKey;
    if(!LUMI.targets[difficulty])throw new RangeError('Historical rules verify EZ, HD and IN only');
    const rng=typeof options.random==='function'?options.random:Math.random;
    const state={songKey,difficulty,scene:songKey==='df-unlock'?'DFUnlock':songKey==='d321-unlock'?'321Unlock':songKey==='qd-event'?'QDEvent':songKey==='about-us'?'AboutUs':'Level',
      phase:songKey==='retribution-phase1'?1:songKey==='retribution-phase2'?2:null,
      stage:songKey==='df-unlock'?'df-prepare':songKey==='d321-unlock'?'d321-prepare':songKey==='qd-event'?'qd-prepare':songKey==='about-us'?'credits-wait':'playing',
      time:0,rawScore:0,sceneTime:0,hp:null,totalNoteAffect:0,dead:false,locked:false,awaitingInput:false,
      eventActive:false,stage1Failed:false,stage2Failed:false,scoreCheckComplete:false,timeTag:0,
      targetScore:songKey==='luminescence'?LUMI.targets[difficulty]:songKey==='the-chariot'?920000:null,complete:false,
      outro:TIMES.phase2Outro,videoTime:0,clip:null,flags:{},messageIndex:0,
      subtitle:'',creditsProgress:0,creditsTime:0,skipOpacity:0};
    if(songKey==='about-us')state.awaitingInput=true;
    if(state.phase)state.hp=HP[state.phase][difficulty].begin;
    let started=false,pending=null,stageElapsed=0,hideElapsed=null,lockElapsed=null;
    let messageElapsed=null,messageWait=0,messageIntro=true,ambientStarted=false,flashIndex=-1,flashElapsed=0;
    let messageTexts=MESSAGES,messageTail=false,messageFinished=false,captionIndex=0,captionElapsed=null;
    let creditsHeld=false,creditsClip=0,skipTime=0,skipSpeed=1,skipPlaying=false;
    const flashSequence=[{glitch:.5,duration:F(.2)},{glitch:0,duration:F(.1)},
      {glitch:1,duration:.5},{glitch:0,duration:F(.1)},
      {glitch:3,exposure:0,contrast:-.5,duration:.5},{glitch:.5,duration:F(.1)}];
    const emitFlag=(events,key)=>{state.flags[key]=true;events.push({type:'chapter-flag',key,value:true,persist:false});};
    const go=(stage)=>{state.stage=stage;stageElapsed=0;};
    function next(events,key,phase) {
      if(state.complete)return;
      state.complete=true;state.awaitingInput=false;state.stage='next-song';
      events.push({type:'next-song',songKey:key,difficulty,phase:phase||null});
    }
    function changeScene(events,scene) {
      state.scene=scene;state.sceneTime=0;stageElapsed=0;state.awaitingInput=false;
      // Unity destroys the previous scene's UI/effect components here.
      for(const key of ['blackOpacity','hudOpacity','lockProgress','infoVisible'])delete state[key];
      hideElapsed=null;lockElapsed=null;state.hp=null;state.locked=false;state.dead=false;
      events.push({type:'scene',scene});
      if(scene==='DFUnlock'){state.songKey='df-unlock';state.phase=null;state.stage='df-prepare';state.clip=null;state.videoTime=0;}
      else if(scene==='321Unlock'){state.songKey='d321-unlock';state.phase=null;state.stage='d321-prepare';state.clip=null;state.videoTime=0;}
      else if(scene==='QDEvent'){state.songKey='qd-event';state.phase=null;state.stage='qd-prepare';state.clip=null;state.videoTime=0;state.subtitle='';captionIndex=0;captionElapsed=null;}
      else if(scene==='AboutUs'){state.songKey='about-us';state.phase=null;state.stage='credits-wait';state.awaitingInput=true;state.subtitle='';events.push({type:'await-input',input:'touch',instruction:'点击开始制作人员名单'});}
      else {state.stage='failed';state.complete=true;}
    }
    function black(events,target,reason,duration) {
      duration=duration===undefined?TIMES.blackScreen:duration;
      pending={remaining:duration,target};go('black-screen');
      events.push({type:'black-screen',duration,target,reason});
    }
    function play(events,clip,seek) {
      state.clip=clip;state.videoTime=seek||0;
      events.push({type:'play-clip',clip,seek:seek||0});
    }
    function startMessages(events,texts) {
      messageElapsed=0;messageWait=1;messageIntro=true;state.messageIndex=0;
      messageTexts=texts||MESSAGES;messageTail=false;messageFinished=false;
      events.push({type:'messages-start'});
    }
    function messages(events,dt) {
      if(messageElapsed===null)return;
      messageElapsed+=dt;
      if(messageElapsed<messageWait)return;
      messageElapsed=0;
      if(messageTail){messageElapsed=null;messageFinished=true;events.push({type:'messages-end'});return;}
      if(messageIntro){messageIntro=false;events.push({type:'message-ambient-play',fadeIn:1,volume:1,loop:true});messageWait=4.5+2*Math.max(0,Math.min(1,number(rng(),'random')));return;}
      if(state.messageIndex<messageTexts.length){
        const index=state.messageIndex++;
        events.push({type:'message',index,text:messageTexts[index]});
        if(index===1&&messageTexts===MESSAGES&&!ambientStarted){ambientStarted=true;events.push({type:'ambient-play',fadeIn:1});}
        messageWait=4.5+2*Math.max(0,Math.min(1,number(rng(),'random')));
      }else{messageTail=true;messageWait=.5;events.push({type:'message-hide',duration:.5});}
    }
    function luminescence(events,frame,dt) {
      const now=state.time;
      state.eventActive=now>=LUMI.eventStart&&now<=LUMI.eventEnd;
      if(now>=LUMI.scoreCheck&&!state.scoreCheckComplete){
        state.stage2Failed=state.rawScore<state.targetScore;state.scoreCheckComplete=true;
        events.push({type:'score-check',passed:!state.stage2Failed,score:state.rawScore,target:state.targetScore});
      }
      if(!state.stage1Failed&&!state.stage2Failed){
        if(now>LUMI.shoot&&state.timeTag===0){state.timeTag=1;hideElapsed=0;events.push({type:'particle',name:'ShootUp',playing:true},{type:'hud',visible:false,duration:1});}
        if(now>LUMI.explode&&state.timeTag===1){state.timeTag=2;events.push({type:'particle',name:'Explode',playing:true});}
        if(now>LUMI.stop&&state.timeTag===2){state.timeTag=3;go('lumi-ambient-wait');
          events.push({type:'particle',name:'ShootUp',playing:false},{type:'particle',name:'Explode',playing:false});startMessages(events);}
      }
      if(hideElapsed!==null){hideElapsed+=dt;state.hudOpacity=Math.max(0,1-hideElapsed);}
      messages(events,dt);
      if(state.stage==='lumi-ambient-wait'&&frame.ambientTime!==undefined&&F(frame.ambientTime)>=LUMI.ambientFlash){
        flashIndex=0;flashElapsed=0;go('lumi-flash');events.push({type:'post-effect',...flashSequence[0]});
      }else if(state.stage==='lumi-flash'){
        flashElapsed+=dt;
        if(flashElapsed>=flashSequence[flashIndex].duration){
          flashElapsed=0;flashIndex++;
          if(flashIndex<flashSequence.length)events.push({type:'post-effect',...flashSequence[flashIndex]});
          else {go('lumi-audio-end');events.push({type:'post-effect',exposure:1,contrast:1});}
        }
      }else if(state.stage==='lumi-audio-end'&&frame.ambientPlaying===false)go('lumi-final-wait');
      else if(state.stage==='lumi-final-wait'&&stageElapsed>=.5){
        if(entrySongKey==='the-chariot')black(events,'retribution-phase1','chariot-unlock');
        else {emitFlag(events,'C8LuminescenceUnlocked');black(events,'retribution-phase2','luminescence-unlock');}
      }
    }
    function retribution(events,frame,dt) {
      const phase=state.phase,config=HP[phase][difficulty];
      if(state.dead)return;
      if(state.locked){
        if(lockElapsed!==null){lockElapsed=F(lockElapsed+F(dt));state.lockProgress=Math.min(1,lockElapsed/TIMES.lockAnimation);}
        const audioTime=frame.audioTime===undefined?state.time:frame.audioTime;
        if(Number.isFinite(frame.clipLength)&&audioTime>F(F(frame.clipLength)-6.5))state.outro=Math.max(0,F(state.outro-F(dt)));
        state.blackOpacity=1-state.outro/TIMES.phase2Outro;
        if(state.outro===0&&frame.audioPlaying===false)changeScene(events,'DFUnlock');
        return;
      }
      const elapsed=F(state.time-TIMES[phase===1?'phase1Start':'phase2Start']);
      if(elapsed<0)return;
      // Native phase 2 checks lock before HP, and skips death on this frame.
      if(phase===2&&state.time>TIMES.phase2Lock){state.locked=true;state.stage='locked';lockElapsed=0;state.lockProgress=0;events.push({type:'hp-lock',hp:state.hp,duration:TIMES.lockAnimation});return;}
      const loss=((config.loss*-.5)*elapsed)*elapsed;
      const raw=state.totalNoteAffect+(config.begin+loss);
      state.hp=Math.min(1,raw);
      if(raw>1)state.totalNoteAffect-=raw-1;
      if(raw<=0){
        state.dead=true;go('death-delay');pending={remaining:TIMES.deathDelay,target:phase===1?'phase1-death':'phase2-death'};
        events.push({type:'death',phase,continues:phase===1},{type:'red-flash'},{type:'audio-fade',duration:1});
      }
    }
    function dfUnlock(events,frame) {
      const time=state.videoTime,playing=frame.videoPlaying,prepared=frame.videoPrepared!==false;
      switch(state.stage){
        case 'df-prepare':if(stageElapsed>=TIMES.touchPrepare){play(events,'DF_Touch2Start');go('df-touch-lead');}break;
        case 'df-touch-lead':if(time>=TIMES.touchPause&&prepared){go('df-touch-wait');state.awaitingInput=true;events.push({type:'pause-video',clip:'DF_Touch2Start'},{type:'await-input',input:'touch'});}break;
        case 'df-touch-resuming':if(playing===true)go('df-touch-ending');break;
        case 'df-touch-ending':if(time>=(frame.videoDuration||TIMES.touchDuration)-TIMES.videoLead){events.push({type:'black-mask',visible:true});go('df-touch-stop');}break;
        case 'df-touch-stop':if(playing===false){events.push({type:'stop-clip',clip:'DF_Touch2Start'});go('df-between');}break;
        case 'df-between':if(stageElapsed>=TIMES.betweenVideos)go('df-unlock-prepare');break;
        case 'df-unlock-prepare':if(prepared){play(events,'DF_Unlock');go('df-unlock-playing');}break;
        case 'df-unlock-playing':if(playing===true&&time>=.005){events.push({type:'black-mask',visible:false});go('df-unlock-main');}break;
        case 'df-unlock-main':
          if(!state.infoVisible&&time>=TIMES.infoAt){state.infoVisible=true;events.push({type:'music-info',visible:true,songKey:'distorted-fate',difficulty});}
          if(time>=(frame.videoDuration||TIMES.unlockDuration)-TIMES.videoLead){events.push({type:'black-mask',visible:true});go('df-unlock-stop');}break;
        case 'df-unlock-stop':if(playing===false)black(events,'distorted-fate','df-unlock-complete');break;
      }
    }
    function d321Unlock(events,frame) {
      switch(state.stage){
        case 'd321-prepare':if(frame.videoPrepared!==false){play(events,'321_Unlock');go('d321-starting');}break;
        case 'd321-starting':if(frame.videoPlaying===true)go('d321-playing');break;
        case 'd321-playing':
          if(!state.infoVisible&&state.videoTime>=TIMES.d321InfoAt){state.infoVisible=true;events.push({type:'music-info',visible:true,songKey:'destruction-321',difficulty});}
          if(frame.videoPlaying===false)black(events,'destruction-321','321-unlock-complete');break;
      }
    }
    function qdEvent(events,frame,dt) {
      if(captionElapsed!==null){captionElapsed+=dt;if(captionElapsed>=1){captionElapsed=null;state.subtitle='';events.push({type:'subtitle',text:''});}}
      if(['qd-main','qd-message-gate','qd-messages'].includes(state.stage)&&captionElapsed===null&&captionIndex<ENDINGS.captions.length){
        const caption=ENDINGS.captions[captionIndex];
        if(state.videoTime>=caption.time){captionIndex++;captionElapsed=0;state.subtitle=caption.text;events.push({type:'subtitle',text:caption.text,duration:1});}
      }
      switch(state.stage){
        case 'qd-prepare':if(frame.videoPrepared!==false){play(events,'QD');go('qd-starting');}break;
        case 'qd-starting':if(frame.videoPlaying===true)go('qd-first-frame');break;
        case 'qd-first-frame':if(state.videoTime>=.005){events.push({type:'black-mask',visible:false});go('qd-main');}break;
        // The original sequential WaitUntils check video length-.5 BEFORE 21.15.
        case 'qd-main':if(state.videoTime>=(frame.videoDuration||ENDINGS.qdDuration)-.5)go('qd-message-gate');break;
        case 'qd-message-gate':if(state.videoTime>=ENDINGS.qdMessageGate){startMessages(events,[ENDINGS.qdMessage]);go('qd-messages');}break;
        case 'qd-messages':
          messages(events,dt);
          if(messageFinished){go('qd-ambient-fade');events.push({type:'message-ambient-stop',duration:2});}
          break;
        case 'qd-ambient-fade':if(stageElapsed>=2)black(events,'AboutUs','qd-event-complete',.5);break;
      }
    }
    function leaveCredits(events) {
      if(state.stage==='credits-leave')return;
      emitFlag(events,'chapter8Passed');emitFlag(events,'C8DistortedFateUnlocked');
      state.awaitingInput=false;creditsHeld=false;go('credits-leave');
      pending={remaining:ENDINGS.creditsLeave,target:'chapter-select'};
      events.push({type:'credits-exit',duration:ENDINGS.creditsLeave,nativeScene:'BootScene'});
    }
    function credits(events,frame,dt) {
      if(state.stage!=='credits-playing')return;
      // Browser transport only: loading an external track freezes the scroll,
      // while the original hold/release animation remains responsive.
      state.creditsAudioLoading=!!frame.audioLoading;
      state.creditsTime=F(state.creditsTime+F(frame.audioLoading?0:dt));
      state.creditsProgress=Math.min(1,state.creditsTime/ENDINGS.creditsDuration);
      if(skipPlaying){skipTime=Math.max(0,Math.min(ENDINGS.creditsSkipDuration,F(skipTime+F(dt*skipSpeed))));if(skipTime===0)skipPlaying=false;}
      state.skipOpacity=creditsSkipOpacity(skipTime);
      if(Number.isFinite(frame.skipOpacity))state.skipOpacity=frame.skipOpacity;
      if(creditsHeld&&state.skipOpacity>F(.99)){leaveCredits(events);return;}
      if(creditsHeld&&!skipPlaying){skipPlaying=true;skipTime=0;skipSpeed=1;}
      else if(!creditsHeld&&skipPlaying)skipSpeed=skipTime/ENDINGS.creditsSkipDuration>F(.33)?-6:-1;
      if(creditsClip===0&&state.creditsTime>ENDINGS.creditsClip1){creditsClip=1;events.push({type:'credits-audio',track:1});}
      if(creditsClip===1&&state.creditsTime>ENDINGS.creditsDuration){creditsClip=2;events.push({type:'credits-audio-stop'});}
      if(state.creditsTime>ENDINGS.creditsAutomaticBack)leaveCredits(events);
    }
    function destruction(events,dt) {
      if(state.stage==='playing'&&state.time>ENDINGS.destructionEnd){
        go('destruction-stutter');events.push({type:'audio-stutter',duration:4,interval:.03125,pitch:.75});
      }else if(state.stage==='destruction-stutter'&&stageElapsed>ENDINGS.destructionDuration){
        for(const key of ['C8TheChariotREVIIVALUnlocked','C8RetributionUnlocked','C8DESTRUCTION321Unlocked','chapter8UnlockSecondPhase'])emitFlag(events,key);
        if(difficulty==='IN'&&Math.round(state.rawScore)>=920000)emitFlag(events,'DESTRUCTION321INSGrade');
        state.awaitingInput=true;go('destruction-dialog');
        events.push({type:'audio-stop'},{type:'dialog',title:'PhigrOS已崩溃',text:'模拟结束，谢谢你的参与。',button:'好',action:'confirm'});
      }
    }
    function update(frame) {
      frame=frame||{};const events=[];
      if(state.complete)return freezeEvents(events);
      const dt=frame.deltaTime===undefined?0:Math.max(0,number(frame.deltaTime,'deltaTime'));
      if(frame.time!==undefined)state.time=F(number(frame.time,'time'));
      if(frame.rawScore!==undefined)state.rawScore=F(number(frame.rawScore,'rawScore'));
      if(frame.videoTime!==undefined)state.videoTime=number(frame.videoTime,'videoTime');
      state.sceneTime+=dt;stageElapsed+=dt;
      if(!started){started=true;if(state.scene!=='Level')events.push({type:'scene',scene:state.scene});}
      if(pending){
        pending.remaining-=dt;
        if(pending.remaining<=0){const target=pending.target;pending=null;
          if(target==='phase1-death'){events.push({type:'record',fillRemainingMisses:true});black(events,'321Unlock','phase1-death');}
          else if(target==='phase2-death'){events.push({type:'record',fillRemainingMisses:true});changeScene(events,'Loading');}
          else if(['321Unlock','DFUnlock','Loading','QDEvent','AboutUs'].includes(target))changeScene(events,target);
          else if(target==='chapter-select'){state.complete=true;state.stage='complete';events.push({type:'return-selection',nativeScene:'BootScene',reason:'credits-complete'});}
          else next(events,target,target==='retribution-phase2'?2:target==='retribution-phase1'?1:null);
        }
        return freezeEvents(events);
      }
      if(state.songKey==='luminescence')luminescence(events,frame,dt);
      else if(state.songKey==='the-chariot'&&state.stage.indexOf('lumi-')===0)luminescence(events,frame,dt);
      else if(state.songKey==='the-chariot'&&state.stage==='chariot-black-fade'){
        messages(events,dt);state.blackOpacity=Math.min(1,stageElapsed);
        if(stageElapsed>=1)go('lumi-ambient-wait');
      }
      else if(state.phase)retribution(events,frame,dt);
      else if(state.songKey==='df-unlock')dfUnlock(events,frame);
      else if(state.songKey==='d321-unlock')d321Unlock(events,frame);
      else if(state.songKey==='qd-event')qdEvent(events,frame,dt);
      else if(state.songKey==='about-us')credits(events,frame,dt);
      else if(state.songKey==='destruction-321')destruction(events,dt);
      else if(state.songKey==='the-chariot'&&state.time>=145.5&&!state.scoreCheckComplete){
        state.scoreCheckComplete=true;state.stage2Failed=state.rawScore<920000;
        events.push({type:'score-check',passed:!state.stage2Failed,score:state.rawScore,target:920000});
        if(!state.stage2Failed){state.timeTag=3;go('chariot-black-fade');startMessages(events);events.push({type:'hud',visible:false,duration:1});}
      }
      return freezeEvents(events);
    }
    function judge(kind,time) {
      if(!['Perfect','Good','Bad','Miss'].includes(kind))throw new RangeError('Unknown judgement');
      if(state.complete||state.dead)return freezeEvents([]);
      if(state.songKey==='luminescence'&&(kind==='Bad'||kind==='Miss')&&state.eventActive)state.stage1Failed=true;
      if(state.phase){
        const callbackTime=time===undefined?state.time:F(number(time,'judgement time'));
        const elapsed=F(callbackTime-TIMES[state.phase===1?'phase1Start':'phase2Start']);
        if(elapsed>=0){const config=HP[state.phase][difficulty];
          state.totalNoteAffect+=state.phase===2?config[kind]:config.note*Math.max(1-.025956284153*elapsed,0)*({Miss:-1,Bad:-1,Good:.2,Perfect:.4}[kind]);
        }
      }
      return freezeEvents([]);
    }
    function input(kind) {
      const events=[];kind=kind||'touch';
      if(kind==='exit'){state.complete=true;state.awaitingInput=false;state.stage='exited';events.push({type:'exit',scene:'chapter-select'});}
      else if((kind==='touch'||kind==='start')&&state.stage==='df-touch-wait'){
        state.awaitingInput=false;go('df-touch-resuming');state.videoTime=TIMES.touchResume;
        events.push({type:'seek-video',clip:'DF_Touch2Start',time:TIMES.touchResume});play(events,'DF_Touch2Start',TIMES.touchResume);
      }
      else if(state.stage==='destruction-dialog'&&(kind==='confirm'||kind==='touch')){
        state.complete=true;state.awaitingInput=false;go('complete');events.push({type:'return-selection',nativeAction:'Application.Quit',reason:'destruction-simulation-ended'});
      }
      else if(state.songKey==='about-us'){
        if((kind==='touch'||kind==='start')&&state.stage==='credits-wait'&&state.sceneTime>=1){
          state.awaitingInput=false;state.creditsTime=0;state.creditsProgress=0;go('credits-playing');
          events.push({type:'chapter-string',key:'GameCompleted',value:'3.0',persist:false},{type:'credits-start',asset:'assets/vision-replay/chapter8-about-us.json',duration:ENDINGS.creditsDuration},{type:'credits-audio',track:0});
        }else if(kind==='hold-start'&&state.stage==='credits-playing')creditsHeld=true;
        else if(kind==='hold-end')creditsHeld=false;
        else if(kind==='back'&&state.stage==='credits-playing')leaveCredits(events);
      }
      return freezeEvents(events);
    }
    function finish(result) {
      if(state.complete)return freezeEvents([]);
      if(state.songKey==='distorted-fate'&&state.stage==='playing'){
        const events=[{type:'record',fillRemainingMisses:false}];
        const score=Number.isFinite(result&&result.score)?result.score:Math.round(state.rawScore);
        if(difficulty==='IN'&&score>=920000)emitFlag(events,'DistortedFateINSGrade');
        black(events,'QDEvent','distorted-fate-complete',ENDINGS.dfBlack);
        return freezeEvents(events);
      }
      // The host must keep ticking cinematic stages after chart/audio completion.
      if(state.phase===2)return update({audioPlaying:false});
      if(state.dead||state.stage!=='playing')return freezeEvents([]);
      state.complete=true;state.stage='result';
      return freezeEvents([{type:'result',songKey:state.songKey,difficulty,
        unlockPassed:!state.stage1Failed&&!state.stage2Failed}]);
    }
    function snapshot() {return Object.freeze({...state,flags:Object.freeze({...state.flags})});}
    return Object.freeze({update,judge,input,finish,snapshot});
  }
  const api=Object.freeze({provenance:'historical-modified-3.0.0.1',LUMI,TIMES,ENDINGS,rawScore,creditsSkipOpacity,createController});
  root.PhiChapter8ReplayRules=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})(typeof globalThis!=='undefined'?globalThis:this);
