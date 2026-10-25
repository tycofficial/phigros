const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
function runtime(fetch,overrides={}){
  const context=vm.createContext({URL,Uint8Array,Response,DOMException,AbortController,Promise,
    setTimeout,clearTimeout,location:{origin:'https://example.test',href:'https://example.test/phigros/'},
    fetch,...overrides});
  vm.runInContext(fs.readFileSync('js/resource-transfer.js','utf8'),context);
  return context.PhiTransfer;
}
const data=Uint8Array.from({length:1100000},(_,i)=>i*37%251);
function partial(bytes,range){
  const [,a,b]=/^bytes=(\d+)-(\d+)$/.exec(range),start=Number(a),end=Math.min(Number(b),bytes.length-1);
  return new Response(bytes.slice(start,end+1),{status:206,headers:{
    'Content-Range':`bytes ${start}-${end}/${bytes.length}`,'Content-Length':String(end-start+1)}});
}
test('parallel blocks assemble exactly and retry only the interrupted block',async()=>{
  const requests=[];let concurrent=0,peak=0,failed=false;
  const media=runtime(async (_url,{headers})=>{
    requests.push(headers.Range);concurrent++;peak=Math.max(peak,concurrent);
    await new Promise(resolve=>setTimeout(resolve,5));concurrent--;
    if(headers.Range==='bytes=262144-524287'&&!failed){failed=true;throw TypeError('connection reset');}
    return partial(data,headers.Range);
  },{setTimeout:(fn,ms)=>setTimeout(fn,Math.min(ms,5))});
  const result=await media.download('./assets/music.m4a',{expectedSize:data.length});
  assert.deepEqual(Buffer.from(result),Buffer.from(data));assert(peak>=2&&peak<=3);
  assert.equal(requests.filter(r=>r==='bytes=0-262143').length,1);
  assert.equal(requests.filter(r=>r==='bytes=262144-524287').length,2);
});
test('a server ignoring Range produces one full download without parallel duplicates',async()=>{
  let calls=0;const media=runtime(async()=>{calls++;return new Response(data);});
  assert.deepEqual(Buffer.from(await media.download('./music')),Buffer.from(data));assert.equal(calls,1);
});
test('transparent HTTP compression does not mistake encoded Content-Length for decoded bytes',async()=>{
  let calls=0;const media=runtime(async()=>{
    calls++;return new Response('long decoded response',{headers:{'Content-Length':'5','Content-Encoding':'gzip'}});
  });
  assert.equal(Buffer.from(await media.download('./assets/meta/info.json')).toString(),'long decoded response');assert.equal(calls,1);
});
test('a transfer can remain silent beyond old deadlines and finish without a timeout timer',async()=>{
  let resolve;const timers=[];
  const media=runtime(()=>new Promise(r=>resolve=r),{setTimeout:(fn,ms)=>{timers.push(ms);return setTimeout(fn,ms);}});
  const pending=media.download('./slow');await new Promise(r=>setImmediate(r));
  assert.equal(timers.length,0);resolve(new Response('eventually'));assert.equal(Buffer.from(await pending).toString(),'eventually');
});
test('repeated temporary HTTP failures recover without a fixed retry count',async()=>{
  let calls=0;const media=runtime(async()=>++calls<=7?new Response('',{status:503}):new Response('ok'),
    {setTimeout:(fn)=>setTimeout(fn,0)});
  assert.equal(Buffer.from(await media.download('./slow')).toString(),'ok');assert.equal(calls,8);
});
test('cancel interrupts a pending retry and does not start another request',async()=>{
  const controller=new AbortController();let calls=0;
  const media=runtime(async()=>{calls++;return new Response('',{status:503});});
  const pending=media.download('./slow',{signal:controller.signal});
  await new Promise(r=>setImmediate(r));controller.abort();
  await assert.rejects(pending,{name:'AbortError'});assert.equal(calls,1);
});
test('mismatched byte offsets are rejected rather than assembled into corrupt music',async()=>{
  const media=runtime(async()=>new Response(new Uint8Array(10),{status:206,headers:{'Content-Range':'bytes 10-19/100'}}));
  await assert.rejects(media.download('./bad'),/分块范围不一致/);
});
test('a permanent sibling failure cancels other block fetches and drains them',async()=>{
  let alive=0;
  const media=runtime(async(_url,{headers,signal})=>{
    if(headers.Range==='bytes=0-262143')return partial(data,headers.Range);
    if(headers.Range==='bytes=262144-524287')return new Response('',{status:404});
    alive++;return new Promise((resolve,reject)=>{
      const abort=()=>{alive--;reject(new DOMException('cancel','AbortError'));};
      if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});
    });
  });
  await assert.rejects(media.download('./bad'),/404/);assert.equal(alive,0);
});
test('a site-wide budget limits concurrent requests across several large assets',async()=>{
  let active=0,peak=0;const media=runtime(async(_url,{headers})=>{
    active++;peak=Math.max(peak,active);await new Promise(r=>setTimeout(r,2));active--;
    return partial(data,headers.Range);
  });
  const results=await Promise.all(Array.from({length:5},(_,i)=>media.download('./asset'+i)));
  assert.equal(peak,4);assert(results.every(r=>r.length===data.length));
});
