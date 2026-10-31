/* Original historical scene textures and scene-19 perspective geometry.
 * Quads, translations, camera FOV/clipping and button RectTransforms come from
 * boss-replay-source.json. Unity lighting/postprocessing are not reproduced.
 */
(() => {
  'use strict';
  const BASE='./assets/vision/boss-replay/';
  const ROAD_Z=Object.freeze([10,80,150,220,290,360,430,500,570,640,710,780,850,920]);
  const LAYERS=Object.freeze([{texture:'clock-outer',z:0,size:50},{texture:'clock-middle',z:30,size:40},{texture:'clock-inner',z:50,size:35}]);
  const CAMERA=Object.freeze({fieldOfView:90,near:0.30000001192092896,far:100});
  const FILES=Object.freeze(['clock-outer','clock-middle','clock-inner','spasmodic-entry','spasmodic-touch']);
  function dimensions(options={}) {return {width:Math.max(1,Number(options.width)||1920),height:Math.max(1,Number(options.height)||1080)};}
  function project(point,width,height) {const f=height/(2*Math.tan(CAMERA.fieldOfView*Math.PI/360));return {x:width/2+point.x*f/point.z,y:height/2-point.y*f/point.z};}
  function projectClock(state,options={}) {
    const {width,height}=dimensions(options),cameraZ=Number.isFinite(state?.cameraZ)?state.cameraZ:-10,result=[];
    for(const base of ROAD_Z)for(const layer of LAYERS){const depth=base+layer.z-cameraZ;if(depth<CAMERA.near||depth>CAMERA.far)continue;
      const p=project({x:layer.size/2,y:layer.size/2,z:depth},width,height);
      result.push({texture:layer.texture,depth,x:width-p.x,y:p.y,width:2*p.x-width,height:height-2*p.y});
    }
    return result.sort((a,b)=>b.depth-a.depth);
  }
  function buttonPolygon(state,options={}) {
    const {width,height}=dimensions(options);
    if(state?.phase!=='clock-ready')return null;
    // Scene19: camera child Canvas z5, LevelSelect001 z-1, stretched Image10
    // size10+(-6.793333,-9.02), position(-3.54,-2.15), rotation Y=-10°.
    const c=Math.cos(-Math.PI/18),s=Math.sin(-Math.PI/18),w=3.206666946411133,h=0.9799995422363281;
    return [[-w/2,h/2],[w/2,h/2],[w/2,-h/2],[-w/2,-h/2]].map(([x,y])=>project({x:-3.5399999618530273+x*c,y:-2.1500000953674316+y,z:4-x*s},width,height));
  }
  function contains(polygon,x,y){let inside=false;for(let i=0,j=polygon.length-1;i<polygon.length;j=i++){
    const a=polygon[i],b=polygon[j];if((a.y>y)!==(b.y>y)&&x<(b.x-a.x)*(y-a.y)/(b.y-a.y)+a.x)inside=!inside;
  }return inside;}
  function hitTest(state,point={}) {
    const {width,height}=dimensions(point),x=Number(point.x),y=Number(point.y);
    if(!Number.isFinite(x)||!Number.isFinite(y)||x<0||x>width||y<0||y>height)return false;
    if(state?.phase==='clock-ready')return contains(buttonPolygon(state,{width,height}),x,y);
    // Scene20 Button1 (the final Play) and Button (unlock), scene14 and
    // scene15 buttons all stretch over their entire canvas.
    return ['entry','ready'].includes(state?.phase);
  }
  function create(canvas,options={}) {
    if(!canvas?.getContext)throw Error('A canvas is required');
    const ctx=canvas.getContext('2d'),images={},pending=[];let lastState=null,lastOptions=null,destroyed=false,lastInfo=null;
    if(!ctx)throw Error('Canvas 2D is unavailable');
    for(const key of FILES){
      if(options.images?.[key]){images[key]=options.images[key];continue;}
      if(typeof Image==='undefined')continue;
      const img=new Image();images[key]=img;
      pending.push(new Promise(resolve=>{img.onload=()=>{resolve(true);if(lastState&&!destroyed)sample(lastState,lastOptions);};img.onerror=()=>resolve(false);}));
      img.src=BASE+key+'.png';
    }
    function available(key){const img=images[key];return img&&(img.complete===undefined||img.complete)&&Number(img.naturalWidth||img.width)>0?img:null;}
    function sample(state,drawOptions={}) {
      if(destroyed)return null;lastState=state;lastOptions=drawOptions;
      const {width,height}=dimensions({width:drawOptions.width||canvas.clientWidth||canvas.width,height:drawOptions.height||canvas.clientHeight||canvas.height});
      const pixelRatio=Math.max(1,Math.min(2,Number(drawOptions.pixelRatio)||globalThis.devicePixelRatio||1));
      if(canvas.width!==Math.round(width*pixelRatio))canvas.width=Math.round(width*pixelRatio);
      if(canvas.height!==Math.round(height*pixelRatio))canvas.height=Math.round(height*pixelRatio);
      ctx.setTransform(pixelRatio,0,0,pixelRatio,0,0);ctx.clearRect(0,0,width,height);
      let drawnPlanes=0,visible=false;
      if(state?.boss==='rrharil'&&['clock','clock-ready','clock-exit'].includes(state.phase)){
        visible=true;ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
        for(const plane of projectClock(state,{width,height})){const img=available(plane.texture);if(img){ctx.drawImage(img,plane.x,plane.y,plane.width,plane.height);drawnPlanes++;}}
        if(state.phase==='clock-ready'){
          const polygon=buttonPolygon(state,{width,height});ctx.beginPath();ctx.moveTo(polygon[0].x,polygon[0].y);for(const p of polygon.slice(1))ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fillStyle='#fff';ctx.fill();
          const p=project({x:-3.5399999618530273,y:-2.1500000953674316,z:4},width,height);
          ctx.fillStyle='#000';ctx.font=`${height*0.0575}px Arial,sans-serif`;ctx.textAlign='center';ctx.textBaseline='middle';ctx.fillText('Play',p.x,p.y);
        }
      }else if(state?.boss==='spasmodic'&&state.phase==='entry'){
        visible=true;ctx.fillStyle='#000';ctx.fillRect(0,0,width,height);
        const ortho=width/height>1.8962962627410889?9.481399536132812*height/width:5,scale=height/(2*ortho),img=available('spasmodic-entry');
        if(img){const w=1720*0.013175230473279953*scale,h=880*0.013175230473279953*scale;ctx.drawImage(img,(width-w)/2,(height-h)/2,w,h);}
        const touch=available('spasmodic-touch');
        if(touch){const w=962*0.005*scale,h=100*0.005*scale;ctx.drawImage(touch,(width-w)/2,height/2+1.75*scale-h/2,w,h);}
      }
      lastInfo=Object.freeze({visible,drawnPlanes,width,height,loaded:FILES.every(key=>!!available(key)),phase:state?.phase});return lastInfo;
    }
    function instanceHit(point={}){return hitTest(lastState,{width:lastInfo?.width,height:lastInfo?.height,...point});}
    function destroy(){destroyed=true;ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);lastState=null;}
    return Object.freeze({sample,draw:sample,hitTest:instanceHit,ready:Promise.all(pending),destroy,get state(){return lastInfo;}});
  }
  const renderers=new WeakMap();
  function draw(canvas,state,options={}) {let renderer=renderers.get(canvas);if(!renderer){renderer=create(canvas);renderers.set(canvas,renderer);}return renderer.sample(state,options);}
  const api=Object.freeze({create,draw,hitTest,projectClock,buttonPolygon,CAMERA,ROAD_Z,LAYERS});
  globalThis.PhiBossReplayVisuals=api;if(typeof module!=='undefined'&&module.exports)module.exports=api;
})();
