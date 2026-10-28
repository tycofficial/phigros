/* Optional chapter video clips. Media is fetched only after an explicit selection. */
(() => {
  'use strict';
  const MAX_VIDEO_BYTES = 48 * 1024 * 1024;
  let byURL = new Map(), clips = [];
  const abortError = () => new DOMException('已取消', 'AbortError');
  function installManifest(manifest) {
    if (!manifest || manifest.version !== 1 || !Array.isArray(manifest.videos) || manifest.videos.length > 100)
      throw Error('过场片段清单格式无效');
    const next = new Map(), result = [], ids = new Set();
    for (const v of manifest.videos) {
      if (!v || !/^[a-z0-9][a-z0-9_-]{0,60}$/.test(v.id || '') || ids.has(v.id) ||
          !Number.isInteger(v.chapter) || v.chapter < 1 || v.chapter > 20 ||
          typeof v.title !== 'string' || !v.title.trim() || v.title.length > 120 ||
          v.mime !== 'video/mp4' || !Number.isSafeInteger(v.bytes) || v.bytes <= 0 || v.bytes > MAX_VIDEO_BYTES ||
          !/^[a-f0-9]{64}$/.test(v.sha256 || '')) throw Error('过场片段清单条目无效');
      const url = new URL(v.url), match = /^\/tycofficial\/phigros\/([a-f0-9]{40})\/vision\/([A-Za-z0-9][A-Za-z0-9._-]*\.mp4)$/.exec(url.pathname);
      if (url.origin !== 'https://raw.githubusercontent.com' || url.username || url.password || url.port || url.search || url.hash || !match || url.href !== v.url)
        throw Error('过场片段来源无效');
      const mirror = `https://cdn.jsdelivr.net/gh/tycofficial/phigros@${match[1]}/vision/${match[2]}`;
      if (v.mirror !== mirror || next.has(url.href) || next.has(mirror)) throw Error('过场备用来源无效');
      const item = Object.freeze({ id:v.id, chapter:v.chapter, title:v.title.trim(), url:url.href, mirror, bytes:v.bytes, sha256:v.sha256, mime:v.mime });
      ids.add(v.id);next.set(item.url,item);next.set(item.mirror,item);result.push(item);
    }
    byURL = next;clips = Object.freeze(result);return clips;
  }
  function info(value) {
    try {
      const u = new URL(String(value?.url || value), location.href);
      if (u.protocol !== 'https:' || u.username || u.password || u.port || u.search || u.hash) return null;
      return byURL.get(u.href) || null;
    } catch { return null; }
  }
  async function request(address, spec, signal, onProgress, timeout) {
    const controller = new AbortController(), abort = () => controller.abort();
    signal?.addEventListener('abort', abort, {once:true});
    if (signal?.aborted) controller.abort();
    let timer = setTimeout(abort, timeout), reader = null, done = false;
    // Larger video files need more time than short song assets on slow links.
    // Keep the independent 20-second no-progress timeout, while allowing a
    // steadily downloading 23 MB clip to complete at roughly 64 KiB/s.
    const totalMs = Math.max(120000, Math.min(600000, Math.ceil(spec.bytes / (64 * 1024)) * 1000));
    const overall = setTimeout(abort, totalMs);
    const renew = () => { clearTimeout(timer); timer = setTimeout(abort, 20000); };
    try {
      const response = await fetch(address, {mode:'cors',credentials:'omit',redirect:'error',signal:controller.signal});
      if (response.status !== 200 || response.redirected || (response.url && response.url !== address)) throw Error('来源响应无效');
      if (!response.body?.getReader) throw Error('浏览器不支持安全读取影片');
      reader = response.body.getReader();renew();
      const chunks = [];let count = 0;
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        count += chunk.value.byteLength;
        if (count > spec.bytes) throw Error('影片超出预期大小');
        chunks.push(chunk.value);onProgress?.(count, spec.bytes);renew();
      }
      if (count !== spec.bytes) throw Error('影片长度不符');
      const bytes = new Uint8Array(count);let offset = 0;
      for (const chunk of chunks) { bytes.set(chunk,offset);offset += chunk.length; }
      const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), n => n.toString(16).padStart(2,'0')).join('');
      if (signal?.aborted) throw abortError();
      if (digest !== spec.sha256) throw Error('影片校验失败');
      done = true;return bytes;
    } finally {
      clearTimeout(timer);clearTimeout(overall);signal?.removeEventListener('abort',abort);
      if (!done) { controller.abort();if (reader) try { await reader.cancel(); } catch {} }
      try { reader?.releaseLock?.(); } catch {}
    }
  }
  async function download(value, {signal,onProgress,onSource} = {}) {
    const href = new URL(value, location.href).href, spec = info(href);
    if (!spec) throw Error('影片不在固定来源清单中');
    const addresses = [spec.url,spec.mirror];let last;
    for (let i=0;i<addresses.length;i++) {
      if (signal?.aborted) throw abortError();
      onSource?.(i);onProgress?.(0,spec.bytes);
      try { return await request(addresses[i],spec,signal,onProgress,i===0?5000:12000); }
      catch (error) { if (signal?.aborted) throw abortError();last=error; }
    }
    throw Error('影片来源不可访问或校验失败，请检查网络后重试'+(last?.message?'（'+last.message+'）':''));
  }
  globalThis.PhiVisionReplay = Object.freeze({info,installManifest,download});
  if (typeof document === 'undefined') return;
  const panel=document.getElementById('visionReplayPanel'), open=document.getElementById('visionReplayOpen'), close=document.getElementById('visionReplayClose');
  const list=document.getElementById('visionReplayList'), video=document.getElementById('visionReplayVideo'), status=document.getElementById('visionReplayStatus'), progress=document.getElementById('visionReplayProgress');
  if (!panel || !open || !close || !list || !video || !status || !progress) return;
  let controller=null, manifestController=null, blobURL='', generation=0, focusBefore=null;
  function stopMedia() {
    generation++;controller?.abort();controller=null;
    video.pause();video.removeAttribute('src');video.load();video.hidden=true;
    if(blobURL){URL.revokeObjectURL(blobURL);blobURL='';}
    progress.hidden=true;
  }
  function hidePanel() {
    manifestController?.abort();manifestController=null;stopMedia();
    panel.classList.add('hidden');focusBefore?.focus?.();focusBefore=null;
  }
  function fillList() {
    list.replaceChildren();
    for (const clip of [...clips].sort((a,b)=>a.chapter-b.chapter)) {
      const button=document.createElement('button'),label=document.createElement('small'),title=document.createElement('span');
      button.type='button';button.dataset.clip=clip.id;button.setAttribute('aria-pressed','false');
      label.textContent=`第 ${clip.chapter} 章`;title.textContent=clip.title;button.append(label,title);
      button.addEventListener('click',()=>void selectClip(clip,button));list.appendChild(button);
    }
    if (!clips.length) { const p=document.createElement('p');p.textContent='暂无可播放片段。';list.appendChild(p); }
  }
  async function selectClip(clip,button) {
    stopMedia();const serial=generation;controller=new AbortController();const signal=controller.signal;
    for(const item of list.querySelectorAll('button'))item.setAttribute('aria-pressed',String(item===button));
    if (!video.canPlayType('video/mp4')) {status.textContent='此浏览器不支持 MP4 视频，请更新浏览器。';return;}
    status.textContent=`正在加载 ${clip.title}…`;progress.value=0;progress.hidden=false;
    try {
      const bytes=await download(clip.url,{signal,onSource:index=>{if(serial===generation)status.textContent=index?'主来源不可用，正在尝试备用来源…':`正在加载 ${clip.title}…`;},onProgress:(done,total)=>{if(serial===generation)progress.value=total?100*done/total:0;}});
      if(signal.aborted||serial!==generation)return;
      blobURL=URL.createObjectURL(new Blob([bytes],{type:clip.mime}));video.src=blobURL;video.hidden=false;video.load();progress.hidden=true;
      status.textContent='片段已就绪，请点击视频的播放键。';
    } catch(error) {
      if(serial!==generation)return;
      progress.hidden=true;status.textContent=error?.name==='AbortError'?'加载已取消，请重新选择片段。':String(error?.message||'影片加载失败');
    }
  }
  open.addEventListener('click',async()=>{
    focusBefore=document.activeElement;panel.classList.remove('hidden');close.focus();
    if(clips.length){fillList();status.textContent='选择片段后按需加载。';return;}
    manifestController?.abort();manifestController=new AbortController();const local=manifestController;
    list.replaceChildren();status.textContent='正在读取片段列表…';
    try {
      const response=await fetch('./assets/meta/vision-media.json',{signal:local.signal});
      if(!response.ok)throw Error('片段列表暂不可用');const text=await response.text();if(text.length>100000)throw Error('片段列表过大');
      if(local.signal.aborted)return;installManifest(JSON.parse(text));fillList();status.textContent='选择片段后按需加载。';
    } catch(error) {if(!local.signal.aborted)status.textContent=`无法读取片段列表：${error.message}`;}
  });
  close.addEventListener('click',hidePanel);
  video.addEventListener('playing',()=>{if(blobURL&&!video.hidden)status.textContent='正在播放片段。';});
  video.addEventListener('pause',()=>{if(blobURL&&!video.hidden&&!video.ended)status.textContent='已暂停，可继续播放或返回。';});
  video.addEventListener('ended',()=>{if(blobURL&&!video.hidden)status.textContent='播放结束，可再次播放或返回。';});
  video.addEventListener('error',()=>{if(!video.hidden)status.textContent='视频无法解码，请更新浏览器或重试。';});
  document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!panel.classList.contains('hidden')){event.preventDefault();event.stopImmediatePropagation();hidePanel();}},true);
  document.addEventListener('visibilitychange',()=>{if(document.hidden&&!panel.classList.contains('hidden')){video.pause();if(controller&&!blobURL){controller.abort();status.textContent='加载已取消，请重新选择片段。';progress.hidden=true;}}});
})();
