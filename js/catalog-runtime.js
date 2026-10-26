/* Merge the catalog index without loading any music, artwork, or chart bytes. */
(() => {
  'use strict';
  const collectionFields=['collectionId','collectionTitle','collectionOrder','chapter','songOrder'];
  const difficultyOrder={EZ:0,HD:1,IN:2,AT:3,SP:4};
  function songId(entry) {
    const hash=String(entry?.audioHash||'');
    return hash.startsWith('reference-song:')?hash.slice('reference-song:'.length):String(entry?.songId||entry?.meta?.songId||entry?.thumbnailKey||'');
  }
  function chartIdentity(entry) {
    const song=entry?.audioHash||songId(entry),tier=String(entry?.meta?.difficultyClass||'').toUpperCase(),variant=Number(entry?.meta?.variant)||0;
    return song&&tier?`${song}\u0000${tier}\u0000${variant}`:'';
  }
  function assignCollection(entry,assignments,collections) {
    // A chart can have its own SP/event collection, independent of the base song.
    if(entry.meta?.collectionId)return false;
    let assignment=assignments?.[songId(entry)];
    const special=String(entry.meta?.difficultyClass).toUpperCase()==='SP'&&collections?.find(collection=>collection.id==='special');
    if(special)assignment={...assignment,collectionId:special.id,collectionTitle:special.title,chapter:special.title,collectionOrder:special.order};
    if(!assignment)return false;
    entry.meta={...entry.meta};
    let changed=false;
    for(const key of collectionFields)if(assignment[key]!=null&&entry.meta[key]!==assignment[key]){
      entry.meta[key]=assignment[key];changed=true;
    }
    return changed;
  }
  function numberOrder(value) {
    return value!=null&&value!==''&&Number.isFinite(Number(value))?Number(value):Number.MAX_SAFE_INTEGER;
  }
  function install({entries,assets,hostedManifest,catalog=globalThis.PhiFullCatalog}={}) {
    if(!Array.isArray(entries)||!Array.isArray(assets)||!hostedManifest||typeof hostedManifest!=='object')
      throw new TypeError('曲库合并需要歌曲、资源索引和媒体清单');
    if(!catalog)return {available:false,addedEntries:0,addedAssets:0,totalEntries:entries.length,totalAssets:assets.length};
    if(!Array.isArray(catalog.entries)||!Array.isArray(catalog.assets))throw new TypeError('完整曲库索引格式无效');
    const entryIds=new Set(entries.map(entry=>String(entry.id))),identities=new Set(entries.map(chartIdentity).filter(Boolean)),
      assetIds=new Set(assets.map(asset=>String(asset.id)));
    let updatedEntries=0,addedEntries=0,addedAssets=0;
    for(const entry of entries)if(assignCollection(entry,catalog.collectionAssignments,catalog.collections))updatedEntries++;
    for(const source of catalog.entries){
      if(!source||!source.id)continue;
      const id=String(source.id),identity=chartIdentity(source);
      if(entryIds.has(id)||(identity&&identities.has(identity)))continue;
      const entry={...source,meta:{...source.meta},files:source.files?.map(file=>({...file}))};
      assignCollection(entry,catalog.collectionAssignments,catalog.collections);
      entries.push(entry);entryIds.add(id);if(identity)identities.add(identity);addedEntries++;
    }
    for(const asset of catalog.assets){
      if(!asset?.id||assetIds.has(String(asset.id)))continue;
      assets.push({...asset});assetIds.add(String(asset.id));addedAssets++;
    }
    // Keep the existing tracks and their network-quality choices authoritative.
    for(const key of ['audio','artwork']){
      if(!hostedManifest[key])hostedManifest[key]={};
      for(const [id,spec]of Object.entries(catalog[key]||{}))
        if(!Object.hasOwn(hostedManifest[key],id))hostedManifest[key][id]=spec;
    }
    entries.sort((a,b)=>numberOrder(a.meta?.collectionOrder)-numberOrder(b.meta?.collectionOrder)||
      numberOrder(a.meta?.songOrder)-numberOrder(b.meta?.songOrder)||
      (difficultyOrder[String(a.meta?.difficultyClass).toUpperCase()]??9)-(difficultyOrder[String(b.meta?.difficultyClass).toUpperCase()]??9)||
      (Number(a.meta?.variant)||0)-(Number(b.meta?.variant)||0));
    return {available:true,version:catalog.version,addedEntries,addedAssets,updatedEntries,totalEntries:entries.length,
      totalSongs:new Set(entries.map(entry=>entry.audioHash||songId(entry)||entry.name||entry.id)).size,totalAssets:assets.length,
      coverage:catalog.coverage||null};
  }
  globalThis.PhiCatalogRuntime=Object.freeze({install});
})();
