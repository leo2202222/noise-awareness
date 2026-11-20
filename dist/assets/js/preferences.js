(function () {
  'use strict';
  // Browser preferences control presentation only; device settings come from ThingsBoard.
  const KEY = 'noise-interface-preferences-v1';
  function read() { try { const value=JSON.parse(localStorage.getItem(KEY)||'{}'); return {motionEnabled:value.motionEnabled!==false}; } catch {return {motionEnabled:true};} }
  function write(value) { localStorage.setItem(KEY,JSON.stringify({motionEnabled:value.motionEnabled!==false})); }
  function applyMotion() {
    const enabled=read().motionEnabled;
    document.body.classList.toggle('motion-paused',!enabled);
    const control=document.querySelector('[data-motion-control]');
    if(control){control.setAttribute('aria-checked',String(enabled));const label=control.querySelector('.motion-control-label');if(label)label.textContent=enabled?(document.documentElement.lang==='th'?'เปิดการเคลื่อนไหว':'Motion On'):(document.documentElement.lang==='th'?'ปิดการเคลื่อนไหว':'Motion Off');}
  }
  const originalRender=window.render;
  if(typeof originalRender==='function')window.render=function(...args){const result=originalRender.apply(this,args);applyMotion();return result;};
  document.addEventListener('click',event=>{if(event.target.closest('[data-motion-control]'))queueMicrotask(()=>write({motionEnabled:!document.body.classList.contains('motion-paused')}));});
  applyMotion();window.NoisePreferences={read,write};
})();
