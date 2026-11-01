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
