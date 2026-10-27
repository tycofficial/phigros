const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const {fixture}=require('./helpers/engine.cjs');
const source=fs.readFileSync('js/app.js','utf8');
const managerSource=source.slice(source.indexOf('  const KEYBOARD_LEGACY_CODES='),source.indexOf('  let keyboardInput = null;'));
const reserved=source.slice(source.indexOf('  const KEYBOARD_RESERVED_CODES ='),source.indexOf('  const FACTORY_DEFAULT_SETTINGS ='));
const codes=['KeyA','KeyS','KeyD','KeyF','KeyG','KeyH','KeyJ','KeyK','KeyL','Semicolon'];
function key(code,extra={}){return {code,key:code,timeStamp:1000,repeat:false,target:{closest:()=>null},preventDefault(){this.prevented=true;},...extra};}
function playable(notes){
  let assists=0;
  const f=fixture({window:{addEventListener(){}},keyboardInput:null,judgeTimingLead:0,specialJudgeDelay:0,
    syncAssistIndicators(){assists++;},Diagnostics:{warn(){},info(){}},nativeBlockTouchBlocked:()=>false});
  vm.runInContext(source.slice(source.indexOf('  function lowerBoundNumeric('),source.indexOf('  function eventValueFast(')),f.context);
  vm.runInContext(reserved+managerSource+'\nglobalThis.Keyboard=KeyboardInputManager;',f.context);
  const p=f.probe,manager=new f.context.Keyboard();f.context.keyboardInput=manager;
  p.eventAudioTime=f.context.Engine.prototype.eventAudioTime;p.keyboardCandidateScratch={};p.pendingJudge=new Set();
  p.noteItems=notes.map(n=>{const item={L:{id:0},n:{x:0,state:0,fake:false,...n}};item.n._item=item;return item;}).sort((a,b)=>a.n.time-b.n.time);
  p.noteTimes=Float64Array.from(p.noteItems,item=>item.n.time);p.commits=[];
  p.commit=(n,j,diff)=>{n.state=1;p.pendingJudge.delete(n._item);p.activeHolds.delete(n._item);p.commits.push({n,j,diff});};
  p.playSound=()=>{};p.hitEffect=()=>{};
  return {...f,p,manager,assists:()=>assists};
}

