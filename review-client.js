/* Participant-scoped report comments. Personal access tokens are never stored here. */
(() => {
  "use strict";
  const draftStore = window.__IQOKO_FRAME__?.drafts || {};
  const blocks = [];
  let identity = null;
  let reportVersion = "";
  let comments = [];
  let allCommentsVisible = false;
  let staleReport = false;
  let storageWarning = false;
  let connectionWarning = "";
  let statusText = null;

  class RequestError extends Error {
    constructor(message, status, data) { super(message); this.status = status; this.data = data; }
  }
  async function request(path, options = {}) {
    try { return await window.IQOKOBridge.request(path, options); }
    catch (error) { throw new RequestError(error.message, error.status || 0, error.data || null); }
  }
  function node(tag, className, text) {
    const element = document.createElement(tag);
    if (className) element.className = className;
    if (text !== undefined) element.textContent = text;
    return element;
  }
  function button(text, action, className = "") {
    const element = node("button", "srv-button " + className, text); element.type = "button";
    element.addEventListener("click", action); return element;
  }
  function readableDate(value) {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : date.toLocaleString("ru-RU", { dateStyle: "short", timeStyle: "short", timeZone: "Europe/Moscow" });
  }
  function visibleComments(records) { return allCommentsVisible ? records : records.filter((comment) => comment.participantId === identity.participant.id); }
  function draftKey(block) { return `iqoko-review-draft:${identity.participant.id}:${reportVersion}:${block.id}`; }
  function getDraft(block) {
    try {
      const raw = draftStore[draftKey(block)];
      if (!raw) return null;
      const draft = JSON.parse(raw);
      return typeof draft.body === "string" && Number.isInteger(draft.baseRevision) ? draft : null;
    } catch { storageWarning = true; return null; }
  }
  function writeDraft(block) {
    if (!block.textarea) return;
    try { const key=draftKey(block); const value=JSON.stringify({ body: block.textarea.value, baseRevision: block.revision, updatedAt: new Date().toISOString() }); draftStore[key]=value; window.IQOKOBridge.draft(key,value); }
    catch { storageWarning = true; }
  }
  function clearDraft(block) {
    try { const key=draftKey(block); delete draftStore[key]; window.IQOKOBridge.draft(key,null); } catch { storageWarning = true; }
  }
  function dirty(block) { return Boolean(block.saving || block.conflict || block.recovery || (block.textarea && block.textarea.value !== block.savedBody)); }
  function updateStatus() {
    if (!statusText) return;
    const pending = blocks.filter(dirty).length;
    window.IQOKOBridge.dirty(pending > 0);
    if (staleReport) statusText.textContent = "Появилась новая редакция отчёта. Ваш несохранённый текст оставлен в этой вкладке; перед переносом откройте новую редакцию.";
    else if (blocks.some((block) => block.conflict)) statusText.textContent = "Есть разные редакции комментария. Выберите, какой текст сохранить, в отмеченном разделе.";
    else if (blocks.some((block) => block.failed)) statusText.textContent = "Не все комментарии сохранены. Текст остаётся в этой вкладке; повторите сохранение в отмеченном разделе.";
    else if (pending) statusText.textContent = `Несохранённые изменения: ${pending}. Дождитесь подтверждения сохранения.`;
    else if (connectionWarning) statusText.textContent = connectionWarning;
    else statusText.textContent = allCommentsVisible ? "Вам доступны комментарии всех участников. Изменения сохраняются автоматически." : identity?.participant.role === "viewer" ? "Вы видите только свои сохранённые комментарии. Ваш доступ — только просмотр." : "Ваши комментарии видны только вам и владельцу отчёта. Изменения сохраняются автоматически.";
    if (storageWarning) statusText.textContent += " Локальная копия недоступна: не закрывайте вкладку до подтверждения сохранения.";
    statusText.parentElement.dataset.pending = pending ? "true" : "false";
  }
  function setBlockStatus(block, text, kind = "") {
    block.status.textContent = text; block.status.dataset.kind = kind;
    if (block.saveButton) block.saveButton.disabled = block.saving || staleReport || Boolean(block.conflict) || block.textarea.value === block.savedBody;
    updateStatus();
  }
  function commentNode(comment) {
    const article = node("article", "srv-comment");
    const header = node("div", "srv-comment-head"); header.append(node("strong", "", comment.name));
    header.append(node("span", "", readableDate(comment.updatedAt))); article.append(header);
    article.append(node("small", "srv-affiliation", [comment.title, comment.organization].filter(Boolean).join(" · ")));
    article.append(node("p", "srv-comment-body", comment.body || "Комментарий очищен.")); return article;
  }
  function renderOthers(block) {
    block.others.replaceChildren();
    const others = comments.filter((comment) => comment.thesisId === block.id && comment.body.trim() && (!block.textarea || comment.participantId !== identity.participant.id));
    if (!others.length && (allCommentsVisible || !block.textarea)) block.others.append(node("p", "srv-empty", allCommentsVisible ? "Комментариев других участников пока нет." : "Ваших сохранённых комментариев к этому разделу пока нет."));
    else others.forEach((comment) => block.others.append(commentNode(comment)));
  }
  function updateComment(comment, block) {
    comments = comments.filter((item) => !(item.thesisId === block.id && item.participantId === identity.participant.id));
    if (comment) comments.push(comment);
  }
  function clearRecovery(block) { block.recovery = null; block.recoveryPanel.replaceChildren(); }
  function adoptServer(block, current) {
    clearTimeout(block.timer); block.conflict = null; block.conflictPanel.replaceChildren(); clearRecovery(block);
    block.revision = current ? current.revision : 0; block.savedBody = current ? current.body : "";
    block.textarea.value = block.savedBody; block.failed = false; block.intent = null; clearDraft(block);
    updateComment(current, block); setBlockStatus(block, "Сохранено на сервере", "saved");
  }
  function showConflict(block, current) {
    clearTimeout(block.timer); block.conflict = { current }; block.failed = false;
    block.conflictPanel.replaceChildren();
    const panel = node("div", "srv-conflict"); panel.append(node("strong", "", "Комментарий изменён в другой вкладке или устройстве"));
    panel.append(node("p", "", "На сервере сохранена другая редакция вашего комментария. Оба текста доступны ниже; автоматическое сохранение приостановлено."));
    const columns = node("div", "srv-conflict-columns");
    const saved = node("div"); saved.append(node("small", "", "Сохранено на сервере"), node("pre", "", current?.body || "Комментарий пуст."));
    const local = node("div"); local.append(node("small", "", "Ваш текст в этой вкладке")); block.localConflictText = node("pre", "", block.textarea.value); local.append(block.localConflictText); columns.append(saved, local); panel.append(columns);
    const actions = node("div", "srv-actions");
    actions.append(button("Оставить серверный текст", () => adoptServer(block, block.conflict.current)));
    actions.append(button("Сохранить мой текст вместо серверного", () => {
      const latest = block.conflict.current; block.revision = latest?.revision || 0; block.savedBody = latest?.body || "";
      block.conflict = null; block.conflictPanel.replaceChildren(); clearRecovery(block); block.intent = null; writeDraft(block); void save(block);
    }, "srv-primary"));
    panel.append(actions); block.conflictPanel.append(panel); setBlockStatus(block, "Выберите редакцию", "conflict");
  }
  function showRecovery(block, draft, current) {
    if (draft.body === block.savedBody) { clearDraft(block); return; }
    block.recovery = draft;
    const panel = node("div", "srv-recovery"); panel.append(node("strong", "", "В этой вкладке остался несохранённый черновик"));
    panel.append(node("p", "", "Сначала загружен текст с сервера. Локальная копия не заменяет его автоматически."));
    const details = node("details"); details.append(node("summary", "", "Посмотреть локальный черновик"), node("pre", "", draft.body)); panel.append(details);
    const actions = node("div", "srv-actions");
    actions.append(button("Восстановить в поле", () => {
      block.textarea.value = draft.body; clearRecovery(block);
      if (draft.baseRevision !== block.revision) { block.revision = draft.baseRevision; writeDraft(block); showConflict(block, current); }
      else { writeDraft(block); setBlockStatus(block, "Черновик восстановлен — нажмите «Сохранить»", "pending"); }
    }, "srv-primary"));
    actions.append(button("Удалить локальный черновик", () => { clearRecovery(block); clearDraft(block); setBlockStatus(block, "Сохранено на сервере", "saved"); }));
    panel.append(actions); block.recoveryPanel.append(panel); updateStatus();
  }
  async function save(block) {
    if (!block.textarea || block.saving || block.conflict || staleReport) return;
    const body = block.textarea.value;
    if (body === block.savedBody) { block.failed = false; clearDraft(block); setBlockStatus(block, "Сохранено на сервере", "saved"); return; }
    if (body.length > 20000) { block.failed = true; setBlockStatus(block, "Не сохранено: максимум 20 000 знаков", "error"); return; }
    if (!block.intent || block.intent.body !== body || block.intent.expectedRevision !== block.revision) block.intent = { body, expectedRevision: block.revision, requestId: crypto.randomUUID() };
    const intent = block.intent; block.saving = true; block.failed = false; setBlockStatus(block, "Сохраняется…", "pending");
    try {
      const result = await request(`comments/${encodeURIComponent(block.id)}`, { method: "PUT", headers: { "Content-Type": "application/json", "X-CSRF-Token": identity.csrf }, body: JSON.stringify({ ...intent, reportVersion }) });
      const saved = result.comment; block.revision = saved.revision; block.savedBody = saved.body; updateComment(saved, block); block.intent = null; clearRecovery(block);
      if (block.textarea.value === body) { block.textarea.value = saved.body; clearDraft(block); }
      else writeDraft(block);
      block.saving = false; setBlockStatus(block, block.textarea.value === block.savedBody ? "Сохранено" : "Есть новые изменения…", "saved");
      if (block.textarea.value !== block.savedBody) block.timer = setTimeout(() => void save(block), 500);
    } catch (error) {
      block.saving = false;
      if (error.status === 409 && error.data?.error === "report_changed") {
        staleReport = true; blocks.forEach((item) => { if (item.textarea) item.textarea.readOnly = true; if (item.saveButton) item.saveButton.disabled = true; });
        block.failed = true; setBlockStatus(block, "Отчёт обновлён. Текст сохранён локально в этой вкладке.", "error");
      }
      else if (error.status === 409 && error.data?.error === "revision_conflict") showConflict(block, error.data.current || null);
      else { block.failed = true; setBlockStatus(block, error.status === 401 ? "Сессия завершена. Откройте кабинет для входа; текст сохранён в этой вкладке." : error.message, "error"); }
    }
  }
  async function loadHistory(block) {
    const expanded = block.historyButton.getAttribute("aria-expanded") === "true";
    block.historyButton.setAttribute("aria-expanded", String(!expanded)); block.historyPanel.hidden = expanded;
    if (expanded) return;
    block.historyPanel.replaceChildren(node("p", "srv-empty", "Загружаем историю…"));
    try {
      const data = await request(`history/${encodeURIComponent(block.id)}`); block.historyPanel.replaceChildren();
      const history = visibleComments(data.history);
      if (!history.length) block.historyPanel.append(node("p", "srv-empty", allCommentsVisible ? "История комментариев пока пуста." : "История ваших комментариев пока пуста."));
      else history.forEach((comment) => { const item = commentNode(comment); item.prepend(node("small", "srv-history-revision", `Изменение № ${comment.revision}`)); block.historyPanel.append(item); });
    } catch (error) { block.historyPanel.replaceChildren(node("p", "srv-error-text", error.message)); }
  }
  function buildBlock(element) {
    const id = element.dataset.review; const block = { id, element, timer: null, saving: false, failed: false, conflict: null, recovery: null, revision: 0, savedBody: "", intent: null, textarea: null };
    element.replaceChildren(); element.classList.add("srv-review");
    const head = node("div", "srv-heading"); head.append(node("strong", "", allCommentsVisible ? "Дополнения и комментарии участников" : "Ваши дополнения и комментарии"));
    block.status = node("span", "srv-save-status", ""); block.status.setAttribute("role", "status"); head.append(block.status); element.append(head);
    block.others = node("div", "srv-comments"); element.append(block.others);
    block.recoveryPanel = node("div"); block.conflictPanel = node("div"); element.append(block.recoveryPanel);
    const own = comments.find((comment) => comment.thesisId === id && comment.participantId === identity.participant.id);
    if (identity.participant.role !== "viewer") {
      const editor = node("div", "srv-editor");
      const author = node("div", "srv-author"); author.append(node("strong", "", identity.participant.name), node("small", "", [identity.participant.title, identity.participant.organization].filter(Boolean).join(" · "))); editor.append(author);
      const label = node("label", "srv-label", "Ваше дополнение или комментарий"); label.htmlFor = `server-comment-${id}`;
      const textarea = node("textarea", "srv-textarea"); textarea.id = label.htmlFor; textarea.rows = 3; textarea.maxLength = 20000; textarea.placeholder = "Дополнение или комментарий к разделу"; block.textarea = textarea;
      block.revision = own?.revision || 0; block.savedBody = own?.body || ""; textarea.value = block.savedBody; textarea.readOnly = staleReport;
      textarea.addEventListener("input", () => {
        clearRecovery(block); block.failed = false; writeDraft(block); clearTimeout(block.timer);
        if (block.conflict) { block.localConflictText.textContent = textarea.value; updateStatus(); return; }
        setBlockStatus(block, "Есть изменения…", "pending"); block.timer = setTimeout(() => void save(block), 500);
      });
      editor.append(label, textarea); const actions = node("div", "srv-actions"); block.saveButton = button("Сохранить комментарий", () => { clearTimeout(block.timer); void save(block); }, "srv-primary"); actions.append(block.saveButton, node("small", "", "Сохраняется автоматически после ввода")); editor.append(actions); element.append(editor, block.conflictPanel);
      const draft = getDraft(block); if (draft) showRecovery(block, draft, own || null);
      setBlockStatus(block, block.recovery ? "Есть локальный черновик" : own ? "Сохранено на сервере" : "", block.recovery ? "pending" : "saved");
    } else { block.status.textContent = "Доступ для просмотра"; }
    const footer = node("div", "srv-block-footer"); block.historyButton = button(allCommentsVisible ? "История комментариев" : "История ваших комментариев", () => void loadHistory(block)); block.historyButton.setAttribute("aria-expanded", "false"); footer.append(block.historyButton); element.append(footer);
    block.historyPanel = node("div", "srv-history"); block.historyPanel.hidden = true; element.append(block.historyPanel);
    renderOthers(block); blocks.push(block);
  }
  async function refresh() {
    if (document.hidden || blocks.some((block) => block.saving)) return;
    try {
      const state = await request("state"); connectionWarning = "";
      if (state.report?.version !== reportVersion) { staleReport = true; blocks.forEach((block) => { if (block.textarea) block.textarea.readOnly = true; if (block.saveButton) block.saveButton.disabled = true; }); updateStatus(); return; }
      allCommentsVisible = identity.participant.role === "owner" && state.commentVisibility === "all"; comments = visibleComments(state.comments);
      blocks.forEach((block) => {
        renderOthers(block); if (!block.textarea || block.conflict || block.recovery) return;
        const current = comments.find((comment) => comment.thesisId === block.id && comment.participantId === identity.participant.id) || null;
        if ((current?.revision || 0) === block.revision) return;
        if (block.textarea.value !== block.savedBody) showConflict(block, current);
        else adoptServer(block, current);
      });
    } catch (error) { connectionWarning = error.status === 401 ? "Сессия завершена. Откройте кабинет для повторного входа." : "Обновление комментариев временно недоступно. Показаны последние загруженные данные."; }
    updateStatus();
  }
  function injectStyle() {
    const style = node("style"); style.textContent = `
.srv-global{max-width:1120px;margin:82px auto 18px;padding:12px 18px;background:#edf5f2;border:1px solid #d3e2dc;border-radius:8px;display:flex;align-items:center;justify-content:space-between;gap:18px;color:#416967;font:12px/1.5 Arial,sans-serif}.srv-global[data-pending=true]{background:#fff5e9;border-color:#e7d2b8;color:#8f5e2b}.srv-global a{white-space:nowrap;color:#276f70}.srv-review{background:#f5f9f7!important;border:1px solid #d6e4de!important;border-left:3px solid #276f70!important;padding:17px!important;break-inside:avoid}.srv-heading{display:flex;align-items:center;justify-content:space-between;gap:15px;margin-bottom:10px;font-size:13px}.srv-save-status{font-size:11px;font-weight:400;max-width:50%;color:#4e7d6a;text-align:right}.srv-save-status[data-kind=error],.srv-save-status[data-kind=conflict]{color:#ac4c27}.srv-save-status[data-kind=pending]{color:#9a743b}.srv-empty{font-size:12px;color:#7a8c8b;margin:10px 0!important}.srv-comments{display:grid;gap:9px}.srv-comment{padding:12px 14px;border:1px solid #dde7e2;border-radius:6px;background:#fff;min-width:0}.srv-comment-head{display:flex;gap:15px;align-items:start;justify-content:space-between;font-size:12px}.srv-comment-head>span{color:#7d8e8d;font-size:10px;white-space:nowrap}.srv-affiliation{display:block;font-size:10px;color:#7a8b8a;margin-top:2px}.srv-comment-body{white-space:pre-wrap;overflow-wrap:anywhere;color:#344d52;font:13px/1.6 Arial,sans-serif;margin:9px 0 0!important}.srv-editor{border-top:1px solid #dce7e2;margin-top:16px;padding-top:14px}.srv-author{display:flex;align-items:baseline;flex-wrap:wrap;gap:6px 12px;margin-bottom:13px;color:#345c60;font-size:12px}.srv-author small{font-size:10px;color:#738887}.srv-label{display:block!important;font-size:11px;color:#607a79;margin-bottom:5px}.srv-textarea{display:block;width:100%;min-height:90px;resize:vertical;border:1px solid #c7d9d2;border-radius:5px;padding:11px 12px;background:white;color:#29464e;font:13px/1.6 Arial,sans-serif}.srv-textarea:focus{outline:2px solid #a0c5bd;outline-offset:1px}.srv-textarea:disabled{background:#edf1ef}.srv-actions{display:flex;gap:10px;flex-wrap:wrap;align-items:center;margin-top:9px}.srv-actions small{color:#7b8d89;font-size:10px}.srv-button{display:inline-block!important;border:1px solid #c8dbd3!important;border-radius:5px!important;background:white!important;color:#3d6664!important;font:11px/1.4 Arial,sans-serif!important;padding:7px 11px!important;cursor:pointer}.srv-button.srv-primary{background:#276f70!important;border-color:#276f70!important;color:white!important}.srv-button:disabled{opacity:.45;cursor:default}.srv-button:focus-visible{outline:2px solid #bc551f;outline-offset:3px}.srv-block-footer{display:flex;justify-content:flex-end;margin-top:12px}.srv-history{display:grid;gap:8px;border-top:1px dashed #d0dfd8;margin-top:12px;padding-top:12px}.srv-history[hidden]{display:none}.srv-history-revision{display:block;color:#73857e;font-size:10px;margin-bottom:5px}.srv-conflict,.srv-recovery{background:#fff6eb;border:1px solid #ead7bb;border-radius:6px;padding:15px;margin-top:12px;color:#785b37;font:12px/1.55 Arial,sans-serif}.srv-conflict p,.srv-recovery p{font-size:12px;margin:7px 0!important;color:#806e56}.srv-conflict-columns{display:grid;grid-template-columns:1fr 1fr;gap:12px}.srv-conflict pre,.srv-recovery pre{font:12px/1.6 Arial,sans-serif;white-space:pre-wrap;overflow-wrap:anywhere;background:white;border:1px solid #eadfce;padding:10px;max-height:220px;overflow:auto;margin:7px 0}.srv-conflict-columns>div{min-width:0}.srv-recovery details{border:0!important;background:transparent!important}.srv-recovery summary{padding:5px 0!important;font-size:12px}.srv-error-text{color:#a94a25;font-size:12px}.srv-initial-error{padding:15px;color:#9c4b2d;background:#fff2e9;font:13px/1.6 Arial,sans-serif}
@media(max-width:700px){.srv-global{margin:78px 14px 18px;align-items:flex-start;flex-direction:column;gap:6px}.srv-heading{align-items:flex-start;flex-direction:column;gap:5px}.srv-save-status{max-width:100%;text-align:left}.srv-conflict-columns{grid-template-columns:1fr}.srv-comment-head{flex-wrap:wrap;gap:3px 12px}.srv-review{padding:13px!important}}
@media print{.srv-global,.srv-editor,.srv-block-footer,.srv-history,.srv-conflict,.srv-recovery,.srv-save-status{display:none!important}.srv-review{background:white!important;border-color:#ddd!important}.srv-comment{break-inside:avoid}.srv-comment-body{font-size:10pt}}
`; document.head.append(style);
  }
  async function init() {
    const elements = Array.from(document.querySelectorAll("[data-review]")); if (!elements.length) return;
    injectStyle();
    storageWarning=window.__IQOKO_FRAME__?.storageAvailable === false;
    window.addEventListener("iqoko-storage-unavailable",()=>{storageWarning=true;updateStatus();});
    elements.forEach((element) => { element.replaceChildren(node("p", "srv-empty", "Загружаем комментарии…")); });
    try {
      identity = await request("me"); const state = await request("state"); allCommentsVisible = identity.participant.role === "owner" && state.commentVisibility === "all"; comments = visibleComments(state.comments);
      reportVersion = window.__IQOKO_REPORT_VERSION__ || state.report?.version || "";
      staleReport = reportVersion !== state.report?.version;
      const global = node("div", "srv-global"); statusText = node("span"); statusText.setAttribute("role", "status"); global.append(statusText);
      const link = node("a", "", identity.participant.role === "owner" ? "Кабинет и редакции для печати ↗" : "Кабинет ↗"); link.href = "#review-dashboard"; global.append(link);
      const activeLink = node("a", "", "Текущая редакция ↗"); activeLink.href = "#review-report";  activeLink.rel = "noopener"; global.append(activeLink);
      const main = document.querySelector("main"); if (main) main.before(global); else document.body.prepend(global);
      elements.forEach(buildBlock); updateStatus();
      window.addEventListener("beforeunload", (event) => { if (blocks.some(dirty)) { event.preventDefault(); event.returnValue = ""; } });
      window.addEventListener("online", () => { void refresh(); blocks.forEach((block) => { if (block.failed && !block.conflict) void save(block); }); });
      document.addEventListener("visibilitychange", () => { if (!document.hidden) void refresh(); });
      window.setInterval(() => void refresh(), 30000);
    } catch (error) {
      elements.forEach((element) => { element.replaceChildren(node("p", "srv-initial-error", error.status === 401 ? "Для комментариев необходимо войти по персональной ссылке." : error.message)); const link = node("a", "", "Открыть кабинет"); link.href = "#review-dashboard"; element.append(link); });
    }
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => void init(), { once: true }); else void init();
})();
