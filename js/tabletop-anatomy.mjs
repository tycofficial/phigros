import * as T from './vendor/three/three.module.js';

const V=(x=0,y=0,z=0)=>new T.Vector3(x,y,z);
const smooth=t=>{t=Math.max(0,Math.min(1,t));return t*t*(3-2*t);};

// Remove the controller-style closed wrist cap and retain its exact cut ring.
// Boundary intersections inherit the wrist joint, so both surfaces meet even
// when the fingers and metacarpals deform independently above that ring.
export function openWrist(geometry,origin,rotation,wristJoint,cut=.5){
  const attrs=geometry.attributes,data=Object.fromEntries(Object.entries(attrs).map(([k,a])=>[k,Array.from(a.array)]));
  const p=V(),z=Array.from({length:attrs.position.count},(_,i)=>p.fromBufferAttribute(attrs.position,i).sub(origin).applyQuaternion(rotation).multiplyScalar(100).z);
  const edges=new Map(),boundary=new Map(),triangles=[];
  const intersection=(a,b)=>{
    const key=a<b?a+':'+b:b+':'+a;if(edges.has(key))return edges.get(key);
    const u=(cut-z[a])/(z[b]-z[a]),id=data.position.length/3;
    for(const [name,attribute]of Object.entries(attrs)){
      const size=attribute.itemSize;
      for(let k=0;k<size;k++)data[name].push(name==='skinIndex'?(k===0?wristJoint:0):name==='skinWeight'?(k===0?1:0):attribute.array[a*size+k]*(1-u)+attribute.array[b*size+k]*u);
    }
    z.push(cut);edges.set(key,id);return id;
  };
  const index=geometry.index.array;
  for(let i=0;i<index.length;i+=3){
    const ids=[index[i],index[i+1],index[i+2]],polygon=[],cuts=[];
    for(let k=0;k<3;k++){
      const a=ids[k],b=ids[(k+1)%3],inside=z[a]<=cut;
      if(inside)polygon.push(a);
      if(inside!==(z[b]<=cut)){const id=intersection(a,b);polygon.push(id);cuts.push(id);}
    }
    for(let k=1;k+1<polygon.length;k++)triangles.push(polygon[0],polygon[k],polygon[k+1]);
    if(cuts.length===2)for(let k=0;k<2;k++){const a=cuts[k],b=cuts[1-k];if(!boundary.has(a))boundary.set(a,new Set());boundary.get(a).add(b);}
  }
  if(boundary.size<8||[...boundary.values()].some(n=>n.size!==2))throw Error('手腕截面不连续，无法连接前臂。');
  const first=boundary.keys().next().value,loop=[first];let previous=-1,current=first;
  do{const next=[...boundary.get(current)].find(id=>id!==previous);previous=current;current=next;if(current!==first)loop.push(current);}while(current!==first&&loop.length<=boundary.size);
  if(loop.length!==boundary.size)throw Error('手腕包含多个独立截面。');
  const points=loop.map(i=>V(data.position[i*3],data.position[i*3+1],data.position[i*3+2]).sub(origin).applyQuaternion(rotation).multiplyScalar(100));
  let area=0;for(let i=0;i<points.length;i++){const a=points[i],b=points[(i+1)%points.length];area+=a.x*b.y-b.x*a.y;}if(area<0)points.reverse();
  for(const [name,attribute]of Object.entries(attrs))geometry.setAttribute(name,new T.BufferAttribute(new attribute.array.constructor(data[name]),attribute.itemSize,attribute.normalized));
  geometry.setIndex(triangles);geometry.computeVertexNormals();
  const box=new T.Box3().setFromPoints(points);
  return{center:box.getCenter(V()),radius:box.getSize(V()).multiplyScalar(.5),end:cut,ring:points};
}

