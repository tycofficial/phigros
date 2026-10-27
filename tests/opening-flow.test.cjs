'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');

function fixture({play='resolve',metadata=true,seekThrows=false}={}){
  let now=0,nextFrame=0;
  const styles=new Map(),frames=new Map(),documentEvents=new Map(),plays=[],routes=[];
  const home={clientWidth:682,clientHeight:512,dataset:{stage:'studio'},style:{setProperty:(key,value)=>styles.set(key,value)},appendChild(){}};
  const sound={hidden:true,onclick:null};
  const canvas={getContext:()=>new Proxy({}, {get:()=>()=>{},set:()=>true})};
  class AudioMock extends EventTarget{
    constructor(){super();this._time=0;this.readyState=metadata?4:0;this.paused=true;this.seekThrows=seekThrows;this.src='';this.pauseCalls=0;this.loadCalls=0;}
    set currentTime(value){if(this.seekThrows)throw Error('Metadata unavailable');this._time=value;}
    get currentTime(){return this._time;}
    setAttribute(){}
    getAttribute(name){return name==='src'?this.src:null;}
    removeAttribute(name){if(name==='src')this.src='';}
    pause(){this.paused=true;this.pauseCalls++;}
    load(){this.loadCalls++;if(!this.src){this._time=0;this.readyState=0;}}
    play(){
      if(play==='throw')throw Error('Autoplay blocked');
      const attempt={};plays.push(attempt);
      const pending=new Promise((resolve,reject)=>{
        attempt.resolve=()=>{this.paused=false;resolve();};
        attempt.reject=()=>reject(Error('Autoplay blocked'));
      });
      if(play==='resolve')attempt.resolve();
      if(play==='reject')attempt.reject();
      return pending;
    }
  }
  const document={hidden:false,baseURI:'https://example.test/phigros/',body:{dataset:{referenceScene:'home'}},
    getElementById:id=>({refHome:home,openingSound:sound,openingParticles:canvas})[id],
    addEventListener:(name,handler)=>documentEvents.set(name,handler)};
  const context=vm.createContext({console,URL,URLSearchParams,Audio:AudioMock,performance:{now:()=>now},document,
    PhiHostedManifest:{opening:{audio:'./theme.m4a',warningAt:3.4,titleAt:8,titleSettledAt:8.9}},
    location:{search:''},window:{addEventListener(){}},matchMedia:()=>({matches:false}),
    innerWidth:682,innerHeight:512,devicePixelRatio:1,
    requestAnimationFrame:handler=>{const id=++nextFrame;frames.set(id,handler);return id;},
    cancelAnimationFrame:id=>frames.delete(id),
    $:selector=>selector==='#refHome'?home:null,
    referenceRouteToken:0,Engine:{primeAudioFromGesture:()=>{context.primed=(context.primed||0)+1;}},
    referenceScene:name=>{document.body.dataset.referenceScene=name;routes.push(name);if(name!=='home')context.PhiOpening.stop();}
  });
  vm.runInContext(fs.readFileSync('js/opening.js','utf8'),context);
  // Exercise the shipped home handler, including its menu transition, rather
  // than duplicating the desired three-tap behavior inside this test.
  const source=fs.readFileSync('js/app.js','utf8');
  const start=source.indexOf('    $("#refHome").onclick=()=>{');
  const end=source.indexOf('    $("#refCollectionBack").onclick=',start);
  assert(start>=0&&end>start);
  vm.runInContext(source.slice(start,end),context);
  function click(target=home){
    const event={stopped:false,stopPropagation(){this.stopped=true;}};
    if(target!==home)target.onclick?.(event);
    if(!event.stopped)home.onclick?.(event);
  }
  function frame(){const queued=[...frames];frames.clear();for(const [,handler]of queued)handler();}
  function visibility(hidden){document.hidden=hidden;documentEvents.get('visibilitychange')();}
  return {context,opening:context.PhiOpening,audio:context.PhiOpening.audio,home,sound,styles,plays,routes,frames,click,frame,visibility,setNow:value=>now=value};
}
const flush=async()=>{await Promise.resolve();await Promise.resolve();};

test('default attempts audible autoplay, hides fallback on success and follows the audio clock',async()=>{
  const f=fixture();await flush();
  assert.equal(f.plays.length,1);assert.equal(f.audio.muted,false);assert.equal(f.audio.volume,1);assert.equal(f.sound.hidden,true);
  f.setNow(90000);f.frame();assert.equal(f.home.dataset.stage,'studio','a stalled music clock must not advance the intro');
  f.audio.currentTime=3.9;f.frame();assert.equal(f.home.dataset.stage,'warning');
  f.audio.currentTime=8.9;f.frame();assert.equal(f.home.dataset.stage,'title');assert.equal(f.styles.get('--opening-reveal'),'1');
  f.audio.currentTime=.1;f.frame();assert.equal(f.home.dataset.stage,'title');assert.equal(f.styles.get('--opening-blur'),'0px');
});

test('blocked autoplay keeps a visible brand, and explicit audio retry preserves the current stage/cue',async()=>{
  const f=fixture({play:'reject'});await flush();
  assert.equal(f.sound.hidden,false);assert.equal(f.home.dataset.stage,'studio');assert.equal(f.styles.get('--opening-cue'),'1');
  f.setNow(90000);f.frame();assert.equal(f.home.dataset.stage,'studio');
  f.click();await flush();assert.equal(f.home.dataset.stage,'warning');assert.equal(f.audio.currentTime,3.4);
  f.audio.currentTime=4.2;f.opening.enableFromGesture();await flush();
  assert.equal(f.home.dataset.stage,'warning');assert.equal(f.audio.currentTime,4.2);assert.equal(f.sound.hidden,false);
});

