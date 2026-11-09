/* Chapter scenes own real input, media clocks and chart transitions. */
(() => {
  'use strict';
  const clean=value=>String(value||'').toLowerCase().replace(/·\s*联网/g,'').replace(/[^a-z0-9]/g,'');
  function songKey(entry) {
    const value=clean(typeof entry==='string'?entry:entry?.meta?.name||entry?.name||entry?.songKey);
    if(value.includes('haocore')||entry?.meta?.difficultyClass==='SP')return null;
    const names=[['distortedfate','distorted-fate'],['destruction321','destruction-321'],['thechariot','the-chariot'],['luminescence','luminescence'],['retribution','retribution'],['spasmodic','spasmodic'],['igallta','igallta'],['rrharil','rrharil'],['clockparadox','clock-paradox'],['chronostasis','chronostasis'],['glaciaxion','glaciaxion']];
    const canonical=/^retributionphase[12]$/.test(value)?'retribution':value;
    return names.find(([name])=>canonical===name)?.[1]||null;
  }
  function routeForSong(entry) {
    const key=songKey(entry),tier=String(entry?.meta?.difficultyClass||'IN').toUpperCase();
    if(!['EZ','HD','IN','AT'].includes(tier))return null;
    if(['spasmodic','igallta','rrharil'].includes(key))return {key,chapter:({spasmodic:5,igallta:6,rrharil:7})[key],family:'boss',tier};
    if(['distorted-fate','the-chariot','luminescence','retribution','destruction-321'].includes(key))return {key,chapter:8,family:'chapter8',tier,controller:({'distorted-fate':'df-unlock','retribution':'retribution-phase1','destruction-321':'d321-unlock'})[key]||key};
    return null;
  }
  function createRuntime(adapter={}, env=globalThis) {
    let active=null,serial=0,raf=0,lastFrame=0,ui=null;
    const notify=()=>adapter.onChange?.(active?{...active.route,id:active.id,scene:active.scene,phase:active.rule?.snapshot().phase}:null);
    const isCurrent=s=>active===s&&!s.abort.signal.aborted;
    const fail=(s,error)=>{if(isCurrent(s)){s.error=String(error?.message||error);env.console?.error?.('Chapter replay failed',error);adapter.onError?.(error);cancel(true);}};
    function surface(){return ui||=(adapter.ui||createSurface({input,cancel,error:error=>{if(active)fail(active,error);}},env));}
    function cancel(returnToLibrary=true){
      const previous=active;active=null;serial++;lastFrame=0;
      if(raf)env.cancelAnimationFrame?.(raf);raf=0;
      previous?.abort.abort();ui?.stop();ui?.hide();ui?.disposeGame();ui?.stopAmbient?.();
      if(previous){adapter.cancelPreparation?.(previous.id);adapter.stopSong?.(previous.id);}
      if(returnToLibrary&&previous)adapter.onExit?.();notify();
    }
    function tick(now){
      raf=0;const s=active;if(!s)return;
      const dt=lastFrame?Math.max(0,Math.min(0.1,(now-lastFrame)/1000)):0;lastFrame=now;
      if(!env.document?.hidden&&!s.engine&&!s.loading&&s.rule&&!s.completed){
        const media=surface().mediaState(),step=media.mediaLoading||media.mediaBlocked?0:dt;
        if(!media.mediaLoading&&!media.mediaBlocked){
          s.sceneTime+=step;
          try{dispatch(s,s.rule.update({...s.lastSongFrame,time:s.scene==='Level'?(s.lastSongFrame?.time||0):s.sceneTime,sceneTime:s.sceneTime,deltaTime:step,...media,held:s.held}));surface().paint(s.rule.snapshot());}catch(error){fail(s,error);}
        }
      }
      if(isCurrent(s))raf=env.requestAnimationFrame?.(tick)||0;
    }
    async function begin(entry){
      const route=routeForSong(entry);if(!route)return false;
      cancel(false);const s={id:++serial,entry,route,abort:new AbortController(),scene:'',sceneTime:0,held:false,engine:null,loading:false,trackSerial:0};active=s;
      surface().show(route);surface().status('');
      try{
        await adapter.prepare?.(route,s.abort.signal);if(!isCurrent(s))return false;
        const tier=route.tier==='AT'?'IN':route.tier;
        s.rule=route.family==='boss'?env.PhiBossReplayRules.create({boss:route.key,tier:route.tier}):env.PhiChapter8ReplayRules.createController(route.controller,tier);
        surface().status('');dispatch(s,s.rule.drain?.()||s.rule.update({time:0,deltaTime:0}));
        if(route.family==='chapter8'&&!['df-unlock','d321-unlock'].includes(route.controller))await playTrack(s,{songKey:route.key,difficulty:route.tier,phase:route.controller});
        if(!isCurrent(s))return false;notify();raf=env.requestAnimationFrame?.(tick)||0;return true;
      }catch(error){fail(s,error);return false;}
    }
    function input(action='activate'){
      const s=active;if(!s?.rule||s.error)return;
      if(action==='hold-start')s.held=true;if(action==='hold-end')s.held=false;
      try{dispatch(s,s.rule.input(s.route.family==='chapter8'?(action==='activate'?'touch':action):action));surface().paint(s.rule.snapshot());}catch(error){fail(s,error);}
    }
    async function playTrack(s,event){
      if(!isCurrent(s))return;
      const token=++s.trackSerial;s.loading=true;s.engine=null;surface().stop();surface().scene('Level');surface().hide();
      adapter.stopSong?.(s.id);surface().disposeGame();surface().stopAmbient?.();
      try{
        const tier=songKey(event.songKey)===s.route.key?s.route.tier:event.difficulty||event.tier||s.route.tier;
        const next=adapter.findEntry?.(event.songKey,tier,s.entry);
        if(!next)throw Error('重演所需谱面暂不可用：'+event.songKey);
        s.currentSong=songKey(next);s.currentPhase=event.phase||s.rule.snapshot().phase;s.scene='Level';
        const engine=await adapter.startSong(next,{visionContinuation:true,visionReplay:{id:s.id,chapter:s.route.chapter,phase:s.currentPhase,songKey:s.currentSong}});
        if(!isCurrent(s)||token!==s.trackSerial){adapter.stopSong?.(s.id);return;}
        if(!engine)throw Error('重演谱面未能启动');s.engine=engine;s.loading=false;notify();
      }catch(error){s.loading=false;if(isCurrent(s)){surface().show(s.route);fail(s,error);}}
    }
    function dispatch(s,events){
      for(const event of events||[]){
        if(!isCurrent(s))break;
        const type=event.type;
        if(type==='scene'){
          s.scene=event.scene;s.sceneTime=0;s.held=false;
          if(event.scene==='Loading'){adapter.onFailure?.(s.engine,event);cancel(true);break;}
          if(!['Level','SettleAccounts'].includes(event.scene)){
            if(s.engine){adapter.stopSong?.(s.id);s.engine=null;}
            surface().show(s.route);surface().scene(event.scene,event.phase);surface().status('');
          }
          notify();
        }else if(type==='play-clip'){
          const clip=event.id||event.clip;
          surface().show(s.route);surface().play(clip,{...event,signal:s.abort.signal,isCurrent:()=>isCurrent(s)}).catch(error=>fail(s,error));
        }else if(type==='stop-clip')surface().stop();
        else if(['seek-video','seek-clip'].includes(type))surface().seek(event.time??event.seek??0,event.play!==false);
        else if(['pause-video','pause-clip'].includes(type))surface().pause();
        else if(['resume-video','resume-clip'].includes(type))surface().resume().catch(error=>fail(s,error));
        else if(['next-song','start-song'].includes(type)){
          if(s.route.family==='chapter8'){
            const key=event.phase===2?'retribution-phase2':event.phase===1?'retribution-phase1':event.songKey;
            s.rule=env.PhiChapter8ReplayRules.createController(key,s.route.tier==='AT'?'IN':s.route.tier);s.scene='Level';
          }
          void playTrack(s,event);
        }
        else if(type==='return-selection'){cancel(true);break;}
        else if(type==='complete'){
          s.completed=true;surface().hide();surface().disposeGame();surface().stopAmbient?.();notify();
        }else if(type==='result'){
          s.completed=true;surface().hide();surface().disposeGame();surface().stopAmbient?.();notify();
        }else if(type==='exit'){
          cancel(true);break;
        }else if(type==='failed'){
          s.failed=true;adapter.onFailure?.(s.engine,event);surface().status('');
        }else{
          if(type==='dialog'){
            if(s.engine){s.lastSongFrame={...s.lastSongFrame,audioPlaying:false};adapter.stopSong?.(s.id);s.engine=null;}
            s.scene='DestructionDialog';surface().show(s.route);surface().scene(s.scene);surface().status('');
          }
          if(type==='record'&&event.fillRemainingMisses&&s.engine)adapter.settleSong?.(s.engine);
          if(type==='audio-fade'&&s.engine)adapter.fadeAudio?.(s.engine,event.duration);
          if(type==='audio-stutter'&&s.engine)adapter.stutterAudio?.(s.engine,event);
          if(type==='audio-stop'&&s.engine)adapter.stopAudio?.(s.engine);
          const difficulty=type==='music-info'&&songKey(event.songKey)===s.route.key?s.route.tier:event.difficulty;
          const meta=type==='music-info'?adapter.findEntry?.(event.songKey,difficulty||s.route.tier,s.entry)?.meta:undefined;
          const task=surface().effect({...event,difficulty,meta,time:s.lastSongFrame?.time,signal:s.abort.signal,isCurrent:()=>isCurrent(s)});
          task?.catch?.(error=>fail(s,error));
        }
      }
    }
    function owns(engine){return !!active&&engine?.record?.visionReplay?.id===active.id;}
    function updateSong(engine,time,deltaTime){
      if(!owns(engine)||active.error)return;
      const s=active;s.engine=engine;
      const frame={time,rawScore:engine.rawScore?.()??engine.score(),score:engine.score(),deltaTime,songKey:s.currentSong,audioTime:engine.musicCurrentTime(),audioPlaying:engine.musicPlaying!==false,clipLength:engine.musicBuffer?.duration||engine.audio?.duration||0};s.lastSongFrame=frame;
      dispatch(s,s.rule.update({...frame,...surface().mediaState()}));
      surface().paintGame(s.rule.snapshot(),engine);
    }
    function judge(engine,kind){if(owns(engine))dispatch(active,active.rule.judge?.(kind,engine.musicCurrentTime())||[]);}
    function finishSong(engine){
      if(!owns(engine))return false;const s=active;
      dispatch(s,s.rule.finish({score:engine.score(),rawScore:engine.rawScore?.(),counts:engine.counts.slice(),maxCombo:engine.maxCombo})||[]);
      if(s.completed||s.rule.snapshot().stage==='result')return false;
      if(s.engine===engine){s.lastSongFrame={...s.lastSongFrame,audioPlaying:false};s.engine=null;adapter.stopSong?.(s.id);surface().show(s.route);}
      return true;
    }
    function drawSong(engine,pass){if(owns(engine))surface().drawGame(active.rule.snapshot(),engine,pass);}
    function detach(engine){if(owns(engine))surface().disposeGame(engine);}
    return Object.freeze({begin,cancel,input,routeForSong,songKey,updateSong,judge,finishSong,drawSong,detach,owns,get current(){return active?{id:active.id,route:active.route,scene:active.scene,loading:active.loading,error:active.error,snapshot:active.rule?.snapshot()}:null;}});
  }
  function createSurface(actions,env){
    const doc=env.document,root=doc.createElement('section');root.id='interactiveVisionScene';root.className='interactiveVisionScene hidden';root.setAttribute('aria-label','章节异像重演');
    root.innerHTML='<video playsinline preload="none" aria-label="异像场景"></video><canvas class="visionSceneCanvas" aria-hidden="true"></canvas><div class="visionNativeScene"></div><div class="visionSceneSubtitle"></div><div class="visionCreditsViewport hidden"><div></div><i></i></div><div class="visionNativeDialog hidden" role="alertdialog"><h2></h2><p></p><button type="button"></button></div><div class="visionSceneToolbar"><button type="button" data-action="exit">返回选曲</button></div>';
    doc.body.appendChild(root);
    const video=root.querySelector('video'),native=root.querySelector('.visionNativeScene'),canvas=root.querySelector('canvas'),subtitle=root.querySelector('.visionSceneSubtitle'),credits=root.querySelector('.visionCreditsViewport'),dialog=root.querySelector('.visionNativeDialog');
    let generation=0,url='',clipId='',scene='',renderer=null,rendererCanvas=null,mediaLoading=false,mediaBlocked=false,bossRenderer=null,stageRenderer=null,stageCanvas=null,postEffects={},hudFade=null;
    let creditsData=null,creditsURL='',creditsGeneration=0,audioLoading=false,fadeLast=0;
    const fades=[],videoManifest={value:null,pending:null},audioManifest={value:null,pending:null};
    function loadSessionManifest(cache,path,signal,install,message){
      if(signal.aborted)return Promise.reject(new DOMException('Replay cancelled','AbortError'));
      if(cache.value!==null)return Promise.resolve(cache.value);
      if(cache.pending?.signal===signal)return cache.pending.promise;
      const request={signal,promise:null};
      request.promise=(async()=>{
        const response=await fetch(path,{signal});
        if(!response.ok)throw Error(message);
        const raw=await response.json();
        if(signal.aborted)throw new DOMException('Replay cancelled','AbortError');
        const value=install(raw);
        if(cache.pending===request)cache.value=value;
        return value;
      })().finally(()=>{if(cache.pending===request)cache.pending=null;});
      cache.pending=request;return request.promise;
    }
    const ambient=new Audio(),message=new Audio('./assets/vision-replay/chapter8-message.wav'),messageAmbient=new Audio('./assets/vision-replay/chapter8-message-ambient.wav'),creditsAudio=new Audio();ambient.preload='none';message.preload='none';messageAmbient.preload='none';messageAmbient.loop=true;creditsAudio.preload='none';
    for(const audio of [ambient,message,messageAmbient,creditsAudio])audio.setAttribute('playsinline','');
    let activationEpoch=0;const blockedMedia=new Set(),pendingMedia=new Map();
    const allMedia=[video,ambient,message,messageAmbient,creditsAudio];
    function mediaFailure(error){if(actions.error)actions.error(error);else{env.console?.error?.('Chapter media failed',error);actions.cancel();}}
    for(const media of allMedia)media.addEventListener('error',()=>{if(media.getAttribute('src')&&media.error)mediaFailure(Error(media.error.message||`Media decoding failed (${media.error.code})`));});
    function clearBlocked(media){blockedMedia.delete(media);pendingMedia.delete(media);mediaBlocked=blockedMedia.size>0;}
    function blockMedia(media){blockedMedia.add(media);mediaBlocked=true;}
    async function activateMedia(media,valid=()=>true){
      const epoch=activationEpoch,attempt=Symbol();pendingMedia.set(media,attempt);
      try{
        if(doc.hidden){if(valid())blockMedia(media);return;}
        await media.play();
        if(!valid()||pendingMedia.get(media)!==attempt)return;
        if(doc.hidden){media.pause();blockMedia(media);return;}
        if(epoch===activationEpoch){blockedMedia.delete(media);mediaBlocked=blockedMedia.size>0;}
      }catch(error){
        if(valid()&&epoch===activationEpoch&&pendingMedia.get(media)===attempt){
          if(error?.name==='NotAllowedError')blockMedia(media);
          else if(error?.name!=='AbortError')mediaFailure(error);
        }
      }
      finally{if(pendingMedia.get(media)===attempt)pendingMedia.delete(media);}
    }
    function resumeMedia(){
      if(!mediaBlocked)return false;
      const epoch=++activationEpoch;
      for(const media of [...blockedMedia]){
        if(!media.getAttribute('src')||media.ended){clearBlocked(media);continue;}
        void activateMedia(media,()=>epoch===activationEpoch);
      }
      return true;
    }
    const aliases={DF_Touch2Start:'df_touch',DF_Unlock:'df_unlock','321_Unlock':'321_unlock',Unlock321:'321_unlock','321Unlock':'321_unlock',RrharilUnlock:'rr_unlock',QD:'qd',QD_Video:'qd'};
    function stop(){generation++;mediaLoading=false;clearBlocked(video);video.pause();video.removeAttribute('src');video.load();if(url)URL.revokeObjectURL(url);url='';clipId='';}
    function stopAmbient(){creditsGeneration++;audioLoading=false;fades.length=0;for(const audio of [ambient,message,messageAmbient,creditsAudio]){clearBlocked(audio);audio.pause();audio.removeAttribute('src');audio.load();}if(creditsURL)URL.revokeObjectURL(creditsURL);creditsURL='';}
    function fade(audio,target,duration){fades.push({audio,from:audio.volume,target,duration,elapsed:0});}
    function mediaState(){
      const now=performance.now(),dt=fadeLast?Math.max(0,Math.min(.1,(now-fadeLast)/1000)):0;fadeLast=now;
      for(let i=fades.length-1;i>=0;i--){const f=fades[i];if(!doc.hidden&&!f.audio.paused)f.elapsed+=dt;const t=Math.min(1,f.elapsed/Math.max(.001,f.duration));f.audio.volume=f.from+(f.target-f.from)*t;if(t>=1){if(f.target===0)f.audio.pause();fades.splice(i,1);}}
      return {clipId,videoTime:Number(video.currentTime)||0,videoPlaying:!video.paused&&!video.ended,videoEnded:video.ended,videoDuration:Number.isFinite(video.duration)?video.duration:0,videoPrepared:video.readyState>=1||!clipId,mediaLoading,audioLoading,mediaBlocked,ambientTime:Number(ambient.currentTime)||0,ambientPlaying:!!ambient.getAttribute('src')&&!ambient.paused&&!ambient.ended};
    }
    async function startCreditsAudio(track,options){
      const token=++creditsGeneration;audioLoading=true;clearBlocked(creditsAudio);creditsAudio.pause();
      const specs=await loadSessionManifest(audioManifest,'./assets/meta/vision-audio.json?v=4.0.1.2-pages-20',options.signal,value=>env.PhiVisionReplay.installAudioManifest(value),'重演音频清单暂不可用');if(token!==creditsGeneration||options.signal.aborted||!options.isCurrent())return;const variants=specs.filter(s=>s.track===track),spec=variants.find(s=>s.mime==='audio/flac'&&creditsAudio.canPlayType(s.mime))||variants.find(s=>creditsAudio.canPlayType(s.mime));
      if(!spec)throw Error('此浏览器不支持制作名单音频');
      const bytes=await env.PhiVisionReplay.download(spec.url,{signal:options.signal});
      if(token!==creditsGeneration||options.signal.aborted||!options.isCurrent())return;
      if(creditsURL)URL.revokeObjectURL(creditsURL);creditsURL=URL.createObjectURL(new Blob([bytes],{type:spec.mime}));creditsAudio.src=creditsURL;creditsAudio.volume=1;creditsAudio.load();
      await activateMedia(creditsAudio,()=>token===creditsGeneration&&!options.signal.aborted&&options.isCurrent());
      if(token===creditsGeneration&&!options.signal.aborted&&options.isCurrent())audioLoading=false;
    }
    async function play(id,options){
      const requested=aliases[id]||id;
      if(requested===clipId&&url){const token=generation;if(Number.isFinite(options.seek))video.currentTime=options.seek;await activateMedia(video,()=>token===generation&&!options.signal.aborted&&options.isCurrent());return;}
      stop();const token=generation;clipId=requested;mediaLoading=true;
      const {clips}=await loadSessionManifest(videoManifest,'./assets/meta/vision-media.json?v=4.0.1.2-pages-20',options.signal,value=>({value,clips:env.PhiVisionReplay.installManifest(value)}),'异像资源清单暂不可用');if(token!==generation||options.signal.aborted||!options.isCurrent())return;const clip=clips.find(item=>item.id===requested);if(!clip)throw Error('缺少异像场景资源：'+clipId);
      const bytes=await env.PhiVisionReplay.download(clip.url,{signal:options.signal});
      if(token!==generation||options.signal.aborted||!options.isCurrent())return;
      url=URL.createObjectURL(new Blob([bytes],{type:clip.mime}));video.src=url;video.loop=!!options.loop;video.muted=!!options.muted;video.load();if(Number.isFinite(options.seek))video.currentTime=options.seek;
      mediaLoading=false;await activateMedia(video,()=>token===generation&&!options.signal.aborted&&options.isCurrent());
    }
    const excluded=target=>target?.closest?.('button'),contacts=new Map();
    root.addEventListener('pointerdown',event=>{
      if(excluded(event.target))return;if(event.cancelable)event.preventDefault();root.setPointerCapture?.(event.pointerId);
      if(resumeMedia()){contacts.set(event.pointerId,{resume:true});return;}
      const entry={phase:root.dataset.phase,scene:root.dataset.scene,activated:root.dataset.scene==='DFUnlock'};contacts.set(event.pointerId,entry);
      if(contacts.size===1)actions.input('hold-start');if(entry.activated)actions.input('activate');
    });
    root.addEventListener('pointerup',event=>{
      if(excluded(event.target))return;const entry=contacts.get(event.pointerId);contacts.delete(event.pointerId);if(!contacts.size)actions.input('hold-end');
      if(!entry||entry.resume||entry.activated||entry.phase==='clock')return;
      const rect=root.getBoundingClientRect(),point={x:event.clientX-rect.left,y:event.clientY-rect.top,width:rect.width,height:rect.height};
      if(root.dataset.replayFamily!=='boss'||!bossRenderer?.hitTest||bossRenderer.hitTest(point))actions.input('activate');
    });
    root.addEventListener('pointercancel',event=>{contacts.delete(event.pointerId);if(!contacts.size)actions.input('hold-end');});
    let keyPhase=null;
    root.addEventListener('keydown',event=>{if([' ','Enter'].includes(event.key)&&!excluded(event.target)){event.preventDefault();if(!event.repeat){if(resumeMedia()){keyPhase='media-resume';return;}keyPhase=root.dataset.phase;actions.input('hold-start');if(root.dataset.scene==='DFUnlock')actions.input('activate');}}});
    root.addEventListener('keyup',event=>{if([' ','Enter'].includes(event.key)&&!excluded(event.target)){event.preventDefault();actions.input('hold-end');if(keyPhase!=='clock'&&keyPhase!=='media-resume'&&root.dataset.scene!=='DFUnlock')actions.input('activate');keyPhase=null;}});
    root.querySelector('[data-action=exit]').onclick=()=>actions.cancel();
    doc.addEventListener('keydown',event=>{if(event.key==='Escape'&&!root.classList.contains('hidden')){event.preventDefault();event.stopImmediatePropagation();actions.cancel();}},{capture:true});
    doc.getElementById('loadingBack')?.addEventListener('click',()=>{if(!root.classList.contains('hidden'))actions.cancel();});
    doc.addEventListener('visibilitychange',()=>{
      if(!doc.hidden||root.classList.contains('hidden'))return;
      activationEpoch++;
      for(const media of allMedia)if(!media.paused&&!media.ended||pendingMedia.has(media)){blockMedia(media);media.pause();}
      contacts.clear();keyPhase=null;actions.input('hold-end');
    });
    function disposeGame(){renderer?.dispose();renderer=null;rendererCanvas=null;stageRenderer?.dispose();stageRenderer=null;stageCanvas=null;postEffects={};hudFade=null;const view=doc.querySelector('#gameView');view?.classList.remove('visionReplayHideUI','visionReplayDimUI');view?.style.removeProperty('--vision-hud-opacity');for(const id of ['visionReplayHP','visionReplayBlackout','visionReplayMessage'])doc.getElementById(id)?.remove();}
    return {
      show(route){root.dataset.replayFamily=route.family;root.classList.remove('hidden');root.tabIndex=-1;root.focus({preventScroll:true});},hide(){root.classList.add('hidden');contacts.clear();keyPhase=null;},stop,play,mediaState,stopAmbient,
      status(message,error=false){if(error&&message)env.console?.error?.('Chapter replay:',message);},
      scene(value){scene=value;contacts.clear();keyPhase=null;root.querySelector('.visionSceneMusicInfo')?.remove();root.dataset.scene=value;root.classList.remove('visionBlackMask');root.style.removeProperty('--vision-scene-black');native.replaceChildren();subtitle.textContent='';dialog.classList.add('hidden');credits.classList.toggle('hidden',value!=='AboutUs');canvas.getContext('2d')?.clearRect(0,0,canvas.width,canvas.height);},
      seek(time,shouldPlay=true){video.currentTime=time;if(shouldPlay){const token=generation;void activateMedia(video,()=>token===generation);}},pause(){video.pause();},resume(){const token=generation;return activateMedia(video,()=>token===generation);},
      effect(event){
        if(event.type==='music-info'){
          let info=root.querySelector('.visionSceneMusicInfo');
          if(!info){info=doc.createElement('div');info.className='visionSceneMusicInfo';root.appendChild(info);}
          info.textContent=[event.meta?.name||(event.songKey==='distorted-fate'?'Distorted Fate':'DESTRUCTION 3,2,1'),event.meta?.composer||event.meta?.artist||'',event.difficulty].filter(Boolean).join('\n');info.hidden=event.visible===false;
        }
        if(event.type==='subtitle')subtitle.textContent=event.text||'';
        if(event.type==='dialog'){
          dialog.querySelector('h2').textContent=event.title||'';dialog.querySelector('p').textContent=event.text||event.body||'';
          const button=dialog.querySelector('button');button.textContent=event.button||'好';button.onclick=()=>{dialog.classList.add('hidden');actions.input(event.action||'confirm');};dialog.classList.remove('hidden');button.focus();
        }
        if(event.type==='hide-ui')doc.querySelector('#gameView')?.classList.add('visionReplayHideUI');
        if(event.type==='hud')hudFade={time:event.time||0,visible:event.visible,duration:event.duration||0};
        if(event.type==='show-ui')doc.querySelector('#gameView')?.classList.remove('visionReplayHideUI');
        if(event.type==='ambient-play'){ambient.src='./assets/vision-replay/chapter8-ambient-retri.wav';ambient.volume=event.fadeIn?0:1;if(event.fadeIn)fade(ambient,1,event.fadeIn);const token=creditsGeneration;void activateMedia(ambient,()=>token===creditsGeneration);}
        if(event.type==='message-ambient-play'){messageAmbient.src='./assets/vision-replay/chapter8-message-ambient.wav';messageAmbient.volume=0;fade(messageAmbient,event.volume??1,event.fadeIn||1);const token=creditsGeneration;void activateMedia(messageAmbient,()=>token===creditsGeneration);}
        if(event.type==='message'){native.textContent=event.text;let box=doc.getElementById('visionReplayMessage');if(!box){box=doc.createElement('p');box.id='visionReplayMessage';doc.getElementById('gameView').appendChild(box);}box.textContent=event.text;message.src='./assets/vision-replay/chapter8-message.wav';message.volume=.5;message.currentTime=0;const token=creditsGeneration;void activateMedia(message,()=>token===creditsGeneration);}
        if(event.type==='messages-end'){native.textContent='';doc.getElementById('visionReplayMessage')?.remove();}
        if(event.type==='message-ambient-stop')fade(messageAmbient,0,event.duration||0);
        if(event.type==='credits-start'){
          credits.classList.remove('hidden');return fetch('./'+event.asset,{signal:event.signal}).then(r=>{if(!r.ok)throw Error('制作名单暂不可用');return r.json();}).then(value=>{if(!event.isCurrent())return;creditsData=value;credits.querySelector('div').textContent=value.sections.filter(s=>s.role!=='skip').map(s=>s.text.replace(/<[^>]*>/g,'')).join('\n\n');});
        }
        if(event.type==='credits-audio')return startCreditsAudio(event.track,event);
        if(event.type==='credits-audio-stop'){creditsAudio.pause();if(creditsURL)URL.revokeObjectURL(creditsURL);creditsURL='';}
        if(event.type==='credits-exit'){creditsAudio.pause();root.style.setProperty('--vision-scene-black','1');}
        if(event.type==='black-screen'){root.style.setProperty('--vision-scene-black','1');const view=doc.querySelector('#gameView');if(!view.classList.contains('hidden')){let mask=doc.getElementById('visionReplayBlackout');if(!mask){mask=doc.createElement('div');mask.id='visionReplayBlackout';view.appendChild(mask);}mask.style.opacity='1';}}
        if(event.type==='post-effect')postEffects={...postEffects,...event};
        if(event.type==='black-mask')root.classList.toggle('visionBlackMask',!!event.visible);
        if(event.type==='red-flash'){const view=doc.querySelector('#gameView');view?.classList.remove('visionRedFlash');void view?.offsetWidth;view?.classList.add('visionRedFlash');}
      },
      paint(state){root.dataset.phase=state.phase||state.stage||'';if(scene==='Level'&&Number.isFinite(state.blackOpacity))root.style.setProperty('--vision-scene-black',state.blackOpacity);if(Object.prototype.hasOwnProperty.call(state,'instruction'))native.textContent=state.instruction||'';if(scene==='AboutUs'){
        if(state.stage==='credits-wait')native.textContent='touch to start';else native.textContent='';
        if(creditsData){const y=(creditsData.startPosition[1]+(creditsData.serializedEndPosition[1]-creditsData.startPosition[1])*state.creditsProgress)*root.clientHeight/18.75;credits.querySelector('div').style.transform=`translateY(${-y}px)`;}
        credits.querySelector('i').style.transform=`scaleX(${state.skipOpacity||0})`;
      }if(env.PhiBossReplayVisuals){if(!bossRenderer)bossRenderer=env.PhiBossReplayVisuals.create(canvas);bossRenderer.sample?.(state,{width:root.clientWidth,height:root.clientHeight});if(state.boss==='spasmodic'&&state.phase==='entry'||state.boss==='rrharil'&&state.phase==='clock-ready')native.textContent='';}},
      paintGame(state,engine){
        const view=doc.getElementById('gameView');
        const opacity=Number.isFinite(state.hudOpacity)?state.hudOpacity:hudFade?(hudFade.visible?1:Math.max(0,1-(engine.musicCurrentTime()-hudFade.time)/Math.max(.001,hudFade.duration))):1;
        view.style.setProperty('--vision-hud-opacity',opacity);view.classList.toggle('visionReplayDimUI',opacity<1);
        if(Number.isFinite(state.blackOpacity)){let mask=doc.getElementById('visionReplayBlackout');if(!mask){mask=doc.createElement('div');mask.id='visionReplayBlackout';view.appendChild(mask);}mask.style.opacity=state.blackOpacity;}
        if(Number.isFinite(state.hp)){
          let hp=doc.querySelector('#visionReplayHP');if(!hp){hp=doc.createElement('div');hp.id='visionReplayHP';hp.innerHTML='<i></i>';doc.querySelector('#gameView').appendChild(hp);}hp.querySelector('i').style.transform=`scaleX(${Math.max(0,Math.min(1,state.hp))})`;
        }
      },
      drawGame(state,engine,pass){
        if(pass==='background'&&env.PhiChapter8ReplayVisuals&&String(state.songKey||'').includes('luminescence')){
          if(!renderer||rendererCanvas!==engine.canvas){renderer?.dispose();rendererCanvas=engine.canvas;renderer=env.PhiChapter8ReplayVisuals.create(engine.canvas,{background:true});}
          renderer.sample({time:engine.musicCurrentTime(),phase:'luminescence',branch:state.stage1Failed||state.stage2Failed?'failed':state.timeTag>0?'success':'pending',width:engine.canvas.width,height:engine.canvas.height,clear:false,background:true});
        }
        if(pass!=='background'&&env.PhiChapter8StageEffects&&(state.songKey==='distorted-fate'||Object.keys(postEffects).length)){
          if(!stageRenderer||stageCanvas!==engine.canvas){stageRenderer?.dispose();stageCanvas=engine.canvas;stageRenderer=env.PhiChapter8StageEffects.create(engine.canvas);}
          stageRenderer.sample({songKey:state.songKey,time:engine.musicCurrentTime(),paramsOverride:postEffects,state});
        }
      },disposeGame,
    };
  }
  let installed=null;
  const api={routeForSong,songKey,createRuntime,configure(adapter){installed?.cancel(false);installed=createRuntime(adapter);return installed;},begin(entry){return installed?.begin(entry);},cancel(){installed?.cancel();},updateSong(...args){installed?.updateSong(...args);},judge(...args){installed?.judge(...args);},finishSong(...args){return installed?.finishSong(...args)||false;},drawSong(...args){installed?.drawSong(...args);},detach(...args){installed?.detach(...args);},get current(){return installed?.current||null;}};
  globalThis.PhiInteractiveReplay=Object.freeze(api);
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
