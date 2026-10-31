'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const visual=require('../js/boss-replay-visuals.js');
test('clock perspective uses the serialized camera and exactly the original 42 quads',()=>{
 const source=JSON.parse(fs.readFileSync('assets/meta/boss-replay-source.json','utf8'));
 const transforms=source.scenes['19'].transforms;
 assert.equal(transforms.filter(t=>['中环','内环','外环'].includes(t.name)).length,42);
 assert.equal(visual.CAMERA.fieldOfView,90);assert.equal(visual.CAMERA.far,100);
 const planes=visual.projectClock({cameraZ:-10},{width:1920,height:1080});
 assert.deepEqual(planes.map(p=>p.depth),[90,70,50,20]);
 assert(Math.abs(planes.at(-1).width-1350)<0.00001);
 assert(visual.projectClock({cameraZ:970},{width:1920,height:1080}).every(p=>p.depth>0.3));
});
test('clock Play uses the tilted original RectTransform while final Play stretches full-screen',()=>{
 const state={boss:'rrharil',phase:'clock-ready'},options={width:1920,height:1080},polygon=visual.buttonPolygon(state,options);
 const point={x:polygon.reduce((s,p)=>s+p.x,0)/4,y:polygon.reduce((s,p)=>s+p.y,0)/4,...options};
 assert(visual.hitTest(state,point));assert(!visual.hitTest(state,{...options,x:960,y:540}));
 assert(!visual.hitTest(state,{...options,x:point.x,y:point.y-250}));
 assert(visual.hitTest({boss:'rrharil',phase:'ready'},{...options,x:960,y:540}));
 assert(!visual.hitTest({boss:'rrharil',phase:'intro'},{...options,x:960,y:540}));
});
test('overlay clears its pixels during real video phases and preserves instance hit coordinates',async()=>{
 let draws=0,fills=0,clears=0;const ctx={setTransform(){},clearRect(){clears++;},fillRect(){fills++;},drawImage(){draws++;},beginPath(){},moveTo(){},lineTo(){},closePath(){},fill(){},fillText(){}};
 const canvas={width:0,height:0,getContext:()=>ctx},images={};
 for(const key of ['clock-outer','clock-middle','clock-inner','spasmodic-entry','spasmodic-touch'])images[key]={width:512,height:512};
 const renderer=visual.create(canvas,{images});await renderer.ready;
 const frame=renderer.sample({boss:'rrharil',phase:'clock',cameraZ:-10},{width:1920,height:1080});assert.equal(frame.drawnPlanes,4);assert(draws>0);
 const oldDraws=draws,oldFills=fills;
 assert.equal(renderer.sample({boss:'rrharil',phase:'intro'},{width:1920,height:1080}).visible,false);assert.equal(draws,oldDraws);assert.equal(fills,oldFills);assert(clears>=2);
 renderer.sample({boss:'rrharil',phase:'clock-ready',cameraZ:970},{width:1920,height:1080});
 assert(renderer.hitTest({x:482,y:830}));assert(!renderer.hitTest({x:960,y:540}));renderer.destroy();
});
