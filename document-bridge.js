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
  window.addEventListener('message',(event)=>{
    if(event.source!==window.parent)return;const message=event.data;if(!message||typeof message!=='object')return;
    if(message.type==='iqoko:response'){const request=pending.get(message.id);if(!request)return;pending.delete(message.id);clearTimeout(request.timer);if(message.error){const error=new Error(message.error.message);error.status=message.error.status;error.data=message.error.data;request.reject(error);}else request.resolve(message.value);}
    else if(message.type==='iqoko:print'){document.querySelectorAll('details').forEach(details=>details.open=true);window.print();}
    else if(message.type==='iqoko:scroll'&&typeof message.anchor==='string'){const target=document.getElementById(message.anchor);if(target)send({type:'iqoko:scroll-position',top:target.getBoundingClientRect().top+window.scrollY});}
    else if(message.type==='iqoko:storage-unavailable')window.dispatchEvent(new Event('iqoko-storage-unavailable'));
  });
  function height(){const value=Math.max(window.__IQOKO_FRAME__?.kind==='viewer'?760:300,document.body.scrollHeight,Math.ceil(document.body.getBoundingClientRect().height));send({type:'iqoko:height',height:value});}
  let measureTimer=null;const schedule=()=>{clearTimeout(measureTimer);measureTimer=setTimeout(height,100);};
  new ResizeObserver(schedule).observe(document.body);window.addEventListener('load',schedule);window.addEventListener('resize',schedule);document.querySelectorAll('img').forEach(image=>image.addEventListener('load',schedule));schedule();
  const previewReady=new WeakSet();
  document.addEventListener('click',(event)=>{
    const control=event.target.closest('[data-review-image]');if(!control)return;
    if(previewReady.has(control)){previewReady.delete(control);return;}
    event.preventDefault();event.stopImmediatePropagation();control.setAttribute('aria-busy','true');
    void(async()=>{try{
      const params=new URLSearchParams({version:window.__IQOKO_FRAME__.reportVersion,path:decodeURIComponent(control.dataset.reviewImage)});
      const result=await window.IQOKOBridge.request('asset-url?'+params.toString());
      const url=new URL(result.url);if(url.protocol!=='https:')throw new Error('Недопустимый адрес изображения.');
      control.dataset.image=url.href;previewReady.add(control);control.click();
    }catch(error){const message=document.createElement('p');message.setAttribute('role','alert');message.textContent=error.message;message.style.cssText='color:#9b4825;font:12px Arial';control.after(message);}
    finally{control.removeAttribute('aria-busy');}})();
  },true);
  async function openAsset(link,popup){
    try{
      const path=decodeURIComponent(link.dataset.reviewAsset);
      const params=new URLSearchParams({version:window.__IQOKO_FRAME__.reportVersion,path});
      const result=await window.IQOKOBridge.request('asset-url?'+params.toString());
      const target=new URL(result.url);if(target.protocol!=='https:')throw new Error('Недопустимый адрес вложения.');
      if(link.dataset.reviewAssetAnchor)target.hash=link.dataset.reviewAssetAnchor;
      if(popup&&!popup.closed){popup.location.replace(target.href);}
      else{
        const fallback=document.createElement('p');fallback.style.cssText='padding:12px;background:#fff5e9;border:1px solid #e5cda9;border-radius:5px;font:12px/1.5 Arial';
        fallback.append('Браузер ограничил открытие новой вкладки. ');const fresh=document.createElement('a');fresh.href=target.href;fresh.target='_blank';fresh.rel='noopener noreferrer';fresh.textContent='Открыть вложение';fallback.append(fresh);link.after(fallback);
      }
    }catch(error){if(popup&&!popup.closed)popup.close();const message=document.createElement('p');message.setAttribute('role','alert');message.style.cssText='padding:10px;color:#9b4825;background:#fff2e9;font:12px/1.5 Arial';message.textContent=error.status===401?'Сессия завершена. Откройте персональную ссылку для повторного входа.':error.message;link.after(message);}
  }
  document.addEventListener('click',(event)=>{
    const link=event.target.closest('a');if(!link)return;const href=link.getAttribute('href')||'';
    if(link.dataset.reviewAsset){event.preventDefault();const popup=window.open('about:blank','_blank');if(popup){popup.opener=null;try{popup.document.title='Открываем вложение';popup.document.body.textContent='Открываем защищённое вложение…';}catch{ /* Window navigation remains available without document access. */ }}void openAsset(link,popup);return;}
    const route=link.dataset.reviewRoute;const file=link.dataset.reviewDocument;if(route==='report'){event.preventDefault();send({type:'iqoko:navigate',route:'report',anchor:link.dataset.reviewAnchor||''});return;}if(file){event.preventDefault();send({type:'iqoko:navigate',route:'viewer',file});return;}
    if(href==='#review-snapshots'||href==='#review-dashboard'||href==='/#snapshots'||href==='/'||href==='#dashboard'||href==='#snapshots'){event.preventDefault();send({type:'iqoko:navigate',route:'dashboard'});return;}
    if(href==='#review-report'||href==='/report'||href==='#report'){event.preventDefault();send({type:'iqoko:navigate',route:'report',anchor:link.dataset.reviewAnchor||''});return;}
    if(href.startsWith('#viewer=')){event.preventDefault();const params=new URLSearchParams(href.slice(1));send({type:'iqoko:navigate',route:'viewer',file:params.get('viewer')});return;}
    if(href.startsWith('#')){const target=document.getElementById(href.slice(1));if(target){event.preventDefault();send({type:'iqoko:scroll-position',top:target.getBoundingClientRect().top+window.scrollY});}return;}
    // All attachments open separately; the parent remains available with its saved session.
    if(/^https:\/\//.test(href)){link.target='_blank';link.rel='noopener noreferrer';}
  });
})();
