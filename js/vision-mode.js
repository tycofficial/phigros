/* Independent chapter replay mode. Ordinary in-song effects do not depend on it. */
(() => {
  'use strict';
  const key='phi.visionReplayEnabled';let enabled=true;
  try{enabled=localStorage.getItem(key)!=='false';}catch{}
  function paint(){const button=document.getElementById('visionModeToggle');if(button){button.textContent=`意象重演：${enabled?'开启':'关闭'}`;button.setAttribute('aria-pressed',String(enabled));}}
  function set(value){enabled=!!value;try{localStorage.setItem(key,String(enabled));}catch{}paint();if(typeof CustomEvent==='function'&&typeof window!=='undefined')window.dispatchEvent(new CustomEvent('phi:vision-mode',{detail:{enabled}}));return enabled;}
  globalThis.PhiVisionMode=Object.freeze({get enabled(){return enabled;},set});
  document.getElementById('visionModeToggle')?.addEventListener('click',()=>set(!enabled));paint();
})();
