'use strict';
// Deterministic browser media-lifecycle regression checks; not an official-game comparison.
// Run: node tests/interactive-replay-media-browser.cjs
const assert=require('node:assert/strict'),fs=require('node:fs');
const {chromium}=require('playwright');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.CHROMIUM_PATH||'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try{
  const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.setContent('<main id="gameView"></main><button id="loadingBack">返回</button>');
  const source=fs.readFileSync(process.env.REPLAY_SOURCE_PATH||'js/interactive-replay.js','utf8');
  // Exercise the shipped private surface without exporting a new product API.
  await page.addScriptTag({content:source.slice(source.indexOf('  function createSurface('),source.indexOf('  let installed='))+'\nglobalThis.surfaceFactory=createSurface;'});
  const result=await page.evaluate(async()=>{
   let hidden=false;Object.defineProperty(document,'hidden',{get:()=>hidden,configurable:true});
   const states=new WeakMap(),calls=[],pending=[];
   const state=media=>{if(!states.has(media))states.set(media,{paused:true,ended:false});return states.get(media);};
   Object.defineProperty(HTMLMediaElement.prototype,'paused',{get(){return state(this).paused;},configurable:true});
   Object.defineProperty(HTMLMediaElement.prototype,'ended',{get(){return state(this).ended;},configurable:true});
   HTMLMediaElement.prototype.load=function(){};
   HTMLMediaElement.prototype.pause=function(){state(this).paused=true;};
   let deferNext=false,rejectNext=false,fatalNext=false;
   HTMLMediaElement.prototype.play=function(){
    const media=this;calls.push(media);state(media).paused=false;
    if(rejectNext){rejectNext=false;state(media).paused=true;return Promise.reject(new DOMException('autoplay denied','NotAllowedError'));}
    if(fatalNext){fatalNext=false;state(media).paused=true;return Promise.reject(new DOMException('unsupported codec','NotSupportedError'));}
    if(deferNext){deferNext=false;return new Promise((resolve,reject)=>pending.push({media,resolve,reject}));}
    return Promise.resolve();
   };
   HTMLMediaElement.prototype.canPlayType=()=> 'probably';
   const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
   globalThis.fetch=async()=>({ok:true,json:async()=>({})});
   globalThis.PhiVisionReplay={installManifest:()=>[{id:'a',url:'a',mime:'video/mp4'},{id:'b',url:'b',mime:'video/mp4'}],installAudioManifest:()=>[{track:0,url:'music0',mime:'audio/flac'},{track:1,url:'music1',mime:'audio/flac'}],download:async()=>new Uint8Array([1,2,3])};
   const actions=[],controller=new AbortController(),options={signal:controller.signal,isCurrent:()=>true};
   const ui=surfaceFactory({input:x=>actions.push(x),cancel:()=>actions.push('cancel'),error:error=>actions.push('error:'+error.name)},globalThis);
   ui.show({family:'chapter8',chapter:8});
   const root=document.querySelector('#interactiveVisionScene'),video=root.querySelector('video');
   await ui.play('a',options);ui.effect({type:'ambient-play'});await flush();
   hidden=true;document.dispatchEvent(new Event('visibilitychange'));
   const paused=ui.mediaState();hidden=false;document.dispatchEvent(new Event('visibilitychange'));
   const beforePointer=actions.length;
   root.dispatchEvent(new PointerEvent('pointerdown',{pointerId:1,bubbles:true}));
   root.dispatchEvent(new PointerEvent('pointerup',{pointerId:1,bubbles:true}));await flush();
   const pointerActions=actions.slice(beforePointer),resumed=ui.mediaState();
   // A clip intentionally paused at its native touch gate must stay paused.
   ui.pause();hidden=true;document.dispatchEvent(new Event('visibilitychange'));hidden=false;
   root.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
   root.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));await flush();
   const gateStillPaused=video.paused;
   ui.stop();ui.stopAmbient();
   // A failed pending playback belongs to its old clip, never the replacement clip.
   deferNext=true;const oldClip=ui.play('a',options);await flush();const oldAttempt=pending.pop();
   ui.stop();await ui.play('b',options);oldAttempt.reject(Error('old clip cancelled'));await oldClip;await flush();
   const afterStaleClip=ui.mediaState();
   // A replaced credits track owns audioLoading until its own activation completes.
   deferNext=true;const oldAudio=ui.effect({type:'credits-audio',track:0,...options});await flush();const oldAudioAttempt=pending.pop();
   ui.stopAmbient();deferNext=true;const newAudio=ui.effect({type:'credits-audio',track:1,...options});await flush();const newAudioAttempt=pending.pop();
   oldAudioAttempt.reject(Error('old credits cancelled'));await oldAudio;
   const duringNewAudio=ui.mediaState();newAudioAttempt.resolve();await newAudio;await flush();
   const afterNewAudio=ui.mediaState();
   // A blocked initial activation resumes from Enter without activating the scene.
   ui.stop();ui.stopAmbient();rejectNext=true;await ui.play('a',options);
   const blocked=ui.mediaState(),beforeKeyboard=actions.length;
   root.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}));
   root.dispatchEvent(new KeyboardEvent('keyup',{key:'Enter',bubbles:true}));await flush();
   const keyboardActions=actions.slice(beforeKeyboard),afterKeyboard=ui.mediaState();
   ui.stop();fatalNext=true;await ui.play('a',options);const fatalRecovered=actions.at(-1)==='error:NotSupportedError'&&!ui.mediaState().mediaBlocked;
   document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
   const escapeCancelled=actions.at(-1)==='cancel';
   const beforeExit=actions.length,exitButton=root.querySelector('.visionSceneToolbar [data-action=exit]');
   exitButton.dispatchEvent(new PointerEvent('pointerdown',{pointerId:2,bubbles:true}));
   exitButton.dispatchEvent(new PointerEvent('pointerup',{pointerId:2,bubbles:true}));exitButton.click();
   const exitActions=actions.slice(beforeExit);
   ui.effect({type:'subtitle',text:'鸠？！'});
   ui.effect({type:'dialog',title:'PhigrOS已崩溃',text:'模拟结束，谢谢你的参与。',button:'好',action:'confirm'});
   const historicalContent={subtitle:root.querySelector('.visionSceneSubtitle').textContent,title:root.querySelector('.visionNativeDialog h2').textContent,body:root.querySelector('.visionNativeDialog p').textContent,button:root.querySelector('.visionNativeDialog button').textContent};
   root.querySelector('.visionNativeDialog button').click();
   const dialogConfirmed=actions.at(-1)==='confirm';
   const noExtraUI=!root.querySelector('.visionSceneToolbar span,.visionSceneToolbar h1,.visionSceneToolbar h2,[data-action=restart],.visionSceneStatus,.visionResumeMedia,.visionCreditsViewport span');
   return {exitActions,historicalContent,dialogConfirmed,fatalRecovered,paused,resumed,pointerActions,gateStillPaused,afterStaleClip,duringNewAudio,afterNewAudio,blocked,keyboardActions,afterKeyboard,noExtraUI,escapeCancelled};
  });
  const manifestRaces=await page.evaluate(async()=>{
   const results={};
   const flush=async()=>{for(let i=0;i<10;i++)await Promise.resolve();};
   for(const kind of ['video','credits']){
    let fetchCount=0,resolveReplacement;
    globalThis.fetch=(_url,{signal})=>{
     fetchCount++;
     if(fetchCount===1)return new Promise((resolve,reject)=>signal.addEventListener('abort',()=>queueMicrotask(()=>reject(new DOMException('cancel old manifest','AbortError'))),{once:true}));
     if(fetchCount===2)return new Promise(resolve=>{resolveReplacement=()=>resolve({ok:true,json:async()=>({})});});
     return Promise.resolve({ok:true,json:async()=>({})});
    };
    const ui=surfaceFactory({input(){},cancel(){},error(error){throw error;}},globalThis);
    const first=new AbortController(),second=new AbortController(),third=new AbortController();
    const begin=signal=>kind==='video'?ui.play('a',{signal,isCurrent:()=>!signal.aborted}):ui.effect({type:'credits-audio',track:0,signal,isCurrent:()=>!signal.aborted});
    const stop=()=>kind==='video'?ui.stop():ui.stopAmbient();
    const old=begin(first.signal).catch(error=>error.name);await flush();
    first.abort();stop();
    const replacement=begin(second.signal).then(()=> 'resolved',error=>'rejected:'+error.name);
    await flush();
    // The old rejection must not clear or poison the new in-flight request.
    const sameSession=begin(second.signal).then(()=> 'resolved',error=>'rejected:'+error.name);
    await flush();const countWhilePending=fetchCount;resolveReplacement?.();
    const replacementResult=await replacement,sameResult=await sameSession,oldResult=await old;
    stop();const cachedPromise=begin(third.signal).then(()=> 'resolved',error=>'rejected:'+error.name);await flush();resolveReplacement?.();const cachedResult=await cachedPromise;
    results[kind]={old:oldResult,replacement:replacementResult,sameSession:sameResult,countWhilePending,fetchCount,cached:cachedResult,newSessionAborted:second.signal.aborted};
    ui.stop();ui.stopAmbient();
   }
   return results;
  });
  for(const kind of ['video','credits'])assert.deepEqual(manifestRaces[kind],{old:'AbortError',replacement:'resolved',sameSession:'resolved',countWhilePending:2,fetchCount:2,cached:'resolved',newSessionAborted:false},kind+' manifests must be isolated across sessions');
  assert.equal(result.paused.videoPlaying,false);assert.equal(result.paused.ambientPlaying,false);assert.equal(result.paused.mediaBlocked,true);
  assert.equal(result.resumed.videoPlaying,true);assert.equal(result.resumed.ambientPlaying,true);assert.equal(result.resumed.mediaBlocked,false);
  assert(!result.pointerActions.includes('activate'));assert(!result.pointerActions.includes('hold-start'));
  assert.equal(result.gateStillPaused,true);
  assert.equal(result.afterStaleClip.mediaBlocked,false);assert.equal(result.afterStaleClip.clipId,'b');
  assert.equal(result.duringNewAudio.audioLoading,true);assert.equal(result.duringNewAudio.mediaBlocked,false);assert.equal(result.afterNewAudio.audioLoading,false);
  assert.equal(result.blocked.mediaBlocked,true);assert.equal(result.afterKeyboard.mediaBlocked,false);assert(!result.keyboardActions.includes('activate'));assert(!result.keyboardActions.includes('hold-start'));
  assert.deepEqual(result.exitActions,['cancel']);assert.deepEqual(result.historicalContent,{subtitle:'鸠？！',title:'PhigrOS已崩溃',body:'模拟结束，谢谢你的参与。',button:'好'});assert.equal(result.dialogConfirmed,true);assert.equal(result.fatalRecovered,true);assert.equal(result.noExtraUI,true);assert.equal(result.escapeCancelled,true);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({scope:'Browser media lifecycle only; official equivalence unverified',result,manifestRaces},null,2));
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
