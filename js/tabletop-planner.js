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
  const rest=id=>({x:id<5?.31-(id%5)*.038:.69+(id%5)*.038,y:1.09,z:1.7});
  class ContactPlanner {
    constructor(engine,geometry,options={}){
      this.engine=engine;this.geometry=geometry;this.offset=Number(engine.chart.offset)||0;
      this.hz=120;this.tracks=Array.from({length:10},(_,id)=>({id,events:[],last:-Infinity,point:rest(id)}));
      this.stats={notes:0,contacts:0,sharedNotes:0,holdSamples:0,avoided:0,verifiedSamples:0,handoffs:0};
      this.events=[];this.options=options;
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
      const e=this.engine,p=this.target(item,time),half=e.judgeHalfWidth(item.n)*.88;
      const valid=q=>{
        const n=this.normalize(q);
        return n.x>.013&&n.x<.987&&n.y>.018&&n.y<.982&&
          e.touchCoordinatesMatchNote(item.L,item.n,q.x,q.y,time-this.offset)&&!this.blocked(q,time)&&
          (!future||!this.blocked(q,time+future));
      };
      if(previous){const q=this.world(previous);if(valid(q))return this.normalize(q);}
      if(!previous&&valid(p))return this.normalize(p);
      let best=null,bestCost=Infinity;
      const preferred=previous?this.world(previous):p;
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
      const items=this.engine.noteItems.filter(({n})=>!n.fake).slice().sort((a,b)=>(a.n.time-(a.n.type===4?.035:0))-(b.n.time-(b.n.type===4?.035:0))||((b.n.type===3?b.n.end:b.n.time)-(a.n.type===3?a.n.end:a.n.time)));
      for(let index=0;index<items.length;index++){
        check();const item=items[index],n=item.n,hit=n.time+this.offset,start=Math.max(0,hit-(n.type===4?.035:0));
        if(start<0)throw Error('实景手部规划不支持音频开始前的可判定音符。');
        const hold=n.type===3;let end=hold?Math.max(start,n.end+this.offset):hit+(n.type===4?.002:.016);
        let point=this.safe(item,start);const same=this.events.findLast(event=>(Math.abs(event.start-start)<.0001||(n.type===2&&event.hold&&event.start<start))&&event.end>=end&&this.canShare(event,item,start,end));
        this.stats.notes++;
        if(same){same.items.push(item);this.stats.sharedNotes++;continue;}
        point=this.separatePoint(item,start,point);
        const available=this.tracks.filter(track=>track.id%5<4&&track.last<=start-.012);
        if(!available.length)throw Error(`实景手部规划：${start.toFixed(3)} 秒需要超过八个独立演奏触点。`);
        let track=available[0],cost=Infinity;
        for(const candidate of available){
          const right=candidate.id>=5,id=candidate.id%5,home=rest(candidate.id);
          const jump=distance(point,candidate.point)/Math.max(.06,start-candidate.last);
          const value=jump*.035+Math.abs(point.x-home.x)*.7+
            (right?Math.max(0,.46-point.x):Math.max(0,point.x-.54))*3+(id===4?5:0)+id*.006;
          let penalty=0;
          for(const other of this.tracks){
            if((other.id<5)!==(candidate.id<5)||other.id===candidate.id)continue;
            const event=other.events[other.events.length-1];if(!event||event.end<start)continue;
            const active=this.sample(event,start),expected=(id-other.id%5)*(right?1:-1);
            if(id<4&&other.id%5<4&&(point.x-active.x)*expected<-.005)penalty+=8;
            if(distance(point,active)>.43)penalty+=6;
          }
          if(value+penalty<cost){track=candidate;cost=value+penalty;}
        }
        const samples=[{...point,time:start}],step=1/this.hz;
        if(end>start){
          for(let at=start+step;at<end-1e-7;at+=step){
            let p;const previous={...samples[samples.length-1]};if(n.type===4)previous.y-=.012;
            try{p=this.safe(item,at,previous,hold?Math.min(.025,end-at):0);}catch(error){if(!hold&&at>hit){end=samples[samples.length-1].time;break;}throw error;}
            samples.push({...p,time:at});this.stats.holdSamples++;
          }
          try{samples.push({...this.safe(item,end,samples[samples.length-1]),time:end});}catch(error){if(!hold&&end>hit)end=samples[samples.length-1].time;else throw error;}
        }
        const event={item,items:[item],start,end,hold,flick:n.type===4,track:track.id,samples};
        track.events.push(event);track.last=end;track.point=samples[samples.length-1];
        this.events.push(event);this.stats.contacts++;
        if(index%48===0){this.options.progress?.(index/items.length);await new Promise(r=>setTimeout(r,0));}
      }
      await this.resolveTransitions(check);
      this.stats.fingerUsage=this.tracks.map(track=>track.events.length);
      this.options.progress?.(1);return this;
    }
    separatePoint(item,time,point){
      const occupied=this.events.filter(event=>event.start<=time&&event.end>=time).map(event=>this.sample(event,time));
      const clear=p=>occupied.every(q=>distance(p,q)>.037);
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
    relevant(item,time){return time>=item.n.time+this.offset-(item.n.type===4?.035:0)-1e-7&&time<=(item.n.type===3?item.n.end:item.n.time+.02)+this.offset+1e-7;}
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
          if(!event.hold){event.end=a.time;event.samples=event.samples.slice(0,i+1);break;}
          if(event.hold&&this.valid(event,a.time,b)){
            const nextTrack=this.tracks.filter(track=>track.id%5<4&&track.id!==event.track&&!track.events.some(other=>other!==event&&other.start<event.end+.003&&other.end>a.time-.003))
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
      const departure=previous?this.sample(previous,previous.end):rest(id),arrival=next?next.samples[0]:rest(id);
      const from=previous?previous.end:time-.32,to=next?next.start:time+.32;
      const gap=to-from,travel=Math.min(.42,Math.max(.085,distance(departure,arrival)*.85));
      let a=departure,b=arrival,u;
      if(next&&time<to-travel){
        a=departure;b={x:mix(departure.x,arrival.x,.45),y:mix(departure.y,arrival.y,.45)};
        u=smooth((time-from)/Math.max(.16,gap-travel));
      }else if(next){
        a=gap>travel?{x:mix(departure.x,arrival.x,.45),y:mix(departure.y,arrival.y,.45)}:departure;
        u=smooth((time-Math.max(from,to-travel))/Math.min(travel,gap));
      }else u=smooth((time-from)/.38);
      const raise=smooth(Math.min(1,(time-from)/.045)),lower=next?smooth(Math.min(1,(to-time)/.065)):1;
      return{x:mix(a.x,b.x,u),y:mix(a.y,b.y,u),z:.16+1.7*raise*lower,until:next?to-time:Infinity,since:previous?time-from:Infinity,contact:false};
    }
    poses(time){
      const poses=this.tracks.map(track=>this.pose(track.id,time)),minimum=.048;
      for(let pass=0;pass<12;pass++){
        let moved=false;
        for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++){
          const a=poses[i],b=poses[j];if(!a.contact||!b.contact)continue;
          const d=distance(a,b);if(d>=minimum)continue;
          const dx=d>1e-9?(a.x-b.x)/d:(i%2?1:-1),dy=d>1e-9?(a.y-b.y)/d:0;
          for(const [p,sign]of [[a,1],[b,-1]]){
            const q={x:p.x+dx*sign*(minimum-d+.0001)*.6,y:p.y+dy*sign*(minimum-d+.0001)*.6};
            if(q.x>.013&&q.x<.987&&q.y>.018&&q.y<.982&&this.valid(p.event,time,q)){p.x=q.x;p.y=q.y;moved=true;}
          }
        }
        if(!moved)break;
      }
      for(let i=0;i<poses.length;i++)for(let j=i+1;j<poses.length;j++)
        if(poses[i].contact&&poses[j].contact&&distance(poses[i],poses[j])<.037)
          throw Error(`实景手部在 ${time.toFixed(3)} 秒无法分离独立指尖。`);
      return poses;
    }
    async verify(check=()=>{},hz=240){
      let checked=0;
      for(const event of this.events){
        for(let t=event.start;t<=event.end+1e-9;t+=1/hz){check();this.pose(event.track,Math.min(t,event.end));checked++;}
        if(checked%240<8)await new Promise(r=>setTimeout(r,0));
      }
      return{...this.stats,checked};
    }
  }
  return{ContactPlanner,smooth,rest};
});
