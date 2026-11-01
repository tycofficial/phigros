// Continuous segment/capsule proximity diagnostics, in the scene's centimetres.
// Capsules are conservative proxies for fingers, not triangle-mesh collision
// proofs. The palm's webbing is intentionally excluded from self-collision.
const clamp01=x=>Math.max(0,Math.min(1,x));
const dot=(a,b)=>a.x*b.x+a.y*b.y+a.z*b.z;
const minus=(a,b)=>({x:a.x-b.x,y:a.y-b.y,z:a.z-b.z});
const along=(a,b,t)=>({x:a.x+(b.x-a.x)*t,y:a.y+(b.y-a.y)*t,z:a.z+(b.z-a.z)*t});

export function segmentProximity(a,b,c,d){
  const ab=minus(b,a),cd=minus(d,c),ac=minus(a,c),aa=dot(ab,ab),bb=dot(ab,cd),cc=dot(cd,cd),dd=dot(ab,ac),ee=dot(cd,ac);
  let s=0,t=0;
  if(aa<1e-12&&cc<1e-12){s=t=0;}
  else if(aa<1e-12)t=clamp01(ee/cc);
  else if(cc<1e-12)s=clamp01(-dd/aa);
  else{
    const denominator=aa*cc-bb*bb;
    s=denominator>1e-12?clamp01((bb*ee-cc*dd)/denominator):0;
    t=(bb*s+ee)/cc;
    if(t<0){t=0;s=clamp01(-dd/aa);}
    else if(t>1){t=1;s=clamp01((bb-dd)/aa);}
  }
  const first=along(a,b,s),second=along(c,d,t),delta=minus(first,second);
  return{distance:Math.sqrt(dot(delta,delta)),s,t,first,second};
}

// Approximate 95th percentile radial envelopes from dominant-weight rest
// vertices, away from segment ends. The rig's bone axis is not the geometric
// centre of each cross-section, especially near a metacarpal. These envelopes
// deliberately flag proximity early; the narrower core separates deep skeletal
// crossings from those conservative warnings. Neither is a mesh proof.
export const FINGER_RADII=Object.freeze([
  [1.48,.85,.73],[1.62,.89,.76],[1.37,.86,.69],[1.08,.69,.67],[2.78,1.37,1.12]
].map(row=>Object.freeze(row)));
export const FINGER_CORE_RADII=Object.freeze([
  [.66,.57,.45],[.69,.60,.47],[.64,.54,.43],[.56,.47,.39],[.84,.71,.58]
].map(row=>Object.freeze(row)));

export function fingerCapsules(hand,handIndex=0,poses=null){
  return(hand.joints||[]).flatMap((points,finger)=>points.slice(0,-1).map((a,segment)=>({
    hand:handIndex,finger,segment,a,b:points[segment+1],radius:FINGER_RADII[finger][segment],coreRadius:FINGER_CORE_RADII[finger][segment],contact:!!poses?.[finger]?.contact
  })));
}

export function handProximity(hands,poses=null,{includeSelf=true,margin=0}={}){
  const capsules=hands.flatMap((hand,index)=>fingerCapsules(hand,index,poses?.slice(index*5,index*5+5))),pairs=[];
  let interHandMinimum=Infinity,selfMinimum=Infinity,interHandCoreMinimum=Infinity,selfCoreMinimum=Infinity;
  for(let i=0;i<capsules.length;i++)for(let j=i+1;j<capsules.length;j++){
    const a=capsules[i],b=capsules[j],self=a.hand===b.hand;
    if(self&&(!includeSelf||a.finger===b.finger))continue;
    // Two proximal segments share palm/web tissue in the real mesh. Their
    // overlapping enclosing capsules do not establish a finger crossing.
    if(self&&a.segment===0&&b.segment===0)continue;
    const closest=segmentProximity(a.a,a.b,b.a,b.b),clearance=closest.distance-a.radius-b.radius,coreClearance=closest.distance-a.coreRadius-b.coreRadius;
    if(self)selfMinimum=Math.min(selfMinimum,clearance);else interHandMinimum=Math.min(interHandMinimum,clearance);
    if(self)selfCoreMinimum=Math.min(selfCoreMinimum,coreClearance);else interHandCoreMinimum=Math.min(interHandCoreMinimum,coreClearance);
    if(clearance<margin)pairs.push({first:{hand:a.hand,finger:a.finger,segment:a.segment,contact:a.contact},second:{hand:b.hand,finger:b.finger,segment:b.segment,contact:b.contact},clearance,coreClearance,distance:closest.distance,closest:[closest.first,closest.second]});
  }
  pairs.sort((a,b)=>a.clearance-b.clearance);
  return{interHandMinimum,selfMinimum,interHandCoreMinimum,selfCoreMinimum,pairs};
}

