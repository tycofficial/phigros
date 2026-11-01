import * as T from './vendor/three/three.module.js';
import {projectReachDisks} from './tabletop-hand.mjs';

// Solve the entire wrist path before rendering. Projected bidirectional relaxation
// spreads each real contact's constraint into its approach and departure; a
// frame never depends on the previous rendered frame or the export FPS.
export class WristTrajectory {
  static async create(hands,planner,screen,floor,duration,signal){
    const hz=120,count=Math.ceil(duration*hz)+1,result=new WristTrajectory(hz,count),constraints=[[],[]];
    const check=()=>{if(signal?.aborted)throw new DOMException('导出已取消','AbortError');};
    for(let i=0;i<count;i++){
      check();const poses=planner.poses(Math.min(duration,i/hz));
      for(let h=0;h<2;h++){
        const hand=hands[h],part=poses.slice(h*5,h*5+5),seed=hand.plan(part,screen,floor);
        seed.wrist.y=floor+3.55;
        const plan=hand.plan(part,screen,floor,0,seed.wrist),data=result.paths[h];
        data.set(plan.wrist.toArray(),i*3);
        constraints[h][i]=plan.targets.flatMap((target,k)=>{
          if(!part[k].contact)return[];
          const base=hand.fingers[k].positions[0],length=hand.fingers[k].lengths.reduce((a,b)=>a+b,0)*.985;
          return[{x:target.x-base.x,z:target.z-base.z,dy:target.y-base.y,length}];
        });
      }
      if(i%480===0)await new Promise(r=>setTimeout(r,0));
    }
    const disksAt=(h,i,y)=>constraints[h][i].map(c=>({x:c.x,z:c.z,r:Math.abs(c.dy-y)>c.length?-1:Math.sqrt(Math.max(0,c.length*c.length-(c.dy-y)**2))}));
    const optimize=async(h,iterations,separate=false)=>{
      const data=result.paths[h],sets=constraints[h].map((_,i)=>disksAt(h,i,data[i*3+1]));
      for(let iteration=0;iteration<iterations;iteration++){
        check();let largest=0;
        for(let direction=0;direction<2;direction++)for(let j=1;j<count-1;j++){
          const i=direction?count-1-j:j,k=i*3;
          let x=data[k]+1.55*((data[k-3]+data[k+3])*.5-data[k]);
          const z=data[k+2]+1.55*((data[k-1]+data[k+5])*.5-data[k+2]);
          // Give an actual playing hand priority over the idle one. Otherwise
          // an idle palm can push a live pinky contact into an unnatural reach.
          if(separate&&(!constraints[h][i].length||constraints[1-h][i].length)){
            const other=result.paths[1-h],dz=(z-other[k+2])/10;
            const clearance=7.8*Math.sqrt(Math.max(0,1-dz*dz));
            x=h?Math.max(x,other[k]+clearance):Math.min(x,other[k]-clearance);
          }
          const point=sets[i].length?projectReachDisks({x,z},sets[i]):{x,z};
          if(!point)throw Error('整段手腕轨迹无法满足真实触点。');
          largest=Math.max(largest,Math.abs(data[k]-point.x),Math.abs(data[k+2]-point.z));
          data[k]=point.x;data[k+2]=point.z;
        }
        if(iteration>24&&largest<.0002)break;
        if(iteration%8===0)await new Promise(r=>setTimeout(r,0));
      }
    };
    const anticipateHeight=h=>{
      const data=result.paths[h],ceilings=Float64Array.from({length:count},(_,i)=>data[i*3+1]);
      for(let i=0;i<count;i++){
        let y=ceilings[i];for(let j=Math.max(0,i-24);j<=Math.min(count-1,i+24);j++)y=Math.min(y,ceilings[j]+Math.abs(j-i)/24*1.2);
        data[i*3+1]=y;
      }
    };
    for(let h=0;h<2;h++){anticipateHeight(h);await optimize(h,200);}
    // Plan the passing height before the second constrained smoothing pass.
    // Raising a hand only at render time otherwise makes the next contact snap
    // its palm sideways to compensate for the shortened horizontal reach.
    for(let i=0;i<count;i++){
      const k=i*3,a=result.paths[0],b=result.paths[1];
      const separation=((a[k]-b[k]-2.4)/6.8)**2+((a[k+2]-b[k+2])/10.4)**2;
      const u=Math.max(0,Math.min(1,(1.5-separation)/1.5));
      let low=floor+2.3,high=b[k+1]+3.1*u*u*(3-2*u);
      const desired={x:b[k],z:b[k+2]};
      if(!projectReachDisks(desired,disksAt(1,i,high))){
        for(let n=0;n<12;n++){const middle=(low+high)/2;if(projectReachDisks(desired,disksAt(1,i,middle)))low=middle;else high=middle;}
        high=low;
      }
      b[k+1]=high;
    }
    anticipateHeight(1);
    for(let pass=0;pass<4;pass++)for(let h=0;h<2;h++)await optimize(h,80,true);
    return result;
  }
  constructor(hz,count){this.hz=hz;this.count=count;this.paths=[new Float64Array(count*3),new Float64Array(count*3)];}
  at(hand,time){
    const u=Math.max(0,Math.min(this.count-1,time*this.hz)),a=Math.floor(u),b=Math.min(this.count-1,a+1),f=u-a,data=this.paths[hand];
    return new T.Vector3(...[0,1,2].map(k=>data[a*3+k]*(1-f)+data[b*3+k]*f));
  }
}

