/* Sandboxed document bridge. Credentials remain in the parent application. */
(() => {
  "use strict";
  const pending=new Map();
  const send=(value)=>window.parent.postMessage(value,'*');
  window.IQOKOBridge={
    request(path,options={}){return new Promise((resolve,reject)=>{const id=crypto.randomUUID();const timer=setTimeout(()=>{pending.delete(id);const error=new Error('Нет подтверждения от сервера. Повторите сохранение.');error.status=0;reject(error);},45000);pending.set(id,{resolve,reject,timer});send({type:'iqoko:request',id,path,options:{method:options.method||'GET',body:options.body}});});},
    draft(key,value){send({type:'iqoko:draft',key,value});},
    dirty(value){send({type:'iqoko:dirty',dirty:value});}
  };
  function scrollToElement(target){const top=target.getBoundingClientRect().top+window.scrollY;if(window.__IQOKO_FRAME__?.kind==='report')window.scrollTo({top:Math.max(0,top-15),behavior:'smooth'});else send({type:'iqoko:scroll-position',top});}
  window.addEventListener('message',(event)=>{
    if(event.source!==window.parent)return;const message=event.data;if(!message||typeof message!=='object')return;
    if(message.type==='iqoko:response'){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error){const error=new Error(message.error.message);error.status=message.error.status;error.data=message.error.data;request.reject(error);}else request.resolve(message.value);}
    else if(message.type==='iqoko:print'){document.querySelectorAll('details').forEach(details=>details.open=true);window.print();}
    else if(message.type==='iqoko:scroll'&&typeof message.anchor==='string'){const target=document.getElementById(message.anchor);if(target)scrollToElement(target);}
    else if(message.type==='iqoko:storage-unavailable')window.dispatchEvent(new Event('iqoko-storage-unavailable'));
  });
  function height(){if(window.__IQOKO_FRAME__?.kind==='report')return;const value=Math.max(window.__IQOKO_FRAME__?.kind==='viewer'?760:300,document.body.scrollHeight,Math.ceil(document.body.getBoundingClientRect().height));send({type:'iqoko:height',height:value});}
  let measureTimer=null;const schedule=()=>{clearTimeout(measureTimer);measureTimer=setTimeout(height,100);};
  new ResizeObserver(schedule).observe(document.body);window.addEventListener('load',schedule);window.addEventListener('resize',schedule);document.querySelectorAll('img').forEach(image=>image.addEventListener('load',schedule));schedule();
  // Match dynamic trip thumbnails to paths already supplied by the protected report.
  const imagePaths=new Map([...document.querySelectorAll('[data-review-image]')].map(control=>[control.dataset.image,decodeURIComponent(control.dataset.reviewImage)]));
  document.addEventListener('click',(event)=>{
    const control=event.target.closest('[data-review-image]');if(!control)return;
    event.preventDefault();event.stopImmediatePropagation();
    const path=imagePaths.get(control.dataset.image);if(path)send({type:'iqoko:open-asset',path,anchor:''});
  },true);
  document.addEventListener('click',(event)=>{
    const link=event.target.closest('a');if(!link)return;const href=link.getAttribute('href')||'';
    if(link.dataset.reviewAsset){event.preventDefault();send({type:'iqoko:open-asset',path:decodeURIComponent(link.dataset.reviewAsset),anchor:link.dataset.reviewAssetAnchor||''});return;}
    const route=link.dataset.reviewRoute;const file=link.dataset.reviewDocument;if(route==='report'){event.preventDefault();send({type:'iqoko:navigate',route:'report',anchor:link.dataset.reviewAnchor||''});return;}if(file){event.preventDefault();send({type:'iqoko:navigate',route:'viewer',file});return;}
    if(href==='#review-snapshots'||href==='#review-dashboard'||href==='/#snapshots'||href==='/'||href==='#dashboard'||href==='#snapshots'){event.preventDefault();send({type:'iqoko:navigate',route:'dashboard'});return;}
    if(href==='#review-report'||href==='/report'||href==='#report'){event.preventDefault();send({type:'iqoko:navigate',route:'report',anchor:link.dataset.reviewAnchor||''});return;}
    if(href.startsWith('#viewer=')){event.preventDefault();const params=new URLSearchParams(href.slice(1));send({type:'iqoko:navigate',route:'viewer',file:params.get('viewer')});return;}
    if(href.startsWith('#')){const target=document.getElementById(href.slice(1));if(target){event.preventDefault();scrollToElement(target);}return;}
    // All attachments open separately; the parent remains available with its saved session.
    if(/^https:\/\//.test(href)){link.target='_blank';link.rel='noopener noreferrer';}
  });
})();
