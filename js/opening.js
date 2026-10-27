/* Opening cues measured from the user's 2026-10-22 reference recording. */
(() => {
  'use strict';
  const cues = globalThis.PhiHostedManifest.opening;
  const home = document.getElementById('refHome');
  const audio = new Audio();
  const openingSpec=globalThis.PhiHostedMedia?.selectAudio(cues.audioSpec||{url:cues.audio},audio);
  const audioURL=new URL(openingSpec?.url||cues.audio,document.baseURI).href;
  audio.src=audioURL;
  audio.loop = true; audio.preload = 'metadata'; audio.muted = false; audio.volume = 1; audio.setAttribute('playsinline', '');
  audio.id='openingAudio';audio.hidden=true;home.appendChild(audio);
  const canvas = document.getElementById('openingParticles'), ctx = canvas.getContext('2d');
  const sound = document.getElementById('openingSound');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const stages = ['studio', 'warning', 'title'];
  let raf = 0, stage = 0, manualStage = -1, titleClear = false, visible = false, suspended = false, blocked = false;
  let playAttempt = 0, pendingSeek = null, resumeTime = 0;
  let width = 682, height = 512, scale = 1;
  const clamp = value => Math.max(0, Math.min(1, value));
  const particles = Array.from({length: 42}, (_, i) => ({x: ((i * 193 + 79) % 997) / 997, y: ((i * 137 + 71) % 991) / 991, size: 1 + (i % 4) * .45, speed: .004 + (i % 5) * .0018}));
  function resize() {
    width=home.clientWidth||innerWidth;height=home.clientHeight||innerHeight;scale=Math.min(1.5,devicePixelRatio||1);
    canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
  }
  function draw(time) {
    ctx.setTransform(scale,0,0,scale,0,0);ctx.clearRect(0,0,width,height);
    if(home.dataset.stage!=='title'||reduced)return;
    const u=width/682,y=height/512,beat=time/(60/109.5);
    const mesh=Math.pow(Math.max(0,Math.sin((beat-12)*Math.PI/8)),5)*.48;
    ctx.lineWidth=.7*u;
    const step=138*u,vertical=80*y,offset=40*Math.sin(beat*.09)*u;
    for(let row=-1;row<8;row++)for(let col=2;col<7;col++){
      const x=col*step+(row%2)*step/2-160*u+offset,py=row*vertical;
      const proximity=clamp((x-width*.38)/(width*.36));
      ctx.strokeStyle=`rgba(150,235,246,${mesh*proximity})`;
      ctx.beginPath();ctx.moveTo(x,py);ctx.lineTo(x+step,py);ctx.lineTo(x+step/2,py+vertical);ctx.closePath();ctx.stroke();
      if(mesh>.05){ctx.fillStyle=`rgba(182,249,255,${mesh*proximity})`;ctx.fillRect(x-1*u,py-1*y,2*u,2*y);}
    }
    for(const p of particles){
      const px=(.52+p.x*.48)*width,py=((p.y-time*p.speed)%1+1)%1*height;
      const alpha=.22+.5*(.5+.5*Math.sin(time*1.7+p.x*19));
      ctx.fillStyle=`rgba(235,250,255,${alpha})`;ctx.shadowColor='#b5f8ff';ctx.shadowBlur=5*u;
      ctx.fillRect(px,py,p.size*u,p.size*u);
    }
    ctx.shadowBlur=0;
  }
  function clock() {
    // The audio clock owns automatic transitions. A blocked/stalled audio
    // element must not silently advance to another screen on a wall timer.
    return pendingSeek == null ? Math.max(0, Number(audio.currentTime) || 0) : pendingSeek;
  }
  function paint() {
    const time = clock();
    if(time>=cues.titleAt)stage=2;
    else if(time>=cues.warningAt)stage=Math.max(stage,1);
    home.dataset.stage=stages[stage];
    if(stage===2&&(manualStage===2||time>=cues.titleSettledAt||time<cues.titleAt))titleClear=true;
    const titleProgress=titleClear?1:clamp((time-cues.titleAt)/(cues.titleSettledAt-cues.titleAt));
    home.style.setProperty('--opening-reveal',String(titleProgress));
    home.style.setProperty('--opening-blur',`${reduced?0:(1-titleProgress)*12}px`);
    home.style.setProperty('--opening-prompt',String(.78+.22*Math.cos(time/(60/109.5)*Math.PI)));
    const cue=manualStage===stage||blocked||time===0?1:stage===0?clamp(time/.45)*clamp((3.5-time)/.5):stage===1?clamp((time-3.35)/.4)*clamp((8.0-time)/.45):1;
    home.style.setProperty('--opening-cue',String(cue));
    draw(time);
  }
  function frame() {
    raf=0;if(!visible||suspended)return;
    paint();raf=requestAnimationFrame(frame);
  }
  function animate(){if(!raf&&visible&&!suspended)raf=requestAnimationFrame(frame);}
  function applySeek() {
    if(pendingSeek==null||!visible||suspended)return;
    const target=pendingSeek;
    try{
      audio.currentTime=target;
      // Some media elements defer seeking until metadata is available. Keep
      // only the latest requested cue, including across several rapid taps.
      if(audio.readyState>0&&Math.abs((Number(audio.currentTime)||0)-target)<.05)pendingSeek=null;
    }catch{}
  }
  function seek(time) {pendingSeek=Math.max(0,Number(time)||0);applySeek();}
  function play() {
    if(!visible||suspended)return;
    const token=++playAttempt;
    sound.hidden=true;
    const success=()=>{
      if(!visible||suspended){audio.pause();return;}
      if(token!==playAttempt)return;
      blocked=false;sound.hidden=true;applySeek();paint();
    };
    const failure=()=>{
      if(token!==playAttempt||!visible||suspended)return;
      blocked=true;sound.hidden=false;paint();
    };
    // A browser can reject play() or throw synchronously. Neither path resets
    // the visual stage or pretends that audible autoplay was granted.
    try{Promise.resolve(audio.play()).then(success,failure);}catch{failure();}
    animate();
  }
  function show(initial=false) {
    if(!audio.getAttribute?.('src'))audio.src=audioURL;
    audio.preload='metadata';
    ++playAttempt;visible=true;suspended=!!document.hidden;blocked=false;sound.hidden=true;
    stage=initial?0:2;manualStage=initial?-1:2;titleClear=!initial;resize();
    resumeTime=initial?0:cues.titleSettledAt;
    pendingSeek=resumeTime;applySeek();paint();
    play();animate();
  }
  function stop(){
    ++playAttempt;visible=false;suspended=false;pendingSeek=null;sound.hidden=true;audio.pause();audio.preload='none';
    // Pausing alone lets the title music continue downloading while the selected
    // song is buffering. Releasing its source cancels that competing request.
    audio.removeAttribute?.('src');audio.load();
    if(raf)cancelAnimationFrame(raf);raf=0;
  }
  function enableFromGesture() {
    if(!visible||suspended)return;
    seek(Math.max(clock(),stage===2?cues.titleSettledAt:stage===1?cues.warningAt:0));
    play();paint();
  }
  function advanceFromGesture() {
    if(!visible)return true;
    if(suspended)return false;
    // Update synchronously before play() resolves or the next animation frame:
    // three rapid taps are three distinct transitions, not three audio retries.
    paint();
    if(stage===2)return true;
    stage++;manualStage=stage;
    if(stage===2)titleClear=true;
    seek(stage===1?cues.warningAt:cues.titleSettledAt);
    paint();play();return false;
  }
  // The fallback button uses the same single bubbling click as the home screen:
  // unlocking sound is also the first advance, never an extra consumed tap.
  sound.onclick=null;
  audio.addEventListener?.('loadedmetadata',()=>{if(visible&&!suspended){applySeek();paint();}});
  audio.addEventListener?.('canplay',()=>{if(visible&&!suspended)applySeek();});
  window.addEventListener('resize',resize,{passive:true});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){
      suspended=visible;resumeTime=clock();++playAttempt;audio.pause();if(raf)cancelAnimationFrame(raf);raf=0;
    }else if(suspended&&visible){suspended=false;seek(resumeTime);paint();play();animate();}
  });
  globalThis.PhiOpening=Object.freeze({show,stop,enableFromGesture,advanceFromGesture,readyForStart:()=>stage===2,audio,cues});
  const bypass=new URLSearchParams(location.search).has('skipIntro')||new URLSearchParams(location.search).has('phiSelfTest');
  if(!bypass)show(true);else stop();
})();
