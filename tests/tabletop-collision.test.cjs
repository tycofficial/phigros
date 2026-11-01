'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict');
const p=(x,y=0,z=0)=>({x,y,z});
test('segment proximity handles crossings, parallel segments, endpoints and degenerate bones',async()=>{
  const {segmentProximity}=await import('../js/tabletop-collision.mjs');
  for(const [a,b,c,d,distance]of [
    [p(-2),p(2),p(0,-2),p(0,2),0],
    [p(0),p(3),p(1,2),p(2,2),2],
    [p(0),p(1),p(2,2),p(2,3),Math.sqrt(5)],
    [p(1),p(1),p(1,3),p(1,4),3],
    [p(1),p(1),p(1,4),p(1,4),4],
    [p(-2),p(-1),p(1),p(2),2]
  ]){
    const result=segmentProximity(a,b,c,d);assert(Math.abs(result.distance-distance)<1e-10);
    assert(result.s>=0&&result.s<=1&&result.t>=0&&result.t<=1);
    assert(Math.abs(segmentProximity(c,d,a,b).distance-distance)<1e-10);
  }
});
test('capsule diagnostics distinguish interhand finger crossings from shared palm webs',async()=>{
  const {handProximity}=await import('../js/tabletop-collision.mjs');
  const hands=[{joints:[[p(-3),p(-1),p(1),p(3)]]},{joints:[[p(0,-3),p(0,-1),p(0,1),p(0,3)]]}];
  const crossing=handProximity(hands);assert(crossing.interHandMinimum< -1);assert(crossing.pairs.length>0);
  hands[1].joints[0]=hands[1].joints[0].map(v=>p(v.x,v.y,5));
  assert(handProximity(hands).interHandMinimum>1.9);
  assert.equal(handProximity([{joints:[[p(0),p(1)],[p(0),p(1,.1)]]}]).pairs.length,0);
});

test('opposing idle directions travel over the knuckle without collapsing extension radius',async()=>{
  const {blendIdleCurl}=await import('../js/tabletop-collision.mjs'),{Vector3}=await import('../js/vendor/three/three.module.js');
  const base=new Vector3(0,4,0),start=new Vector3(0,3,5),folded=new Vector3(0,3,-4);
  let previous=start;
  for(let i=0;i<=400;i++){
    const t=i/400,target=blendIdleCurl(base,start.clone(),folded,t),expected=start.distanceTo(base)*(1-t)+folded.distanceTo(base)*t;
    assert(Math.abs(target.distanceTo(base)-expected)<1e-9);
    assert(target.distanceTo(previous)<.2,'the idle direction must not flip through the MCP');previous=target;
  }
});
