/* Same-origin complete music preparation. Full originals remain the export source. */
(() => {
  'use strict';
  const manifest = globalThis.PhiHostedManifest;
  const downloads = new Map();
  let cachedBytes = 0;
  let networkSample = null;
  const MAX_CACHE = 12 * 1024 * 1024;
  function url(path) {
    const value = new URL(path, document.baseURI);
    if (value.origin !== location.origin || !/^https?:$/.test(value.protocol)) throw Error('资源必须来自本站');
    return value.href;
  }
  function abortable(promise,signal){
    if(!signal)return promise;
    return new Promise((resolve,reject)=>{
      const abort=()=>reject(new DOMException('资源读取已取消','AbortError'));
      if(signal.aborted)return abort();
      signal.addEventListener('abort',abort,{once:true});
      promise.then(resolve,reject).finally(()=>signal.removeEventListener('abort',abort));
    });
  }
  let transferReady;
  function ensureTransfer(){
    if(globalThis.PhiTransfer)return Promise.resolve();
    // A previously cached entry may not include the new dependency yet.
    return transferReady||=(new Promise(resolve=>{
      const load=()=>{
        const script=document.createElement('script');script.src=url('./js/resource-transfer.js?v=4.0.1.2-pages-6');
        script.onload=resolve;script.onerror=()=>{script.remove();setTimeout(load,1500);};document.head.appendChild(script);
      };load();
    }));
  }
  async function bytes(path, { onProgress, priority = 'auto', signal, expectedSize = 0 } = {}) {
    if(signal?.aborted)throw new DOMException('资源读取已取消','AbortError');
    const href=url(path);
    let item=downloads.get(href);
    if(item?.controller.signal.aborted){downloads.delete(href);item=null;}
    if(!item){
      item={size:0,consumers:0,listeners:new Set(),controller:new AbortController(),promise:null,started:performance.now()};
      const current=item;
      item.promise=ensureTransfer().then(()=>PhiTransfer.download(href,{priority,expectedSize,signal:item.controller.signal,
        onProgress:(done,total)=>{for(const listener of current.listeners)listener(done,total);}
      })).then(result=>{
        const elapsed=(performance.now()-current.started)/1000;
        // Tiny/cache-speed responses cannot establish the route's bandwidth.
        if(result.byteLength>=65536&&elapsed>=.08)
          networkSample={rate:result.byteLength/elapsed,at:performance.now()};
        current.size=result.byteLength;cachedBytes+=current.size;
        for(const [key,old] of downloads){if(cachedBytes<=MAX_CACHE)break;
          if(old!==current&&old.size&&!old.consumers){cachedBytes-=old.size;downloads.delete(key);}}
        return result;
      },error=>{if(downloads.get(href)===current)downloads.delete(href);throw error;});
      downloads.set(href,item);
    }
    item.consumers++;if(onProgress)item.listeners.add(onProgress);
    try{return await abortable(item.promise,signal);}
    finally{
      if(onProgress)item.listeners.delete(onProgress);
      if(--item.consumers===0&&!item.size)item.controller.abort();
    }
  }
  async function artwork(asset, { onStage, active = () => true, maxStage = 2, fromStage = 0, signal } = {}) {
    const spec = manifest.artwork[asset];
    if (!spec) return null;
    let last = null;
    for (let stage = fromStage; stage <= Math.min(maxStage, spec.stages.length - 1); stage++) {
      if (!active()) break;
      try {
        const data = await bytes(spec.stages[stage].url, { priority: stage === 0 ? 'high' : 'low',signal });
        const blob = new Blob([data], { type: 'image/jpeg' });
        if (!active()) break;
        last = blob;
        await onStage?.(blob, stage);
      } catch (error) {
        if(error.name==='AbortError')break;
        // A failed clear image must never hide the already visible small image.
        if (stage === 0) throw error;
        console.warn('[Artwork]', error.message);
      }
    }
    return last;
  }
  function bufferedAhead(audio, at = Number(audio.currentTime) || 0) {
    for (let i = 0; i < audio.buffered.length; i++) {
      if (audio.buffered.start(i) <= at + .15 && audio.buffered.end(i) > at)
        return Math.max(0, audio.buffered.end(i) - at);
    }
    return 0;
  }
  function chartTask(data,transfer=[],{onProgress,signal}={}){
    return new Promise((resolve,reject)=>{
      let worker,settled=false;
      const finish=(error,bytes)=>{if(settled)return;settled=true;signal?.removeEventListener('abort',abort);worker?.terminate();error?reject(error):resolve(bytes);};
      const abort=()=>finish(new DOMException('谱面加载已取消','AbortError'));
      if(signal?.aborted)return abort();
      try{
        worker=new Worker(url('./js/chart-decode-worker.js?v=4.0.1.2-pages-6'));
        worker.onmessage=({data})=>{
          if(settled)return;
          if(data.type==='progress'){onProgress?.(data.received,data.total,data.stage);return;}
          finish(data.ok?null:Error(data.error),data.bytes);
        };
        worker.onerror=()=>finish(Object.assign(Error('谱面后台线程不可用'),{name:'WorkerUnavailableError'}));
        signal?.addEventListener('abort',abort,{once:true});
        worker.postMessage(data,transfer);
      }catch(error){finish(Object.assign(Error(error?.message||'谱面后台线程不可用'),{name:'WorkerUnavailableError'}));}
    });
  }
  function decodeChart(packed,expectedSize){
    const bytes=packed.slice();return chartTask({bytes,expectedSize},[bytes.buffer]);
  }
  function loadChart(spec,options={}){
    return chartTask({url:url(spec.url),offset:Number(spec.offset)||0,length:Number(spec.byteLength),expectedSize:Number(spec.usize)||0},[],options);
  }
  function bufferTarget(duration, downloadRate, elapsed, minimum = 6) {
    if(globalThis.PhiPerformance)return PhiPerformance.startupBuffer(duration,downloadRate,elapsed,minimum);
    if (elapsed < 1.2 || !(downloadRate > 0)) return Math.min(duration, minimum);
    return Math.min(duration, downloadRate >= 2 ? minimum : Math.max(minimum,12));
  }
  function audioQuality() {
    const connection=navigator.connection||navigator.mozConnection||navigator.webkitConnection;
    if(connection?.saveData||/^(slow-2g|2g|3g)$/.test(connection?.effectiveType||'')||
      (connection?.downlink>0&&connection.downlink<1.5)||connection?.rtt>=500)return 'low';
    if(networkSample&&performance.now()-networkSample.at<60000)
      return networkSample.rate>=256*1024?'high':'low';
    if(connection?.downlink>=4&&(!connection.rtt||connection.rtt<400))return 'high';
    // Safari often has no Network Information API. Start conservatively until
    // same-origin resource transfers establish a usable bandwidth sample.
    return 'low';
  }
  function selectAudio(spec,audio,forceLow=false) {
    if(!spec.low)return {...spec,mime:spec.mime||'audio/mp4',quality:'high',formatLabel:'原始音质'};
    const supports=mime=>!!audio.canPlayType?.(mime);
    if(!forceLow&&audioQuality()==='high'){
      const high=[spec.lossless,spec.high].find(variant=>variant&&supports(variant.mime));
      if(high||supports(spec.mime||'audio/mp4'))
        return {...spec,...(high||{}),quality:'high',formatLabel:high&&high===spec.lossless?'无损音质':'原始音质',mime:high?.mime||spec.mime||'audio/mp4'};
    }
    const variant=supports(spec.low.mime)?spec.low:spec.lowFallback||spec.low;
    return {...spec,...variant,quality:'low',formatLabel:variant===spec.low?'省流 OGG':'省流 AAC'};
  }
  class Stream {
    constructor(audio, spec, onProgress) {
      this.audio = audio; this.spec = spec; this.onProgress = onProgress;
      this.controller = new AbortController(); this.started = performance.now();
      this.lastBufferEnd=0;this.downloadRate=0;this.initialReady=false;
      audio.pause(); audio.loop = false; audio.muted = false; audio.preload = 'auto';
      audio.setAttribute('playsinline', '');
      this.blob=null;this.blobURL='';this.loadedBytes=0;
      this.downloadReady=this.readMusic().then(data=>{
        if(this.controller.signal.aborted)throw new DOMException('已返回选歌','AbortError');
        this.blob=new Blob([data],{type:this.selectedSpec.mime});this.blobURL=URL.createObjectURL(this.blob);
        audio.src=this.blobURL;audio.load();return audio;
      });
      this.downloadReady.catch(()=>{});
    }
    async readMusic() {
      let selected=selectAudio(this.spec,this.audio);
      for(;;){
        this.selectedSpec=selected;this.loadedBytes=0;
        const controller=new AbortController(),abort=()=>controller.abort();
        this.controller.signal.addEventListener('abort',abort,{once:true});
        if(this.controller.signal.aborted)controller.abort();
        const started=performance.now();let downgrade=false;
        // A changed/overoptimistic connection hint must not trap weak networks
        // on the large file. This changes quality, never ends song loading.
        const timer=selected.quality==='high'&&this.spec.low?setInterval(()=>{
          const seconds=(performance.now()-started)/1000;
          if(seconds>=2&&this.loadedBytes/seconds<96*1024){downgrade=true;controller.abort();}
        },500):0;
        try{
          return await bytes(selected.url,{signal:controller.signal,priority:'high',expectedSize:selected.bytes,
            onProgress:(done,total)=>{this.loadedBytes=done;this.onProgress?.({...this.snapshot(),downloaded:done,total,downloading:true});}});
        }catch(error){
          if(!downgrade||this.controller.signal.aborted)throw error;
          selected=selectAudio(this.spec,this.audio,true);
        }finally{clearInterval(timer);this.controller.signal.removeEventListener('abort',abort);}
      }
    }
    snapshot(minimum = 6) {
      const at = Number(this.audio.currentTime) || 0;
      const duration = Number.isFinite(this.audio.duration) && this.audio.duration > 0 ? this.audio.duration : this.spec.duration;
      const ahead = bufferedAhead(this.audio, at), elapsed = Math.max(.01, (performance.now() - this.started) / 1000);
      this.lastBufferEnd=Math.max(this.lastBufferEnd,ahead+at);
      // Initial browser bursts are not sustained throughput. Include quiet time
      // in the estimate, otherwise a fast first chunk hides an under-speed link.
      const rate=this.downloadRate=this.lastBufferEnd/elapsed;
      const remaining = Math.max(0, duration - at);
      const target = this.initialReady?Math.min(remaining,minimum):bufferTarget(remaining, rate, elapsed, minimum);
      return { ahead, target, duration, rate, quality:this.selectedSpec?.quality,formatLabel:this.selectedSpec?.formatLabel,complete: ahead >= remaining - .1,
        ready: !!this.blob && this.audio.readyState >= 3 };
    }
    wait(minimum = 6, {signal: externalSignal} = {}) {
      const audio = this.audio, signal = this.controller.signal;
      return new Promise((resolve, reject) => {
        let timer,settled=false;
        const finish = error => {
          if(settled)return;settled=true;
          clearInterval(timer);
          for (const event of ['progress', 'loadedmetadata', 'canplay', 'error']) audio.removeEventListener(event, check);
          signal.removeEventListener('abort', abort);
          externalSignal?.removeEventListener('abort',abort);
          error ? reject(error) : resolve(audio);
        };
        const abort = () => finish(new DOMException('已返回选歌', 'AbortError'));
        const check = () => {
          if (signal.aborted||externalSignal?.aborted) return abort();
          if (!this.blob) return;
          if (audio.error) return finish(Error('音乐文件无法解码'));
          const state = this.snapshot(minimum);
          this.onProgress?.({...state,downloaded:this.loadedBytes,total:this.selectedSpec?.bytes,downloading:false});
          if (state.ready) {this.initialReady=true;return finish();}
        };
        for (const event of ['progress', 'loadedmetadata', 'canplay', 'error']) audio.addEventListener(event, check);
        signal.addEventListener('abort', abort, { once: true });
        externalSignal?.addEventListener('abort',abort,{once:true});
        timer = setInterval(check, 120);
        this.downloadReady.then(check,finish);check();
      });
    }
    destroy() { this.controller.abort();if(this.blobURL)URL.revokeObjectURL(this.blobURL);this.blobURL='';this.blob=null; }
  }
  globalThis.PhiHostedMedia = Object.freeze({ manifest, url, bytes, artwork, bufferedAhead, bufferTarget, audioQuality,selectAudio,decodeChart, loadChart, Stream });
  if ('serviceWorker' in navigator && /^https?:$/.test(location.protocol)) {
    window.addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}), { once: true });
  }
})();
