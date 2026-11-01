'use strict';
const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),zlib=require('node:zlib');
async function loadHand(side){
  const T=await import('../js/vendor/three/three.module.js'),{GLTFLoader}=await import('../js/vendor/three/GLTFLoader.js'),{SkinnedHand}=await import('../js/tabletop-hand.mjs');
  const bytes=zlib.gunzipSync(fs.readFileSync('assets/tabletop/hands/'+(side<0?'left':'right')+'.glb.gz'));
  const gltf=await new GLTFLoader().parseAsync(bytes.buffer.slice(bytes.byteOffset,bytes.byteOffset+bytes.byteLength),'');
  const hand=new SkinnedHand(side,new T.Scene(),new T.MeshPhysicalMaterial(),.1);hand.initialize(gltf.scene);return{hand,T};
}
test('both thumbs remain on the radial side of the palm with unchanged joint lengths',async()=>{
  for(const side of [-1,1]){
    const {hand,T}=await loadHand(side),f=hand.fingers[4],poses=Array.from({length:5},()=>({x:.5,y:.5,z:2,contact:false}));
    for(const wrist of [new T.Vector3(side*8,3.65,19),new T.Vector3(side*2,5.5,12)]){
      const plan=hand.plan(poses,{width:26.35,height:19.81},.1,0,wrist);hand.update(poses,{width:26.35,height:19.81},.1,plan);
      const points=hand.joints[4],relative=points[3].clone().sub(points[0]);
      assert(-side*relative.x>3.5,'the thumb must splay away from the palm, toward the index side');
      assert(relative.z< -4,'the thumb also points forward in its relaxed stance');
      assert(points[3].y>points[0].y,'a resting thumb hovers instead of folding below the palm');
      for(let j=0;j<3;j++)assert(Math.abs(points[j].distanceTo(points[j+1])-f.lengths[j])<1e-9);
      const first=hand.joints[4].map(p=>p.toArray());hand.update(poses,{width:26.35,height:19.81},.1,plan);
      assert.deepEqual(hand.joints[4].map(p=>p.toArray()),first,'seeking must not accumulate thumb rotation');
      // Inspect the actual skinned surface, not just joint/capsule locations.
      const geometry=hand.mesh.geometry,p=new T.Vector3(),thumb=[],palm=[];
      for(const index of new Set(geometry.index.array)){
        const indices=geometry.attributes.skinIndex.array.slice(index*4,index*4+4),weights=geometry.attributes.skinWeight.array.slice(index*4,index*4+4);
        const weight=Math.max(...weights),bone=hand.mesh.skeleton.bones[indices[weights.indexOf(weight)]].name;
        if(weight<.7)continue;
        hand.mesh.getVertexPosition(index,p);p.applyMatrix4(hand.mesh.matrixWorld).sub(hand.lastWrist);
        if(bone==='thumb-phalanx-distal')thumb.push(-side*p.x);
        if(bone==='wrist'||bone==='index-finger-metacarpal')palm.push(-side*p.x);
      }
      assert(thumb.length>500&&palm.length>1000);
      assert(Math.min(...thumb)>Math.max(...palm)+1,'the distal thumb skin must be visibly outside the palm surface');
    }
  }
});
test('hand surface detail follows the skin geometry with bounded folds and a short nail edge',async()=>{
  const {hand}=await loadHand(-1),geometry=hand.mesh.geometry,detail=geometry.attributes.phiSkinDetail;
  assert.equal(detail.count,geometry.attributes.position.count);
  const sums=[0,0,0];
  for(let i=0;i<detail.count;i++)for(let j=0;j<3;j++){
    const value=detail.array[i*3+j];assert(Number.isFinite(value)&&value>=0&&value<=1);sums[j]+=value;
  }
  assert(sums.every(value=>value>5),'all anatomical detail channels must cover actual vertices');
  assert(sums[0]<detail.count*.15,'folds cannot become stripes over the entire hand');
});

