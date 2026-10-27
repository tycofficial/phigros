const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs'),vm=require('node:vm'),zlib=require('node:zlib'),crypto=require('node:crypto');
const {fixture}=require('./helpers/engine.cjs');
const source=fs.readFileSync('js/app.js','utf8');
function shippedFunction(name){
  const start=source.indexOf('  function '+name+'(');assert(start>=0,name);
  const next=source.slice(start+3).search(/^  (?:async )?function /m);assert(next>=0,name+' boundary');
  return source.slice(start,start+3+next);
}
const parser=vm.createContext({});
vm.runInContext(['clamp','lerp','ease','cubicBezierProgress','compileEventFastFields','eventEaseValue','prepareEvents','eventValueFast',
  'buildPgrHeightTrack','normalizeOffset','countMulti','blockPair','prepareNativeBlocks','parsePGR','archiveDirname',
  'applyHistoricalSPLineProfile','applyRecordChartMetadata'].map(shippedFunction).join('\n'),parser);
const catalogContext={};vm.runInNewContext(fs.readFileSync('js/full-catalog.js','utf8'),catalogContext);
const catalog=catalogContext.PhiFullCatalog,assets=new Map(catalog.assets.map(asset=>[asset.id,asset]));
function historical(name){
  const entry=catalog.entries.find(entry=>entry.name===name&&entry.meta.difficultyClass==='SP');assert(entry,name);
  const spec=assets.get(entry.files.find(file=>file.name==='chart.json').asset),raw=zlib.gunzipSync(fs.readFileSync(spec.url));
  return {raw,entry,chart:parser.parsePGR(JSON.parse(raw)),record:{builtin:true,builtinEntryId:entry.id,meta:entry.meta}};
}
function paint(chart,time){
  const candidates=[],rectangles=[];
  const {probe,context}=fixture({eventValueFast:parser.eventValueFast,chartRevealEnabled:false,
    drawNativeBlocks(){},drawNativeNoiseOverlay(){},NOTE_RENDER_ORDER:[],PHI_COLORS:{ap:'#ffecA0',fc:'#a2eeff'}});
  const ctx={setTransform(){},save(){},restore(){},beginPath(){},rect(){},clip(){},fillRect(...args){rectangles.push(args);}};
  Object.assign(probe,{chart,record:{meta:{}},ctx,frameTime:time,frameLines:[],renderLines:chart.lines,
    dpr:1,counts:[0,0,0,0],officialLineSpan:{from:-2000,to:2000},badGhosts:[],effects:[],
    drawGameplayBackground(){},renderBucketAt(){return null;},officialLineThickness(){return 2;},
    officialLineIntersectsViewport(frame){candidates.push(chart.lines.find(line=>probe.frameLines[line.id]===frame).id);return true;},
    visibleEffectsAt(){return [];},hideForegroundFxUnderlay(){}});
  for(const line of chart.lines)context.Engine.prototype.computeLineFrame.call(probe,line,time,1);
  context.Engine.prototype.draw.call(probe,time,1000);
  assert.equal(rectangles.length,candidates.length);
  return candidates;
}

test('pinned Spasmodic SP keeps its moving playable line while stationary helper channels stop painting',()=>{
  const {raw,chart,record}=historical('Spasmodic(Haocore Mix)');
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'f9134dcb91e60f71ac5c604bdf3c0d06ddbae39f79f0c428af2ce77165dce7c6');
  const alphaData=JSON.stringify(chart.lines.slice(20).map(line=>line.alpha));
  assert(paint(chart,30).includes(20),'reproduces the extra stationary centerline');
  parser.applyRecordChartMetadata(chart,record);
  for(const time of [0,10,30,60,90,120])assert.deepEqual(paint(chart,time),[0],`seconds ${time}`);
  assert.equal(chart.noteCount,2500);assert.equal(chart.lines[0].notes.length,2500);assert.equal(chart.lines.length,24);
  assert.equal(JSON.stringify(chart.lines.slice(20).map(line=>line.alpha)),alphaData,'source event tracks are preserved');
});

test('Wavetapper SP retains all authored lines including the note-bearing line 23',()=>{
  const {chart,record}=historical('Wavetapper');
  const alpha=chart.lines[23].alpha.find(event=>Math.max(event.a,event.b)>.9);assert(alpha);
  const time=(alpha.st+alpha.et)/2,before=paint(chart,time);
  assert(before.includes(23),'samples a legitimately visible high-index line');
  parser.applyRecordChartMetadata(chart,record);
  assert.deepEqual(paint(chart,time),before);assert.equal(chart.noteCount,906);
  assert(chart.lines.every(line=>!line.nonRenderingControl));
});

test('Dead Soul SP authored visibility is unchanged at the reported middle section',()=>{
  const {chart,record}=historical('Dead Soul');
  const times=[10,30,60,90,120],before=times.map(time=>paint(chart,time));
  parser.applyRecordChartMetadata(chart,record);
  assert.deepEqual(times.map(time=>paint(chart,time)),before);assert.equal(chart.noteCount,564);
});

test('ordinary empty decorative lines and modified SP layouts are not globally hidden',()=>{
  const rawLine={bpm:120,notesAbove:[],notesBelow:[],speedEvents:[],judgeLineDisappearEvents:[],judgeLineMoveEvents:[],judgeLineRotateEvents:[]},
    decorative=parser.parsePGR({formatVersion:3,judgeLineList:[rawLine,{...rawLine}]});
  parser.applyRecordChartMetadata(decorative,{builtin:true,id:'builtin:another-chart',meta:{}});
  assert.deepEqual(paint(decorative,30),[0,1]);
  const {chart,record}=historical('Spasmodic(Haocore Mix)');
  chart.lines[20].moveX[0].a=.2;
  parser.applyRecordChartMetadata(chart,record);
  assert(chart.lines.every(line=>!line.nonRenderingControl),'the exact compatibility signature is required');
});