test('three rapid clicks from the brand advance once each and enter the menu before any play promise settles',async()=>{
  const f=fixture({play:'pending'});
  f.click();assert.equal(f.home.dataset.stage,'warning');assert.equal(f.audio.currentTime,3.4);assert.equal(f.routes.length,0);
  f.click();assert.equal(f.home.dataset.stage,'title');assert.equal(f.audio.currentTime,8.9);
  assert.equal(f.styles.get('--opening-reveal'),'1');assert.equal(f.styles.get('--opening-blur'),'0px');
  f.click();assert.deepEqual(f.routes,['collection']);assert.equal(f.context.primed,1);assert.equal(f.audio.src,'');
  f.click();assert.equal(f.routes.length,1);
  for(const attempt of [...f.plays].reverse())attempt.resolve();await flush();
  assert.equal(f.audio.paused,true);assert.equal(f.sound.hidden,true);assert.equal(f.frames.size,0);
});

test('the enable-sound button bubbles through the same one-step handler without consuming an extra tap',async()=>{
  const f=fixture({play:'reject'});await flush();assert.equal(f.sound.hidden,false);
  f.click(f.sound);assert.equal(f.home.dataset.stage,'warning');assert.equal(f.audio.currentTime,3.4);assert.equal(f.routes.length,0);
  await flush();f.click(f.sound);assert.equal(f.home.dataset.stage,'title');assert.equal(f.audio.currentTime,8.9);
  await flush();f.click(f.sound);assert.deepEqual(f.routes,['collection']);assert.equal(f.plays.length,3);
});

test('rapid seeks before metadata retain only the latest cue and show a complete title immediately',async()=>{
  const f=fixture({play:'pending',metadata:false,seekThrows:true});
  f.click();assert.equal(f.home.dataset.stage,'warning');
  f.click();assert.equal(f.home.dataset.stage,'title');assert.equal(f.styles.get('--opening-reveal'),'1');
  f.frame();assert.equal(f.home.dataset.stage,'title');assert.equal(f.audio.currentTime,0);
  f.audio.seekThrows=false;f.audio.readyState=4;f.audio.dispatchEvent(new Event('loadedmetadata'));
  assert.equal(f.audio.currentTime,8.9);assert.equal(f.home.dataset.stage,'title');
  f.plays[0].reject();f.plays[1].reject();f.plays[2].resolve();await flush();
  assert.equal(f.sound.hidden,true);assert.equal(f.audio.currentTime,8.9);
});

test('an old autoplay rejection cannot reveal fallback after a newer gesture succeeds',async()=>{
  const f=fixture({play:'pending'});f.click();f.click();
  f.plays[2].resolve();await flush();assert.equal(f.sound.hidden,true);
  f.plays[0].reject();f.plays[1].reject();await flush();
  assert.equal(f.sound.hidden,true);assert.equal(f.home.dataset.stage,'title');assert.equal(f.audio.currentTime,8.9);
});

test('synchronous autoplay errors retain fallback and do not reset gesture progression',()=>{
  const f=fixture({play:'throw'});assert.equal(f.sound.hidden,false);
  f.click(f.sound);assert.equal(f.home.dataset.stage,'warning');assert.equal(f.sound.hidden,false);
  f.click();assert.equal(f.home.dataset.stage,'title');assert.equal(f.styles.get('--opening-reveal'),'1');
  f.click();assert.deepEqual(f.routes,['collection']);
});

test('visibility pauses and restores the exact music cue without a wall-clock stage jump',async()=>{
  const f=fixture();await flush();f.audio.currentTime=4.2;f.frame();
  f.visibility(true);assert.equal(f.audio.paused,true);assert.equal(f.frames.size,0);
  f.click();assert.equal(f.home.dataset.stage,'warning');assert.equal(f.routes.length,0);
  f.audio.currentTime=0;f.setNow(900000);f.visibility(false);await flush();
  assert.equal(f.audio.currentTime,4.2);assert.equal(f.home.dataset.stage,'warning');assert.equal(f.sound.hidden,true);
  f.visibility(true);const attempts=f.plays.length;f.opening.stop();f.visibility(false);await flush();
  assert.equal(f.plays.length,attempts);assert.equal(f.audio.src,'');assert.equal(f.frames.size,0);
});

test('stop invalidates late promises and metadata; returning home starts directly at a clear title',async()=>{
  const f=fixture({play:'pending'});f.click();f.opening.stop();
  f.plays[0].reject();f.plays[1].resolve();f.audio.dispatchEvent(new Event('loadedmetadata'));await flush();
  assert.equal(f.audio.paused,true);assert.equal(f.sound.hidden,true);assert.equal(f.audio.preload,'none');assert.equal(f.frames.size,0);
  f.opening.show(false);assert.equal(f.home.dataset.stage,'title');assert.equal(f.styles.get('--opening-reveal'),'1');assert(f.audio.src);
  f.audio.readyState=4;f.audio.dispatchEvent(new Event('loadedmetadata'));assert.equal(f.audio.currentTime,8.9);
  f.plays.at(-1).resolve();await flush();f.click();assert.deepEqual(f.routes,['collection']);
});
