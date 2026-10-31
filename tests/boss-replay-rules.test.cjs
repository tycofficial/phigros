'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const rules=require('../js/boss-replay-rules.js');
const has=(events,type)=>events.find(event=>event.type===type);
function setup(boss,tier='IN'){const run=rules.create({boss,tier});run.drain();return run;}
function activate(run,seconds=1.1){run.update({deltaTime:seconds});return run.input('activate');}
function playing(run){return run.update({deltaTime:0.01,videoPlaying:true,videoTime:0.01,clipId:run.state.clip});}
function tick(run,seconds,extra={}){let events=[];for(let t=0;t<seconds;t+=1/60)events.push(...run.update({deltaTime:Math.min(1/60,seconds-t),...extra}));return events;}
test('only selected boss songs receive a replay route and the switch gates routing',()=>{
 for(const song of ['Spasmodic','Igallta','Rrharil',"Rrhar’il",'Igallta.SeURa.0'])assert(rules.routeForSong(song));
 for(const song of ['ClockParadox','Spasmodic remix',null])assert.equal(rules.routeForSong(song),null);
 assert.equal(rules.routeForSong('Igallta',false),null);
});
test('Igallta starts its original loop and rejects the first-second accidental tap',()=>{
 const run=rules.create({boss:'igallta',tier:'HD'}),events=run.drain();
 assert.equal(has(events,'play-clip').id,'iga_loop');assert.equal(has(events,'play-clip').loop,true);
 run.update({deltaTime:0.999});assert.equal(run.input('activate').length,0);assert.equal(run.state.phase,'entry');
 run.update({deltaTime:0.001});assert.equal(has(run.input('activate'),'play-clip').id,'iga_main');
});
test('Igallta download time, ended notifications and nonplaying media never start a chart',()=>{
 const run=setup('igallta');activate(run);
 tick(run,50,{videoPlaying:false,videoTime:18.5,videoEnded:true});assert.equal(run.state.phase,'intro');
 tick(run,2,{videoPlaying:true,videoTime:0.009});assert.equal(run.state.phase,'intro');
 playing(run);tick(run,19.9);assert.equal(run.state.phase,'intro');
 const events=tick(run,0.2);assert.equal(has(events,'start-song').songKey,'Igallta');assert.equal(run.state.phase,'playing');
});
test('Spasmodic original button starts the 29.5-second timer and 0.75-second video reveal',()=>{
 const run=setup('spasmodic','EZ');activate(run,0.7);
 assert.equal(run.state.phase,'intro');assert(!has(run.update({deltaTime:0.74}),'play-clip'));
 assert.equal(has(run.update({deltaTime:0.02}),'play-clip').id,'spas_unlock');
 tick(run,28.7);assert.equal(run.state.phase,'intro');
 assert.equal(has(tick(run,0.1),'start-song').tier,'EZ');
});
test('real chart score is required; both pass and failure retain the chosen tier',()=>{
 for(const [score,passed]of [[699999,false],[700000,true],[1000000,true]]){
  const run=setup('spasmodic','AT');assert.equal(run.finish({score}).length,0);activate(run);tick(run,29.6);
  assert.throws(()=>run.finish({}),/real chart score/);assert.throws(()=>run.finish({score:1000001}),/real chart score/);
  const event=has(run.finish({score,miss:7}),'complete');assert.equal(event.result.passed,passed);assert.equal(event.tier,'AT');
  assert.equal(run.finish({score:1000000}).length,0);
 }
});
test('Rrharil reverse waits for a genuinely started clip then nine seconds',()=>{
 const run=rules.create({boss:'rrharil'});assert.equal(has(run.drain(),'play-clip').id,'time_reverse');
 tick(run,20);assert.equal(run.state.phase,'reverse');playing(run);tick(run,8.9);assert.equal(run.state.phase,'reverse');
 tick(run,0.2);assert.equal(run.state.phase,'clock');assert.equal(run.state.cameraZ,-10);
});
test('Rrharil any-position hold moves the original camera and release decelerates',()=>{
 const run=setup('rrharil');playing(run);run.update({deltaTime:9.1});
 tick(run,2);assert.equal(run.state.cameraZ,-10);
 run.input('hold-start',{x:-999,y:999});tick(run,2);const z=run.state.cameraZ,speed=run.state.cameraSpeed;
 assert(z>-10&&speed>0&&speed<200);run.input('hold-end');tick(run,2);assert(run.state.cameraSpeed<speed/100);assert(run.state.cameraZ>z);
 run.input('hold-start');tick(run,20);assert.equal(run.state.phase,'clock-ready');assert.equal(run.state.cameraZ,970);
});
test('Rrharil requires Play, the separate unlock video, and final Play before chart starts',()=>{
 const run=setup('rrharil','HD');playing(run);run.update({deltaTime:9.1});tick(run,20,{held:true});
 assert.equal(run.state.phase,'clock-ready');run.input('activate');tick(run,0.7);assert.equal(run.state.scene,'RrharilUnlock');
 run.update({deltaTime:0.7});assert.equal(has(run.input('activate'),'play-clip').id,'rr_unlock');
 tick(run,40,{videoPlaying:false,videoTime:35.435});assert.equal(run.state.phase,'intro');playing(run);
 tick(run,31.5);assert.equal(run.state.phase,'intro');tick(run,0.1);assert.equal(run.state.phase,'ready');
 run.input('activate');tick(run,0.49);assert.equal(run.state.phase,'song-start');
 const event=has(tick(run,0.02),'start-song');assert.equal(event.songKey,'Rrharil');assert.equal(event.tier,'HD');assert.equal(event.mod,'001UiChange');
});
test('cancel during download or animation is terminal and cannot award success',()=>{
 for(const boss of ['spasmodic','igallta','rrharil']){
  const run=setup(boss);activate(run);assert(has(run.input('cancel'),'return-selection'));
  assert.equal(tick(run,100,{videoPlaying:true,videoTime:10,held:true}).length,0);
  assert.equal(run.finish({score:1000000}).length,0);assert(run.state.cancelled);
 }
});