test('close palms use complementary thumb passing poses without shortening bones or seek drift',async()=>{
  const {segmentProximity,FINGER_CORE_RADII}=await import('../js/tabletop-collision.mjs');
  const loaded=await Promise.all([-1,1].map(loadHand)),hands=loaded.map(v=>v.hand),T=loaded[0].T;
  const poses=Array.from({length:5},()=>({x:.5,y:.5,z:2,contact:false})),screen={width:26.35,height:19.81};
  const plans=hands.map((hand,index)=>hand.plan(poses,screen,.1,0,new T.Vector3(index?3.9:-3.9,4.31,19)));
  const clearance=()=>{
    let minimum=Infinity;
    for(let a=0;a<3;a++)for(let b=0;b<3;b++)minimum=Math.min(minimum,segmentProximity(hands[0].joints[4][a],hands[0].joints[4][a+1],hands[1].joints[4][b],hands[1].joints[4][b+1]).distance-FINGER_CORE_RADII[4][a]-FINGER_CORE_RADII[4][b]);
    return minimum;
  };
  hands.forEach((hand,index)=>hand.update(poses,screen,.1,plans[index]));
  assert(clearance()< -1,'the synthetic palms reproduce the original thumb crossing');
  const snapshot=hands.map(hand=>[{points:hand.joints[4].map(p=>p.clone()),finger:4,radii:FINGER_CORE_RADII[4],strength:1}]);
  hands.forEach((hand,index)=>hand.update(poses,screen,.1,plans[index],null,snapshot[1-index]));
  assert(clearance()>.25,'complementary rotations must separate the thumb cores');
  const first=hands.map(hand=>hand.joints[4].map(p=>p.toArray()));
  hands.forEach((hand,index)=>{
    for(let j=0;j<3;j++)assert(Math.abs(hand.joints[4][j].distanceTo(hand.joints[4][j+1])-hand.fingers[4].lengths[j])<1e-9);
    hand.update(poses,screen,.1,plans[index],null,snapshot[1-index]);
    assert.deepEqual(hand.joints[4].map(p=>p.toArray()),first[index]);
  });
});

test('idle avoidance leaves real contact fingertips unchanged',async()=>{
  const {hand,T}=await loadHand(1),screen={width:26.35,height:19.81},poses=Array.from({length:5},()=>({x:.5,y:.5,z:2,contact:false}));
  poses[0]={x:.6,y:.6,z:0,contact:true};
  const plan=hand.plan(poses,screen,.1,0,new T.Vector3(3.9,4.31,19));hand.update(poses,screen,.1,plan);
  const before=hand.joints[0][3].clone(),obstacles=[{points:hand.joints[4].map(p=>p.clone()),finger:4,strength:1}];
  hand.update(poses,screen,.1,plan,null,obstacles);
  assert(before.distanceTo(hand.joints[0][3])<1e-10);assert.equal(hand.reachError,0);
});

test('off-grid contact seams meet the exact fingertip despite interpolated hover offsets',async()=>{
  const {hand,T}=await loadHand(1),screen={width:26.35,height:19.81},poses=Array.from({length:5},()=>({x:.5,y:.5,z:2,contact:false}));
  poses[0]={x:.6,y:.6,z:0,contact:true};
  const plan=hand.plan(poses,screen,.1,0,new T.Vector3(3.9,4.31,19));hand.update(poses,screen,.1,plan);
  const contact=hand.joints[0][3].clone(),offsets=hand.fingerTargets(poses,.1,plan).map(v=>v.target.clone().sub(v.base));
  offsets[0].x+=2;
  const state={offsets,poles:Array.from({length:5},()=>new T.Vector3(0,1,0))};
  for(const edge of ['until','since']){
    const near=poses.map(p=>({...p}));near[0]={x:.6,y:.6,z:1e-8,contact:false,[edge]:1e-7};
    hand.update(near,screen,.1,plan,state);
    assert(hand.joints[0][3].distanceTo(contact)<1e-5,'an authored contact between samples cannot snap to a different fingertip');
  }
});

test('analytic bend-plane clearance keeps intermediate joints above glass with exact contact and bone lengths',async()=>{
  const {solveFinger}=await import('../js/tabletop-hand.mjs'),{Vector3}=await import('../js/vendor/three/three.module.js');
  const base=new Vector3(0,3.5,0),lengths=[4.69,2.75,1.22];
  for(let i=0;i<200;i++){
    const radius=.2+(i%50)/50*6,target=new Vector3(Math.sin(i)*radius,.24,Math.cos(i)*radius),pole=new Vector3(Math.sin(i*.3),-1,Math.cos(i*.3)).normalize();
    const result=solveFinger(base,target,lengths,1,pole,.02);
    assert(result.error<1e-8);assert(result.points.every(point=>point.y>=.02-1e-8));
    for(let j=0;j<3;j++)assert(Math.abs(result.points[j].distanceTo(result.points[j+1])-lengths[j])<1e-8);
  }
});
