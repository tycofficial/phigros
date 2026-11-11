'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/course-mode.js','utf8');
function charts(){return [1,2,3].map(i=>({id:'chart-'+i,name:'Song '+i,meta:{difficulty:10+i/10,difficultyClass:'IN'}}));}
function load(){const env=vm.createContext({});vm.runInContext(source,env);return env.PhiCourse;}
const result=score=>({score,counts:[10,1,0,0],total:11});
test('course requires exactly three distinct identified charts and retains input order',()=>{
 const {Session}=load(),c=charts();for(const bad of [[],c.slice(0,2),[c[0],c[0],c[1]],[{},c[1],c[2]]])assert.throws(()=>new Session(bad));
 const session=new Session(c);c.reverse();assert.equal(session.begin().id,'chart-1');
});
test('course stages accept each real result only once and reject stale session/stage callbacks',()=>{
 const {Session}=load(),s=new Session(charts());s.begin();const old=s.stageToken;
 assert.equal(s.finish(result(900000),'old-session',old),false);assert.equal(s.finish(result(900000),s.id,'old-stage'),false);
 assert.equal(s.finish(result(900000)),true);assert.equal(s.finish(result(900000)),false);assert.equal(s.state,'between');
 assert.equal(s.next().id,'chart-2');assert.notEqual(s.stageToken,old);assert.equal(s.finish(result(900000),s.id,old),false);
 s.finish(result(950000));s.next();s.finish(result(1000000));assert.equal(s.state,'complete');assert.equal(s.score,2850000);assert.deepEqual([...s.counts],[30,3,0,0]);assert.throws(()=>s.next());
});
test('cancelled course cannot begin, advance or accept a delayed result',()=>{
 const {Session}=load(),s=new Session(charts());s.begin();s.cancel();assert.equal(s.state,'cancelled');assert.equal(s.finish(result(1000000)),false);assert.equal(s.score,0);assert.throws(()=>s.begin());assert.throws(()=>s.next());
});
test('result snapshot is detached from engine counters and assisted state remains visible',()=>{
 const {Session}=load(),s=new Session(charts()),r={...result(990000),assisted:true};s.begin();s.finish(r);r.counts[0]=999;assert.deepEqual([...s.counts],[10,1,0,0]);assert.equal(s.assisted,true);
});
function deferred(){let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};}
function mount(provider){
 let document;
 class Element{
  constructor(tag){this.tag=tag;this.children=[];this.className='';this.textContent='';this.value='';this.isConnected=true;const change=(add,values)=>{const set=new Set(this.className.split(/\s+/).filter(Boolean));for(const x of values)add?set.add(x):set.delete(x);this.className=[...set].join(' ');};this.classList={add:(...x)=>change(true,x),remove:(...x)=>change(false,x),contains:x=>this.className.split(/\s+/).includes(x)};}
  appendChild(node){this.children.push(node);return node;}append(...nodes){nodes.forEach(n=>this.appendChild(n));}replaceChildren(...nodes){this.children=nodes;}
  setAttribute(name,value){this[name]=value;}addEventListener(){}focus(){document.activeElement=this;}
 }
 const body=new Element('body'),origin=new Element('button');
 document={body,activeElement:origin,createElement:tag=>new Element(tag),getElementById:()=>null,addEventListener(){}};
 const env=vm.createContext({document});vm.runInContext(source,env);const api=env.PhiCourse;api.install({entries:provider,start:async()=>{},back:async()=>{}});
 const flatten=node=>[node,...node.children.flatMap(flatten)];
 return {api,all:()=>flatten(body),button:text=>flatten(body).find(n=>n.tag==='button'&&n.textContent===text)};
}
test('an older catalog completion cannot replace the active course selection model',async()=>{
 const first=deferred(),second=deferred();let reads=0;const f=mount(()=>++reads===1?first.promise:second.promise);
 const old=f.api.open(),current=f.api.open();second.resolve([{id:'new',name:'New',parser:'pgr',meta:{difficultyClass:'IN'}}]);await current;
 const choose=f.button('New · IN');assert(choose);first.resolve([{id:'old',name:'Old',parser:'pgr',meta:{difficultyClass:'IN'}}]);await old;
 assert.doesNotThrow(()=>choose.onclick());assert(f.all().some(n=>n.textContent==='New · IN'));assert(f.button('New · IN · 已选择'));
});
test('late catalog failures and cancellations cannot revive a dismissed panel',async()=>{
 const pending=deferred(),f=mount(()=>pending.promise);const opening=f.api.open();f.api.cancel();pending.reject(Error('late failure'));await opening;
 assert(f.all().find(n=>n.id==='phiCoursePanel').classList.contains('hidden'));assert(!f.all().some(n=>n.textContent==='late failure'));
});
