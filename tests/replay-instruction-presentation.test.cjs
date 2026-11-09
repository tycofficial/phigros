'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
// Exercise the actual private surface, not a duplicate rendering implementation.
function surface(){
  class Element{
    constructor(){this.textContent='';this.dataset={};this.style={setProperty(){},removeProperty(){}};this.nodes=new Map();this.classList={add(){},remove(){},toggle(){},contains(){return false;}};}
    querySelector(key){if(!this.nodes.has(key))this.nodes.set(key,new Element());return this.nodes.get(key);}
    setAttribute(){} addEventListener(){} appendChild(){} focus(){} remove(){} pause(){} load(){}
    play(){return Promise.resolve();} getAttribute(){return null;}
    replaceChildren(){this.textContent='';} getContext(){return {clearRect(){}};}
  }
  let root;const doc={createElement(){return root=new Element();},body:new Element(),addEventListener(){},getElementById(){return null;},querySelector(){return null;}};
  const context=vm.createContext({Audio:Element,console});
  const source=fs.readFileSync('js/interactive-replay.js','utf8');
  vm.runInContext(source.slice(source.indexOf('  function createSurface('),source.indexOf('  let installed=')),context);
  const ui=context.createSurface({input(){},cancel(){}},{document:doc});
  return {ui,native:root.querySelector('.visionNativeScene'),subtitle:root.querySelector('.visionSceneSubtitle')};
}
test('an explicit empty instruction clears the previous boss-phase label',()=>{
  const {ui,native}=surface();ui.scene('RrharilUnlock');
  ui.paint({boss:'rrharil',phase:'ready',instruction:'Play'});assert.equal(native.textContent,'Play');
  ui.paint({boss:'rrharil',phase:'song-start',instruction:''});assert.equal(native.textContent,'');
  ui.paint({boss:'rrharil',phase:'song-start',instruction:''});assert.equal(native.textContent,'');
});
test('snapshot updates without an instruction do not erase event-owned narrative text',()=>{
  const {ui,native,subtitle}=surface();native.textContent='Existing narrative';
  ui.effect({type:'subtitle',text:'Existing subtitle'});
  ui.paint({phase:'message',elapsed:1});
  assert.equal(native.textContent,'Existing narrative');assert.equal(subtitle.textContent,'Existing subtitle');
});
test('scene transitions still clear all previous scene text and allow subsequent labels',()=>{
  const {ui,native,subtitle}=surface();ui.paint({instruction:'Play'});ui.effect({type:'subtitle',text:'Previous'});
  ui.scene('IgalltaUnlock');assert.equal(native.textContent,'');assert.equal(subtitle.textContent,'');
  ui.paint({instruction:'touch to start'});assert.equal(native.textContent,'touch to start');
});
