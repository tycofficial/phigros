/* Resumable same-origin transfers. Slow progress is never a terminal error. */
(() => {
  'use strict';
  const CHUNK = 256 * 1024, LIMIT = 4;
  let active = 0;
  const queue = [];
  const cancelled = () => new DOMException('资源读取已取消', 'AbortError');
  function check(signal) { if (signal?.aborted) throw cancelled(); }
  function slot(signal) {
    check(signal);
    return new Promise((resolve, reject) => {
      const entry = { start: null, abort: null };
      entry.abort = () => { const i=queue.indexOf(entry); if(i>=0)queue.splice(i,1); reject(cancelled()); };
      entry.start = () => {
        signal?.removeEventListener('abort', entry.abort);
        active++;
        let released=false;
        resolve(() => { if(released)return; released=true; active--; queue.shift()?.start(); });
      };
      if(active<LIMIT)entry.start();
      else { queue.push(entry); signal?.addEventListener('abort',entry.abort,{once:true}); }
    });
  }
  function delay(ms, signal) {
    check(signal);
    return new Promise((resolve,reject) => {
      const abort=()=>{clearTimeout(timer);reject(cancelled());};
      const timer=setTimeout(()=>{signal?.removeEventListener('abort',abort);resolve();},ms);
      signal?.addEventListener('abort',abort,{once:true});
    });
  }
  function permanent(message) { return Object.assign(Error(message), {permanent:true}); }
  async function download(path, {signal,onProgress,priority='auto',expectedSize=0,parallel=3}={}) {
    const address=new URL(path,globalThis.document?.baseURI||globalThis.location.href);
    if(address.origin!==location.origin||!/^https?:$/.test(address.protocol))throw permanent('资源必须来自本站');
    let total=Number(expectedSize)||0, received=0;
    const report=delta=>{received+=delta;onProgress?.(received,total);};
    async function request(start=0,end=null) {
      let failures=0;
      for(;;){
        check(signal);
        const release=await slot(signal);
        try{
          check(signal);
          const response=await fetch(address.href,{credentials:'same-origin',signal,priority,
            headers:end==null?{}:{Range:`bytes=${start}-${end}`}});
          if(!response.ok){
            if(response.status!==408&&response.status!==429&&response.status<500)
              throw permanent(`资源加载失败（${response.status}）：${path}`);
            throw Error(`HTTP ${response.status}`);
          }
          const partial=response.status===206;
          if(partial){
            const match=/^bytes (\d+)-(\d+)\/(\d+)$/.exec(response.headers.get('Content-Range')||'');
            if(!match||Number(match[1])!==start||Number(match[2])!==Math.min(end,Number(match[3])-1)||
              (total&&total!==Number(match[3])))throw permanent('资源分块范围不一致');
            total=Number(match[3]);
          } else if(response.status!==200)throw permanent('资源响应无效');
          const length=Number(response.headers.get('Content-Length'))||0;
          if(!partial&&!total&&length&&!response.headers.get('Content-Encoding'))total=length;
          const chunks=[];let count=0;
          try{
            if(response.body?.getReader){
              const reader=response.body.getReader();
              for(;;){check(signal);const part=await reader.read();if(part.done)break;
                chunks.push(part.value);count+=part.value.byteLength;report(part.value.byteLength);}
            }else{const part=new Uint8Array(await response.arrayBuffer());chunks.push(part);count=part.length;report(count);}
            const wanted=partial?Math.min(end,total-1)-start+1:total;
            if(wanted&&count!==wanted)throw Error('资源传输中断');
          }catch(error){report(-count);throw error;}
          const bytes=new Uint8Array(count);let at=0;
          for(const chunk of chunks){bytes.set(chunk,at);at+=chunk.byteLength;}
          return {bytes,partial};
        }catch(error){
          check(signal);
          if(error.permanent)throw error;
          // Browser/network failures retry only this block; completed blocks stay.
          failures++;
        }finally{release();}
        await delay(Math.min(8000,500*2**Math.min(failures-1,4)),signal);
      }
    }
    // Probe with useful data instead of an extra HEAD round trip. Servers which
    // ignore Range return one full response; do not start duplicate downloads.
    const first=await request(0,total?Math.min(CHUNK,total)-1:CHUNK-1);
    if(!first.partial)return first.bytes;
    const output=new Uint8Array(total);output.set(first.bytes);
    let next=first.bytes.length;
    const group=new AbortController(),abort=()=>group.abort();
    signal?.addEventListener('abort',abort,{once:true});
    // The caller owns cancellation. On a permanent sibling failure, drain all
    // jobs before returning so no detached work can keep retrying in the back.
    // request observes the group through the local signal binding below.
    const originalSignal=signal;signal=group.signal;
    if(originalSignal?.aborted)group.abort();
    let failure;
    try{
      await Promise.all(Array.from({length:Math.min(3,Math.max(1,parallel))},async()=>{
        try{
          while(next<total){check(signal);const start=next;next+=CHUNK;
            const end=Math.min(total-1,start+CHUNK-1),part=await request(start,end);
            if(!part.partial){
              if(part.bytes.length!==total)throw permanent('资源完整长度不一致');
              output.set(part.bytes.subarray(start,end+1),start);
            }else output.set(part.bytes,start);
          }
        }catch(error){if(!failure)failure=error;group.abort();}
      }));
      if(failure)throw failure;
      onProgress?.(total,total);return output;
    }finally{originalSignal?.removeEventListener('abort',abort);}
  }
  async function cachedDownload(path,options){
    const bytes=await download(path,options);
    // Only a complete assembled object may enter the durable media cache.
    // Range responses themselves are deliberately never stored as full files.
    const address=new URL(path,globalThis.document?.baseURI||globalThis.location.href);
    if(globalThis.caches&&/\/assets\//.test(address.pathname)&&bytes.length<=8*1024*1024){
      caches.open('tycphigros-4.0.1.2-stability-2').then(cache=>cache.put(address.href,
        new Response(bytes,{headers:{'Content-Length':String(bytes.length),'Accept-Ranges':'bytes'}}))).catch(()=>{});
    }
    return bytes;
  }
  globalThis.PhiTransfer=Object.freeze({download:cachedDownload});
})();
