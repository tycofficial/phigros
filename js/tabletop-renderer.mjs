import * as T from './vendor/three/three.module.js';
import {SkinnedHand} from './tabletop-hand.mjs';
import {WristTrajectory,FingerTrajectory} from './tabletop-motion.mjs';
import {handProximity,FINGER_CORE_RADII} from './tabletop-collision.mjs';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const mix=(a,b,t)=>a+(b-a)*t;
const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const BASE=new URL('../assets/tabletop/ipad/',import.meta.url);

async function readModel(signal){
  const response=await fetch(new URL('ipad.json',BASE),{signal});
  if(!response.ok)throw Error('iPad 模型清单加载失败。');
  const model=await response.json();
  const data=await fetch(new URL(model.binary,BASE),{signal});
  if(!data.ok)throw Error('iPad 主体模型加载失败。');
  const packed=await data.arrayBuffer(),signature=new Uint8Array(packed,0,Math.min(2,packed.byteLength));
  const binary=signature[0]===31&&signature[1]===139?await new Response(new Blob([packed]).stream().pipeThrough(new DecompressionStream('gzip'))).arrayBuffer():packed;
  if(binary.byteLength!==model.binaryBytes)throw Error('iPad 模型数据不完整。');
  const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',binary)),b=>b.toString(16).padStart(2,'0')).join('');
  if(hash!==model.binarySha256)throw Error('iPad 模型校验失败。');
  return{model,binary};
}

function studioEnvironment(renderer){
  const canvas=document.createElement('canvas');canvas.width=1024;canvas.height=512;
  const c=canvas.getContext('2d'),g=c.createLinearGradient(0,0,0,512);
  g.addColorStop(0,'#f2efea');g.addColorStop(.48,'#a6abb4');g.addColorStop(.64,'#262e3d');g.addColorStop(1,'#111722');
  c.fillStyle=g;c.fillRect(0,0,1024,512);
  c.fillStyle='#ffffff';c.fillRect(160,80,150,155);c.fillRect(720,90,60,180);
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.mapping=T.EquirectangularReflectionMapping;
  const pmrem=new T.PMREMGenerator(renderer),target=pmrem.fromEquirectangular(map);
  pmrem.dispose();map.dispose();return target;
}

// Separate albedo, pore height and oil roughness; color noise alone makes a
// smooth mesh look painted. All maps use a fixed seed for frame-exact exports.
function skinTextures(){
  const size=512,make=()=>{const canvas=document.createElement('canvas');canvas.width=canvas.height=size;return canvas;};
  const color=make(),height=make(),roughness=make(),c=color.getContext('2d'),h=height.getContext('2d'),r=roughness.getContext('2d');
  const image=c.createImageData(size,size),relief=h.createImageData(size,size),oil=r.createImageData(size,size);let seed=13;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  const grid=Float32Array.from({length:32*32},random);
  const noise=(x,y)=>{
    const u=x/16,v=y/16,a=Math.floor(u),b=Math.floor(v),fx=u-a,fy=v-b;
    const at=(i,j)=>grid[((j+32)%32)*32+(i+32)%32];
    return mix(mix(at(a,b),at(a+1,b),fx),mix(at(a,b+1),at(a+1,b+1),fx),fy);
  };
  for(let y=0;y<size;y++)for(let x=0;x<size;x++){
    const i=(y*size+x)*4,broad=noise(x,y)-.5,fine=random()-.5;
    image.data.set([184+broad*6+fine*2,136+broad*4+fine*1.6,111+broad*3+fine*1.4,255],i);
    const micro=145+fine*24;
    relief.data.set([micro,micro,micro,255],i);
    const matte=204+broad*20+fine*8;oil.data.set([matte,matte,matte,255],i);
  }
  c.putImageData(image,0,0);h.putImageData(relief,0,0);r.putImageData(oil,0,0);
  // Subpixel pores with soft rims stay subtle at 1080p and do not crawl during
  // motion. The height field, unlike an albedo freckle, responds to studio light.
  for(let i=0;i<5400;i++){
    const x=random()*size,y=random()*size,radius=.3+random()*.65;
    h.fillStyle='rgba(58,58,58,.27)';h.beginPath();h.ellipse(x,y,radius,radius*.72,random()*Math.PI,0,Math.PI*2);h.fill();
  }
  const map=canvas=>{const t=new T.CanvasTexture(canvas);t.wrapS=t.wrapT=T.RepeatWrapping;return t;};
  const albedo=map(color);albedo.colorSpace=T.SRGBColorSpace;
  return{albedo,bump:map(height),roughness:map(roughness)};
}

