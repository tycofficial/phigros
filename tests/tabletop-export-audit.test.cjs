'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('js/app.js','utf8');
const begin=source.indexOf('  function validateTabletopAudit('),end=source.indexOf('  async function runVideoExport(',begin);
const validate=vm.runInNewContext(source.slice(begin,end)+'\nvalidateTabletopAudit');
const good=()=>({motionSampleHz:120,minJointHeightCm:.24,maxReach:.001,worstTime:1,maxWristStepCm:.5,worstMotionTime:2,maxJointStepCm:1,worstJointMotion:{time:3},minContactSeparationCm:1.5});

test('export preflight accepts continuous reachable motion and songs without simultaneous contacts',()=>{
  assert.doesNotThrow(()=>validate(good()));
  assert.doesNotThrow(()=>validate({...good(),minContactSeparationCm:null}));
  assert.doesNotThrow(()=>validate({...good(),minContactSeparationCm:1.39999999}));
});
test('export rejects unreachable, discontinuous or overlapping contact plans before encoding',()=>{
  assert.throws(()=>validate({...good(),minJointHeightCm:-.01,worstJointHeightTime:4}),/4\.000 秒低于屏幕/);
  assert.throws(()=>validate({...good(),maxReach:.05}),/1\.000 秒超出/);
  assert.throws(()=>validate({...good(),maxWristStepCm:1}),/2\.000 秒移动过快/);
  assert.throws(()=>validate({...good(),maxJointStepCm:2}),/3\.000 秒动作不连续/);
  assert.throws(()=>validate({...good(),minContactSeparationCm:1.3}),/触点间距不足/);
});
test('export requires the full 120 Hz audit and finite motion diagnostics',()=>{
  for(const audit of [null,{...good(),motionSampleHz:30},{...good(),maxReach:NaN},{...good(),maxWristStepCm:Infinity},{...good(),maxJointStepCm:NaN}])assert.throws(()=>validate(audit),/校验未完成/);
  assert.throws(()=>validate({...good(),minContactSeparationCm:NaN}),/触点间距不足/);
});
