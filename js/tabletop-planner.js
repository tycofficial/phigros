/* Deterministic contact planning for offline tabletop video, independent of FPS. */
(function(root,factory){
  if(typeof module==='object'&&module.exports)module.exports=factory();
  else root.PhiTabletopPlanner=factory();
})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
  const mix=(a,b,t)=>a+(b-a)*t;
  const smooth=t=>{t=clamp(t,0,1);return t*t*t*(10+t*(-15+6*t));};
  const distance=(a,b)=>Math.hypot(a.x-b.x,a.y-b.y);
  // Centimetres on the supplied iPad's original display, not square UV units.
  const screenWidth=26.34622478485108,screenHeight=19.807105189400612;
  const padDistance=(a,b)=>Math.hypot((a.x-b.x)*screenWidth,(a.y-b.y)*screenHeight);
  // MCP offsets and reach lengths measured in centimetres from the bundled
  // GLB skeletons (left/right index geometry is slightly asymmetric).
  const reachProfile=[
    [[2.355069,-.731646,-9.199623,7.663089],[.172591,-.254316,-9.164662,8.534139],[-1.746524,-.652931,-8.469378,8.016008],[-3.505408,-1.369119,-7.389584,6.57985]],
    [[-2.355068,-.731646,-8.854873,8.001522],[-.172591,-.254316,-9.164662,8.534139],[1.746524,-.652931,-8.469378,8.016008],[3.505408,-1.369119,-7.389584,6.57985]]
  ];
  const disksIntersect=disks=>{
    const valid=p=>disks.every(d=>(p.x-d.x)**2+(p.z-d.z)**2<=d.r*d.r+1e-6);
    if(disks.some(valid))return true;
    for(let i=0;i<disks.length;i++)for(let j=i+1;j<disks.length;j++){
      const a=disks[i],b=disks[j],dx=b.x-a.x,dz=b.z-a.z,d=Math.hypot(dx,dz);
      if(d<1e-10||d>a.r+b.r||d<Math.abs(a.r-b.r))continue;
      const along=(a.r*a.r-b.r*b.r+d*d)/(2*d),height=Math.sqrt(Math.max(0,a.r*a.r-along*along)),x=a.x+dx*along/d,z=a.z+dz*along/d;
      if(valid({x:x-dz*height/d,z:z+dx*height/d})||valid({x:x+dz*height/d,z:z-dx*height/d}))return true;
    }
    return !disks.length;
  };
  const rest=id=>({x:id<5?.31-(id%5)*.038:.69+(id%5)*.038,y:1.09,z:1.7});
  class ContactPlanner {
    constructor(engine,geometry,options={}){
      this.engine=engine;this.geometry=geometry;this.offset=Number(engine.chart.offset)||0;
      this.hz=120;this.tracks=Array.from({length:10},(_,id)=>({id,events:[],last:-Infinity,point:rest(id)}));
      this.stats={notes:0,contacts:0,sharedNotes:0,holdSamples:0,avoided:0,verifiedSamples:0,handoffs:0,glides:0,linkedFlicks:0};
      this.events=[];this.options=options;this.endpointCache=new Map();
    }
    target(item,time){
      const e=this.engine,t=time-this.offset,p=e.noteJudgePointInto(item.L,item.n,t,{});
      return {x:p.x,y:p.y,ux:p.line?.ux??1,uy:p.line?.uy??0};
    }
    normalize(p){const e=this.engine,s=e.viewScale||1;return{x:((e.viewX||0)+p.x*s)/e.surfaceW,y:((e.viewY||0)+p.y*s)/e.surfaceH};}
    world(p){const e=this.engine,s=e.viewScale||1;return{x:(p.x*e.surfaceW-(e.viewX||0))/s,y:(p.y*e.surfaceH-(e.viewY||0))/s};}
    blocked(p,time,radius=true){
      if(!this.geometry.blocked)return false;
      const e=this.engine,t=time-this.offset,r=radius?e.w*.0045:0;
      // Sample the contact pad, not just its center; subtractive masks use the
      // exact same parity and transforms as the shipped native noise renderer.
      for(const [dx,dy] of [[0,0],[r,0],[-r,0],[0,r],[0,-r],[r*.7,r*.7],[-r*.7,r*.7],[r*.7,-r*.7],[-r*.7,-r*.7]])
        if(this.geometry.blocked(e,p.x+dx,p.y+dy,t))return true;
      return false;
    }
    safe(item,time,previous=null,future=0){
      const hit=item.n.time+this.offset,judgeTime=item.n.type===1?Math.min(time,hit):time;
      const e=this.engine,p=this.target(item,judgeTime),half=e.judgeHalfWidth(item.n)*.88;
      const valid=q=>{
        const n=this.normalize(q);
        return n.x>.013&&n.x<.987&&n.y>.018&&n.y<.982&&
          e.touchCoordinatesMatchNote(item.L,item.n,q.x,q.y,judgeTime-this.offset)&&!this.blocked(q,time)&&
          (!future||!this.blocked(q,time+future));
      };
      if(previous){const q=this.world(previous);if(valid(q))return this.normalize(q);}
      let home=p;
      if(!previous&&e.chart.kind!=='pjsk'){
        // Phigros accepts contact anywhere in its real judgement strip. Keep
        // idle hands near a comfortable lower play area, rather than chasing
        // every decorative line's vertical position across the whole display.
        const desired=this.world({x:clamp(this.normalize(p).x,.035,.965),y:.78});
        const along=(desired.x-p.x)*p.ux+(desired.y-p.y)*p.uy;
        home={x:desired.x-p.ux*along,y:desired.y-p.uy*along};
        if(valid(home)){if(this.blocked(p,time))this.stats.avoided++;return this.normalize(home);}
      }
      if(!previous&&valid(p))return this.normalize(p);
      let best=null,bestCost=Infinity;
      const preferred=previous?this.world(previous):home;
      // Native Phigros contact validity is a strip along the judgement line.
      // Search that real strip, including its normal, rather than changing notes.
      for(const n of [0,-.025,.025,-.06,.06,-.12,.12,-.22,.22,-.38,.38,-.6,.6,-.9,.9,-1.3,1.3]){
        for(const a of [0,-.22,.22,-.48,.48,-.75,.75,-1,1]){
          const q={x:p.x+p.ux*a*half-p.uy*n*e.h,y:p.y+p.uy*a*half+p.ux*n*e.h};
          if(!valid(q))continue;
          const cost=distance(q,preferred)+distance(q,p)*.18;
          if(cost<bestCost){best=q;bestCost=cost;}
        }
      }
      if(!best&&future)return this.safe(item,time,previous,0);
      if(!best){
        for(let iy=1;iy<96;iy++)for(let ix=1;ix<128;ix++){
          const q=this.world({x:ix/128,y:iy/96});
          if(!valid(q))continue;const cost=distance(q,preferred)+distance(q,p)*.18;
          if(cost<bestCost){best=q;bestCost=cost;}
        }
      }
      if(!best)throw Error(`实景手部规划：${time.toFixed(3)} 秒没有可避开噪域的有效触点（类型 ${item.n.type}，${item.n.time}～${item.n.end}；目标 ${p.x.toFixed(1)},${p.y.toFixed(1)}）。`);
      this.stats.avoided++;return this.normalize(best);
    }
    async build(check=()=>{}){
      const items=this.engine.noteItems.filter(({n})=>!n.fake).slice().sort((a,b)=>a.n.time-b.n.time||((b.n.type===3?b.n.end:b.n.time)-(a.n.type===3?a.n.end:a.n.time)));
      for(let index=0;index<items.length;index++){
        check();const item=items[index],n=item.n,hit=n.time+this.offset,start=Math.max(0,hit-(n.type===4?.035:n.type===2?.028:0));
        if(start<0)throw Error('实景手部规划不支持音频开始前的可判定音符。');
        const hold=n.type===3;let end=hold?Math.max(start,n.end+this.offset):hit+(n.type===4?.002:n.type===2?.024:.016);
        let point=this.safe(item,start);const same=this.events.findLast(event=>(Math.abs(event.start-start)<.0001||(n.type===2&&event.hold&&event.start<start))&&event.end>=end&&this.canShare(event,item,start,end));
        this.stats.notes++;
        if(same){same.items.push(item);this.stats.sharedNotes++;continue;}
        // Drag and Flick consume a continuing touch. A blue note needs a new
        // down edge, but its following gesture can stay on the same fingertip.
        if((n.type===2||n.type===4)&&this.continueGesture(item,start,end,point))continue;
        point=this.separatePoint(item,start,point);
        const candidatePoints=new Map(),candidateOptions=new Map();
        const available=this.tracks.filter(candidate=>{
          if(candidate.id%5>=4||candidate.last>start-.012)return false;
          const targets=[];
          const homeDepth=candidate.id<5?.86:.65;
          for(const depth of [homeDepth,homeDepth-.17,homeDepth+.17]){
          for(const offset of [0,-.025,.025,-.05,.05]){
            try{
              const target=this.engine.chart.kind==='pjsk'?point:this.separatePoint(item,start,this.safe(item,start,{x:point.x+offset,y:depth}));
              const proposed={start,end:start,samples:[{...target,time:start}]};
              if(this.trackCanTravel(candidate.id,proposed)&&this.handCanReach(candidate.id,proposed))targets.push(target);
            }catch{}
          }
          }
          if(!targets.length)return false;
          targets.sort((a,b)=>{
            const previous=Number.isFinite(candidate.last)?candidate.point:point;
            return padDistance(a,point)*.4+padDistance(a,previous)-padDistance(b,point)*.4-padDistance(b,previous);
          });
          candidatePoints.set(candidate.id,targets[0]);candidateOptions.set(candidate.id,targets);return true;
        });
        if(!available.length)throw Error(`实景手部规划：${start.toFixed(3)} 秒没有能及时到达的独立演奏手指。`);
        let track=available[0],cost=Infinity;
        for(const candidate of available){
          const target=candidatePoints.get(candidate.id),right=candidate.id>=5,id=candidate.id%5,home=rest(candidate.id);
          const speed=Number.isFinite(candidate.last)?padDistance(target,candidate.point)/Math.max(1e-9,start-candidate.last):0;
          const value=speed*.0035+Math.abs(target.x-home.x)*.7+
            (right?Math.max(0,.46-target.x):Math.max(0,target.x-.54))*12+
            // Translate the wrist to retain the index when the actual travel
            // deadline allows it. Other fingers take fast distant transitions.
            [0,.38,1.05,1.8,5][id];
          let penalty=0;
          for(const other of this.tracks){
            if((other.id<5)!==(candidate.id<5)||other.id===candidate.id)continue;
            const event=other.events[other.events.length-1];if(!event||event.end<start)continue;
            const active=this.sample(event,start),expected=(id-other.id%5)*(right?1:-1);
            if(id<4&&other.id%5<4&&(target.x-active.x)*expected<-.005)penalty+=2;
            if(distance(target,active)>.43)penalty+=6;
          }
          if(this.handCanReach(candidate.id,{start,end:start,samples:[{...target,time:start}],track:candidate.id})&&value+penalty<cost){track=candidate;cost=value+penalty;}
        }
        // Candidate scoring and its travel deadline use this exact staggered
        // play area, rather than changing depth after choosing a fingertip.
        point=candidatePoints.get(track.id);
        let samples=[{...point,time:start}];const step=1/this.hz;
        if(end>start){
          for(let at=start+step;at<end-1e-7;at+=step){
            let p;const previous={...samples[samples.length-1]};
            if(!hold&&at>hit&&this.blocked(this.world(previous),at)){end=previous.time;break;}
            if(n.type===4)previous.y-=.012;else if(n.type===2)previous.y-=.004;
            try{p=this.safe(item,at,previous,hold?Math.min(.025,end-at):0);}catch(error){if(!hold&&at>hit){end=samples[samples.length-1].time;break;}throw error;}
            samples.push({...p,time:at});this.stats.holdSamples++;
          }
          if(!hold&&end>hit&&this.blocked(this.world(samples[samples.length-1]),end))end=samples[samples.length-1].time;
          try{samples.push({...this.safe(item,end,samples[samples.length-1]),time:end});}catch(error){if(!hold&&end>hit)end=samples[samples.length-1].time;else throw error;}
        }
        const event={item,items:[item],start,end,hold,flick:n.type===4,gesture:n.type===2?'glide':n.type===4?'flick':'press',track:track.id,samples};
        if(!this.handCanReach(track.id,event)){
          const alternatives=[];
          for(const candidate of available){
            for(const target of candidateOptions.get(candidate.id)){
            const dy=target.y-point.y,dx=target.x-point.x;
            let shifted;
            try{shifted=samples.map(p=>({...this.safe(item,p.time,{x:p.x+dx,y:p.y+dy}),time:p.time}));}catch{continue;}
            const trial={...event,track:candidate.id,samples:shifted};
            if(this.trackCanTravel(candidate.id,trial)&&this.handCanReach(candidate.id,trial))alternatives.push({candidate,trial});
            }
          }
          alternatives.sort((a,b)=>Math.abs(a.trial.samples[0].x-(a.candidate.id<5?.3:.7))+.15*(a.candidate.id%5)-Math.abs(b.trial.samples[0].x-(b.candidate.id<5?.3:.7))-.15*(b.candidate.id%5));
          if(!alternatives.length)throw Error(`实景手部规划：${start.toFixed(3)} 秒的同时触点超出真实手部可达范围。`);
          track=alternatives[0].candidate;Object.assign(event,alternatives[0].trial);samples=event.samples;
        }
        track.events.push(event);track.last=end;track.point=samples[samples.length-1];
        this.events.push(event);this.stats.contacts++;
        if(index%48===0){this.options.progress?.(index/items.length);await new Promise(r=>setTimeout(r,0));}
      }
      await this.resolveTransitions(check);
      this.stats.fingerUsage=this.tracks.map(track=>track.events.length);
      this.options.progress?.(1);return this;
    }
    trackCanTravel(trackId,planned){
      const list=this.tracks[trackId].events.filter(event=>event!==planned);
      if(list.some(event=>event.start<planned.end-1e-8&&event.end>planned.start+1e-8))return false;
      const previous=list.filter(event=>event.end<=planned.start+1e-8).sort((a,b)=>b.end-a.end)[0];
      const next=list.filter(event=>event.start>=planned.end-1e-8).sort((a,b)=>a.start-b.start)[0];
      // Quintic interpolation peaks at 1.875 times its mean speed. Measuring
      // real centimetres and the real gap prevents reusing an index 5 cm away
      // only 15 ms after its release. Retain 6 ms for a distinct press edge.
      const reachable=(a,b,gap)=>gap+1e-8>=.006+1.875*padDistance(a,b)/100;
      return (!previous||reachable(this.sample(previous,previous.end),planned.samples[0],planned.start-previous.end))&&
        (!next||reachable(planned.samples[planned.samples.length-1],next.samples[0],next.start-planned.end));
    }
    handCanReach(trackId,planned,replacing=null){
      const hand=trackId<5?0:1,others=this.events.filter(event=>event!==planned&&event.track!==trackId&&(event.track<5?0:1)===hand&&event.start<=planned.end+.12&&(event===replacing?planned.start:event.end)>=planned.start-.12);
      if(!others.length)return true;
      const times=new Set(planned.samples.map(p=>p.time));
      for(const event of others)for(const p of event.samples)if(p.time>=planned.start&&p.time<=planned.end)times.add(p.time);
      for(const time of times){
        // Consecutive fingers share one palm. Outside an event's active
        // interval its reach disk expands at a 60 cm/s wrist-speed limit,
        // preventing a new finger from demanding an unreachable palm jump.
        const contacts=[{id:trackId,p:this.sample(planned,time),gap:0},...others.flatMap(event=>{
          const end=event===replacing?planned.start:event.end,at=clamp(time,event.start,end),gap=Math.abs(time-at);
          return gap<=.12?[{id:event.track,p:this.sample(event,at),gap}]:[];
        })];
        // These hands retain a fixed MCP orientation. Simultaneous fingertips
        // at the same depth cannot swap lateral order without crossing skin.
        for(let a=0;a<contacts.length;a++)for(let b=a+1;b<contacts.length;b++){
          const first=contacts[a],second=contacts[b],order=Math.sign((second.id%5)-(first.id%5))*(hand?1:-1);
          if(!first.gap&&!second.gap&&Math.abs(second.p.y-first.p.y)*screenHeight<3&&(second.p.x-first.p.x)*screenWidth*order<-.7)return false;
        }
        const disks=contacts.map(({id,p,gap})=>{
          const [x,y,z,length]=reachProfile[hand][id%5],dy=.24-3.55-y;
          return{x:(p.x-.5)*screenWidth-x,z:(p.y-.5)*screenHeight-z,r:Math.sqrt(length*length-dy*dy)-.35+60*gap};
        });
        if(!disksIntersect(disks))return false;
      }
      return true;
    }
    continueGesture(item,start,end,point){
      const hit=item.n.time+this.offset,limit=item.n.type===2?.24:.16;
      const candidates=this.tracks.filter(track=>track.id%5<4).flatMap(track=>{
        const event=track.events[track.events.length-1];if(!event)return[];
        const latest=Math.max(...event.items.map(entry=>entry.n.time+this.offset));
        if(latest>=hit-.004||event.end<start-limit||(event.end>hit&&event.items.some(entry=>entry.n.type===3&&entry.n.end+this.offset>hit)))return[];
        return[{track,event,cost:padDistance(this.sample(event,event.end),point)+(track.id%5===0?0:3)}];
      }).sort((a,b)=>a.cost-b.cost);
      for(const {track,event}of candidates){
        // Do not move an existing press before its own hit. For an adjacent
        // blue/Flick pair the tap's trailing dwell becomes the flick stroke.
        const latest=Math.max(...event.items.map(entry=>entry.n.time+this.offset));
        const from=Math.max(latest,Math.min(event.end,start)),origin=this.sample(event,from);
        let destination;try{destination=this.safe(item,start,origin);}catch{continue;}
        const joined={...event,items:[...event.items,item],end,gesture:'glide',flick:event.flick||item.n.type===4,
          samples:event.samples.filter(p=>p.time<from-1e-8).concat([{...origin,time:from}])};
        const times=new Set([from,start,hit,end]);
        for(let time=from+1/this.hz;time<end;time+=1/this.hz)times.add(time);
        let previous=origin,okay=true;
        for(const time of [...times].filter(t=>t>from+1e-8).sort((a,b)=>a-b)){
          let p;
          if(time<start){
            const u=smooth((time-from)/Math.max(1e-9,start-from));p={x:mix(origin.x,destination.x,u),y:mix(origin.y,destination.y,u)};
          }else{
            const u=smooth((time-from)/Math.max(1e-9,hit-from));
            const desired={x:mix(origin.x,destination.x,u),y:mix(origin.y,destination.y,u)};
            if(item.n.type===4)desired.y-=.045*clamp((time-Math.max(start,from))/Math.max(.008,hit-Math.max(start,from)),0,1);
            try{p=this.safe(item,time,desired);}catch{okay=false;break;}
          }
          const last=joined.samples[joined.samples.length-1],dt=time-last.time;
          if(padDistance(previous,p)>100*dt+.03){okay=false;break;}
          for(const u of [0,.125,.25,.375,.5,.625,.75,.875,1]){
            if(!this.valid(joined,mix(last.time,time,u),{x:mix(previous.x,p.x,u),y:mix(previous.y,p.y,u)})){okay=false;break;}
          }
          if(!okay)break;joined.samples.push({...p,time});previous=p;
        }
        // The overlapping part can contain a previous tap or another gesture.
        // Check it too before replacing the original contact with this chain.
        if(okay)for(const p of joined.samples)if(!this.valid(joined,p.time,p)){okay=false;break;}
        if(!okay||!this.handCanReach(track.id,joined))continue;
        // Preserve the object identity used by the track and global event lists.
        Object.assign(event,joined);track.last=end;track.point=joined.samples[joined.samples.length-1];
        if(item.n.type===4)this.stats.linkedFlicks++;else this.stats.glides++;
        return true;
      }
      return false;
    }
    separatePoint(item,time,point){
      const occupied=this.events.filter(event=>event.start<=time&&event.end>=time).map(event=>this.sample(event,time));
      const clear=p=>occupied.every(q=>padDistance(p,q)>1.4);
      if(clear(point))return point;
      for(const radius of [.04,.055,.08,.11,.16])for(const [dx,dy]of [[-1,0],[1,0],[0,-1],[0,1],[-.7,-.7],[.7,.7],[-.7,.7],[.7,-.7]]){
        try{const p=this.safe(item,time,{x:point.x+dx*radius,y:point.y+dy*radius},0);if(clear(p))return p;}catch{}
      }
      throw Error(`实景手部规划：${time.toFixed(3)} 秒的独立指尖缺少足够间距。`);
    }
    canShare(event,item,start,end){
      if(item.n.type===1||item.n.type===4||(item.n.type===3&&event.item.n.type!==3))return false;
      for(const p of [{...this.sample(event,start),time:start},...event.samples,{...this.sample(event,end),time:end}]){
        if(p.time<start-1e-7||p.time>end+1e-7)continue;const q=this.world(p);
        if(!this.engine.touchCoordinatesMatchNote(item.L,item.n,q.x,q.y,p.time-this.offset))return false;
      }
      return true;
    }
    relevant(item,time){if(item.n.type===1)return Math.abs(time-item.n.time-this.offset)<1e-7;return time>=item.n.time+this.offset-(item.n.type===4?.035:0)-1e-7&&time<=(item.n.type===3?item.n.end:item.n.time+.02)+this.offset+1e-7;}
    valid(event,time,p){
      const q=this.world(p);
      return !this.blocked(q,time)&&event.items.every(item=>!this.relevant(item,time)||this.engine.touchCoordinatesMatchNote(item.L,item.n,q.x,q.y,time-this.offset));
    }
    async resolveTransitions(check){
      // A straight interpolation between two safe points can cross a red mask.
      // Subdivide curves; for disconnected safe regions use a second finger
      // already hovering there, with an overlapping, validated Hold handoff.
      const queue=this.events.slice();
      for(let eventIndex=0;eventIndex<queue.length;eventIndex++){
        let event=queue[eventIndex],refinements=0;
        for(let i=0;i+1<event.samples.length;i++){
          check();const a=event.samples[i],b=event.samples[i+1];
          let bad=false;
          for(const u of [.125,.25,.375,.5,.625,.75,.875]){
            const time=mix(a.time,b.time,u),p={x:mix(a.x,b.x,u),y:mix(a.y,b.y,u)};
            if(!this.valid(event,time,p)){bad=true;break;}
          }
          if(!bad&&distance(a,b)<.035)continue;
          if(!event.hold){
            if(!bad)continue;
            const lastHit=Math.max(...event.items.map(item=>item.n.time+this.offset));
            if(a.time<lastHit-1e-7)throw Error(`实景手势在 ${a.time.toFixed(4)} 秒无法连续避开噪域。`);
            event.end=a.time;event.samples=event.samples.slice(0,i+1);break;
          }
          if(event.hold&&this.valid(event,a.time,b)){
            const proposed={...event,start:a.time,samples:[{...b,time:a.time},...event.samples.slice(i+1)]};
            const nextTrack=this.tracks.filter(track=>track.id%5<4&&track.id!==event.track&&!track.events.some(other=>other!==event&&other.start<event.end+.003&&other.end>a.time-.003)&&this.trackCanTravel(track.id,proposed)&&this.handCanReach(track.id,proposed,event))
              .sort((x,y)=>Math.abs((x.id<5?.3:.7)-b.x)-Math.abs((y.id<5?.3:.7)-b.x))[0];
            if(nextTrack){
              const continuation={...event,start:a.time,track:nextTrack.id,samples:[{...b,time:a.time},...event.samples.slice(i+1)],handoff:true};
              event.end=a.time;event.samples=event.samples.slice(0,i+1);
              nextTrack.events.push(continuation);nextTrack.events.sort((x,y)=>x.start-y.start);
              this.events.push(continuation);queue.push(continuation);this.stats.handoffs++;this.stats.contacts++;break;
            }
          }
          if(!bad)continue;
          if(++refinements>2048||b.time-a.time<1/7680)throw Error(`实景手部规划：${a.time.toFixed(4)} 秒无法连续避障或换手（类型 ${event.item.n.type}，${event.start}～${event.end}，端点 ${JSON.stringify(a)} → ${JSON.stringify(b)}）。`);
          const time=(a.time+b.time)/2,point=this.safe(event.item,time,a,0);
          event.samples.splice(i+1,0,{...point,time});i--;
        }
        if(eventIndex%24===0)await new Promise(r=>setTimeout(r,0));
      }
      for(const track of this.tracks)track.events.sort((a,b)=>a.start-b.start);
    }
    sample(event,time){
      const list=event.samples;
      if(list.length===1)return {...list[0]};
      let lo=0,hi=list.length-1;while(lo+1<hi){const m=(lo+hi)>>>1;if(list[m].time<=time)lo=m;else hi=m;}
      const a=list[lo],b=list[hi],u=clamp((time-a.time)/Math.max(1e-9,b.time-a.time),0,1);
      return{x:mix(a.x,b.x,u),y:mix(a.y,b.y,u)};
    }
    pose(id,time){
      const list=this.tracks[id].events;
      let lo=0,hi=list.length;while(lo<hi){const m=(lo+hi)>>>1;if(list[m].start<=time)lo=m+1;else hi=m;}
      const previous=list[lo-1],next=list[lo];
      if(previous&&time<=previous.end){
        const p=this.sample(previous,time);
        // Flick motion is part of the validated contact samples.
        const world=this.world(p);
        if(!this.valid(previous,time,p))
          throw Error(`实景触点校验失败：${time.toFixed(4)} 秒，手指 ${id+1}，类型 ${previous.item.n.type}，区间 ${previous.start}～${previous.end}，噪域 ${this.blocked(world,time)}，位置 ${p.x},${p.y}。`);
        this.stats.verifiedSamples++;
        return{...p,z:0,contact:true,event:previous};
      }
      const departure=previous?this.separatedEndpoint(id,previous.end):rest(id),arrival=next?this.separatedEndpoint(id,next.start):rest(id);
      const from=previous?previous.end:time-.32,to=next?next.start:time+.32;
      const gap=to-from,travel=Math.min(.42,Math.max(.085,distance(departure,arrival)*.85));
      let a=departure,b=arrival,u;
      if(next&&gap-travel<.16){
        // A very short dwell cannot carry 45% of the entire move. Use the whole
        // gap for one continuous travel instead of squeezing it into a few ms.
        u=smooth((time-from)/Math.max(1e-9,gap));
      }else if(next&&time<to-travel){
        a=departure;b={x:mix(departure.x,arrival.x,.45),y:mix(departure.y,arrival.y,.45)};
        // The first phase must reach its midpoint at the exact start of the
        // second phase. A minimum .16 s denominator left short gaps unfinished
        // and teleported the finger (and palm) to that midpoint at the boundary.
        u=smooth((time-from)/Math.max(1e-9,gap-travel));
      }else if(next){
        a=gap>travel?{x:mix(departure.x,arrival.x,.45),y:mix(departure.y,arrival.y,.45)}:departure;
        u=smooth((time-Math.max(from,to-travel))/Math.min(travel,gap));
      }else u=smooth((time-from)/.38);
      const raise=smooth(Math.min(1,(time-from)/.045)),lower=next?smooth(Math.min(1,(to-time)/.065)):1;
      return{x:mix(a.x,b.x,u),y:mix(a.y,b.y,u),z:1.7*raise*lower,until:next?to-time:Infinity,since:previous?time-from:Infinity,contact:false};
    }
    separatedEndpoint(id,time){
      // Hover must meet the same separated fingertip used at touchdown. Using
      // the raw event sample here approached one spot, then snapped sideways
      // as simultaneous-contact separation was applied on the contact frame.
      if(!this.endpointCache.has(time)){
        const contacts=this.tracks.map(track=>{
          const list=track.events;let lo=0,hi=list.length;
          while(lo<hi){const middle=(lo+hi)>>>1;if(list[middle].start<=time)lo=middle+1;else hi=middle;}
          const event=list[lo-1];
          return event&&time<=event.end?{...this.sample(event,time),contact:true,event}:{contact:false};
        });
        this.endpointCache.set(time,this.separateContacts(contacts,time));
      }
      return this.endpointCache.get(time)[id];
    }
    separateContacts(poses,time){
      const minimum=1.5;
      for(let pass=0;pass<12;pass++){
        let moved=false;
        for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++){
          const a=poses[i],b=poses[j];if(!a.contact||!b.contact)continue;
          const d=padDistance(a,b);if(d>=minimum)continue;
          const dx=d>1e-9?(a.x-b.x)*screenWidth/d:(i%2?1:-1),dy=d>1e-9?(a.y-b.y)*screenHeight/d:0;
          for(const [p,sign]of [[a,1],[b,-1]]){
            const q={x:p.x+dx*sign*(minimum-d+.001)*.6/screenWidth,y:p.y+dy*sign*(minimum-d+.001)*.6/screenHeight};
            if(q.x>.013&&q.x<.987&&q.y>.018&&q.y<.982&&this.valid(p.event,time,q)){p.x=q.x;p.y=q.y;moved=true;}
          }
        }
        if(!moved)break;
      }
      for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)
        if(poses[i].contact&&poses[j].contact&&padDistance(poses[i],poses[j])<1.4)
          throw Error(`实景手部在 ${time.toFixed(3)} 秒无法分离独立指尖。`);
      return poses;
    }
    poses(time){return this.separateContacts(this.tracks.map(track=>this.pose(track.id,time)),time);}
    async verify(check=()=>{},hz=240){
      let checked=0;
      // Verify authored hit times as well as sampled event intervals. A broken
      // gesture merge must never truncate its contact before its actual note.
      for(const item of this.engine.noteItems){
        if(item.n.fake)continue;check();const time=item.n.time+this.offset;
        if(!this.poses(time).some(p=>p.contact&&p.event.items.includes(item)))throw Error(`实景手部在 ${time.toFixed(4)} 秒缺少音符触点。`);
        checked++;if(checked%240===0)await new Promise(r=>setTimeout(r,0));
      }
      for(const event of this.events){
        for(let t=event.start;t<=event.end+1e-9;t+=1/hz){check();this.pose(event.track,Math.min(t,event.end));checked++;}
        if(checked%240<8)await new Promise(r=>setTimeout(r,0));
      }
      return{...this.stats,checked};
    }
  }
  return{ContactPlanner,smooth,rest};
});