for(const count of [4,5,6,10])test(`${count} distinct simultaneous browser keydown edges each judge a Tap exactly once`,()=>{
  const {p,manager,assists}=playable(Array.from({length:count},()=>({type:1,time:40})));
  for(const code of codes.slice(0,count))manager.keyDown(key(code));
  assert.equal(p.commits.length,count);assert(p.commits.every(result=>result.j===0));
  assert.equal(manager.down.size,count);assert.equal(p.inputStats.keyboardMaxHeld,count);assert.equal(assists(),1);
});
test('repeat and duplicate non-repeat events cannot consume extra notes, and a genuine lift permits reuse',()=>{
  const {p,manager}=playable([{type:1,time:40},{type:1,time:40},{type:1,time:40}]);
  manager.keyDown(key('Space'));const repeat=key('Space',{repeat:true}),duplicate=key('Space');
  manager.keyDown(repeat);manager.keyDown(duplicate);
  assert.equal(p.commits.length,1);assert(repeat.prevented);assert(duplicate.prevented);
  manager.keyUp(key('Space'));manager.keyDown(key('Space'));assert.equal(p.commits.length,2);
});
test('ten delayed chord events use captured audio time, without accepting a genuinely late key',()=>{
  const {p,manager,setNow}=playable(Array.from({length:11},()=>({type:1,time:40})));
  setNow(1400);p.time=40.4;
  for(const code of codes)manager.keyDown(key(code));
  assert.equal(p.commits.length,10);assert(p.commits.every(result=>Math.abs(result.diff)<1e-9&&result.j===0));
  manager.keyDown(key('KeyZ',{timeStamp:1200}));assert.equal(p.commits.length,10);
  assert.equal(p.inputStats.maxDispatchMs,400);
});
test('out-of-order captured timestamps remain eligible instead of advancing a shared key cursor',()=>{
  const {p,manager,setNow}=playable([{type:1,time:40},{type:1,time:40.05}]);
  setNow(1500);p.time=40.5;
  manager.keyDown(key('KeyA',{timeStamp:1050}));manager.keyDown(key('KeyS',{timeStamp:1000}));
  assert.equal(p.commits.length,2);assert(p.commits.every(result=>result.j===0));
});
test('six legacy keys with missing or Unidentified code remain distinct and release across Shift case changes',()=>{
  const {p,manager}=playable(Array.from({length:6},()=>({type:1,time:40})));
  for(let i=0;i<6;i++)manager.keyDown(key(i%2?'':'Unidentified',{key:String.fromCharCode(65+i),keyCode:65+i,shiftKey:true}));
  assert.equal(p.commits.length,6);assert.equal(manager.down.size,6);
  for(let i=0;i<6;i++)manager.keyUp(key('Unidentified',{key:String.fromCharCode(97+i),keyCode:65+i}));
  assert.equal(manager.down.size,0);
  assert.equal(manager.eventCode(key('',{key:'!'})),'Digit1');assert.equal(manager.eventCode(key('',{key:'1'})),'Digit1');
  assert.equal(manager.eventCode(key('',{key:'?',keyCode:191})),'Slash');
  assert.equal(manager.eventCode(key('Unidentified',{key:'Unidentified',keyCode:0})), '');
});
test('Control, Alt, Meta, composition and Ctrl shortcuts do not create gameplay edges',()=>{
  const {p,manager}=playable(Array.from({length:6},()=>({type:1,time:40})));
  for(const event of [key('ControlRight'),key('ControlLeft'),key('AltRight'),key('MetaLeft'),key('KeyS',{ctrlKey:true}),key('KeyA',{isComposing:true})])manager.keyDown(event);
  assert.equal(p.commits.length,0);assert.equal(manager.down.size,0);
});
test('Shift remains a gameplay key in a six-key chord with five letters',()=>{
  const {p,manager}=playable(Array.from({length:6},()=>({type:1,time:40})));
  manager.keyDown(key('ShiftLeft',{key:'Shift',shiftKey:true,location:1}));
  for(const code of codes.slice(0,5))manager.keyDown(key(code,{shiftKey:true}));
  assert.equal(p.commits.length,6);assert.equal(manager.down.size,6);assert.equal(p.inputStats.keyboardMaxHeld,6);
});
test('legacy left and right Shift stay distinct and release their own Holds independently',()=>{
  const {p,manager,setNow}=playable([{type:3,time:40,end:42},{type:3,time:40,end:42}]);
  manager.keyDown(key('Unidentified',{key:'Shift',keyCode:16,location:1,shiftKey:true}));
  manager.keyDown(key('',{key:'Shift',keyCode:16,location:2,shiftKey:true}));
  assert.equal(manager.down.size,2);assert.equal(p.activeHolds.size,2);
  const [left,right]=p.noteItems.map(item=>item.n);
  assert.equal(left.holdPointer,'keyboard:ShiftLeft');assert.equal(right.holdPointer,'keyboard:ShiftRight');
  setNow(1100);manager.keyUp(key('',{key:'Shift',keyCode:16,location:2,timeStamp:1050}));
  assert.equal(right.releaseAt,1.05);assert.equal(left.releaseAt,Infinity);assert(manager.down.has('ShiftLeft'));
  assert.equal(p.findTouchForNote({},right,40,false,1.1,right.holdPointer),null);
  manager.keyUp(key('Unidentified',{key:'Shift',keyCode:16,location:1,timeStamp:1100}));assert.equal(manager.down.size,0);
});
test('legacy key-only Backslash and its shifted vertical bar release the same key',()=>{
  const {p,manager}=playable([{type:1,time:40}]);
  assert.equal(manager.eventCode(key('',{key:'\\',keyCode:0})),'Backslash');
  assert.equal(manager.eventCode(key('',{key:'|',keyCode:0})),'Backslash');
  manager.keyDown(key('',{key:'\\',keyCode:0}));assert.equal(p.commits.length,1);assert(manager.down.has('Backslash'));
  manager.keyUp(key('',{key:'|',keyCode:0,shiftKey:true}));assert.equal(manager.down.size,0);
});
for(const count of [4,5,6,10])test(`${count} simultaneous Holds retain separate key owners and independent captured releases`,()=>{
  const {p,manager,setNow}=playable(Array.from({length:count},()=>({type:3,time:40,end:42})));
  for(const code of codes.slice(0,count))manager.keyDown(key(code));
  assert.equal(p.activeHolds.size,count);
  const first=p.noteItems[0].n,second=p.noteItems[1].n;
  assert.equal(first.holdPointer,'keyboard:KeyA');assert.equal(second.holdPointer,'keyboard:KeyS');
  setNow(1200);manager.keyUp(key('KeyA',{timeStamp:1030}));assert.equal(first.releaseAt,1.03);
  assert.equal(p.findTouchForNote({},first,40,false,1.2,first.holdPointer),null);
  assert.equal(p.findTouchForNote({},second,40,false,1.2,second.holdPointer).id,'keyboard:KeyS');
  assert.equal(second.releaseAt,Infinity);
  const touch={id:31,active:true};p.pointer.set(31,touch);p.touchMatchesNote=()=>true;
  assert.equal(p.findTouchForNote({},first,40,false,1.2,first.holdPointer),touch,'real touch handoff remains possible');
  manager.clear('blur');assert.equal(manager.down.size,0);assert.equal(second.releaseAt,1.2);
});
test('PJSK keeps its six lane bindings and uses one captured time for paired tap/flick',()=>{
  const calls=[],{p,manager,setNow,context}=playable([]);p.chart.kind='pjsk';
  context.SEKAI_KEYS=['KeyS','KeyD','KeyF','KeyJ','KeyK','KeyL'];context.SEKAI_FLICK_KEYS=['KeyW','KeyE','KeyR','KeyU','KeyI','KeyO'];
  context.pjskStageGeometry=()=>({cx:500,bottomHalf:300,judgeY:400});context.pjskInput=(_engine,kind,x,y,at)=>calls.push({kind,x,y,at});
  setNow(1400);p.time=40.4;
  for(const letter of ['s','d','f','j','k','l'])manager.keyDown(key('Unidentified',{key:letter,keyCode:letter.toUpperCase().charCodeAt(0)}));
  assert.equal(calls.length,6);assert.equal(new Set(calls.map(call=>call.x)).size,6);assert(calls.every(call=>Math.abs(call.at-40)<1e-9));
  manager.keyDown(key('KeyW'));assert.deepEqual(calls.slice(-2).map(call=>call.kind),['tap','flick']);assert.equal(calls.at(-1).at,calls.at(-2).at);
});
test('a captured pre-buffer key can recover, while keys sampled during a freeze cannot become future hits',()=>{
  const {p,manager,setNow}=playable([{type:1,time:40},{type:1,time:40.1}]);
  p.inputClockPauses=[{start:1100,end:1500}];p.time=40.1;setNow(1500);
  manager.keyDown(key('KeyA'));assert.equal(p.commits.length,1);assert(Math.abs(p.commits[0].diff)<1e-9);
  manager.keyDown(key('KeyS',{timeStamp:1200}));assert.equal(p.commits.length,1);
});
test('continuous keyboard contact visits a dense special-note window once, without a 32-note cap or full chart scan',()=>{
  const {p,manager}=playable([...Array.from({length:20000},(_,i)=>({type:1,time:1+i/1000})),
    ...Array.from({length:80},(_,i)=>({type:i%2?2:4,time:40}))]);
  manager.keyDown(key('KeyA'));
  assert.equal(p.commits.length,80);assert.equal(p.inputStats.keyboardContinuousScanned,80);
  // Five more simultaneous keys must not repeat the same continuous scan.
  for(const code of codes.slice(1,6))manager.keyDown(key(code));
  assert.equal(p.inputStats.keyboardContinuousScanned,80);assert.equal(p.commits.length,80);
});
test('a later keydown judges newly due special notes before a delayed animation frame',()=>{
  const {p,manager,setNow}=playable([{type:2,time:40.1},{type:4,time:40.1}]);
  manager.keyDown(key('KeyA'));assert.equal(p.commits.length,0);
  setNow(1100);p.time=40.1;
  manager.keyDown(key('KeyS',{timeStamp:1100}));
  assert.equal(p.commits.length,2);assert(p.commits.every(result=>result.j===0&&Math.abs(result.diff)<1e-9));
});