export class TabletopScene {
  static async create(options){
    const data=await readModel(options.signal);
    const scene=new TabletopScene(options,data.model);
    try{await scene.initialize(data.binary);return scene;}catch(error){scene.close();throw error;}
  }
  constructor(options,model){this.options=options;this.model=model;this.engine=options.engine;this.base=options.session;this.planner=options.planner;this.closed=false;this.diagnostics={frames:0,source:model.source};}
  async initialize(binary){
    const {width,height}=this.options;
    this.renderer=new T.WebGLRenderer({antialias:true,alpha:false,preserveDrawingBuffer:true,powerPreference:'high-performance'});
    this.renderer.setPixelRatio(1);this.renderer.setSize(width,height,false);
    if(width>this.renderer.capabilities.maxTextureSize||height>this.renderer.capabilities.maxTextureSize)throw Error('此 GPU 无法创建所选分辨率的实景画面。');
    this.renderer.outputColorSpace=T.SRGBColorSpace;this.renderer.toneMapping=T.ACESFilmicToneMapping;this.renderer.toneMappingExposure=1.05;
    this.renderer.shadowMap.enabled=true;this.renderer.shadowMap.type=T.PCFSoftShadowMap;
    this.renderer.domElement.addEventListener('webglcontextlost',event=>{event.preventDefault();this.lost=true;});
    this.canvas=this.renderer.domElement;this.scene=new T.Scene();this.scene.background=new T.Color('#171e2c');
    this.environment=studioEnvironment(this.renderer);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.6;
    const aspect=width/height,vertical=Math.max(27,36/aspect),horizontal=vertical*aspect;
    this.camera=new T.OrthographicCamera(-horizontal/2,horizontal/2,vertical/2,-vertical/2,.1,150);
    this.camera.position.set(0,54,13.5);this.camera.lookAt(0,this.model.screen.y,0);
    this.scene.add(new T.HemisphereLight(0xe3edff,0x352b24,.65));
    const key=new T.DirectionalLight(0xffefdf,2.0);key.position.set(-12,28,-10);key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-23,right:23,top:24,bottom:-24,near:.5,far:70});
    key.shadow.bias=-.00015;key.shadow.normalBias=.012;key.shadow.radius=4;this.scene.add(key);
    const fill=new T.DirectionalLight(0xc6d9ef,.6);fill.position.set(20,17,8);this.scene.add(fill);
    const floor=new T.Mesh(new T.PlaneGeometry(240,240),new T.MeshStandardMaterial({color:'#202a3c',roughness:.86,metalness:.04}));
    floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.015;this.scene.add(floor);
    const skinMaps=skinTextures();this.skinMaps=Object.values(skinMaps);
    for(const map of this.skinMaps)map.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());
    const skin=new T.MeshPhysicalMaterial({map:skinMaps.albedo,bumpMap:skinMaps.bump,bumpScale:.012,roughnessMap:skinMaps.roughness,roughness:.67,metalness:0,specularIntensity:.45,clearcoat:.025,clearcoatRoughness:.48});
    this.materials=[skin];this.device=new T.Group();this.scene.add(this.device);this.textures=[];
    this.screenTexture=new T.CanvasTexture(this.base.canvas);this.screenTexture.colorSpace=T.SRGBColorSpace;this.screenTexture.minFilter=T.LinearFilter;this.screenTexture.generateMipmaps=false;
    const loader=new T.TextureLoader(),loaded=new Map();
    for(const entry of this.model.meshes){
      const g=new T.BufferGeometry(),vertices=new Float32Array(binary,entry.vertexOffset,entry.vertices*8);
      const interleaved=new T.InterleavedBuffer(vertices,8);
      g.setAttribute('position',new T.InterleavedBufferAttribute(interleaved,3,0));g.setAttribute('normal',new T.InterleavedBufferAttribute(interleaved,3,3));g.setAttribute('uv',new T.InterleavedBufferAttribute(interleaved,2,6));
      g.setIndex(new T.BufferAttribute(new Uint32Array(binary,entry.indexOffset,entry.indices),1));
      let material;
      if(entry.screen){
        material=new T.MeshBasicMaterial({map:this.screenTexture,toneMapped:false,side:T.DoubleSide,polygonOffset:true,polygonOffsetFactor:-2,polygonOffsetUnits:-2});
        this.screenMesh=new T.Mesh(g,material);this.screenMesh.name='Original rounded iPad display';this.device.add(this.screenMesh);
        const shadow=new T.Mesh(g,new T.ShadowMaterial({opacity:.28,depthWrite:false,polygonOffset:true,polygonOffsetFactor:-3,polygonOffsetUnits:-3}));shadow.receiveShadow=true;shadow.position.y=.003;this.device.add(shadow);continue;
      }
      const spec=entry.material,color=spec.color||[.045,.045,.047];
      material=new T.MeshStandardMaterial({color:new T.Color(...color),roughness:spec.roughness??.45,metalness:spec.metalness??.7,side:T.DoubleSide});
      if(spec.opacity!=null&&spec.opacity<1){material.transparent=true;material.opacity=spec.opacity;material.depthWrite=false;}
      if(spec.map){
        if(!loaded.has(spec.map)){
          const texture=await loader.loadAsync(new URL(spec.map,BASE).href);texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());loaded.set(spec.map,texture);this.textures.push(texture);
        }
        material.map=loaded.get(spec.map);material.color.setRGB(1,1,1);
      }
      const mesh=new T.Mesh(g,material);mesh.name=entry.name;mesh.castShadow=true;mesh.receiveShadow=true;this.device.add(mesh);
    }
    if(!this.screenMesh)throw Error('模型中没有原始圆角屏幕。');
    this.hands=await Promise.all([-1,1].map(side=>SkinnedHand.create(side,this.scene,skin,this.model.screen.y+.006,this.options.signal)));
    this.motion=await WristTrajectory.create(this.hands,this.planner,this.model.screen,this.model.screen.y+.006,this.engine.musicBuffer.duration,this.options.signal);
    this.fingerMotion=await FingerTrajectory.create(this.hands,this.planner,this.model.screen,this.model.screen.y+.006,this.motion,this.engine.musicBuffer.duration,this.options.signal);
    this.renderer.compile(this.scene,this.camera);
  }
  render(time){
    if(this.closed||this.lost)throw Error('实景渲染 GPU 已中断，请重新导出。');
    this.base.render(time);this.screenTexture.needsUpdate=true;
    const poses=this.planner.poses(time),floor=this.model.screen.y+.006;
    this.poseHands(poses,floor,time);
    for(const hand of this.hands)hand.updateSurface();
    this.renderer.render(this.scene,this.camera);this.diagnostics.reachError=Math.max(this.diagnostics.reachError||0,...this.hands.map(hand=>hand.reachError));this.diagnostics.frames++;return this.canvas;
  }
  poseHands(poses,floor,time){
    const screen=this.model.screen,plans=this.hands.map((hand,h)=>hand.plan(poses.slice(h*5,h*5+5),screen,floor,0,this.motion.at(h,time)));
    const fingers=this.hands.map((_,h)=>this.fingerMotion.at(h,time));
    for(let h=0;h<2;h++)this.hands[h].update(poses.slice(h*5,h*5+5),screen,floor,plans[h],fingers[h]);
    // Both hands see the same first-pass snapshot, so avoidance is independent
    // of render order. Only unused digits may yield; judged contacts stay fixed.
    const snapshots=this.hands.map((hand,h)=>hand.joints.map((points,finger)=>{
      const pose=poses[h*5+finger],u=clamp(1-Math.min(pose.until??Infinity,pose.since??Infinity)/.20,0,1);
      return{points,finger,radii:FINGER_CORE_RADII[finger],strength:finger===4||pose.contact?1:u*u*(3-2*u)};
    }));
    for(let h=0;h<2;h++)this.hands[h].update(poses.slice(h*5,h*5+5),screen,floor,plans[h],fingers[h],snapshots[1-h]);
  }
  async audit(check=()=>{},hz=120){
    let maxReach=0,worstTime=0,worst=null,samples=0,maxWristStep=0,worstMotionTime=0,previous=null;
    let minContactDistance=Infinity,maxJointStep=0,worstJointMotion=null,previousJoints=null,previousPoses=null;
    let minJointHeight=Infinity,worstJointHeightTime=0,worstJointHeight=null;
    let minContactSeparation=Infinity,minInterHandCapsule=Infinity,minSelfCapsule=Infinity,minInterHandCore=Infinity,minSelfCore=Infinity,worstProximity=null;
    const floor=this.model.screen.y+.006,duration=this.engine.musicBuffer.duration;
    for(let frame=0;frame<=Math.ceil(duration*hz);frame++){
      check();const time=Math.min(duration,frame/hz),poses=this.planner.poses(time);
      for(let h=0;h<2;h++){
        if(h===0)this.poseHands(poses,floor,time);
        if(this.hands[h].reachError>maxReach){maxReach=this.hands[h].reachError;worstTime=time;worst={hand:h,details:this.hands[h].contactError,poses:poses.slice(h*5,h*5+5).filter(p=>p.contact).map(p=>({x:p.x,y:p.y,type:p.event.item.n.type,start:p.event.start,end:p.event.end,track:p.event.track}))};}
      }
      // Conservative capsule diagnostics augment contact spacing. They locate
      // possible crossings for visual review, not a triangle collision proof.
      if(frame%4===0){
        const proximity=handProximity(this.hands,poses);
        if(proximity.interHandMinimum<minInterHandCapsule){minInterHandCapsule=proximity.interHandMinimum;worstProximity={time,pairs:proximity.pairs.filter(p=>p.first.hand!==p.second.hand).slice(0,3)};}
        minSelfCapsule=Math.min(minSelfCapsule,proximity.selfMinimum);
        minInterHandCore=Math.min(minInterHandCore,proximity.interHandCoreMinimum);minSelfCore=Math.min(minSelfCore,proximity.selfCoreMinimum);
      }
      const wrists=this.hands.map(hand=>hand.lastWrist.clone());
      if(previous)for(let h=0;h<2;h++){const step=wrists[h].distanceTo(previous[h]);if(step>maxWristStep){maxWristStep=step;worstMotionTime=time;}}
      const joints=this.hands.map(hand=>hand.joints);
      const contacts=poses.flatMap((p,i)=>p.contact?[joints[Math.floor(i/5)][i%5][3]]:[]);
      for(let a=0;a<contacts.length;a++)for(let b=a+1;b<contacts.length;b++)minContactSeparation=Math.min(minContactSeparation,contacts[a].distanceTo(contacts[b]));
      for(let h=0;h<2;h++)for(let f=0;f<5;f++){
        for(let j=0;j<joints[h][f].length;j++){const point=joints[h][f][j];if(point.y-floor<minJointHeight){minJointHeight=point.y-floor;worstJointHeightTime=time;worstJointHeight={hand:h,finger:f,joint:j,point:point.toArray()};}}
        if(poses[h*5+f].contact)minContactDistance=Math.min(minContactDistance,joints[h][f][0].distanceTo(joints[h][f][3]));
        if(previousJoints)for(let j=0;j<4;j++){
          const step=joints[h][f][j].distanceTo(previousJoints[h][f][j]);
          if(step>maxJointStep){
            const describe=p=>({x:p.x,y:p.y,z:p.z,contact:p.contact,until:p.until,since:p.since,start:p.event?.start,end:p.event?.end});
            maxJointStep=step;worstJointMotion={time,hand:h,finger:f,joint:j,before:previousJoints[h][f].map(p=>p.toArray()),after:joints[h][f].map(p=>p.toArray()),poses:[describe(previousPoses[h*5+f]),describe(poses[h*5+f])]};
          }
        }
      }
      previousJoints=joints;previousPoses=poses;
      previous=wrists;samples++;
      if(frame%120===0)await new Promise(r=>setTimeout(r,0));
    }
    return{minJointHeightCm:minJointHeight,worstJointHeightTime,worstJointHeight,capsules:{sampleHz:hz/4,minInterHandClearanceCm:minInterHandCapsule,minSelfClearanceCm:minSelfCapsule,minInterHandCoreClearanceCm:minInterHandCore,minSelfCoreClearanceCm:minSelfCore,worst:worstProximity,conservativeProxies:true},samples,maxReach,worstTime,worst,maxWristStepCm:maxWristStep,worstMotionTime,motionSampleHz:hz,minContactDistanceCm:minContactDistance,maxJointStepCm:maxJointStep,worstJointMotion,minContactSeparationCm:Number.isFinite(minContactSeparation)?minContactSeparation:null};
  }
  close(){
    if(this.closed)return;this.closed=true;
    const geometries=new Set(),materials=new Set();
    this.scene?.traverse(o=>{if(o.customDepthMaterial)materials.add(o.customDepthMaterial);if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});
    for(const g of geometries)g.dispose();for(const m of new Set([...materials,...this.materials||[]]))m.dispose();this.scene?.traverse(o=>o.skeleton?.dispose());
    this.screenTexture?.dispose();for(const map of this.skinMaps||[])map.dispose();for(const t of this.textures||[])t.dispose();this.environment?.dispose();
    this.renderer?.dispose();this.renderer?.forceContextLoss();if(this.canvas)this.canvas.width=this.canvas.height=1;
    this.base?.close();this.motion=null;this.fingerMotion=null;this.planner=null;this.engine=null;
  }
}

export const modelInfo=async()=> (await readModel()).model;
