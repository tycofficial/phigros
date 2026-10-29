'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const source=fs.readFileSync('js/vision-mode.js','utf8');
function mount(storage){let click;const button={textContent:'',setAttribute(k,v){this[k]=v;},addEventListener(_,fn){click=fn;}};const c={localStorage:storage,document:{getElementById:()=>button}};vm.runInNewContext(source,c);return {api:c.PhiVisionMode,button,click:()=>click()};}
test('vision switch persists independently, restores off state and reflects accessible state',()=>{const data=new Map(),storage={getItem:k=>data.get(k),setItem:(k,v)=>data.set(k,v)};let v=mount(storage);assert(v.api.enabled);v.click();assert.equal(v.api.enabled,false);assert.equal(v.button['aria-pressed'],'false');v=mount(storage);assert.equal(v.api.enabled,false);v.api.set(true);assert.equal(data.get('phi.visionReplayEnabled'),'true');});
test('unavailable browser storage does not break the switch',()=>{const v=mount({getItem(){throw Error();},setItem(){throw Error();}});assert(v.api.enabled);v.click();assert.equal(v.api.enabled,false);});
