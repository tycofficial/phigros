import * as T from './vendor/three/three.module.js';
import {projectReachDisks,solveFinger} from './tabletop-hand.mjs';
import {resolveIdleFingerTargets,thumbAvoidanceInfluence,FINGER_CORE_RADII} from './tabletop-collision.mjs';

const phase=value=>{const u=Math.max(0,Math.min(1,value));return u*u*(3-2*u);};

export function anticipateWristHeight(data,hz){
  const count=data.length/3,step=6/hz;
  // A finite lookahead jumps upward when its limiting contact leaves the
  // window. Propagate the reach ceiling across the entire timeline instead.
  for(let i=1;i<count;i++)data[i*3+1]=Math.min(data[i*3+1],data[(i-1)*3+1]+step);
  for(let i=count-2;i>=0;i--)data[i*3+1]=Math.min(data[i*3+1],data[(i+1)*3+1]+step);
}

// Solve the entire wrist path before rendering. Projected bidirectional relaxation
// spreads each real contact's constraint into its approach and departure; a
// frame never depends on the previous rendered frame or the export FPS.
export class WristTrajectory {
  static async create(hands,planner,screen,floor,duration,signal){
    const hz=120,count=Math.ceil(duration*hz)+1,result=new WristTrajectory(hz,count),constraints=[[],[]],activity=[new Float32Array(count),new Float32Array(count)];
    const check=()=>{if(signal?.aborted)throw new DOMException('导出已取消','AbortError');};
    for(let i=0;i<count;i++){
      check();const poses=planner.poses(Math.min(duration,i/hz));
      for(let h=0;h<2;h++){
        const hand=hands[h],part=poses.slice(h*5,h*5+5),seed=hand.plan(part,screen,floor);
        activity[h][i]=Math.max(...part.map(p=>p.contact?1:Math.max(phase(1-(p.until??Infinity)/.20),phase(1-(p.since??Infinity)/.15))));
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
    const ergonomic=result.paths.map(path=>path.slice()),attraction=.0035;
    const disksAt=(h,i,y)=>constraints[h][i].map(c=>({x:c.x,z:c.z,r:Math.abs(c.dy-y)>c.length?-1:Math.sqrt(Math.max(0,c.length*c.length-(c.dy-y)**2))}));
    const temporalDisks=(h,i,y)=>{
      const disks=[];
      for(const offset of [0,-1,1]){
        const at=i+offset;if(at<0||at>=count)continue;
        for(const source of disksAt(h,at,y)){
          const disk={...source,r:source.r<0?-1:source.r+Math.abs(offset)/hz*120};
          if(disk.r<0)return[disk];
          if(disks.some(other=>Math.hypot(disk.x-other.x,disk.z-other.z)+other.r<=disk.r))continue;
          for(let n=disks.length-1;n>=0;n--)if(Math.hypot(disk.x-disks[n].x,disk.z-disks[n].z)+disk.r<=disks[n].r)disks.splice(n,1);
          disks.push(disk);
        }
      }
      return disks;
    };
    // Reserve a feasible height for adjacent contact changes before raising a
    // palm to pass the other hand. A height feasible for one frame alone can
    // shrink its reach to a tangent and cause a lateral snap at the next note.
    for(let h=0;h<2;h++)for(let i=0;i<count;i++){
      const data=result.paths[h],k=i*3,desired={x:data[k],z:data[k+2]};
      if(projectReachDisks(desired,temporalDisks(h,i,data[k+1])))continue;
      let low=floor+2.3,high=data[k+1];
      for(let n=0;n<10;n++){const middle=(low+high)/2;if(projectReachDisks(desired,temporalDisks(h,i,middle)))low=middle;else high=middle;}
      data[k+1]=low;
    }
    const optimize=async(h,iterations,separate=false)=>{
      const data=result.paths[h],sets=constraints[h].map((_,i)=>{
        const disks=temporalDisks(h,i,data[i*3+1]);
        return projectReachDisks({x:data[i*3],z:data[i*3+2]},disks)?disks:disksAt(h,i,data[i*3+1]);
      });
      for(let iteration=0;iteration<iterations;iteration++){
        check();let largest=0;
        for(let direction=0;direction<2;direction++)for(let j=1;j<count-1;j++){
          const i=direction?count-1-j:j,k=i*3;
          // Keep a weak pull toward the contact-aware ergonomic seed. Pure
          // harmonic relaxation forgets where the palm belongs and can settle
          // with a playing index folded backward across its idle neighbours.
          // The small weight spreads repositioning over about .2 seconds;
          // exact reach disks still decide the feasible wrist location.
          const home=ergonomic[h];
          let x=data[k]+1.55*(((data[k-3]+data[k+3])*.5+attraction*home[k])/(1+attraction)-data[k]);
          const z=data[k+2]+1.55*(((data[k-1]+data[k+5])*.5+attraction*home[k+2])/(1+attraction)-data[k+2]);
          // Give an actual playing hand priority over the idle one. Otherwise
          // an idle palm can push a live pinky contact into an unnatural reach.
          if(separate){
            const other=result.paths[1-h],dz=(z-other[k+2])/20;
            const clearance=11.5*Math.sqrt(Math.max(0,1-dz*dz));
            const separated=h?Math.max(x,other[k]+clearance):Math.min(x,other[k]-clearance);
            const priority=1-activity[h][i]*(1-activity[1-h][i]);
            // Separation is a smooth objective, not a hard bound which suddenly
            // becomes reachable the instant a previous contact releases.
            x+=(separated-x)*.02*priority;
          }
          const point=sets[i].length?projectReachDisks({x,z},sets[i]):{x,z};
          if(!point){
            const error=Error(`整段手腕轨迹在 ${(i/hz).toFixed(4)} 秒无法满足${h?'右':'左'}手真实触点。`);
            error.motionDetails={time:i/hz,hand:h,height:data[k+1],constraints:sets[i]};throw error;
          }
          largest=Math.max(largest,Math.abs(data[k]-point.x),Math.abs(data[k+2]-point.z));
          data[k]=point.x;data[k+2]=point.z;
        }
        if(iteration>24&&largest<.0002)break;
        if(iteration%8===0)await new Promise(r=>setTimeout(r,0));
      }
    };
    const anticipateHeight=h=>anticipateWristHeight(result.paths[h],hz);
    for(let h=0;h<2;h++){anticipateHeight(h);await optimize(h,200);}
    // Plan the passing height before the second constrained smoothing pass.
    // Raising a hand only at render time otherwise makes the next contact snap
    // its palm sideways to compensate for the shortened horizontal reach.
    const passingHeight=()=>{for(let i=0;i<count;i++){
      const k=i*3,a=result.paths[0],b=result.paths[1];
      // Both thumbs extend toward the table centre. Use the full symmetric
      // hand span; subtracting a one-sided offset previously disabled the
      // passing lift precisely when the inward thumb chains crossed.
      const separation=((a[k]-b[k])/13.5)**2+((a[k+2]-b[k+2])/20)**2;
      const u=Math.max(0,Math.min(1,(1.5-separation)/1.5));
      const baseHeight=ergonomic[1][k+1];let low=floor+2.3,high=baseHeight+4.2*u*u*(3-2*u);
      const desired={x:b[k],z:b[k+2]};
      if(!projectReachDisks(desired,temporalDisks(1,i,high))){
        for(let n=0;n<12;n++){const middle=(low+high)/2;if(projectReachDisks(desired,temporalDisks(1,i,middle)))low=middle;else high=middle;}
        high=low;
      }
      // Keep headroom inside the feasible reach envelope. A tangent disk
      // intersection leaves no horizontal room for the following contact.
      b[k+1]=Math.min(high,Math.max(baseHeight,high-.35));
    }
    anticipateHeight(1);};
    for(let pass=0;pass<4;pass++){passingHeight();for(let h=0;h<2;h++)await optimize(h,80,true);}
    // Enforce motion on the solved wrists themselves, not only on contact
    // reach envelopes. A feasible envelope still has many possible corners;
    // selecting different corners on adjacent frames can otherwise snap.
    for(let iteration=0;iteration<120;iteration++){
      check();let largest=0;
      for(let h=0;h<2;h++){
        const data=result.paths[h];
        for(let direction=0;direction<2;direction++)for(let j=1;j<count-1;j++){
          const i=direction?count-1-j:j,k=i*3,disks=disksAt(h,i,data[k+1]);
          for(const at of [i-1,i+1]){
            const n=at*3,dy=data[k+1]-data[n+1];
            disks.push({x:data[n],z:data[n+2],r:Math.sqrt(Math.max(0,.95*.95-dy*dy))});
          }
          const point=projectReachDisks({x:data[k],z:data[k+2]},disks);
          if(point){largest=Math.max(largest,Math.abs(point.x-data[k]),Math.abs(point.z-data[k+2]));data[k]=point.x;data[k+2]=point.z;}
        }
      }
      if(iteration>12&&largest<1e-5)break;
      if(iteration%12===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
    const reachSets=result.paths.map((data,h)=>constraints[h].map((_,i)=>disksAt(h,i,data[i*3+1])));
    for(let iteration=0;iteration<240;iteration++){
      check();let excess=0;
      for(let h=0;h<2;h++)for(let direction=0;direction<2;direction++)for(let j=1;j<count;j++){
        const i=direction?count-j:j,a=(i-1)*3,b=i*3,data=result.paths[h],dx=data[b]-data[a],dz=data[b+2]-data[a+2],dy=data[b+1]-data[a+1];
        const limit=Math.sqrt(Math.max(0,.98*.98-dy*dy)),distance=Math.hypot(dx,dz);
        if(distance<=limit+1e-5)continue;
        excess=Math.max(excess,distance-limit);const step=(distance-limit)/Math.max(1e-9,distance)*.5;
        const first=projectReachDisks({x:data[a]+dx*step,z:data[a+2]+dz*step},reachSets[h][i-1]);
        const second=projectReachDisks({x:data[b]-dx*step,z:data[b+2]-dz*step},reachSets[h][i]);
        if(first){data[a]=first.x;data[a+2]=first.z;}if(second){data[b]=second.x;data[b+2]=second.z;}
      }
      if(excess<1e-4)break;if(iteration%24===0)await new Promise(resolve=>setTimeout(resolve,0));
    }
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
  // Do not clamp the pole to an upward hemisphere here: its boundary rotates
  // arbitrarily fast around a near-vertical fingertip direction. The finger
  // solver enforces actual joint clearance by uncurling DIP flexion instead.
  return pole;
}

function upperBendPole(direction,pole){
  const preferred=new T.Vector3(0,1,0).addScaledVector(direction,-direction.y),strength=preferred.length();
  if(strength>1e-6&&pole.dot(preferred)<0){
    // Project onto the closest boundary of the upward bending hemisphere.
    // Reflection overshoots that boundary and can flip a finger. Keeping each
    // transported sample in the hemisphere prevents accumulated downward curl
    // from driving a hovering PIP joint through the display.
    const tangent=new T.Vector3().crossVectors(direction,preferred).normalize();
    pole.copy(tangent.multiplyScalar(pole.dot(tangent)<0?-1:1));
  }
  return pole;
}

function relaxSample(data,at,stride,acceleration){
  return acceleration?(4*(data[at-stride]+data[at+stride])-data[at-2*stride]-data[at+2*stride])/6:
    data[at]+1.4*((data[at-stride]+data[at+stride])*.5-data[at]);
}

export class FingerTrajectory {
  static async create(hands,planner,screen,floor,motion,duration,signal){
    const result=new FingerTrajectory(motion.hz,motion.count),count=motion.count;
    result.bakedAvoidance=hands.every(hand=>!!hand.thumbRest);
    const fixed=[new Uint8Array(count*5),new Uint8Array(count*5)],clearance=[new Float32Array(count*5),new Float32Array(count*5)];
    const check=()=>{if(signal?.aborted)throw new DOMException('导出已取消','AbortError');};
    for(let i=0;i<count;i++){
      check();const time=Math.min(duration,i/motion.hz),poses=planner.poses(time);
      const parts=[poses.slice(0,5),poses.slice(5,10)];
      const plans=hands.map((hand,h)=>hand.plan(parts[h],screen,floor,0,motion.at(h,time)));
      const targets=hands.map((hand,h)=>hand.fingerTargets(parts[h],floor,plans[h]));
      if(result.bakedAvoidance){
        const solve=(base,target,lengths,up,pole)=>solveFinger(base,target,lengths,up,pole,floor+.02);
        for(let h=0;h<2;h++)resolveIdleFingerTargets({hand:hands[h],poses:parts[h],targets:targets[h],floor,solve});
        const snapshots=hands.map((hand,h)=>targets[h].map((entry,finger)=>{
          const pose=parts[h][finger],u=Math.max(0,Math.min(1,1-Math.min(pose.until??Infinity,pose.since??Infinity)/.20));
          const points=finger===4?hand.thumbRest.points.map(p=>p.clone().add(entry.base)):solve(entry.base,entry.target,hand.fingers[finger].lengths,1).points;
          return{points,finger,radii:FINGER_CORE_RADII[finger],strength:finger===4||pose.contact?1:u*u*(3-2*u)};
        }));
        for(let h=0;h<2;h++){
          resolveIdleFingerTargets({hand:hands[h],poses:parts[h],targets:targets[h],floor,solve,obstacles:snapshots[1-h]});
          const dx=plans[0].wrist.x-plans[1].wrist.x,dz=plans[0].wrist.z-plans[1].wrist.z;
          const proximity=Math.max(0,Math.min(1,(1.4-(dx/13)**2-(dz/14)**2)/.65));
          const passing=proximity*proximity*(3-2*proximity);
          result.thumbs[h][i]=Math.max(thumbAvoidanceInfluence(snapshots[h][4].points,snapshots[1-h]),passing*(h?1:.75));
        }
      }
      for(let h=0;h<2;h++)for(let f=0;f<5;f++){
        // Retain a release endpoint in the baked path when the authored end
        // falls between grid samples. Relax the following hover around that
        // anchor instead of correcting a distant smoothed offset at render time.
        const pose=parts[h][f],anchor=f<4&&!pose.contact&&(pose.since??Infinity)<=1/motion.hz;
        if(anchor){targets[h][f].target.copy(plans[h].targets[f]);targets[h][f].target.y=floor+.24;}
        const offset=targets[h][f].target.clone().sub(targets[h][f].base),radius=offset.length(),k=i*5+f;
        result.directions[h].set(offset.normalize().toArray(),k*3);result.radii[h][k]=radius;
        fixed[h][k]=pose.contact||anchor?1:0;clearance[h][k]=(targets[h][f].minimumHeight??floor+.24+pose.z)-targets[h][f].base.y;
      }
      if(i%240===0)await new Promise(r=>setTimeout(r,0));
    }
    // Cartesian hovering can pass through the MCP joint and spin its direction
    // in one frame. Smooth directions on the unit sphere and radii separately;
    // real contact samples remain fixed throughout the solve.
    for(let h=0;h<2;h++)for(let f=0;f<4;f++){
      const d=result.directions[h],r=result.radii[h],lengths=hands[h].fingers[f].lengths;
      const minimum=Math.abs(lengths[0]-lengths[1]-lengths[2])+.05,maximum=lengths.reduce((a,b)=>a+b,0)*.985;
      const desiredD=result.bakedAvoidance?d.slice():null,desiredR=result.bakedAvoidance?r.slice():null;
      for(let iteration=0;iteration<240;iteration++){
        check();
        for(let pass=0;pass<2;pass++)for(let j=1;j<count-1;j++){
          const i=pass?count-1-j:j,k=i*5+f,n=k*3;if(fixed[h][k])continue;
          // Harmonic relaxation first finds a stable feasible path. The final
          // minimum-acceleration pass rounds its velocity changes at landing
          // and lift-off; first-order smoothing alone leaves a visible corner
          // where a moving hover reaches a fixed contact interval.
          const acceleration=iteration>=160&&i>1&&i<count-2;
          r[k]=Math.max(minimum,Math.min(maximum,acceleration?relaxSample(r,k,5,true):(r[k-5]+r[k+5])*.5));
          let x=relaxSample(d,n,15,acceleration),y=relaxSample(d,n+1,15,acceleration),z=relaxSample(d,n+2,15,acceleration);
          if(desiredD){
            // Bake collision responses before temporal relaxation. A weak
            // attraction retains their intent while rounding abrupt proximity
            // changes over several frames instead of reacting during render.
            const attraction=.008;
            x=(x+attraction*desiredD[n])/(1+attraction);y=(y+attraction*desiredD[n+1])/(1+attraction);z=(z+attraction*desiredD[n+2])/(1+attraction);
            r[k]=(r[k]+attraction*desiredR[k])/(1+attraction);
          }
          const norm=Math.hypot(x,y,z);if(norm<1e-8){x=0;y=1;z=0;}else{x/=norm;y/=norm;z/=norm;}
          const low=Math.max(-.999,Math.min(.999,clearance[h][k]/r[k]));
          if(y<low){const horizontal=Math.hypot(x,z),scale=Math.sqrt(1-low*low);x=horizontal>1e-8?x/horizontal*scale:0;z=horizontal>1e-8?z/horizontal*scale:-scale;y=low;}
          d[n]=x;d[n+1]=y;d[n+2]=z;
        }
        if(iteration%16===0)await new Promise(resolve=>setTimeout(resolve,0));
      }
    }
    // Thumb passing is an obstacle envelope over absolute time. Smooth the
    // envelope outward from each required lift, anticipating the obstacle
    // instead of rotating a rigid thumb abruptly when a contact disappears.
    if(result.bakedAvoidance)for(let h=0;h<2;h++){
      const data=result.thumbs[h],required=data.slice();
      for(let iteration=0;iteration<240;iteration++){
        check();
        for(let pass=0;pass<2;pass++)for(let j=1;j<count-1;j++){
          const i=pass?count-1-j:j;
          data[i]=Math.max(required[i],(data[i-1]+data[i+1])*.5/1.003);
        }
        if(iteration%24===0)await new Promise(r=>setTimeout(r,0));
      }
    }
    for(let h=0;h<2;h++)for(let f=0;f<5;f++){
      let previous=null,pole=null;
      for(let i=0;i<count;i++){
        const k=(i*5+f)*3,direction=new T.Vector3().fromArray(result.directions[h],k).normalize();
        pole=previous?transportBend(previous,pole,direction,1/motion.hz):upperBendPole(direction,new T.Vector3(0,1,0).applyQuaternion(new T.Quaternion().setFromUnitVectors(new T.Vector3(0,0,-1),direction)));
        result.paths[h].set(pole.toArray(),k);previous=direction;
      }
    }
    return result;
  }
  constructor(hz,count){this.hz=hz;this.count=count;this.thumbs=[new Float32Array(count),new Float32Array(count)];this.paths=[new Float32Array(count*15),new Float32Array(count*15)];this.directions=[new Float32Array(count*15),new Float32Array(count*15)];this.radii=[new Float32Array(count*5),new Float32Array(count*5)];}
  at(hand,time){
    const u=Math.max(0,Math.min(this.count-1,time*this.hz)),a=Math.floor(u),b=Math.min(this.count-1,a+1),f=u-a;
    const blend=(data,i)=>new T.Vector3(...[0,1,2].map(k=>data[(a*5+i)*3+k]*(1-f)+data[(b*5+i)*3+k]*f)).normalize();
    const poles=Array.from({length:5},(_,i)=>blend(this.paths[hand],i));
    const offsets=Array.from({length:5},(_,i)=>blend(this.directions[hand],i).multiplyScalar(this.radii[hand][a*5+i]*(1-f)+this.radii[hand][b*5+i]*f));
    return{poles,offsets,bakedAvoidance:!!this.bakedAvoidance,thumbAvoidance:this.bakedAvoidance?this.thumbs[hand][a]*(1-f)+this.thumbs[hand][b]*f:undefined};
  }
}