// Nail color/roughness lives on the skin's own vertices. It follows the same
// skeleton and surface instead of floating on top as a separate ellipsoid.
export function buildNailMask(geometry,origin,rotation,fingers){
  const values=new Float32Array(geometry.attributes.position.count),counts=Array(5).fill(0),p=V(),n=V();
  const regions=fingers.map(f=>{
    const a=f.positions[2],b=f.positions[3],along=b.clone().sub(a).normalize();
    const dorsal=V(0,1,0).addScaledVector(along,-along.y).normalize(),across=V().crossVectors(along,dorsal).normalize();
    return{center:a.clone().lerp(b,.55),along,dorsal,across,length:a.distanceTo(b)*.55,width:f.name==='thumb'?.38:.30};
  });
  for(let i=0;i<values.length;i++){
    p.fromBufferAttribute(geometry.attributes.position,i).sub(origin).applyQuaternion(rotation).multiplyScalar(100);
    n.fromBufferAttribute(geometry.attributes.normal,i).applyQuaternion(rotation);
    for(let k=0;k<regions.length;k++){
      const r=regions[k],delta=p.clone().sub(r.center),x=delta.dot(r.across)/r.width,z=delta.dot(r.along)/r.length;
      if(delta.dot(r.dorsal)<.12||n.dot(r.dorsal)<.25)continue;
      const mask=1-smooth((x*x+z*z-.70)/.30);
      if(mask>values[i]){values[i]=mask;if(mask>.1)counts[k]++;}
    }
  }
  geometry.setAttribute('phiNail',new T.BufferAttribute(values,1));return counts;
}

export class Forearm {
  constructor(side,material,cuff){
    this.side=side;this.cuff=cuff;this.rings=24;this.sides=cuff.ring?.length||32;
    const positions=new Float32Array((this.rings+1)*(this.sides+1)*3),uv=[],index=[];
    for(let j=0;j<=this.rings;j++)for(let i=0;i<=this.sides;i++){
      uv.push(i/this.sides,j/this.rings*2);
      if(j<this.rings&&i<this.sides){const a=j*(this.sides+1)+i,b=a+this.sides+1;index.push(a,a+1,b,a+1,b+1,b);}
    }
    this.geometry=new T.BufferGeometry();this.geometry.setAttribute('position',new T.BufferAttribute(positions,3));
    this.geometry.setAttribute('uv',new T.Float32BufferAttribute(uv,2));this.geometry.setIndex(index);
    this.mesh=new T.Mesh(this.geometry,material);this.mesh.castShadow=this.mesh.receiveShadow=true;this.mesh.frustumCulled=false;
  }
  update(wrist,glass){
    const c=this.cuff,positions=this.geometry.attributes.position.array,start=wrist.z+c.end,length=Math.max(20,34-start);
    let at=0;
    for(let j=0;j<=this.rings;j++){
      const t=j/this.rings,bend=smooth(Math.min(1,t*1.8)),z=start+length*t;
      const x=(wrist.x+c.center.x)*(1-bend)+this.side*9.5*bend;
      const y=(wrist.y+c.center.y)*(1-smooth(t))+(1.40)*smooth(t);
      const rx=c.radius.x*(1+1.05*smooth(t)),ry=c.radius.y*(1+1.25*smooth(t));
      for(let i=0;i<=this.sides;i++){
        const angle=i/this.sides*Math.PI*2,ring=c.ring?.[i%this.sides];
        const px=x+(ring?ring.x-c.center.x:Math.cos(angle)*c.radius.x)*rx/c.radius.x;
        let py=y+(ring?ring.y-c.center.y:Math.sin(angle)*c.radius.y)*ry/c.radius.y;
        const support=glass*(1-smooth((z-10.5)/1.6))*(1-smooth((Math.abs(px)-13.8)/1.3));
        py=Math.max(support+.025,py);
        positions[at++]=px;positions[at++]=py;positions[at++]=z;
      }
    }
    this.geometry.attributes.position.needsUpdate=true;this.geometry.computeVertexNormals();
  }
}
