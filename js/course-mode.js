/* Three-chart course state is independent of chart/audio loading.
 * Numeric scoring/rank reference: Adai-add/PhiraiAd@a60b49ad30b4748327df9a5fae794278a3978520
 * phira/src/challenge.rs and prpr/src/judge.rs (GPL-3.0-only).
 * This web implementation uses fixed windows, without that engine's half-frame
 * adjustment, and does not claim the original game's complete course behavior.
 */
(function (root) {
  'use strict';
  let sequence = 0;
  const key = item => String(item?.id || item?.scoreIdentity || '');
  const ranks=[
    {minimum:3000000,id:'rainbow',title:'彩'},
    {minimum:2940000,id:'yellow',title:'黄'},
    {minimum:2850000,id:'orange',title:'橙'},
    {minimum:2700000,id:'blue',title:'蓝'},
    {minimum:2460000,id:'green',title:'绿'}
  ];
  const rankFor = score => ranks.find(rank=>score>=rank.minimum)||{id:'none',title:'未达标',minimum:0};
  function courseLevel(charts) {
    const values=charts.map(item=>Number(item.meta?.difficulty??item.difficulty));
    if(values.some(value=>!Number.isFinite(value)||value<0))return {integer:null,precise:null};
    return {integer:values.reduce((sum,value)=>sum+Math.floor(value),0),precise:values.reduce((sum,value)=>sum+value,0)};
  }
  class Session {
    constructor(charts) {
      if (!Array.isArray(charts) || charts.length !== 3) throw Error('请选择三张谱面');
      if (charts.some(item => !key(item)) || new Set(charts.map(key)).size !== 3)
        throw Error('请选择三张不同的谱面');
      this.id = `course-${Date.now()}-${++sequence}`;
      this.charts = charts.slice(); this.index = 0; this.results = []; this.state = 'ready';
      this.stageToken = ''; this.level = courseLevel(charts);
    }
    begin() {
      if (this.state !== 'ready') throw Error('当前课题不能开始');
      this.state = 'playing';this.stageToken=`${this.id}:${this.index}`; return this.charts[this.index];
    }
    finish(result, id = this.id, stageToken = this.stageToken) {
      if (id !== this.id || this.state !== 'playing' || stageToken!==this.stageToken) return false;
      if (!Number.isFinite(result?.score) || !Array.isArray(result.counts) || result.counts.length !== 4)
        throw Error('课题结果不完整');
      this.results.push({score:Math.max(0,Math.min(1000000,Math.round(result.score))),
        counts:result.counts.slice(), total:Number(result.total)||0, assisted:!!result.assisted});
      this.state = this.index === 2 ? 'complete' : 'between'; return true;
    }
    next() {
      if (this.state !== 'between') throw Error('当前课题不能继续');
      this.index++; this.state = 'ready'; return this.begin();
    }
    cancel() { this.state = 'cancelled'; }
    get score() { return this.results.reduce((sum,item)=>sum+item.score,0); }
    get counts() { return this.results.reduce((sum,item)=>sum.map((n,i)=>n+item.counts[i]),[0,0,0,0]); }
    get assisted() { return this.results.some(item=>item.assisted); }
  }
  let adapter, panel, progress, focusOrigin, session = null, selection = [], entries = [], busy = false, generation = 0;
  const el = (tag, text, className) => {
    const node=document.createElement(tag);if(text!=null)node.textContent=text;if(className)node.className=className;return node;
  };
  function ensurePanel() {
    if(panel)return panel;
    panel=el('section',null,'phiCourse hidden');panel.id='phiCoursePanel';
    panel.setAttribute('role','dialog');panel.setAttribute('aria-modal','true');panel.setAttribute('aria-labelledby','phiCourseTitle');
    document.body.appendChild(panel);return panel;
  }
  function title(text) {
    const box=el('div',null,'phiCourseBox'),heading=el('h2',text);heading.id='phiCourseTitle';box.appendChild(heading);
    if(!focusOrigin)focusOrigin=document.activeElement;
    ensurePanel().replaceChildren(box);panel.classList.remove('hidden');heading.tabIndex=-1;heading.focus();return box;
  }
  function button(text, action, disabled=false) {
    const node=el('button',text);node.type='button';node.disabled=disabled;node.onclick=action;return node;
  }
  function caption(item) {return `${item.name||item.meta?.name||'未命名'} · ${item.meta?.level||item.meta?.difficultyClass||item.level||'?'}`;}
  function cancel(hide=true) {
    generation++;session?.cancel();session=null;busy=false;progress?.classList.add('hidden');
    if(hide){panel?.classList.add('hidden');const target=focusOrigin;focusOrigin=null;if(target?.isConnected)target.focus();}
  }
  async function open() {
    if(busy)return;
    cancel(); const token=generation;
    const box=title('课题模式');box.appendChild(el('p','正在读取谱面目录…'));
    try {
      entries=await adapter.entries();if(token!==generation)return;
      entries=entries.filter(item=>item.parser!=='sus');
      selection=selection.filter(id=>entries.some(item=>key(item)===id)).slice(0,3);
      renderSelection();
    } catch(error) {if(token!==generation)return;box.appendChild(el('p',error.message));box.appendChild(button('返回',()=>cancel()));}
  }
  function renderSelection(query='') {
    const box=title('课题模式'),hint=el('p','选择三张不同谱面，依次挑战。Tap 使用 Perfect ±40ms、Good ±90ms、Bad ±140ms，Hold 无 Bad；按准确率计分。','phiCourseHint');
    box.appendChild(hint);
    const slots=el('ol',null,'phiCourseSlots');
    selection.forEach((id,i)=>{const li=el('li'),item=entries.find(item=>key(item)===id);li.append(el('span',caption(item)),button('移除',()=>{selection.splice(i,1);renderSelection(query);}));slots.appendChild(li);});
    for(let i=selection.length;i<3;i++)slots.appendChild(el('li',`第 ${i+1} 首 · 待选择`));
    box.appendChild(slots);
    if(selection.length===3){const level=courseLevel(selection.map(id=>entries.find(item=>key(item)===id)));box.appendChild(el('p',`课题等级 ${level.integer??'?'} · 定数合计 ${level.precise?.toFixed(1)??'?'}`));}
    const search=el('input');search.type='search';search.placeholder='搜索歌曲、难度或作者';search.value=query;search.setAttribute('aria-label','搜索课题谱面');box.appendChild(search);
    const list=el('div',null,'phiCourseChoices');list.setAttribute('role','list');box.appendChild(list);
    function refresh() {
      const q=search.value.trim().toLowerCase();list.replaceChildren();
      for(const item of entries.filter(item=>[caption(item),item.meta?.composer].join(' ').toLowerCase().includes(q))){
        const selected=selection.includes(key(item));
        const row=button(caption(item)+(selected?' · 已选择':''),()=>{selection.push(key(item));renderSelection(search.value);},selected||selection.length>=3);
        row.setAttribute('role','listitem');list.appendChild(row);
      }
      if(!list.children.length)list.appendChild(el('p','没有匹配的谱面'));
    }
    search.oninput=refresh;refresh();
    const actions=el('div',null,'phiCourseActions');actions.append(button('返回',()=>cancel()),button('开始课题',start,selection.length!==3));box.appendChild(actions);
  }
  async function start() {
    if(busy)return;
    try {session=new Session(selection.map(id=>entries.find(item=>key(item)===id)));session.begin();await launch();}
    catch(error){showFailure(error);}
  }
  async function launch() {
    const current=session,token=++generation;if(!current)return;
    busy=true;panel?.classList.add('hidden');
    if(!progress){progress=el('div',null,'phiCourseProgress hidden');document.body.appendChild(progress);}
    progress.textContent=`课题 ${current.level.integer??'?'} · ${current.index+1} / 3 · 累计 ${current.score}`;
    progress.classList.remove('hidden');
    try {
      await adapter.start(current.charts[current.index],current.id,current.stageToken);
      if(token!==generation||session!==current)return;
    } catch(error) {if(token===generation&&session===current)showFailure(error);}
    finally {if(token===generation)busy=false;}
  }
  function showFailure(error) {
    busy=false;progress?.classList.add('hidden');session?.cancel();const box=title('课题未能开始');box.appendChild(el('p',error?.message||String(error)));
    box.appendChild(button('返回选曲',async()=>{cancel();await adapter.back();await open();}));
  }
  function onResult(engine) {
    if(!session||engine.courseSessionId!==session.id)return false;
    if(engine.courseStageToken!==session.stageToken)return false;
    const counts=engine.usedInvincible?engine.actualCounts:engine.counts;
    if(!session.finish({score:engine.score(),counts,total:engine.total,
      assisted:engine.usedAutoplay||engine.usedInvincible||engine.usedReveal||engine.usedKeyboard||engine.usedModeSwitch},engine.courseSessionId,engine.courseStageToken))return false;
    progress?.classList.add('hidden');
    busy=false;const complete=session.state==='complete',box=title(complete?'课题完成':`第 ${session.index+1} 首完成`);
    box.appendChild(el('p',`总分 ${String(session.score).padStart(7,'0')} / 3000000`,'phiCourseScore'));
    if(complete){const rank=session.assisted?{id:'none',title:'辅助游玩 · 不评级'}:rankFor(session.score),badge=el('p',`课题 ${session.level.integer??'?'} · ${rank.title}`,'phiCourseBadge');badge.dataset.rank=rank.id;box.appendChild(badge);}
    const list=el('ol');session.results.forEach((result,i)=>list.appendChild(el('li',`${caption(session.charts[i])} · ${result.score}`)));box.appendChild(list);
    const countsSum=session.counts;box.appendChild(el('p',`Perfect ${countsSum[0]} · Good ${countsSum[1]} · Bad ${countsSum[2]} · Miss ${countsSum[3]}`));
    if(session.assisted)box.appendChild(el('p','本次使用了辅助功能或键盘，成绩不参与正式纪录。','phiCourseHint'));
    const actions=el('div',null,'phiCourseActions');
    actions.appendChild(button('退出课题',async()=>{cancel();await adapter.back();}));
    if(!complete)actions.appendChild(button('下一首',async()=>{if(busy)return;session.next();await launch();}));
    else actions.appendChild(button('重新挑战',retry));
    box.appendChild(actions);return true;
  }
  async function retry() {
    if(busy||!session)return;
    session=new Session(session.charts);session.begin();await launch();
  }
  function install(value) {
    adapter=value;
    const button=document.getElementById('refCourse');if(button)button.onclick=event=>{event.stopPropagation();open();};
    document.getElementById('loadingBack')?.addEventListener('click',()=>cancel(),{capture:true});
    document.addEventListener('keydown',event=>{
      if(!panel||panel.classList.contains('hidden'))return;
      if(event.key==='Escape'){
        event.preventDefault();event.stopImmediatePropagation();const active=!!session;cancel();if(active)adapter.back();return;
      }
      if(event.key==='Tab'){
        const nodes=[...panel.querySelectorAll('button:not(:disabled),input:not(:disabled),[tabindex="0"]')];
        if(!nodes.length){event.preventDefault();return;}
        const at=nodes.indexOf(document.activeElement);
        if(at<0||(event.shiftKey&&at===0)||(!event.shiftKey&&at===nodes.length-1)){
          event.preventDefault();nodes[event.shiftKey?nodes.length-1:0].focus();
        }
        event.stopPropagation();
      }
    },{capture:true});
  }
  const api={Session,rankFor,courseLevel,install,open,cancel,retry,onResult,fail:showFailure,current:()=>session};
  if(typeof module==='object'&&module.exports)module.exports=api;
  root.PhiCourse=api;
})(globalThis);
