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
const checked=new Map(), remoteChecked=new Map();
// The online catalog can use only these exact fixed-commit files. Local
// resources are always read and hashed; remote objects are checked against
// the compiled allowlist here, and their actual bytes are hashed on download.
const remoteManifestPath=path.join(root,'assets/meta/online-manifest.json');
const remoteManifest=fs.existsSync(remoteManifestPath)?JSON.parse(fs.readFileSync(remoteManifestPath,'utf8')):{};
if(Object.keys(remoteManifest).length){
  const code=read('js/remote-assets.js'), prefix='const known = Object.freeze(', suffix='), allowed = new Map();';
  const start=code.indexOf(prefix),end=code.indexOf(suffix,start);
  check(start>=0&&end>start,'Missing compiled online whitelist');
  const compiled=JSON.parse(code.slice(start+prefix.length,end));
  check(JSON.stringify(compiled)===JSON.stringify(remoteManifest),'Online whitelist does not match manifest');
  const commits=new Set(['5d40bfdf05bee53f5107a6ea5620ca0e953de815','5142ba2673ccbeb23173886f3bd851e9c881e6ec','0c7e90ee5d8ffaaa756d79d8aef879338fdde423']);
  for(const [address,spec] of Object.entries(remoteManifest)){
    const u=new URL(address),parts=u.pathname.split('/');
    check(u.origin==='https://raw.githubusercontent.com'&&!u.search&&!u.hash&&!u.username&&!u.password&&parts[1]==='7aGiven'&&parts[2]==='Phigros_Resource'&&commits.has(parts[3])&&parts.length>=5,'Invalid online origin '+address);
    check(Number.isSafeInteger(spec.bytes)&&spec.bytes>0&&/^[a-f0-9]{64}$/.test(spec.sha256),'Invalid online metadata '+address);
    const mirror='https://cdn.jsdelivr.net/gh/7aGiven/Phigros_Resource@'+parts[3]+'/'+parts.slice(4).join('/');
    check(spec.mirror===mirror,'Invalid online mirror '+address);
  }
}
function resource(url,bytes,hash){
  if(typeof url==='string'&&url.startsWith('https://')){
    const spec=remoteManifest[url];check(spec,'Unexpected remote resource '+url);
    if(bytes!=null)check(spec.bytes===bytes,'Wrong remote byte size '+url);
    if(hash)check(spec.sha256===hash,'Wrong remote hash '+url);
    remoteChecked.set(url,spec);return;
  }
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
  localSongs:context.PhiFullCatalog.coverage?.localPlayableSongVersions||result.totalSongs,
  localCharts:context.PhiFullCatalog.coverage?.localPlayableCharts||result.totalEntries,
  remoteSongs:context.PhiFullCatalog.coverage?.externalSongVersions||0,
  remoteCharts:context.PhiFullCatalog.coverage?.externalCharts||0,
  addedCharts:result.addedEntries,verifiedResources:checked.size,remoteReferences:remoteChecked.size,publishedBytes:bytes}));
