'use strict';
// The dated evidence must never turn an unavailable mirror into a green gate.
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),os=require('node:os'),path=require('node:path'),crypto=require('node:crypto'),{spawnSync}=require('node:child_process');
const directory='docs/evidence/2026-11-10-vision-resources',checkpointPath=directory+'/cors-checkpoint.json',evidencePath=directory+'/ci10-final.json',script='scripts/vision-cors-checkpoint.py';
function fixture(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'phi-vision-checkpoint-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const cp=JSON.parse(fs.readFileSync(checkpointPath));
 for(const name of [...Object.keys(cp.sourceHashes),checkpointPath,evidencePath,script,'scripts/checkpoint_sources.py']){fs.mkdirSync(path.dirname(path.join(root,name)),{recursive:true});fs.copyFileSync(name,path.join(root,name));}
 return {root,run:()=>spawnSync('python3',[path.join(root,script)],{encoding:'utf8'}),read:name=>JSON.parse(fs.readFileSync(path.join(root,name))),write:(name,value)=>fs.writeFileSync(path.join(root,name),JSON.stringify(value))};
}
test('unchanged vision evidence reuses its dated results and explicitly retains blocked status',t=>{
 const f=fixture(t),r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'reuse-blocked-scoped');
});
test('changed download source requires fresh relevant vision checks',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.root,'js/vision-replay.js'),'\n// changed loader\n');
 const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'run');
});
test('omitting a required source fingerprint cannot reuse partial evidence',t=>{
 const f=fixture(t),cp=f.read(checkpointPath);delete cp.sourceHashes['js/vision-replay.js'];f.write(checkpointPath,cp);
 const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Incomplete vision source dependencies/);
});
test('even rehashed evidence cannot misclassify two unavailable mirrors as passed',t=>{
 const f=fixture(t),e=f.read(evidencePath);e.visionNetwork.status='passed';f.write(evidencePath,e);
 const cp=f.read(checkpointPath);cp.evidenceSHA256=crypto.createHash('sha256').update(fs.readFileSync(path.join(f.root,evidencePath))).digest('hex');f.write(checkpointPath,cp);
 const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/Incomplete or misclassified vision evidence/);
});
test('an additional bootstrap or policy edit cannot use a recorded UI/cache-only change',t=>{
 const f=fixture(t);fs.appendFileSync(path.join(f.root,'index.html'),'\n<script>changedBootstrap()</script>\n');
 const r=f.run();assert.equal(r.status,0,r.stderr);assert.equal(r.stdout.trim(),'run');
});
test('a scoped change must reconstruct the exact measured baseline bytes',t=>{
 const f=fixture(t),cp=f.read(checkpointPath);cp.scopedSourceChanges['index.html'].reverseEdits[0].after='pages-invalid';f.write(checkpointPath,cp);
 const r=f.run();assert.notEqual(r.status,0);assert.match(r.stderr,/do not reconstruct measured source/);
});
