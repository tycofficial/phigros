import * as T from './vendor/three/three.module.js';
import {SkinnedHand} from './tabletop-hand.mjs';

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

function skinTextures(){
  const canvas=document.createElement('canvas');canvas.width=512;canvas.height=512;
  const c=canvas.getContext('2d'),image=c.createImageData(512,512);let seed=13;
  const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
  for(let i=0;i<image.data.length;i+=4){
    const d=(random()-.5)*12;image.data[i]=188+d;image.data[i+1]=145+d;image.data[i+2]=120+d;image.data[i+3]=255;
  }
  c.putImageData(image,0,0);
  // Fine pores and subdued creases, kept small enough to avoid plastic stripes.
  for(let i=0;i<3200;i++){c.fillStyle='rgba(104,63,50,.11)';c.beginPath();c.ellipse(random()*512,random()*512,.2+random()*.7,.25+random()*.4,0,0,Math.PI*2);c.fill();}
  const map=new T.CanvasTexture(canvas);map.colorSpace=T.SRGBColorSpace;map.wrapS=map.wrapT=T.RepeatWrapping;
  return map;
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
    this.environment=studioEnvironment(this.renderer);this.scene.environment=this.environment.texture;this.scene.environmentIntensity=.8;
    const aspect=width/height,vertical=Math.max(27,36/aspect),horizontal=vertical*aspect;
    this.camera=new T.OrthographicCamera(-horizontal/2,horizontal/2,vertical/2,-vertical/2,.1,150);
    this.camera.position.set(0,54,13.5);this.camera.lookAt(0,this.model.screen.y,0);
    this.scene.add(new T.HemisphereLight(0xe3edff,0x352b24,.9));
    const key=new T.DirectionalLight(0xfff0df,2.2);key.position.set(-12,28,-10);key.castShadow=true;
    key.shadow.mapSize.set(2048,2048);Object.assign(key.shadow.camera,{left:-23,right:23,top:24,bottom:-24,near:.5,far:70});
    key.shadow.bias=-.00015;key.shadow.normalBias=.012;key.shadow.radius=4;this.scene.add(key);
    const fill=new T.DirectionalLight(0xb9d3ff,.85);fill.position.set(20,17,8);this.scene.add(fill);
    const floor=new T.Mesh(new T.PlaneGeometry(240,240),new T.MeshStandardMaterial({color:'#202a3c',roughness:.86,metalness:.04}));
    floor.rotation.x=-Math.PI/2;floor.receiveShadow=true;floor.position.y=-.015;this.scene.add(floor);
    const skinMap=skinTextures();this.skinMap=skinMap;
    const skin=new T.MeshPhysicalMaterial({map:skinMap,bumpMap:skinMap,bumpScale:.022,roughness:.55,metalness:0,clearcoat:.06,clearcoatRoughness:.6});
    const nail=new T.MeshPhysicalMaterial({color:'#bd9384',roughness:.32,clearcoat:.25,clearcoatRoughness:.3});
    this.materials=[skin,nail];this.device=new T.Group();this.scene.add(this.device);this.textures=[];
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
    this.hands=await Promise.all([-1,1].map(side=>SkinnedHand.create(side,this.scene,skin,nail,this.model.screen.y+.006,this.options.signal)));
    this.renderer.compile(this.scene,this.camera);
  }
  render(time){
    if(this.closed||this.lost)throw Error('实景渲染 GPU 已中断，请重新导出。');
    this.base.render(time);this.screenTexture.needsUpdate=true;
    const poses=this.planner.poses(time),floor=this.model.screen.y+.006;
    this.poseHands(poses,floor);
    this.renderer.render(this.scene,this.camera);this.diagnostics.reachError=Math.max(this.diagnostics.reachError||0,...this.hands.map(hand=>hand.reachError));this.diagnostics.frames++;return this.canvas;
  }
  poseHands(poses,floor){
    const screen=this.model.screen,plans=this.hands.map((hand,h)=>hand.plan(poses.slice(h*5,h*5+5),screen,floor));
    const a=plans[0].wrist,b=plans[1].wrist;
    const separation=((a.x-b.x-2.4)/6.8)**2+((a.z-b.z)/10.4)**2;
    const u=clamp((1.5-separation)/1.5,0,1),lift=3.1*u*u*(3-2*u);
    if(lift>.0001)plans[1]=this.hands[1].plan(poses.slice(5),screen,floor,lift);
    for(let h=0;h<2;h++)this.hands[h].update(poses.slice(h*5,h*5+5),screen,floor,plans[h]);
  }
  async audit(check=()=>{},hz=120){
    let maxReach=0,worstTime=0,worst=null,samples=0;
    const floor=this.model.screen.y+.006,duration=this.engine.musicBuffer.duration;
    for(let frame=0;frame<=Math.ceil(duration*hz);frame++){
      check();const time=Math.min(duration,frame/hz),poses=this.planner.poses(time);
      for(let h=0;h<2;h++){
        if(h===0)this.poseHands(poses,floor);
        if(this.hands[h].reachError>maxReach){maxReach=this.hands[h].reachError;worstTime=time;worst={hand:h,poses:poses.slice(h*5,h*5+5).filter(p=>p.contact).map(p=>({x:p.x,y:p.y,type:p.event.item.n.type,start:p.event.start,end:p.event.end,track:p.event.track}))};}
      }
      samples++;
      if(frame%120===0)await new Promise(r=>setTimeout(r,0));
    }
    return{samples,maxReach,worstTime,worst};
  }
  close(){
    if(this.closed)return;this.closed=true;
    const geometries=new Set(),materials=new Set();
    this.scene?.traverse(o=>{if(o.customDepthMaterial)materials.add(o.customDepthMaterial);if(o.geometry)geometries.add(o.geometry);for(const m of Array.isArray(o.material)?o.material:[o.material])if(m)materials.add(m);});
    for(const g of geometries)g.dispose();for(const m of new Set([...materials,...this.materials||[]]))m.dispose();this.scene?.traverse(o=>o.skeleton?.dispose());
    this.screenTexture?.dispose();this.skinMap?.dispose();for(const t of this.textures||[])t.dispose();this.environment?.dispose();
    this.renderer?.dispose();this.renderer?.forceContextLoss();if(this.canvas)this.canvas.width=this.canvas.height=1;
    this.base?.close();this.planner=null;this.engine=null;
  }
}

export const modelInfo=async()=> (await readModel()).model;
