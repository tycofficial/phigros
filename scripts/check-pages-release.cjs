'use strict';
const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');
const root=path.resolve(process.argv[2]||'.');
const check=(ok,message)=>{if(!ok)throw Error(message);};
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const context={};
for(const name of ['full-catalog.js','hosted-manifest.js','catalog-runtime.js'])
  vm.runInNewContext(read('js/'+name),context);
const source=read('js/app.js');
function original(name){
  const match=source.match(new RegExp('^  const '+name+' = (\\[.*\\]);$','m'));
  check(match,'Missing '+name);return JSON.parse(match[1]);
}
const entries=original('BUILTIN_PACKS'),assets=original('BUILTIN_ASSETS');
const result=context.PhiCatalogRuntime.install({entries,assets,hostedManifest:context.PhiHostedManifest});
check(result.addedEntries>0,'Release must add playable charts');
const checked=new Map();
function resource(url,bytes,hash){
  check(typeof url==='string'&&url.startsWith('./assets/'),'Unexpected resource '+url);
  const name=url.slice(2),target=path.resolve(root,name);
  check(target.startsWith(root+path.sep),'Invalid path '+url);
  let data=checked.get(url);
  if(!data){
    const buffer=fs.readFileSync(target);
    data={bytes:buffer.length,hash:crypto.createHash('sha256').update(buffer).digest('hex')};
    checked.set(url,data);
  }
  if(bytes!=null)check(data.bytes===bytes,'Wrong byte size '+url);
  if(hash)check(data.hash===hash,'Wrong hash '+url);
}
const byId=new Map(assets.map(spec=>[spec.id,spec]));
for(const entry of entries){
  for(const file of entry.files){
    const spec=byId.get(file.asset);check(spec,'Missing asset '+file.asset);
    resource(spec.url,spec.offset==null?spec.byteLength:null,spec.method===0?spec.sha256:spec.packedSha256);
  }
  const music=entry.files.find(file=>file.name===entry.meta.music);
  const art=entry.files.find(file=>file.name===entry.meta.illustration);
  const audio=context.PhiHostedManifest.audio[music.asset];
  const artwork=context.PhiHostedManifest.artwork[art.asset];
  check(audio?.duration>0&&artwork,'Incomplete song '+entry.id);
  for(const variant of [audio,audio.high,audio.low,audio.lowFallback].filter(Boolean))
    resource(variant.url,variant.bytes,variant.sha256);
  resource(audio.original);resource(artwork.original);
  for(const stage of artwork.stages)resource(stage.url,stage.bytes,stage.sha256);
}
for(const match of read('index.html').matchAll(/(?:src|href)=["'](\.\/[^"']+)["']/g))
  check(fs.existsSync(path.join(root,match[1].split('?')[0])),'Missing entry resource '+match[1]);
function size(dir){return fs.readdirSync(dir,{withFileTypes:true}).reduce((n,item)=>{
  if(item.name==='.git')return n;
  const full=path.join(dir,item.name);return n+(item.isDirectory()?size(full):fs.statSync(full).size);
},0);}
const bytes=size(root);check(bytes<1000000000,'Pages site exceeds 1 GB');
console.log(JSON.stringify({passed:true,songs:result.totalSongs,charts:result.totalEntries,
  addedCharts:result.addedEntries,verifiedResources:checked.size,publishedBytes:bytes}));
