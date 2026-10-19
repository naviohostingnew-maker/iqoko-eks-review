/* Public application shell. Report materials are returned only after authorization. */
(() => {
  "use strict";
  const API = "https://zajoghykujclawehsikd.supabase.co/functions/v1/iqoko-review-api/";
  const SESSION_KEY = "iqoko-review-session-v1";
  const app = document.getElementById("app");
  let sessionToken = "", identity = null, state = null, freshLink = null, errorText = "", notice = "";
  let frame = null, dirty = false, currentRoute = "", frameVersion = "", documentEpoch = 0, clientSource = "", bridgeSource = "";
  let busy = false, storageAvailable = true, pendingAnchor = ''; 
  const pendingFrameRequests = new Set();
  class ApiError extends Error { constructor(message, status, data) { super(message); this.status = status; this.data = data; } }
  const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
  const date = (value) => new Date(value).toLocaleString("ru-RU", { dateStyle: "medium", timeStyle: "short", timeZone: "Europe/Moscow" });
  const role = (value) => ({ owner: "Управление отчётом", reviewer: "Участник обсуждения", viewer: "Просмотр" }[value] || "Участник");
  const inactive = (person) => person.active === false || Boolean(person.revokedAt);
  function readSession() { try { return sessionStorage.getItem(SESSION_KEY) || ""; } catch { storageAvailable = false; return ""; } }
  function saveSession(value) { sessionToken = value; try { if (value) sessionStorage.setItem(SESSION_KEY, value); else sessionStorage.removeItem(SESSION_KEY); } catch { storageAvailable = false; } }
  async function api(path, options = {}) {
    try {
      const headers = new Headers(options.headers || {});
      if (sessionToken) headers.set("Authorization", `Bearer ${sessionToken}`);
      if (options.body) headers.set("Content-Type", "application/json");
      if (identity?.csrf && options.method && options.method !== "GET") headers.set("X-CSRF-Token", identity.csrf);
      const response = await fetch(API + path, { ...options, headers, cache: "no-store", credentials: "omit", referrerPolicy: "no-referrer" });
      const data = await response.json();
      if (!response.ok) throw new ApiError(data.message || "Не удалось выполнить действие. Повторите попытку.", response.status, data);
      return data;
    } catch (error) { if (error instanceof ApiError) throw error; throw new ApiError("Нет соединения с сервером. Результат действия пока не подтверждён.", 0, null); }
  }
  function post(path, body) { return api(path, { method: "POST", body: JSON.stringify(body) }); }
  async function refreshState() {
    state = await api("state");
    if (identity?.participant.role === "owner") state.participants = (await api("participants")).participants;
  }
  function setMessage(message, success = false) { if (success) { notice = message; errorText = ""; } else { errorText = message; notice = ""; } renderDashboard(); }
  function header() { return `<header class="portal-header"><a class="brand" href="#dashboard" aria-label="IQOKO и ЕКС — кабинет отчёта">IQOKO<span>×</span>ЕКС</a><span class="header-caption">Совместный отчёт · ТЭЦ-25</span>${identity ? '<button class="text-button" data-action="logout">Выйти</button>' : ''}</header>`; }
  function alerts() { return `${errorText ? `<div class="alert error" role="alert">${esc(errorText)}<button class="text-button" data-action="dismiss" aria-label="Закрыть сообщение">×</button></div>` : ''}${notice ? `<div class="alert success" role="status">${esc(notice)}</div>` : ''}${!storageAvailable ? '<div class="alert error">Браузер не разрешает хранить сессию в этой вкладке. После её обновления потребуется снова открыть персональную ссылку.</div>' : ''}`; }
  function invitation() { return freshLink ? `<div class="invitation" role="status"><div class="panel-heading"><h3>Ссылка для ${esc(freshLink.name)}</h3><button class="text-button" data-action="close-invitation">Закрыть</button></div><p>Ссылка показывается только сейчас. Скопируйте её перед закрытием этого блока.</p><div class="copy-row"><input aria-label="Персональная ссылка" value="${esc(freshLink.url)}" readonly><button class="button primary" data-action="copy-link">Скопировать</button></div></div>` : ''; }
  function renderDashboard(anchor = "") {
    frame = null; dirty = false; documentEpoch += 1;
    const owner = identity?.participant.role === "owner";
    const snapshots = owner ? [...(state?.snapshots || [])].sort((a,b) => b.number-a.number) : [];
    const participants = state?.participants || [];
    const comments = state?.comments.filter((item) => item.body.trim() && (owner || item.participantId === identity?.participant.id)) || [];
    app.innerHTML = `<div class="portal">${header()}<main class="portal-main">${alerts()}${!identity ? `<section class="access-panel"><span class="eyebrow">IQOKO × ЕКС</span><h1>Совместное рассмотрение результатов пилота</h1><p>Вход по персональной ссылке, которую предоставил координатор. Откройте эту ссылку, чтобы читать отчёт и оставлять комментарии от своего имени.</p><div class="access-note">Если ссылка перестала действовать, обратитесь к координатору за новой.</div></section>` : `
    <section class="welcome"><div><span class="eyebrow">Рабочие материалы пилота</span><h1>Кабинет совместного отчёта</h1><p>${owner ? "Результаты эксплуатации, комментарии всех участников и редакции для подписания." : "Результаты эксплуатации и ваши комментарии к отчёту."}</p></div><div class="identity-card"><strong>${esc(identity.participant.name)}</strong><span>${esc([identity.participant.title,identity.participant.organization].filter(Boolean).join(" · "))}</span><small>${esc(role(identity.participant.role))}</small></div></section>
    <section class="report-card"><div><span class="eyebrow">Текущая рабочая редакция</span><h2>${esc(state?.report?.title || "Отчёт подготавливается")}</h2><p>${state?.report ? (owner ? "Вам доступны комментарии всех участников. Каждый приглашённый видит только свои комментарии и историю их изменений." : "Ваши комментарии и история изменений доступны вам и владельцу отчёта. Остальные участники их не видят.") : "Координатор добавляет исходные материалы. Доступ к кабинету уже открыт."}</p>${state?.report ? `<div class="report-meta"><span>Редакция ${esc(state.report.version)}</span><span>${owner ? "Всего комментариев" : "Ваших комментариев"}: ${comments.length}</span>${owner ? `<span>${participants.filter(p=>!inactive(p)).length} участников</span>` : ""}</div>` : ''}</div>${state?.report ? '<a class="button primary" href="#report">Открыть отчёт ↗</a>' : ''}</section>
    ${owner ? `<nav class="section-nav" aria-label="Разделы кабинета"><a href="#snapshots">Редакции для печати</a><a href="#participants">Участники и доступ</a></nav>
    <section class="panel" id="snapshots"><div class="panel-heading"><div><span class="eyebrow">Фиксированные редакции</span><h2>Печать и подписание</h2></div><span class="count-label">${snapshots.length}</span></div><p class="section-description">Каждая редакция сохраняет текст, материалы и комментарии на момент фиксации. Изменения рабочего отчёта не меняют уже подготовленный экземпляр. Полные редакции с комментариями всех участников доступны только вам.</p>
    ${snapshots.length ? `<div class="snapshot-list">${snapshots.map(s=>`<article class="snapshot-row"><div class="snapshot-number">${String(s.number).padStart(2,"0")}</div><div class="snapshot-info"><h3>Редакция № ${s.number}</h3><p>${esc(date(s.createdAt))} · исходный отчёт ${esc(s.reportVersion)}</p><small>Для собственноручных подписей участников</small></div><a class="button secondary" href="#print=${encodeURIComponent(s.id)}">Открыть для печати ↗</a></article>`).join('')}</div>` : '<div class="empty-state">Фиксированных редакций пока нет. Координатор подготовит первую после совместного рассмотрения.</div>'}
    ${owner && state?.report ? '<div class="snapshot-create"><h3>Подготовить редакцию для подписания</h3><p>В неё попадут только сохранённые на сервере комментарии. Печатный экземпляр можно сохранить в PDF через диалог печати браузера.</p><label class="checkbox-row"><input type="checkbox" id="checked-contents">Текст отчёта и сохранённые комментарии просмотрены.</label><label class="checkbox-row"><input type="checkbox" id="checked-snapshot">Редакция будет зафиксирована без возможности изменить её содержимое.</label><button class="button primary" id="create-snapshot" data-action="snapshot" disabled>Зафиксировать редакцию</button></div>' : ''}
    <p class="small-note">Сохранение комментария и фиксация редакции не являются электронной подписью или подтверждением согласия участника со всем отчётом.</p></section>` : ''}
    ${owner ? `<section class="panel" id="participants"><div class="panel-heading"><div><span class="eyebrow">Работа участников</span><h2>Участники и персональные ссылки</h2></div><button class="button secondary compact" data-action="export">Экспорт данных</button></div><p class="section-description">Персональная ссылка открывает доступ от имени указанного участника. Передайте её только этому человеку. Приглашённый видит только свои комментарии и историю их изменений; вам как владельцу доступны комментарии всех участников.</p>${invitation()}
    <div class="participant-list">${participants.map(p=>`<article class="participant-row${inactive(p)?' inactive':''}"><div class="avatar" aria-hidden="true">${esc(p.name.split(/\s+/).map(v=>v[0]).slice(0,2).join(''))}</div><div class="participant-info"><h3>${esc(p.name)}</h3><p>${esc([p.title,p.organization].filter(Boolean).join(' · '))}</p><small>${esc(inactive(p)?'Доступ отозван':role(p.role))}</small></div>${p.id!==identity.participant.id && p.role!=="owner" ? `<div class="participant-actions"><button class="text-button" data-action="rotate" data-id="${esc(p.id)}">Новая ссылка</button>${!inactive(p)?`<button class="text-button danger" data-action="revoke" data-id="${esc(p.id)}">Отозвать доступ</button>`:''}</div>`:''}</article>`).join('')}</div>
    <form class="participant-form" id="participant-form"><h3>Добавить участника</h3><div class="form-grid"><label>Имя и фамилия<input name="name" required maxlength="160" autocomplete="off"></label><label>Организация<input name="organization" required maxlength="160" value="ГК ЕКС"></label><label>Должность<input name="title" maxlength="200"></label><label>Доступ<select name="role"><option value="reviewer">Просмотр и свои комментарии</option><option value="viewer">Только просмотр</option></select></label></div><button class="button primary" type="submit">Создать персональную ссылку</button></form></section>`:''}`}</main><footer class="portal-footer"><span>IQOKO (ВНДС) × ГК ЕКС</span><span>Материалы для совместного рассмотрения</span></footer></div>`;
    const form = document.getElementById("participant-form"); if (form) form.addEventListener("submit", (event)=>{ event.preventDefault(); void createParticipant(form); });
    document.querySelectorAll("#checked-contents,#checked-snapshot").forEach(input=>input.addEventListener("change",()=>{ document.getElementById("create-snapshot").disabled=!(document.getElementById("checked-contents").checked&&document.getElementById("checked-snapshot").checked); }));
    const linkField=document.querySelector('.copy-row input'); if(linkField) linkField.addEventListener('focus',()=>linkField.select());
    if(anchor) document.getElementById(anchor)?.scrollIntoView();
  }
  function setBusy(value) { busy=value; document.querySelectorAll('button,form input,form select').forEach(element=>{element.disabled=value;}); }
  async function runAction(action) { if(busy)return; setBusy(true); try {await action();} catch(error){setMessage(error.message);} finally{setBusy(false);} }
  function personalLink(token) { return `${location.origin}${location.pathname}#access=${encodeURIComponent(token)}`; }
  async function createParticipant(form) {
    const values=Object.fromEntries(new FormData(form));
    await runAction(async()=>{const result=await post("participants",values);freshLink={name:values.name,url:personalLink(result.token)};await refreshState();renderDashboard("participants");});
  }
  function confirmAction(title, text, action) {
    const overlay=document.createElement('div');overlay.className='confirm-overlay';overlay.innerHTML=`<div class="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title"><h2 id="confirm-title">${esc(title)}</h2><p>${esc(text)}</p><div class="button-row"><button class="button primary" data-confirm>Подтвердить</button><button class="button secondary" data-cancel>Отмена</button></div></div>`;document.body.append(overlay);
    overlay.querySelector('[data-cancel]').addEventListener('click',()=>overlay.remove());overlay.querySelector('[data-confirm]').addEventListener('click',()=>{overlay.remove();void action();});overlay.querySelector('[data-cancel]').focus();
  }
  async function changeAccess(type,id) { const person=state.participants.find(p=>p.id===id); if(!person)return; confirmAction(type==='rotate'?'Создать новую персональную ссылку':'Отозвать доступ',`${person.name}. ${type==='rotate'?'Предыдущая ссылка перестанет действовать. Новая будет показана один раз.':'Участник больше не сможет открыть отчёт. Сохранённые комментарии останутся в документе.'}`,()=>runAction(async()=>{const result=await post(`participants/${encodeURIComponent(id)}/${type}`,{});if(type==='rotate')freshLink={name:person.name,url:personalLink(result.token)};else{freshLink=null;notice=`Доступ отозван: ${person.name}.`;}await refreshState();renderDashboard('participants');})); }
  async function exportData(){await runAction(async()=>{const data=await api('export');const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const link=document.createElement('a');link.href=url;link.download=`IQOKO_EKS_${new Date().toISOString().slice(0,10)}.json`;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});}
  async function logout(){await runAction(async()=>{await post('logout',{});saveSession('');clearDrafts();identity=null;state=null;freshLink=null;notice='';errorText='';history.replaceState(null,'',location.pathname);currentRoute='';renderDashboard();});}
  function clearDrafts(){try{for(const key of Object.keys(sessionStorage)){if(key.startsWith('iqoko-review-draft:'))sessionStorage.removeItem(key);}}catch{storageAvailable=false;}}
  app.addEventListener('click',(event)=>{const button=event.target.closest('[data-action]');if(!button)return;const action=button.dataset.action;
    if(action==='dismiss'){errorText='';renderDashboard();}
    else if(action==='close-invitation'){freshLink=null;renderDashboard('participants');}
    else if(action==='copy-link'){void(async()=>{try{await navigator.clipboard.writeText(freshLink.url);button.textContent='Скопировано';}catch{setMessage('Не удалось скопировать автоматически. Выделите ссылку и скопируйте вручную.');}})();}
    else if(action==='rotate'||action==='revoke')void changeAccess(action,button.dataset.id);
    else if(action==='export')void exportData();
    else if(action==='logout')void logout();
    else if(action==='snapshot'){if(!(document.getElementById('checked-contents')?.checked&&document.getElementById('checked-snapshot')?.checked))return;void runAction(async()=>{await post('snapshots',{});await refreshState();notice='Редакция зафиксирована. Откройте её для печати и подписания на бумаге.';renderDashboard('snapshots');});}
    else if(action==='print')frame?.contentWindow?.postMessage({type:'iqoko:print'},'*');
    else if(action==='reload-document')void loadDocument(currentRoute);
    else if(action==='report-anchor')frame?.contentWindow?.postMessage({type:'iqoko:scroll',anchor:button.dataset.anchor},'*');
  });
  function draftsFor(version){const result={};try{const prefix=`iqoko-review-draft:${identity.participant.id}:${version}:`;for(const key of Object.keys(sessionStorage)){if(key.startsWith(prefix))result[key]=sessionStorage.getItem(key);}}catch{storageAvailable=false;}return result;}
  async function getPublicScript(name){try{const response=await fetch(new URL(name,location.href),{cache:'no-cache'});if(!response.ok)throw new Error('Не удалось загрузить интерфейс комментариев.');return await response.text();}catch(error){throw new Error(error.message||'Не удалось загрузить интерфейс комментариев.');}}
  function parseRoute(route){const hash=route.replace(/^#/,'');if(hash==='report')return{kind:'report'};if(hash.startsWith('print='))return{kind:'print',snapshot:decodeURIComponent(hash.slice(6))};if(hash.startsWith('viewer=')){const params=new URLSearchParams(hash);return{kind:'viewer',file:params.get('viewer'),version:params.get('version')||state?.report?.version};}return{kind:'dashboard',anchor:['snapshots','participants'].includes(hash)?hash:''};}
  async function loadDocument(route){
    const epoch=++documentEpoch;const parsed=parseRoute(route);frame=null;dirty=false;window.scrollTo(0,0);
    if(parsed.kind==='print' && identity?.participant.role!=='owner'){errorText='Полные редакции для подписания доступны только владельцу отчёта.';history.replaceState(null,'',location.pathname+'#dashboard');currentRoute='#dashboard';renderDashboard();return;}
    app.innerHTML=`<div class="document-shell"><div class="document-tools"><a class="button secondary" href="#dashboard">← Кабинет</a><a class="brand" href="#report">IQOKO<span>×</span>ЕКС</a><span class="document-title">${parsed.kind==='print'?'Сохранённая редакция для подписания':parsed.kind==='viewer'?'Материалы контрольного опыта':'Совместный отчёт'}</span><span class="document-status" role="status"></span><div class="document-actions">${parsed.kind==='viewer'?'<a class="button secondary" href="#report">К отчёту</a>':''}${parsed.kind==='print'?'<button class="button primary" data-action="print" disabled>Печать / PDF</button>':''}<button class="text-button reload-assets" data-action="reload-document">Обновить материалы</button></div></div>${parsed.kind==='report'?`<nav class="document-navigation" aria-label="Разделы отчёта">${[['summary','Итоги'],['operation','Эксплуатация'],['control','Контроль объёма'],['evidence','Подтверждающие материалы'],['order','Задачи приказа'],['order-discussion','Комментарии по приказу'],['decision','Решения']].map(([id,label])=>`<button data-action="report-anchor" data-anchor="${id}">${label}</button>`).join('')}</nav>`:''}<div class="document-progress"><div class="loading-mark" style="margin:0 auto 20px"></div>Загружаем защищённые материалы…</div></div>`;
    try{
      const params=new URLSearchParams();if(parsed.snapshot)params.set('snapshot',parsed.snapshot);if(parsed.file){params.set('file',parsed.file);params.set('path',parsed.file);}if(parsed.version)params.set('version',parsed.version);
      const result=await api(`document${params.size?'?'+params.toString():''}`);
      if(!bridgeSource)bridgeSource=await getPublicScript('document-bridge.js');if(parsed.kind==='report'&&!clientSource)clientSource=await getPublicScript('review-client.js');
      if(epoch!==documentEpoch)return;
      frameVersion=result.reportVersion;
      const data={reportVersion:result.reportVersion,kind:parsed.kind,drafts:draftsFor(result.reportVersion),storageAvailable};
      const parser=new DOMParser();const doc=parser.parseFromString(result.html,'text/html');
      doc.querySelectorAll('meta[http-equiv="Content-Security-Policy"],script[src$="review-client.js"]').forEach(element=>element.remove());
      const ref=doc.createElement('meta');ref.name='referrer';ref.content='no-referrer';doc.head.prepend(ref);
      const config=doc.createElement('script');config.textContent=`window.__IQOKO_FRAME__=${JSON.stringify(data).replace(/</g,'\\u003c')};window.__IQOKO_REPORT_VERSION__=window.__IQOKO_FRAME__.reportVersion;`;doc.head.prepend(config);
      const bridge=doc.createElement('script');bridge.textContent=bridgeSource;doc.body.append(bridge);
      if(parsed.kind==='report'){const client=doc.createElement('script');client.textContent=clientSource;doc.body.append(client);}
      const style=doc.createElement('style');style.textContent='.topbar,.toolbar{display:none!important}html,body{min-height:0!important}.srv-global{margin-top:18px!important}@media print{html,body{height:auto!important;overflow:visible!important}}';doc.head.append(style);
      frame=document.createElement('iframe');frame.className='document-frame'+(parsed.kind==='report'?' working-frame':'');frame.title=parsed.kind==='print'?'Сохранённая редакция отчёта':'Совместный отчёт IQOKO и ЕКС';frame.setAttribute('sandbox','allow-scripts allow-modals allow-popups allow-popups-to-escape-sandbox allow-downloads');frame.referrerPolicy='no-referrer';
      frame.srcdoc='<!doctype html>\n'+doc.documentElement.outerHTML;app.querySelector('.document-progress').replaceWith(frame);
      app.querySelector('[data-action="print"]')?.removeAttribute('disabled');
      if(pendingAnchor){const anchor=pendingAnchor;pendingAnchor='';frame.addEventListener('load',()=>{setTimeout(()=>frame?.contentWindow?.postMessage({type:'iqoko:scroll',anchor},'*'),300);},{once:true});}
    }catch(error){if(epoch!==documentEpoch)return;const target=app.querySelector('.document-progress');if(target)target.outerHTML=`<div class="frame-error" role="alert"><p>${esc(error.message)}</p><button class="button secondary" data-action="reload-document">Повторить загрузку</button>${error.status===401?'<p class="logout-note">Откройте персональную ссылку для повторного входа.</p>':''}</div>`;}
  }
  const allowedRequest=(path,method)=>{
    if((method==='GET'||!method)&&path.startsWith('asset-url?')){const params=new URLSearchParams(path.slice(10));return params.get('version')===frameVersion&&typeof params.get('path')==='string'&&params.get('path').length<1000;}
    return ((method==='GET'||!method)&&(/^(me|state)$/.test(path)||/^history\/[a-z0-9-]+$/.test(path)))||(method==='PUT'&&/^comments\/[a-z0-9-]+$/.test(path));
  };
  function openDocumentTab(file,version){
    let popup=null;
    try{
      const url=new URL(location.pathname,location.origin);
      url.hash=new URLSearchParams({viewer:file,version}).toString();
      popup=window.open('about:blank','_blank');
      if(!popup)throw new Error('Браузер ограничил открытие новой вкладки. Разрешите открытие вкладок для этого сайта.');
      // Initialize only our own same-origin blank tab, before loading the application.
      // Neither the personal link nor the session credential is put in the URL or viewer.
      popup.opener=null;
      popup.sessionStorage.clear();
      popup.sessionStorage.setItem(SESSION_KEY,sessionToken);
      popup.location.replace(url.href);
      app.querySelector('[data-document-tab-notice]')?.remove();
    }catch(error){
      if(popup&&!popup.closed)popup.close();
      app.querySelector('[data-document-tab-notice]')?.remove();
      const note=document.createElement('div');note.className='route-notice';note.dataset.documentTabNotice='';note.setAttribute('role','alert');
      note.append(`${error.message||'Не удалось открыть защищённый материал в новой вкладке.'} `);
      const retry=document.createElement('button');retry.type='button';retry.className='text-button';retry.textContent='Открыть материал в новой вкладке';retry.addEventListener('click',()=>openDocumentTab(file,version));note.append(retry);
      app.querySelector('.document-tools')?.after(note);
    }
  }
  window.addEventListener('message',(event)=>{
    if(!frame||event.source!==frame.contentWindow||event.origin!=='null')return;const message=event.data;if(!message||typeof message!=='object')return;
    if(message.type==='iqoko:request'){
      const path=message.path,method=message.options?.method||'GET';if(typeof message.id!=='string'||typeof path!=='string'||!allowedRequest(path,method)||pendingFrameRequests.has(message.id))return;
      const target=event.source;pendingFrameRequests.add(message.id);void(async()=>{try{const value=await api(path,{method,...(method==='PUT'?{body:message.options.body}:{})});target.postMessage({type:'iqoko:response',id:message.id,value},'*');}catch(error){target.postMessage({type:'iqoko:response',id:message.id,error:{message:error.message,status:error.status||0,data:error.data}},'*');}finally{pendingFrameRequests.delete(message.id);}})();
    }else if(message.type==='iqoko:open-asset'&&typeof message.path==='string'&&message.path.length<1000){
      const popup=window.open('about:blank','_blank');if(popup){popup.opener=null;try{popup.document.title='Открываем вложение';popup.document.body.textContent='Открываем защищённое вложение…';}catch{ /* The fresh URL can still replace this window. */ }}
      void(async()=>{try{
        const params=new URLSearchParams({version:frameVersion,path:message.path});const result=await api('asset-url?'+params.toString());const url=new URL(result.url);if(url.protocol!=='https:')throw new Error('Недопустимый адрес вложения.');if(typeof message.anchor==='string')url.hash=message.anchor;
        if(popup&&!popup.closed)popup.location.replace(url.href);
        else{const note=document.createElement('div');note.className='route-notice';note.append('Браузер ограничил открытие новой вкладки. ');const link=document.createElement('a');link.href=url.href;link.target='_blank';link.rel='noopener noreferrer';link.textContent='Открыть вложение';note.append(link);app.querySelector('.document-tools').after(note);}
      }catch(error){if(popup&&!popup.closed)popup.close();const note=document.createElement('div');note.className='route-notice';note.setAttribute('role','alert');note.textContent=error.message;app.querySelector('.document-tools')?.after(note);}})();
    }else if(message.type==='iqoko:height'&&Number.isFinite(message.height)&&!frame.classList.contains('working-frame'))frame.style.height=`${Math.max(300,Math.min(message.height,250000))}px`;
    else if(message.type==='iqoko:scroll-position'&&Number.isFinite(message.top))window.scrollTo({top:window.scrollY+frame.getBoundingClientRect().top+message.top-112,behavior:'smooth'});
    else if(message.type==='iqoko:dirty'){dirty=Boolean(message.dirty);const status=app.querySelector('.document-status');if(status)status.textContent=dirty?'Есть несохранённые изменения':'Комментарии сохраняются на сервере';}
    else if(message.type==='iqoko:navigate'){
      if(message.route==='dashboard')location.hash=identity?.participant.role==='owner'?'snapshots':'dashboard';else if(message.route==='report'){pendingAnchor=typeof message.anchor==='string'?message.anchor.replace(/^#/,''):'';location.hash='report';}else if(message.route==='viewer'&&typeof message.file==='string'&&message.file.length<1000)openDocumentTab(message.file,frameVersion);
    }else if(message.type==='iqoko:draft'&&typeof message.key==='string'){
      const prefix=`iqoko-review-draft:${identity.participant.id}:${frameVersion}:`;if(!message.key.startsWith(prefix))return;try{if(message.value===null)sessionStorage.removeItem(message.key);else if(typeof message.value==='string'&&message.value.length<24000)sessionStorage.setItem(message.key,message.value);}catch{storageAvailable=false;event.source.postMessage({type:'iqoko:storage-unavailable'},'*');}
    }
  });
  async function applyRoute(next){currentRoute=next;const parsed=parseRoute(next);if(!identity){renderDashboard();return;}if(parsed.kind==='dashboard'){try{await refreshState();}catch(error){errorText=error.message;}renderDashboard(parsed.anchor);}else await loadDocument(next);}
  window.addEventListener('hashchange',()=>{const next=location.hash;const incoming=new URLSearchParams(next.slice(1)).get('access');if(incoming){history.replaceState(null,'',location.pathname);const enter=async()=>{try{const result=await api('login',{method:'POST',body:JSON.stringify({token:incoming})});saveSession(result.sessionToken);identity={participant:result.participant,csrf:result.csrf};errorText='';notice='';freshLink=null;dirty=false;await applyRoute('');}catch(error){setMessage(error.message);}};if(dirty)confirmAction('Открыть другую персональную ссылку','Есть несохранённые комментарии. Они останутся локальным черновиком для прежнего участника.',enter);else void enter();return;}if(next===currentRoute)return;if(dirty){history.replaceState(null,'',location.pathname+currentRoute);confirmAction('Есть несохранённые комментарии','Если перейти сейчас, текст останется локальным черновиком в этой вкладке. Дождитесь сохранения либо подтвердите переход.',async()=>{dirty=false;history.replaceState(null,'',location.pathname+next);await applyRoute(next);});return;}void applyRoute(next);});
  window.addEventListener('beforeunload',(event)=>{if(dirty){event.preventDefault();event.returnValue='';}});
  async function init(){
    let usedLink=false;
    // Remove the personal credential before any network request or report rendering.
    const fragment=new URLSearchParams(location.hash.slice(1));const token=fragment.get('access');if(token){usedLink=true;history.replaceState(null,'',location.pathname+location.search);}
    sessionToken=readSession();
    try{if(token){const result=await api('login',{method:'POST',body:JSON.stringify({token})});saveSession(result.sessionToken);identity={participant:result.participant,csrf:result.csrf};}if(!sessionToken){renderDashboard();return;}identity=await api('me');await refreshState();await applyRoute(location.hash);}catch(error){if(error.status===401){saveSession('');identity=null;if(usedLink)errorText='Персональная ссылка недействительна или отозвана. Обратитесь к координатору за новой.';}else errorText=error.message;renderDashboard();}
  }
  void init();
})();