// Parallel transport avoids the antipodal singularity of reconstructing each
// bend plane independently. A bounded upward correction prevents accumulated
// twist, while the precomputed timeline keeps seek and export order irrelevant.
export function transportBend(previousDirection,previousPole,direction,dt=1/120){
  const pole=previousPole.clone().applyQuaternion(new T.Quaternion().setFromUnitVectors(previousDirection,direction));
  pole.addScaledVector(direction,-pole.dot(direction)).normalize();
  const preferred=new T.Vector3(0,1,0).addScaledVector(direction,-direction.y),strength=preferred.length();
  if(strength>1e-8){
    preferred.multiplyScalar(1/strength);
    const angle=Math.atan2(direction.dot(new T.Vector3().crossVectors(pole,preferred)),pole.dot(preferred));
    const step=Math.max(-4*dt,Math.min(4*dt,angle))*Math.min(1,strength/.2);
    pole.applyAxisAngle(direction,step);
  }
  return pole;
}

export class FingerTrajectory {
  static async create(hands,planner,screen,floor,motion,duration,signal){
    const result=new FingerTrajectory(motion.hz,motion.count),count=motion.count;
    const fixed=[new Uint8Array(count*5),new Uint8Array(count*5)],clearance=[new Float32Array(count*5),new Float32Array(count*5)];
    const check=()=>{if(signal?.aborted)throw new DOMException('导出已取消','AbortError');};
    for(let i=0;i<count;i++){
      check();const time=Math.min(duration,i/motion.hz),poses=planner.poses(time);
      for(let h=0;h<2;h++){
        const hand=hands[h],part=poses.slice(h*5,h*5+5),plan=hand.plan(part,screen,floor,0,motion.at(h,time));
        const targets=hand.fingerTargets(part,floor,plan);
        for(let f=0;f<5;f++){
          const offset=targets[f].target.clone().sub(targets[f].base),radius=offset.length(),k=i*5+f;
          result.directions[h].set(offset.normalize().toArray(),k*3);result.radii[h][k]=radius;
          fixed[h][k]=part[f].contact?1:0;clearance[h][k]=floor+.24+part[f].z-targets[f].base.y;
        }
      }
      if(i%240===0)await new Promise(r=>setTimeout(r,0));
    }
    // Cartesian hovering can pass through the MCP joint and spin its direction
    // in one frame. Smooth directions on the unit sphere and radii separately;
    // real contact samples remain fixed throughout the solve.
    for(let h=0;h<2;h++)for(let f=0;f<4;f++){
      const d=result.directions[h],r=result.radii[h],lengths=hands[h].fingers[f].lengths;
      const minimum=Math.abs(lengths[0]-lengths[1]-lengths[2])+.05,maximum=lengths.reduce((a,b)=>a+b,0)*.985;
      for(let iteration=0;iteration<160;iteration++){
        check();
        for(let pass=0;pass<2;pass++)for(let j=1;j<count-1;j++){
          const i=pass?count-1-j:j,k=i*5+f,n=k*3;if(fixed[h][k])continue;
          r[k]=Math.max(minimum,Math.min(maximum,(r[k-5]+r[k+5])*.5));
          let x=d[n]+1.4*((d[n-15]+d[n+15])*.5-d[n]);
          let y=d[n+1]+1.4*((d[n-14]+d[n+16])*.5-d[n+1]);
          let z=d[n+2]+1.4*((d[n-13]+d[n+17])*.5-d[n+2]);
          const norm=Math.hypot(x,y,z);if(norm<1e-8){x=0;y=1;z=0;}else{x/=norm;y/=norm;z/=norm;}
          const low=Math.max(-.999,Math.min(.999,clearance[h][k]/r[k]));
          if(y<low){const horizontal=Math.hypot(x,z),scale=Math.sqrt(1-low*low);x=horizontal>1e-8?x/horizontal*scale:0;z=horizontal>1e-8?z/horizontal*scale:-scale;y=low;}
          d[n]=x;d[n+1]=y;d[n+2]=z;
        }
        if(iteration%16===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    for(let h=0;h<2;h++)for(let f=0;f<5;f++){
      let previous=null,pole=null;
      for(let i=0;i<count;i++){
        const k=(i*5+f)*3,direction=new T.Vector3().fromArray(result.directions[h],k).normalize();
        pole=previous?transportBend(previous,pole,direction,1/motion.hz):new T.Vector3(0,1,0).applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,-1),direction));
        result.paths[h].set(pole.toArray(),k);previous=direction;
      }
    }
    return result;
  }
  constructor(hz,count){this.hz=hz;this.count=count;this.paths=[new Float32Array(count*15),new Float32Array(count*15)];this.directions=[new Float32Array(count*15),new Float32Array(count*15)];this.radii=[new Float32Array(count*5),new Float32Array(count*5)];}
  at(hand,time){
    const u=Math.max(0,Math.min(this.count-1,time*this.hz)),a=Math.floor(u),b=Math.min(this.count-1,a+1),f=u-a;
    const blend=(data,i)=>new T.Vector3(...[0,1,2].map(k=>data[(a*5+i)*3+k]*(1-f)+data[(b*5+i)*3+k]*f)).normalize();
    const poles=Array.from({length:5},(_,i)=>blend(this.paths[hand],i));
    const offsets=Array.from({length:5},(_,i)=>blend(this.directions[hand],i).multiplyScalar(this.radii[hand][a*5+i]*(1-f)+this.radii[hand][b*5+i]*f));
    return{poles,offsets};
  }
}
