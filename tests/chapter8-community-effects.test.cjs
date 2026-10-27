'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const c=vm.createContext({});
vm.runInContext(fs.readFileSync('js/chapter8-community-effects.js','utf8'),c);
const fx=c.PhiChapter8CommunityEffects;
const df='9f4508d425c0c241e9cfca064256a54b2509aa5e9169c12b6f131b848a1f828b';
const d321='52c749bec3353160c6c0bb14c145e2bc7d708f44e9e3d5c49220ffb372d3b91e';
test('only the source-matched built-in difficulties receive community profiles',()=>{
  const catalog={};vm.runInNewContext(fs.readFileSync('js/full-catalog.js','utf8'),catalog);
  const all=catalog.PhiFullCatalog,byId=new Map(all.assets.map(asset=>[asset.id,asset]));
  const selected=all.entries.filter(e=>/DistortedFate|DESTRUCTION321/.test(e.audioHash)).map(entry=>{
    const file=entry.files.find(item=>item.name===entry.meta.chart);
    return [entry.meta.name,entry.meta.difficultyClass,fx.select(byId.get(file.asset).sha256)];
  });
  assert.deepEqual(JSON.parse(JSON.stringify(selected.filter(row=>row[2]).map(row=>[row[0],row[1]]))),[
    ['DESTRUCTION 3,2,1','IN'],['Distorted Fate','EZ'],['Distorted Fate','HD'],['Distorted Fate','IN'],
  ]);
});
test('effect selection accepts only four source chart hashes, never a similar title or other chart version',()=>{
  assert.equal(fx.select(df),'distorted-fate');assert.equal(fx.select(df.toUpperCase()),'distorted-fate');
  assert.equal(fx.select(d321),'destruction-321');
  assert.equal(fx.select('Distorted Fate'),null);
  assert.equal(fx.select('009a9822e6c2d0f216895d7215835cfd0b06022bba5b3c9217f7468ece41c53d'),null);
  assert.equal(fx.sample('unknown',90),null);assert.equal(fx.sample('distorted-fate',NaN),null);
});
test('Distorted Fate community curve and countdown respect music time and event boundaries',()=>{
  const start=fx.sample('distorted-fate',0);assert.equal(start.blackBgOpacity,0);assert.equal(start.hideMetadata,false);
  const fade=fx.sample('distorted-fate',90);assert(Math.abs(fade.blackBgOpacity-0.32850214)<1e-8);
  assert.equal(fx.sample('distorted-fate',95).hideMetadata,false);assert.equal(fx.sample('distorted-fate',95.01).hideMetadata,true);
  assert.equal(fx.sample('distorted-fate',125.2).showCountdown,false);
  const middle=fx.sample('distorted-fate',130);assert.equal(middle.showCountdown,true);assert(Math.abs(middle.countDownTime-20)<1e-9);assert.equal(middle.hideCombo,true);
  assert.equal(fx.sample('distorted-fate',150).showCountdown,false);
});
test('DESTRUCTION IN dims at community keyframe times without pausing or terminating gameplay',()=>{
  assert.equal(fx.sample('destruction-321',0).blackBgOpacity,0);
  assert.equal(fx.sample('destruction-321',90).blackBgOpacity,.2);
  assert.equal(fx.sample('destruction-321',110).blackBgOpacity,.4);
  assert.equal(fx.sample('destruction-321',145).blackBgOpacity,.6);
  const late=fx.sample('destruction-321',157);assert.equal(late.hideCombo,true);assert(!('stop' in late));
  const reused=fx.sample('distorted-fate',130);fx.sample('destruction-321',130,reused);assert(!('countDownTime' in reused));
});
function context(){let calls=[];const target={calls,save(){calls.push(['save']);},restore(){calls.push(['restore']);},fillRect(...x){calls.push(['fillRect',...x]);},fillText(...x){calls.push(['fillText',...x]);}};return target;}
test('background draw and countdown restore canvas state and render only during their event',()=>{
  const ctx=context();fx.drawBackground(ctx,fx.sample('distorted-fate',0),1000,500);assert.equal(ctx.calls.length,0);
  fx.drawBackground(ctx,fx.sample('destruction-321',110),1000,500);assert.deepEqual(ctx.calls.map(x=>x[0]),['save','fillRect','restore']);
  const before=ctx.calls.length;fx.drawCountdown(ctx,fx.sample('distorted-fate',120),1000,500);assert.equal(ctx.calls.length,before);
  fx.drawCountdown(ctx,fx.sample('distorted-fate',130),1000,500);assert(ctx.calls.some(x=>x[0]==='fillText'&&x[1]==='00:20'));assert(ctx.calls.some(x=>x[0]==='fillText'&&x[1]==='COUNTDOWN'));assert.equal(ctx.calls.at(-1)[0],'restore');
});
