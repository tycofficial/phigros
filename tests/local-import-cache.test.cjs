'use strict';
// Tests shipped cache-publication helpers with controlled transaction completion.
// This is not a replacement for real-browser IndexedDB rollback/reopen coverage.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
function section(start,end){const a=source.indexOf(start),b=source.indexOf(end,a);assert(a>=0&&b>a);return source.slice(a,b);}
const helpers=section('  function chartSummaryFromRecord(record)','  function idbWriteMany')+section('  async function dbPutChartSummary(summary)','  async function dbGetSetting');
function fixture(temporary=false){
 let resolve,reject;const completion=new Promise((a,b)=>{resolve=a;reject=b;});const writes=[];
 const original={id:'existing',name:'Original'},cache=new Map([['existing',original]]),charts=new Map([['existing',original]]);
 const store=name=>({put:record=>{writes.push([name,'put',record]);return completion;},delete:id=>{writes.push([name,'delete',id]);}});
 const env=vm.createContext({librarySummaryCache:cache,libraryDirty:false,sessionStore:{charts},isTemporaryStorage:()=>temporary,retryPersistentOperation:fn=>fn(),idbWrite:(name,fn)=>fn(store(name)),idbWriteMany:(names,fn)=>{const result=fn({objectStore:store});return completion.then(()=>result);}});
 vm.runInContext(helpers,env);return {env,cache,charts,original,writes,resolve,reject};
}
for(const [label,call] of [['chart',e=>e.dbPutChart({id:'existing',name:'Replacement'})],['summary',e=>e.dbPutChartSummary({id:'existing',name:'Replacement'})]]){
 test(`persistent ${label} becomes visible only after transaction completion`,async()=>{
  const f=fixture(),pending=call(f.env);assert.equal(f.cache.get('existing'),f.original);f.resolve('existing');assert.equal(await pending,'existing');assert.equal(f.cache.get('existing').name,'Replacement');
 });
 test(`failed persistent ${label} leaves prior imported entry visible`,async()=>{
  const f=fixture(),pending=call(f.env),failure=Error('quota/abort');f.reject(failure);await assert.rejects(pending,error=>error===failure);assert.equal(f.cache.get('existing'),f.original);assert.equal(f.charts.get('existing'),f.original);
 });
}
test('persistent delete keeps cached entry until commit',async()=>{
 const f=fixture(),pending=f.env.dbDeleteChart('existing');assert.equal(f.cache.get('existing'),f.original);assert.equal(f.charts.get('existing'),f.original);f.resolve();await pending;assert(!f.cache.has('existing'));assert(!f.charts.has('existing'));
});
test('failed persistent delete preserves cached and session entries',async()=>{
 const f=fixture(),pending=f.env.dbDeleteChart('existing');f.reject(Error('abort'));await assert.rejects(pending,/abort/);assert.equal(f.cache.get('existing'),f.original);assert.equal(f.charts.get('existing'),f.original);
});
test('temporary import, summary update and delete remain available without IndexedDB',async()=>{
 const f=fixture(true);assert.equal(await f.env.dbPutChart({id:'new',name:'New'}),'new');assert.equal(f.charts.get('new').name,'New');assert.equal(await f.env.dbPutChartSummary({id:'new',name:'Renamed'}),'new');assert.equal(f.cache.get('new').name,'Renamed');await f.env.dbDeleteChart('new');assert(!f.cache.has('new'));assert(!f.charts.has('new'));assert.equal(f.writes.length,0);
});
test('bulk import remains hidden until commit and retains unrelated records',async()=>{
 const f=fixture(),pending=f.env.dbPutChartsAtomically([{id:'new',name:'First'},{id:'new',name:'Last'}]);assert(!f.cache.has('new'));f.resolve();assert.equal(await pending,1);assert.equal(f.cache.get('new').name,'Last');assert.equal(f.cache.get('existing'),f.original);
});
