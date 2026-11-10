'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const api=require('../js/interactive-replay.js');
function fixture({prepare=async()=>{},play=async()=>{}}={}){
 const calls={exit:0,hide:0,cancel:[],errors:[]};let frame;
 const controller={snapshot:()=>({}),drain:()=>[{type:'play-clip',id:'clip'}],update:()=>[],input:()=>[]};
 const env={console:{error:(_message,error)=>calls.errors.push(error.message)},document:{hidden:false},
  PhiBossReplayRules:{create:()=>controller},requestAnimationFrame:fn=>(frame=fn,1),cancelAnimationFrame:()=>{frame=null;}};
 const ui={show(){},hide(){calls.hide++;},stop(){},stopAmbient(){},disposeGame(){},status(){},play,
  mediaState:()=>({}),paint(){}};
 const runtime=api.createRuntime({ui,prepare,onExit:()=>calls.exit++,cancelPreparation:id=>calls.cancel.push(id)},env);
 return {runtime,calls,tick:()=>frame?.(1000)};
}
const entry={name:'Igallta',meta:{difficultyClass:'IN'}};
const flush=async()=>{for(let i=0;i<8;i++)await Promise.resolve();};
test('a preparation error releases replay ownership and returns through the existing selection adapter',async()=>{
 const f=fixture({prepare:async()=>{throw Error('missing asset');}});
 assert.equal(await f.runtime.begin(entry),false);assert.equal(f.runtime.current,null);
 assert.equal(f.calls.exit,1);assert.equal(f.calls.cancel.length,1);assert.deepEqual(f.calls.errors,['missing asset']);
 f.tick();assert.equal(f.runtime.current,null);
});
test('a current clip failure closes the replay and permits a clean retry',async()=>{
 let fail=true;const f=fixture({play:async()=>{if(fail)throw Error('bad checksum');}});
 await f.runtime.begin(entry);await flush();assert.equal(f.runtime.current,null);assert.equal(f.calls.exit,1);
 fail=false;assert.equal(await f.runtime.begin(entry),true);assert(f.runtime.current);assert.equal(f.calls.exit,1);
 f.runtime.cancel();assert.equal(f.calls.exit,2);
});
test('late failure from an earlier playback cannot cancel the replacement session',async()=>{
 let rejectOld,first=true;const f=fixture({play:()=>first?(first=false,new Promise((_,reject)=>{rejectOld=reject;})):Promise.resolve()});
 await f.runtime.begin(entry);const previous=f.runtime.current.id;
 await f.runtime.begin(entry);const next=f.runtime.current.id;assert.notEqual(next,previous);
 rejectOld(Error('cancelled media'));await flush();assert.equal(f.runtime.current.id,next);
 assert.equal(f.calls.exit,0);assert.deepEqual(f.calls.errors,[]);f.runtime.cancel();
});
test('cancel settles the entry caller before an uncooperative preparation returns',async()=>{
 let release,first=true,result='pending';const gate=new Promise(resolve=>{release=resolve;});
 const f=fixture({prepare:()=>first?(first=false,gate):Promise.resolve()});
 const pending=f.runtime.begin(entry).then(value=>{result=value;});await flush();f.runtime.cancel();await flush();
 try{
  assert.equal(result,false,'the cancelled entry caller must release its UI lock immediately');
  assert.equal(await f.runtime.begin(entry),true);const current=f.runtime.current.id;
  release();await pending;await flush();assert.equal(f.runtime.current.id,current);assert.deepEqual(f.calls.errors,[]);
 }finally{release();f.runtime.cancel();}
});
test('public cancellation lets an existing navigation handler own the return',async()=>{
 let exits=0;const ui={show(){},status(){},stop(){},hide(){},disposeGame(){},stopAmbient(){}};
 api.configure({ui,prepare:()=>new Promise(()=>{}),onExit:()=>exits++});
 try{
  const first=api.begin(entry);api.cancel(false);assert.equal(await first,false);assert.equal(api.current,null);assert.equal(exits,0);
  const second=api.begin(entry);api.cancel();assert.equal(await second,false);assert.equal(exits,1);
 }finally{api.cancel(false);}
});