const smooth01=x=>{x=clamp01(x);return x*x*(3-2*x);};
const playingInfluence=pose=>pose.contact?1:Math.max(smooth01(1-(pose.until??Infinity)/.20),smooth01(1-(pose.since??Infinity)/.15));

export function blendIdleCurl(base,target,folded,amount){
  const from=target.clone().sub(base),to=folded.clone().sub(base),a=from.length(),b=to.length();
  if(a<1e-8||b<1e-8)return target;
  from.multiplyScalar(1/a);to.multiplyScalar(1/b);
  // Cartesian interpolation can pass through the MCP and flip the entire
  // finger in one frame. Keep extension radius independent from direction,
  // and guide opposing directions over the dorsal hemisphere.
  const opposed=smooth01((-from.dot(to)-.4)/.6),up=from.clone().set(0,1,0).addScaledVector(from,-from.y);
  if(up.lengthSq()<1e-8)up.set(1,0,0);else up.normalize();
  const direction=from.clone().multiplyScalar(1-amount).addScaledVector(to,amount).addScaledVector(up,2*opposed*amount*(1-amount)).normalize();
  target.copy(base).addScaledVector(direction,a*(1-amount)+b*amount);
  return target;
}

// A playing index may sweep across the space normally occupied by an unused
// middle/ring finger. Retract only the unused digit into a natural flexion
// pose. Smooth proximity and anticipation weights make this a function of the
// current absolute timeline; there is no previous-frame repulsion state.
// Contacts stay exact, and a finger's own approach progressively takes priority.
export function resolveIdleFingerTargets({hand,poses,targets,poles,floor,solve,obstacles=[]}){
  const chains=targets.map((entry,i)=>solve(entry.base,entry.target,hand.fingers[i].lengths,1,poles?.[i]).points);
  const active=poses.map(playingInfluence);
  let adjusted=0,maxCorrectionCm=0;
  for(let finger=0;finger<4;finger++){
    if(poses[finger].contact)continue;
    const entry=targets[finger],freedom=(1-active[finger])**2;
    if(freedom<1e-8)continue;
    let influence=0;
    const compare=(points,other,radii,strength,self)=>{
      if(strength<1e-8)return;
      let clearance=Infinity;
      for(let a=0;a<3;a++)for(let b=0;b<3;b++){
        if(self&&a===0&&b===0)continue;
        const distance=segmentProximity(points[a],points[a+1],other[b],other[b+1]).distance;
        clearance=Math.min(clearance,distance-FINGER_CORE_RADII[finger][a]-radii[b]);
      }
      influence=Math.max(influence,smooth01((.35-clearance)/1.1)*strength*freedom);
    };
    for(let other=0;other<4;other++)if(other!==finger)compare(chains[finger],chains[other],FINGER_CORE_RADII[other],active[other],true);
    for(const obstacle of obstacles)compare(chains[finger],obstacle.points,obstacle.radii||FINGER_CORE_RADII[obstacle.finger],obstacle.strength??1,false);
    if(influence<1e-8)continue;
    const source=hand.fingers[finger].positions,folded=entry.base.clone().addScaledVector(source[3].clone().sub(source[0]),.43);
    folded.y=Math.max(floor+2.2,entry.base.y-.75);
    const before=entry.target.clone();blendIdleCurl(entry.base,entry.target,folded,influence);
    maxCorrectionCm=Math.max(maxCorrectionCm,before.distanceTo(entry.target));adjusted++;
  }
  return{adjusted,maxCorrectionCm};
}

export function thumbAvoidanceInfluence(points,obstacles){
  let influence=0;
  for(const obstacle of obstacles){
    let clearance=Infinity;
    const radii=obstacle.radii||FINGER_CORE_RADII[obstacle.finger];
    for(let a=0;a<3;a++)for(let b=0;b<3;b++){
      const distance=segmentProximity(points[a],points[a+1],obstacle.points[b],obstacle.points[b+1]).distance;
      clearance=Math.min(clearance,distance-FINGER_CORE_RADII[4][a]-radii[b]);
    }
    influence=Math.max(influence,smooth01((.8-clearance)/1.6)*(obstacle.strength??1));
  }
  return influence;
}
