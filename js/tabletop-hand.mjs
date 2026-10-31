import * as T from './vendor/three/three.module.js';
import {GLTFLoader} from './vendor/three/GLTFLoader.js';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const names=['index-finger','middle-finger','ring-finger','pinky-finger','thumb'];

// Analytic PIP bend with an extended distal pair: exact bone lengths and
// deterministic contact, including near-full extension where iterative IK drifts.
export function solveFinger(base,target,lengths,up=1){
  const first=lengths[0],second=lengths[1]+lengths[2],total=first+second;
  const delta=target.clone().sub(base),actual=delta.length(),dir=delta.normalize();
  if(actual<1e-9)dir.set(0,0,-1);
  const d=clamp(actual,Math.abs(first-second)+1e-5,total-1e-5);
  const along=(first*first-second*second+d*d)/(2*d),height=Math.sqrt(Math.max(0,first*first-along*along));
  const pole=V(0,up,0).addScaledVector(dir,-dir.y*up).normalize();if(pole.lengthSq()<.1)pole.set(0,0,1);
  const elbow=base.clone().addScaledVector(dir,along).addScaledVector(pole,height);
  const tip=base.clone().addScaledVector(dir,d),distal=elbow.clone().lerp(tip,lengths[1]/second);
  return{points:[base.clone(),elbow,distal,tip],error:tip.distanceTo(target)};
}

function constrainSkin(material,inverse,floor){
  const result=material.clone();
  result.onBeforeCompile=shader=>{
    shader.uniforms.phiHandInverse={value:inverse};shader.uniforms.phiGlassY={value:floor};
    shader.vertexShader='uniform mat4 phiHandInverse;\nuniform float phiGlassY;\n'+shader.vertexShader;
    shader.vertexShader=shader.vertexShader.replace('#include <skinning_vertex>',`#include <skinning_vertex>
      vec4 phiHandWorld = modelMatrix * vec4(transformed, 1.0);
      phiHandWorld.y = max(phiGlassY + 0.003, phiHandWorld.y);
      transformed = (phiHandInverse * phiHandWorld).xyz;`);
  };
  result.customProgramCacheKey=()=> 'phi-hand-glass-contact-v1';return result;
}

export class SkinnedHand {
  static async create(side,scene,skin,nailMaterial,floor,signal){
    const hand=new SkinnedHand(side,scene,skin,nailMaterial,floor);
    const name=side<0?'left':'right',url=new URL(`../assets/tabletop/hands/${name}.glb.gz`,import.meta.url);
    const response=await fetch(url,{signal});if(!response.ok)throw Error('手部模型加载失败。');
    const packed=await response.arrayBuffer(),signature=new Uint8Array(packed,0,Math.min(2,packed.byteLength));
    const binary=signature[0]===31&&signature[1]===139?await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():packed;
    const gltf=await new GLTFLoader().parseAsync(binary,url.href);
    hand.initialize(gltf.scene);return hand;
  }
  constructor(side,scene,skin,nailMaterial,floor){this.side=side;this.scene=scene;this.skin=skin;this.nailMaterial=nailMaterial;this.floor=floor;this.reachError=0;}
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
      const nail=new T.Mesh(new T.SphereGeometry(1,20,10),this.nailMaterial);nail.scale.set(name==='thumb'?.39:.29,.022,name==='thumb'?.48:.45);this.scene.add(nail);
      return{name,chain,positions,lengths,nail};
    });
    group.quaternion.copy(this.rotation);group.scale.setScalar(100);group.updateMatrixWorld(true);
    this.inverseMatrix=new T.Matrix4();
    this.mesh.material=constrainSkin(this.skin,this.inverseMatrix,this.floor);
    this.mesh.castShadow=this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
    const depth=new T.MeshDepthMaterial({depthPacking:T.RGBADepthPacking});
    this.mesh.customDepthMaterial=constrainSkin(depth,this.inverseMatrix,this.floor);depth.dispose();
  }
  plan(poses,screen,floor,lift=0){
    const targets=poses.map(p=>V((p.x-.5)*screen.width,floor+p.z+.24,(p.y-.5)*screen.height));
    const weights=poses.map(p=>p.contact?1:Math.max(smooth(1-(p.until??Infinity)/.28),smooth(1-(p.since??Infinity)/.15)));
    const sum=weights.reduce((a,b)=>a+b,0);
    let wrist=V(this.side*7.8,floor+2.3+lift,19.2);
    if(sum>.015){
      let x=0,z=0;
      for(let i=0;i<5;i++){const tip=this.fingers[i].positions[3];x+=(targets[i].x-tip.x)*weights[i];z+=(targets[i].z-tip.z-.65)*weights[i];}
      const blend=Math.min(1,sum);wrist.x=wrist.x*(1-blend)+x/sum*blend;wrist.z=wrist.z*(1-blend)+z/sum*blend;
    }
    const constrain=()=>{wrist.x=clamp(wrist.x,-20,20);wrist.z=clamp(wrist.z,0,32);};
    constrain();
    for(let pass=0;pass<12;pass++){
      for(let i=0;i<5;i++){
        if(!poses[i].contact)continue;
        const base=this.fingers[i].positions[0].clone().add(wrist),delta=targets[i].clone().sub(base),total=this.fingers[i].lengths.reduce((a,b)=>a+b,0)*.985;
        const d=delta.length();if(d>total){delta.y=0;delta.normalize().multiplyScalar((d-total)*.7);wrist.add(delta);constrain();}
      }
    }
    return{targets,weights,wrist};
  }
  update(poses,screen,floor,plan=null){
    const {targets,weights,wrist}=plan||this.plan(poses,screen,floor);this.lastWrist=wrist;
    const originWorld=this.origin.clone().applyQuaternion(this.rotation).multiplyScalar(100);
    this.group.position.copy(wrist).sub(originWorld);
    // Reset every joint from the neutral template on every frame: seek, FPS and
    // render speed do not alter the pose, and skin weights retain a solid palm.
    for(const [name,bone]of this.bones){
      const rest=this.rest.get(name);bone.position.copy(rest.position).multiplyScalar(.01).applyQuaternion(this.inverseRotation).add(this.origin);bone.quaternion.copy(rest.quaternion);
    }
    this.reachError=0;
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
      for(let j=0;j<4;j++){
        const bone=f.chain[j],rest=this.rest.get(bone.name),k=Math.min(j,2);
        const before=f.positions[k+1].clone().sub(f.positions[k]).normalize(),after=points[k+1].clone().sub(points[k]).normalize();
        const delta=new T.Quaternion().setFromUnitVectors(before,after);
        if(rigidThumb)delta.copy(rigidThumb).slerp(new T.Quaternion().setFromUnitVectors(before,after),weights[i]);
        bone.position.copy(points[j]).sub(wrist).multiplyScalar(.01).applyQuaternion(this.inverseRotation).add(this.origin);
        bone.quaternion.copy(this.inverseRotation).multiply(delta).multiply(this.rotation).multiply(rest.quaternion);
      }
      const distal=points[2],tip=points[3],direction=tip.clone().sub(distal).normalize();
      const position=distal.clone().lerp(tip,.65);position.y=Math.max(floor+.28,position.y)+.48;
      f.nail.position.copy(position);f.nail.quaternion.setFromUnitVectors(V(0,0,-1),direction);
    }
    this.group.updateMatrixWorld(true);this.inverseMatrix.copy(this.mesh.matrixWorld).invert();this.mesh.skeleton.update();
  }
}
