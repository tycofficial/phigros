import * as T from './vendor/three/three.module.js';
import {GLTFLoader} from './vendor/three/GLTFLoader.js';
import {openWrist,buildNailMask,Forearm} from './tabletop-anatomy.mjs';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const names=['index-finger','middle-finger','ring-finger','pinky-finger','thumb'];

// Exact closest-point projection onto a convex intersection of reach disks.
// Unlike a fixed number of iterative pushes, this does not leave one finger
// stretched after the next finger's constraint pushes the palm back out.
export function projectReachDisks(desired,disks){
  if(disks.some(d=>d.r<0))return null;
  const valid=p=>disks.every(d=>(p.x-d.x)**2+(p.z-d.z)**2<=d.r*d.r+1e-6);
  if(valid(desired))return{x:desired.x,z:desired.z};
  let best=null,cost=Infinity;
  const consider=p=>{if(!valid(p))return;const c=(p.x-desired.x)**2+(p.z-desired.z)**2;if(c<cost){best=p;cost=c;}};
  for(const d of disks){
    const dx=desired.x-d.x,dz=desired.z-d.z,distance=Math.hypot(dx,dz);
    consider(distance>1e-12?{x:d.x+dx*d.r/distance,z:d.z+dz*d.r/distance}:{x:d.x+d.r,z:d.z});
  }
  for(let i=0;i<disks.length;i++)for(let j=i+1;j<disks.length;j++){
    const a=disks[i],b=disks[j],dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
    if(d<1e-10||d>a.r+b.r+1e-7||d<Math.abs(a.r-b.r)-1e-7)continue;
    const along=(a.r*a.r-b.r*b.r+d*d)/(2*d),height=Math.sqrt(Math.max(0,a.r*a.r-along*along));
    const x=a.x+dx*along/d,z=a.z+dz*along/d;
    consider({x:x-dz*height/d,z:z+dx*height/d});consider({x:x+dz*height/d,z:z-dx*height/d});
  }
  return best;
}

// Analytic PIP bend with an extended distal pair: exact bone lengths and
// deterministic contact, including near-full extension where iterative IK drifts.
export function solveFinger(base,target,lengths,up=1){
  const first=lengths[0],second=lengths[1]+lengths[2],total=first+second;
  const delta=target.clone().sub(base),actual=delta.length(),dir=delta.normalize();
  if(actual<1e-9)dir.set(0,0,-1);
  const d=clamp(actual,Math.abs(first-second)+1e-5,total-1e-5);
  const along=(first*first-second*second+d*d)/(2*d),height=Math.sqrt(Math.max(0,first*first-along*along));
  // Transport the anatomical bend plane from a forward finger. Projecting UP
  // onto a nearly vertical direction flips its sign across that singularity.
  const pole=V(0,up,0).applyQuaternion(new T.Quaternion().setFromUnitVectors(V(0,0,-1),dir));
  const elbow=base.clone().addScaledVector(dir,along).addScaledVector(pole,height);
  const tip=base.clone().addScaledVector(dir,d),distal=elbow.clone().lerp(tip,lengths[1]/second);
  return{points:[base.clone(),elbow,distal,tip],error:tip.distanceTo(target)};
}

function constrainSkin(material,inverse,floor,nails=false){
  const result=material.clone();
  result.onBeforeCompile=shader=>{
    shader.uniforms.phiHandInverse={value:inverse};shader.uniforms.phiGlassY={value:floor};
    shader.vertexShader='uniform mat4 phiHandInverse;\nuniform float phiGlassY;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <skinning_vertex>',`#include <skinning_vertex>
      vec4 phiHandWorld = modelMatrix * vec4(transformed, 1.0);
      phiHandWorld.y = max(phiGlassY + 0.003, phiHandWorld.y);
      transformed = (phiHandInverse * phiHandWorld).xyz;`);
    if(nails){
      shader.vertexShader='attribute float phiNail;\nvarying float vPhiNail;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPhiNail = phiNail;');
      shader.fragmentShader='varying float vPhiNail;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>','#include <color_fragment>\ndiffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.64, 0.40, 0.33), vPhiNail);');
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, vPhiNail);');
    }
  };
  result.customProgramCacheKey=()=> 'phi-hand-contact-nails-v2-'+nails;return result;
}

