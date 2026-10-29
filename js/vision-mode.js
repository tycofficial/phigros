/* Independent, persistent switch for the in-song visions implemented here. */
(() => {
  'use strict';
  const key='phi.visionReplayEnabled';let enabled=true;
  try{enabled=localStorage.getItem(key)!=='false';}catch{}
  function paint(){const button=document.getElementById('visionModeToggle');if(button){button.textContent=`意象重演：${enabled?'开启':'关闭'}`;button.setAttribute('aria-pressed',String(enabled));}}
  function set(value){enabled=!!value;try{localStorage.setItem(key,String(enabled));}catch{}paint();return enabled;}
  globalThis.PhiVisionMode=Object.freeze({get enabled(){return enabled;},set});
  document.getElementById('visionModeToggle')?.addEventListener('click',()=>set(!enabled));paint();
})();
