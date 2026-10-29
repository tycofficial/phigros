const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm');
const {fixture}=require('./helpers/engine.cjs');
const source=fs.readFileSync('js/app.js','utf8');
function shipped(name){
  const start=source.indexOf('  function '+name+'('),next=source.slice(start+3).search(/^  (?:async )?function /m);
  assert(start>=0&&next>=0,name);return source.slice(start,start+3+next);
}
function playable(rotation=0){
  const f=fixture({nativeBlockTouchBlocked:()=>false,judgeTimingLead:0,specialJudgeDelay:0,keyboardInput:null,chartRevealEnabled:false});
  vm.runInContext(['ease','cubicBezierProgress','compileEventFastFields','eventEaseValue','prepareEvents','eventValueFast','lowerBoundNumeric'].map(shipped).join('\n'),f.context);
  const p=f.probe,line={id:0,moveX:[],moveY:[],rotate:[{st:0,et:100,a:rotation,b:rotation}],alpha:[],floorAt:t=>t},
    n={type:1,time:40,x:.2,floor:40,above:true,speed:1,state:0,fake:false},item={L:line,n};n._item=item;
  Object.assign(p,{chart:{kind:'pgr',lines:[line]},frameLines:[],frameTime:NaN,frameStamp:0,inputFrameLines:[],inputFrameTime:NaN,inputFrameStamp:0,
    visibleLogicalBounds:{},noteItems:[item],noteTimes:Float64Array.of(40),candidateScratch:{},pendingJudge:new Set(),commits:[],
    updatePlayfieldFrame(){}});
  p.tryTap=f.context.Engine.prototype.tryTap;p.eventAudioTime=f.context.Engine.prototype.eventAudioTime;
  p.commit=(note,judge)=>{note.state=1;p.commits.push(judge);};
  return {...f,line,n};
}

test('native and pointer input hit the same rotated/inverted note under CSS offset and scaling',()=>{
  for(const angle of [0,45,90,135,180,225,270,315])for(const above of [true,false])for(const native of [true,false]){
    const {probe:p,line,n}=playable(angle);n.above=above;
    Object.assign(p,{inputRect:{left:21,top:35,width:1000,height:500},viewX:70,viewY:25,viewScale:.75,
      surfaceW:1000,surfaceH:500,nativeTouchAuthoritative:native,useNativeTouchInput:native});
    const point=p.noteJudgePoint(line,n,40),clientX=21+70+point.x*.75,clientY=35+25+point.y*.75;
    if(native)p.touchStart({changedTouches:[{identifier:1,clientX,clientY}],touches:[{identifier:1,clientX,clientY}],timeStamp:1000,cancelable:true,preventDefault(){}});
    else p.pointerDown({pointerId:1,pointerType:'touch',clientX,clientY,timeStamp:1000,cancelable:true,preventDefault(){}});
    assert.deepEqual(p.commits,[0],`${angle}° above=${above} native=${native}`);
  }
});

test('a rotated event within four milliseconds of a rendered frame uses its own geometry',()=>{
  for(const renderCached of [true,false]){
    const {probe:p,line,n,setNow}=playable();
    line.rotate=[{st:40,et:40.01,a:0,b:10}];n.time=40.003;p.noteTimes=Float64Array.of(n.time);
    if(renderCached)p.prepareFrame(40);else p.lineScreen(line,40);
    const along=n.x*p.w*.50625+p.judgeHalfWidth(n)-3,across=200,angle=-3*Math.PI/180,
      x=500+Math.cos(angle)*along-Math.sin(angle)*across,y=250+Math.sin(angle)*along+Math.cos(angle)*across;
    setNow(1003);p.time=40.003;p.tryTap(-2,x,y,40.003);
    assert.deepEqual(p.commits,[0],`render cache=${renderCached}`);
    const stamp=p.inputFrameStamp;p.touchLineX(line,x,y,40.003);
    assert.equal(p.inputFrameStamp,stamp,'all contacts at the same event time reuse the dependency cache');
  }
});

test('a small visual viewport resize immediately reprojects held native contacts without resetting their gestures',()=>{
  const {probe:p,line,n}=playable(90);
  n.judgeArea=.25;const targetY=200+p.judgeHalfWidth(n)+4;n._along=250-targetY;
  const contact={id:-2,nativeTouch:true,active:true,clientX:500,clientY:200,x:500,y:200,lastX:500,lastY:200,startX:480,startY:180,
    downT:1000,lastT:1000,startT:900,speed:100};p.pointer.set(-2,contact);
  Object.assign(p,{surfaceW:1000,surfaceH:480,viewScale:1,viewX:0,viewY:0,inputRect:{left:0,top:0,width:1000,height:480}});
  p.updateViewport();
  const expected=p.eventPoint(contact,{});
  assert(Math.abs(contact.x-expected.x)<1e-8&&Math.abs(contact.y-expected.y)<1e-8,'stationary fingers use the updated CSS-to-logical transform');
  assert.equal(p.touchMatchesNote(line,n,contact,40),true,'vertical hit geometry follows the actual visible contact');
  assert.equal(contact.downT,1000);assert.equal(contact.lastT,1000);assert.equal(contact.startT,900);
  assert(Math.abs(contact.startY-180/.96)<1e-8,'the gesture origin transforms with the viewport');
});

test('a viewport shift rebases pointer contacts as well as native contacts',()=>{
  const {probe:p}=playable();
  const contact={id:7,active:true,clientX:510,clientY:270,x:500,y:250,lastX:500,lastY:250,startX:480,startY:220,lastT:1000,downT:900,speed:80};
  p.pointer.set(7,contact);p.inputRect={left:30,top:50,width:1000,height:500};p.surfaceW=1000;p.surfaceH=500;
  p.updateViewport();assert.equal(contact.x,480);assert.equal(contact.y,220);
  assert.equal(contact.lastT,1000);assert.equal(contact.downT,900);
});
