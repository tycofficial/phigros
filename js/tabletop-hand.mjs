import * as T from './vendor/three/three.module.js';
import {GLTFLoader} from './vendor/three/GLTFLoader.js';
import {openWrist,buildNailMask,buildSkinDetail,Forearm} from './tabletop-anatomy.mjs';
import {resolveIdleFingerTargets,thumbAvoidanceInfluence} from './tabletop-collision.mjs';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const smooth=v=>{v=clamp(v,0,1);return v*v*(3-2*v);};
const names=['index-finger','middle-finger','ring-finger','pinky-finger','thumb'];

// The thumb lies on the radial (index finger) side of each hand. `side` is
// the wrist's side of the table, so its radial direction has the opposite sign.
// Rotate the complete rest chain, rather than folding a fingertip back through
// the thenar eminence or interpolating joint positions and shortening bones.
export function relaxedThumb(finger,side){
  const source=finger.positions[3].clone().sub(finger.positions[0]);
  const desired=V(-side*.48,.08,-.87).normalize();
  const rotation=new T.Quaternion().setFromUnitVectors(source.normalize(),desired);
  return{rotation,points:finger.positions.map(p=>p.clone().sub(finger.positions[0]).applyQuaternion(rotation))};
}

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

// Coupled PIP/DIP flexion. The distal joint now curls with the middle joint;
// a monotone bend profile retains the full geometric reach of the old solver.
export function solveFinger(base,target,lengths,up=1,poleHint=null,minimumHeight=-Infinity){
  const [first,middle,last]=lengths,second=middle+last,total=first+second;
  const delta=target.clone().sub(base),actual=delta.length(),dir=delta.normalize();
  if(actual<1e-9)dir.set(0,0,-1);
  const d=clamp(actual,Math.abs(first-second)+1e-5,total-1e-5);
  const profile=coupling=>{
    let low=0,high=Math.PI;
    for(let i=0;i<40;i++){
      const pip=(low+high)/2,dip=coupling*Math.sin(pip);
      const squared=first*first+middle*middle+last*last+2*first*middle*Math.cos(pip)+2*middle*last*Math.cos(dip)+2*first*last*Math.cos(pip+dip);
      if(squared>d*d)low=pip;else high=pip;
    }
    const pip=(low+high)/2,dip=coupling*Math.sin(pip);
    const x=first+middle*Math.cos(pip)+last*Math.cos(pip+dip),y=-middle*Math.sin(pip)-last*Math.sin(pip+dip);
    return{pip,dip,angle:Math.atan2(-y,x)};
  };
  let {pip,dip,angle}=profile(.85);
  let pole=poleHint?.clone().addScaledVector(dir,-poleHint.dot(dir));
  if(!pole||pole.lengthSq()<1e-10)pole=V(0,up,0).applyQuaternion(new T.Quaternion().setFromUnitVectors(V(0,0,-1),dir));
  pole.normalize();
  if(Number.isFinite(minimumHeight)){
    // For a fixed endpoint, each intermediate joint is base + A*dir + B*pole.
    // Raise only the bend plane enough to keep the actual joints above glass;
    // endpoint and all three bone lengths remain unchanged.
    const requiredHeight=(value,height=minimumHeight)=>{
      let along=0,bend=0,required=-Infinity;
      for(let i=0;i<2;i++){
        const a=value.angle-(i>0?value.pip:0);along+=lengths[i]*Math.cos(a);bend+=lengths[i]*Math.sin(a);
        if(bend>1e-8)required=Math.max(required,(height-base.y-dir.y*along)/bend);
      }
      return required;
    };
    const upward=V(0,1,0).addScaledVector(dir,-dir.y),maximum=upward.length();
    const comfortHeight=minimumHeight+.25;
    if(requiredHeight({pip,dip,angle},comfortHeight)>pole.y){
      // Preserve the transported bend plane first. Near a downward endpoint,
      // uncurling the distal joint keeps its skin clear without spinning the
      // finger toward the singular upward projection of a vertical direction.
      // Begin with a small clearance cushion so this adjustment is gradual.
      let low=0,high=.85;
      for(let i=0;i<14;i++){
        const middle=(low+high)/2;
        if(requiredHeight(profile(middle),comfortHeight)<=pole.y)low=middle;else high=middle;
      }
      ({pip,dip,angle}=profile(low));
    }
    const required=requiredHeight({pip,dip,angle});
    if(required>pole.y&&maximum>1e-8){
      upward.multiplyScalar(1/maximum);
      const tangent=pole.clone().addScaledVector(upward,-pole.dot(upward));
      if(tangent.lengthSq()<1e-10)tangent.crossVectors(dir,upward);tangent.normalize();
      const cosine=clamp(required/maximum,-1,1);
      pole.copy(upward).multiplyScalar(cosine).addScaledVector(tangent,Math.sqrt(Math.max(0,1-cosine*cosine))).normalize();
    }
  }
  const points=[base.clone()];
  for(let i=0;i<3;i++){
    const a=angle-(i>0?pip:0)-(i>1?dip:0);
    points.push(points[i].clone().addScaledVector(dir,lengths[i]*Math.cos(a)).addScaledVector(pole,lengths[i]*Math.sin(a)));
  }
  points[3].copy(base).addScaledVector(dir,d);
  return{points,error:Math.abs(actual-d),flexion:[pip,dip]};
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
      shader.vertexShader='attribute float phiNail;\nattribute vec3 phiSkinDetail;\nvarying float vPhiNail;\nvarying vec3 vPhiSkinDetail;\n'+shader.vertexShader;
      shader.vertexShader=shader.vertexShader.replace('#include <begin_vertex>','#include <begin_vertex>\nvPhiNail = phiNail;\nvPhiSkinDetail = phiSkinDetail;');
      shader.fragmentShader='varying float vPhiNail;\nvarying vec3 vPhiSkinDetail;\n'+shader.fragmentShader;
      shader.fragmentShader=shader.fragmentShader.replace('#include <color_fragment>',`#include <color_fragment>
        diffuseColor.rgb *= mix(vec3(1.0), vec3(1.035, 0.958, 0.946), vPhiSkinDetail.y);
        diffuseColor.rgb *= 1.0 - 0.115 * vPhiSkinDetail.x;
        vec3 phiNailPlate = diffuseColor.rgb * vec3(1.06, 1.16, 1.25);
        vec3 phiNailColor = mix(phiNailPlate, vec3(0.65, 0.56, 0.48), vPhiSkinDetail.z * 0.38);
        diffuseColor.rgb = mix(diffuseColor.rgb, phiNailColor, vPhiNail * 0.88);`);
      shader.fragmentShader=shader.fragmentShader.replace('#include <roughnessmap_fragment>','#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.32, vPhiNail);');
    }
  };
  result.customProgramCacheKey=()=> 'phi-hand-contact-anatomy-v3-'+nails;return result;
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
    buildSkinDetail(this.mesh.geometry,this.origin,this.rotation,this.fingers);
    this.thumbRest=relaxedThumb(this.fingers[4],side);
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
  fingerTargets(poses,floor,plan){
    const {targets,wrist}=plan;
    // The palm anticipates the whole phrase; idle fingers stay relaxed until
    // the actual approach, instead of reaching through the other hand early.
    const weights=poses.map(p=>p.contact?1:Math.max(smooth(1-(p.until??Infinity)/.12),smooth(1-(p.since??Infinity)/.12)));
    return this.fingers.map((f,i)=>{
      const base=f.positions[0].clone().add(wrist),neutral=f.positions[3].clone().add(wrist);
      // A relaxed hand has a mild flexion cascade toward the little finger;
      // the index stays ready while unused ring/little fingers curl naturally.
      const relaxed=base.clone().lerp(neutral,[.86,.82,.76,.71,1][i]);relaxed.y=floor+[2.35,2.45,2.55,2.65,1.8][i];
      if(i===4){base.y=Math.max(base.y,floor+1.3);relaxed.copy(this.thumbRest.points[3]).add(base);}
      const target=relaxed.lerp(targets[i],weights[i]);let minimumHeight=floor+.24+poses[i].z;
      if(i<4&&!poses[i].contact){
        const until=poses[i].until??Infinity,since=poses[i].since??Infinity;
        const moving=Math.max(smooth(1-until/.30),smooth(1-since/.30));
        const lifted=smooth(Math.min(1,until/.06,since/.10))*moving;
        // Reposition over the knuckle instead of curling below it. A low
        // hovering fingertip passing directly under the MCP makes the bend
        // plane singular even though both authored contacts are reachable.
        minimumHeight=(floor+.24)*(1-lifted)+(base.y+1)*lifted;
        target.y=Math.max(target.y,minimumHeight);
      }
      return{base,target,weight:weights[i],minimumHeight};
    });
  }
  update(poses,screen,floor,plan=null,fingerState=null,obstacles=[]){
    plan=plan||this.plan(poses,screen,floor);
    const {wrist}=plan,targets=this.fingerTargets(poses,floor,plan);this.lastWrist=wrist;
    const originWorld=this.origin.clone().applyQuaternion(this.rotation).multiplyScalar(100);
    this.group.position.copy(wrist).sub(originWorld);
    // Reset every joint from the neutral template on every frame: seek, FPS and
    // render speed do not alter the pose, and skin weights retain a solid palm.
    for(const [name,bone]of this.bones){
      const rest=this.rest.get(name);bone.position.copy(rest.position).multiplyScalar(.01).applyQuaternion(this.inverseRotation).add(this.origin);bone.quaternion.copy(rest.quaternion);
    }
    this.reachError=0;this.contactError=null;this.joints=[];
    for(let i=0;i<4;i++)if(fingerState&&!poses[i].contact){
      const original=plan.targets[i].clone();original.y=floor+.24;
      targets[i].target.copy(targets[i].base).add(fingerState.offsets[i]);
      // A note can start between the precomputed 120 Hz samples. Meet its
      // exact authored contact on approach instead of snapping from an
      // interpolated hover offset to the exact target on the contact frame.
      // The baked release endpoint keeps its short bridge at glass height;
      // never mix the raw lifted hover back into the smoothed trajectory.
      const seam=Math.max(smooth(1-(poses[i].until??Infinity)*60),smooth(1-(poses[i].since??Infinity)*120));
      targets[i].target.lerp(original,seam);
    }
    const solveClear=(base,target,lengths,up,pole)=>solveFinger(base,target,lengths,up,pole,floor+.02);
    this.idleAvoidance=fingerState?.bakedAvoidance?{baked:true}:resolveIdleFingerTargets({hand:this,poses,targets,poles:fingerState?.poles,floor,solve:solveClear,obstacles});
    for(let i=0;i<5;i++){
      const f=this.fingers[i],{base,target,weight}=targets[i];
      let pole=fingerState?.poles[i];
      if(pole&&i<4){
        // The exact note may fall between trajectory samples. Transport its
        // bend plane with the corrected fingertip direction; projecting a
        // nearly parallel hint magnifies tiny offsets into a knuckle spin.
        const from=fingerState.offsets[i].clone().normalize(),to=target.clone().sub(base).normalize();
        pole=pole.clone().applyQuaternion(new T.Quaternion().setFromUnitVectors(from,to));
      }
      const {points,error}=solveClear(base,target,f.lengths,1,pole);
      let thumbRotations=null;
      if(i===4&&weight===0){
        const resting=this.thumbRest.points.map(point=>point.clone().add(base));
        this.thumbAvoidance=Number.isFinite(fingerState?.thumbAvoidance)?fingerState.thumbAvoidance:thumbAvoidanceInfluence(resting,obstacles);
        const direction=this.side<0?V(.18,.30,-.936):V(-.08,.80,-.595);
        const extent=f.positions[3].distanceTo(f.positions[0]);
        const passing=solveClear(base,base.clone().addScaledVector(direction.normalize(),extent),f.lengths,1,V(0,1,0)).points;
        // Articulate the CMC and phalanges together. A rigid rotation toward
        // an upward fingertip can leave the source metacarpal pointing down
        // into the opposite hand. Segment rotations preserve exact lengths.
        thumbRotations=[];points[0].copy(base);
        for(let j=0;j<3;j++){
          const source=f.positions[j+1].clone().sub(f.positions[j]);
          const desired=passing[j+1].clone().sub(passing[j]).normalize();
          const rotation=this.thumbRest.rotation.clone().slerp(new T.Quaternion().setFromUnitVectors(source.clone().normalize(),desired),this.thumbAvoidance);
          thumbRotations.push(rotation);points[j+1].copy(points[j]).add(source.applyQuaternion(rotation));
        }
      }
      this.joints.push(points);
      if(poses[i].contact)this.reachError=Math.max(this.reachError,error);
      if(poses[i].contact&&error>1e-5)this.contactError={finger:i,base:base.toArray(),target:target.toArray(),lengths:f.lengths,wrist:wrist.toArray()};
      for(let j=0;j<4;j++){
        const bone=f.chain[j],rest=this.rest.get(bone.name),k=Math.min(j,2);
        const before=f.positions[k+1].clone().sub(f.positions[k]).normalize(),after=points[k+1].clone().sub(points[k]).normalize();
        const delta=new T.Quaternion().setFromUnitVectors(before,after);
        if(thumbRotations)delta.copy(thumbRotations[k]);
        bone.position.copy(points[j]).sub(wrist).multiplyScalar(.01).applyQuaternion(this.inverseRotation).add(this.origin);
        bone.quaternion.copy(this.inverseRotation).multiply(delta).multiply(this.rotation).multiply(rest.quaternion);
      }
    }
    this.group.updateMatrixWorld(true);this.inverseMatrix.copy(this.mesh.matrixWorld).invert();this.mesh.skeleton.update();
  }
  updateSurface(){this.forearm.update(this.lastWrist,this.floor);}
}
