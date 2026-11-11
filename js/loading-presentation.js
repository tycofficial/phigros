/* Loading-view presentation only. Timings preserve the current simulator;
 * they are not a claim of verified equivalence to an official build.
 * Local import, chart preparation, audio and load-token ownership stay in app.js.
 */
(() => {
  'use strict';
  function create(deps) {
    const {lookup:$,difficultyInfoFor,cleanSongName,applyLengthClass,Blob,URL,now,frame,sleep,reducedMotion,assertCurrent}=deps;
    let artworkURL='',startedAt=0,generation=0;
    function setStatus(text){const node=$('#loadingProgress');if(node)node.textContent=text;}
    function clearArtwork(){
      if(artworkURL){try{URL.revokeObjectURL(artworkURL);}catch{}}
      artworkURL='';
      for(const id of ['#loadingBackdrop','#loadingArtwork']){const el=$(id);if(el)el.style.backgroundImage='';}
    }
    function setArtwork(blob){
      clearArtwork();if(!(blob instanceof Blob))return;
      artworkURL=URL.createObjectURL(blob);
      const image=`url("${artworkURL}")`;
      $('#loadingBackdrop').style.backgroundImage=image;$('#loadingArtwork').style.backgroundImage=image;
    }
    function update(record,fallbackBlob=null){
      const info=difficultyInfoFor(record),meta=record?.meta||{},name=cleanSongName(record?.name||meta.name||'未命名曲目');
      $('#loadingSongTitle').textContent=name;applyLengthClass($('#loadingSongTitle'),name);
      $('#loadingLevel').textContent=info.level>=0?String(info.level):'?';$('#loadingLevel').dataset.tier=info.tier;
      $('#loadingTitleComposer').textContent=String(meta.composer||meta.artist||'');
      $('#loadingIllustrator').textContent=String(meta.illustrator||'');
      $('#loadingComposer').textContent=String(meta.composer||meta.artist||'');
      $('#loadingCharter').textContent=String(meta.charter||meta.chartDesigner||'');
      const blob=record?.bgBlob instanceof Blob?record.bgBlob:fallbackBlob;
      if(blob instanceof Blob)setArtwork(blob);
    }
    async function begin(record,fallbackBlob=null){
      const current=++generation,view=$('#loadingView'),library=$('#libraryView');startedAt=now();update(record,fallbackBlob);
      view.classList.remove('hidden','loadingExit');view.classList.add('loadingEnter');library?.classList.add('libraryLeavingForLoad');
      await new Promise(resolve=>frame(()=>frame(resolve)));if(current===generation)setStatus('正在准备谱面…');
    }
    async function finish(token){
      const view=$('#loadingView');if(!view||view.classList.contains('hidden'))return;
      await sleep(Math.max(0,850-(now()-startedAt)));assertCurrent(token);
      view.classList.remove('loadingEnter');view.classList.add('loadingExit');
      await sleep(reducedMotion()?20:300);assertCurrent(token);
      view.classList.add('hidden');view.classList.remove('loadingExit');
      $('#libraryView')?.classList.remove('libraryLeavingForLoad');clearArtwork();
    }
    function cancel(){
      generation++;
      const view=$('#loadingView');view?.classList.add('hidden');view?.classList.remove('loadingEnter','loadingExit');
      $('#libraryView')?.classList.remove('libraryLeavingForLoad');clearArtwork();
    }
    return Object.freeze({setStatus,clearArtwork,setArtwork,update,begin,finish,cancel});
  }
  const api=Object.freeze({create});globalThis.PhiLoadingPresentation=api;
  if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