export class SkinnedHand {
  static async create(side,scene,skin,floor,signal){
    const hand=new SkinnedHand(side,scene,skin,floor);
    const name=side<0?'left':'right',url=new URL(`../assets/tabletop/hands/${name}.glb.gz`,import.meta.url);
    const response=await fetch(url,{signal});if(!response.ok)throw Error('手部模型加载失败。');
    const packed=await response.arrayBuffer(),signature=new Uint8Array(packed,0,Math.min(2,packed.byteLength));
    const binary=signature[0]===31&&signature[1]===139?await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():packed;
    const gltf=await new GLTFLoader().parseAsync(binary,url.href);
    hand.initialize(gltf.scene);return hand;
  }
  constructor(side,scene,skin,floor){this.side=side;this.scene=scene;this.skin=skin;this.floor=floor;this.reachError=0;}
  initialize(group){
    this.group=group;this.scene.add(group);this.bones=new Map();
    group.traverse(object=>{if(object.isBone)this.bones.set(object.name,object);if(object.isSkinnedMesh)this.mesh=object;});
    if(!this.mesh||this.bones.size!==25)throw Error('手部骨骼模型不完整。');
    this.mesh.geometry.computeVertexNormals();
    const side=this.side;
    const basis=new T.Matrix4().makeBasis(V(0,side<0?-1:1,0),V(0,0,1),V(side<0?-1:1,0,0));
    this.rotation=new T.Quaternion().setFromRotationMatrix(basis);this.inverseRotation=this.rotation.clone().invert();
    this.wrist=this.bones.get('wrist');this.origin=this.wrist.position.clone();
    this.rest=new Map();
    for(const [name,bone]of this.bones)this.rest.set(name,{position:bone.position.clone().sub(this.origin).applyQuaternion(this.rotation).multiplyScalar(100),quaternion:bone.quaternion.clone()});
    this.fingers=names.map(name=>{
      const chain=(name==='thumb'?['thumb-metacarpal','thumb-phalanx-proximal','thumb-phalanx-distal','thumb-tip']:[name+'-phalanx-proximal',name+'-phalanx-intermediate',name+'-phalanx-distal',name+'-tip']).map(key=>this.bones.get(key));
      const positions=chain.map(bone=>this.rest.get(bone.name).position.clone());
      const lengths=positions.slice(1).map((p,i)=>p.distanceTo(positions[i]));
      return{name,chain,positions,lengths};
    });
    const cuff=openWrist(this.mesh.geometry,this.origin,this.rotation,this.mesh.skeleton.bones.indexOf(this.wrist));
    this.nailVertices=buildNailMask(this.mesh.geometry,this.origin,this.rotation,this.fingers);
    this.forearm=new Forearm(this.side,this.skin,cuff);this.scene.add(this.forearm.mesh);
    group.quaternion.copy(this.rotation);group.scale.setScalar(100);group.updateMatrixWorld(true);
    this.inverseMatrix=new T.Matrix4();
    this.mesh.material=constrainSkin(this.skin,this.inverseMatrix,this.floor,true);
    this.mesh.castShadow=this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
    const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
    this.mesh.customDepthMaterial=constrainSkin(depth,this.inverseMatrix,this.floor);depth.dispose();
  }
  plan(poses,screen,floor,lift=0,preferred=null){
    const targets=poses.map(p=>V((p.x-.5)*screen.width,floor+p.z+.24,(p.y-.5)*screen.height));
    const weights=poses.map(p=>p.contact?1:Math.max(smooth(1-(p.until??Infinity)/.35),smooth(1-(p.since??Infinity)/.18)));
    const sum=weights.reduce((a,b)=>a+b,0);
    let wrist=V(this.side*7.8,floor+3.55+lift,19.2);
    if(sum>1e-9){
      let x=0,z=0;
      for(let i=0;i<5;i++){const tip=this.fingers[i].positions[3];x+=(targets[i].x-tip.x)*weights[i];z+=(targets[i].z-tip.z-.65)*weights[i];}
      const blend=smooth(Math.max(...weights));wrist.x=wrist.x*(1-blend)+x/sum*blend;wrist.z=wrist.z*(1-blend)+z/sum*blend;
    }
    if(preferred){wrist.copy(preferred);wrist.y+=lift;}
    wrist.x=clamp(wrist.x,-20,20);wrist.z=clamp(wrist.z,0,32);
    const atHeight=(height,relax=1)=>{
      const disks=[];
      for(let i=0;i<5;i++)if(preferred?poses[i].contact:weights[i]>1e-6){
        const base=this.fingers[i].positions[0],radius=this.fingers[i].lengths.reduce((a,b)=>a+b,0)*.985+(preferred?0:3*relax*(1-weights[i])/weights[i]);
        const dy=targets[i].y-height-base.y;
        disks.push({x:targets[i].x-base.x,z:targets[i].z-base.z,r:Math.abs(dy)>radius?-1:Math.sqrt(Math.max(0,radius*radius-dy*dy))});
      }
      return projectReachDisks(wrist,disks);
    };
    let point=atHeight(wrist.y);
    if(!point){
      let low=floor+2.3,high=wrist.y,relax=1;
      point=atHeight(low);
      while(!point&&relax<16){relax*=2;point=atHeight(low,relax);}
      if(point){
        if(relax>1){
          let a=relax/2,b=relax;
          for(let i=0;i<10;i++){const middle=(a+b)/2;if(atHeight(low,middle))b=middle;else a=middle;}
          relax=b*1.005;point=atHeight(low,relax);
        }
        for(let i=0;i<9;i++){const middle=(low+high)/2,candidate=atHeight(middle,relax);if(candidate){low=middle;point=candidate;}else high=middle;}
        wrist.y=low;
      }
    }
    if(point){wrist.x=point.x;wrist.z=point.z;}
    return{targets,weights,wrist};
  }
  update(poses,screen,floor,plan=null){
    const {targets,wrist}=plan||this.plan(poses,screen,floor);this.lastWrist=wrist;
    // The palm anticipates the whole phrase; idle fingers stay relaxed until
    // the actual approach, instead of reaching through the other hand early.
    const weights=poses.map(p=>p.contact?1:Math.max(smooth(1-(p.until??Infinity)/.12),smooth(1-(p.since??Infinity)/.07)));
    const originWorld=this.origin.clone().applyQuaternion(this.rotation).multiplyScalar(100);
    this.group.position.copy(wrist).sub(originWorld);
    // Reset every joint from the neutral template on every frame: seek, FPS and
    // render speed do not alter the pose, and skin weights retain a solid palm.
    for(const [name,bone]of this.bones){
      const rest=this.rest.get(name);bone.position.copy(rest.position).multiplyScalar(.01).applyQuaternion(this.inverseRotation).add(this.origin);bone.quaternion.copy(rest.quaternion);
    }
    this.reachError=0;this.contactError=null;
    for(let i=0;i<5;i++){
      const f=this.fingers[i],base=f.positions[0].clone().add(wrist),neutral=f.positions[3].clone().add(wrist);
      const relaxed=base.clone().lerp(neutral,.80);relaxed.y=floor+2.6;
      if(i===4){base.y=Math.max(base.y,floor+1.3);relaxed.x=base.x+this.side*.7;relaxed.z=base.z-5.8;relaxed.y=floor+1.8;}
      const target=relaxed.lerp(targets[i],weights[i]);
      const {points,error}=solveFinger(base,target,f.lengths);
      let rigidThumb=null;
      if(i===4&&weights[i]<1){
        const source=f.positions[3].clone().sub(f.positions[0]),length=source.length();
        const desired=V(this.side*.7,.4,-Math.sqrt(length*length-.65));
        rigidThumb=new T.Quaternion().setFromUnitVectors(source.normalize(),desired.normalize());
        for(let j=0;j<4;j++){
          const relaxedPoint=f.positions[j].clone().sub(f.positions[0]).applyQuaternion(rigidThumb).add(base);
          points[j].lerp(relaxedPoint,1-weights[i]);
        }
      }
      if(poses[i].contact)this.reachError=Math.max(this.reachError,error);
      if(poses[i].contact&&error>1e-5)this.contactError={finger:i,base:base.toArray(),target:target.toArray(),lengths:f.lengths,wrist:wrist.toArray()};
      for(let j=0;j<4;j++){
        const bone=f.chain[j],rest=this.rest.get(bone.name),k=Math.min(j,2);
        const before=f.positions[k+1].clone().sub(f.positions[k]).normalize(),after=points[k+1].clone().sub(points[k]).normalize();
        const delta=new T.Quaternion().setFromUnitVectors(before,after);
        if(rigidThumb)delta.copy(rigidThumb).slerp(new T.Quaternion().setFromUnitVectors(before,after),weights[i]);
        bone.position.copy(points[j]).sub(wrist).multiplyScalar(.01).applyQuaternion(this.inverseRotation).add(this.origin);
        bone.quaternion.copy(this.inverseRotation).multiply(delta).multiply(this.rotation).multiply(rest.quaternion);
      }
    }
    this.group.updateMatrixWorld(true);this.inverseMatrix.copy(this.mesh.matrixWorld).invert();this.mesh.skeleton.update();
  }
  updateSurface(){this.forearm.update(this.lastWrist,this.floor);}
}
