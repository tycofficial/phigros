'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
const bootstrap=source.slice(0,source.indexOf('  let phiExportViewport'))+'})();';
async function run(existing={},mode='success'){
  const requests=[],context=vm.createContext({...existing,document:{createElement(){return {};},head:{appendChild(script){requests.push(script.src);queueMicrotask(()=>{
    if(mode==='network-failure')return script.onerror();
    if(mode==='success')context[script.src.includes('loading-presentation')?'PhiLoadingPresentation':'PhiPerformance']={};
    script.onload();
  });}}}});
  await vm.runInContext(bootstrap,context);return requests;
}
test('current HTML dependencies do not cause duplicate bootstrap requests',async()=>{
  assert.deepEqual(await run({PhiPerformance:{},PhiLoadingPresentation:{}}),[]);
});
test('old cached HTML loads the new presentation dependency before app initialization',async()=>{
  const requests=await run({PhiPerformance:{}});assert.equal(requests.length,1);assert.match(requests[0],/loading-presentation\.js\?v=4\.0\.1\.2-pages-28$/);
  assert.equal((await run()).length,2);
});
test('missing and malformed bootstrap dependencies reject rather than run a half-initialized app',async()=>{
  await assert.rejects(run({PhiPerformance:{}},'network-failure'),/组件加载失败/);
  await assert.rejects(run({PhiPerformance:{}},'missing-export'),/组件未初始化/);
});
test('HTML metadata, runtime constant, dependency URLs and service-worker cache agree',()=>{
  const html=fs.readFileSync('index.html','utf8'),sw=fs.readFileSync('sw.js','utf8');
  const runtime=source.match(/runtime:\s*"([^"]+)"/)[1];
  assert.equal(html.match(/"runtime":\s*"([^"]+)"/)[1],runtime);
  assert(source.includes("'?v="+runtime+"'"));assert(html.includes('loading-presentation.js?v='+runtime));
  assert(sw.includes("tycphigros-app-"+runtime.split('-').slice(1).join('-')));
});
