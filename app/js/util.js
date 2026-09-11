/* 工具函数 */
'use strict';

function $(sel, root) { return (root || document).querySelector(sel); }
function $$(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function debounce(fn, ms) {
  let t = null;
  return function () {
    const args = arguments, self = this;
    clearTimeout(t);
    t = setTimeout(() => fn.apply(self, args), ms);
  };
}

function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function fmtTime(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* 提示条。live region 必须在内容插入**之前**就存在于 DOM 里,否则读屏不会播报
   ——所以这里在首次使用时把容器建好并标注 role/aria-live,而不是每次新建容器。 */
function ensureToastBox() {
  let box = $('#toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    box.setAttribute('role', 'status');
    box.setAttribute('aria-live', 'polite');
    box.setAttribute('aria-atomic', 'false');
    document.body.appendChild(box);
  }
  return box;
}

function toast(msg, type) {
  const box = ensureToastBox();
  const t = document.createElement('div');
  t.className = 'toast ' + (type || '');
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => { t.classList.add('show'); }, 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 400); }, 2600);
}

function download(filename, text, mime) {
  const blob = new Blob([text], { type: (mime || 'application/json') + ';charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 200);
}

/* 打开本地文件(返回 Promise<{name, text}>) */
function openFileText(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) { reject(new Error('未选择文件')); return; }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: f.name, text: String(reader.result || ''), file: f });
      reader.onerror = () => reject(new Error('读取失败'));
      reader.readAsText(f, 'utf-8');
    };
    input.click();
  });
}

/* 选择文件但不读取内容(返回 Promise<File>),用于二进制文件(如 PDF)按需打开 */
function openFileAny(accept) {
  return new Promise((resolve, reject) => {
    const input = document.createElement('input');
    input.type = 'file';
    if (accept) input.accept = accept;
    input.onchange = () => {
      const f = input.files && input.files[0];
      if (!f) { reject(new Error('未选择文件')); return; }
      resolve(f);
    };
    input.click();
  });
}

/* 解析 hash 路由: #/study/PY-001 -> {view:'study', parts:['PY-001'], query:{}} */
function parseHash() {
  let h = location.hash || '#/home';
  if (h.charAt(0) === '#') h = h.slice(1);
  if (h.charAt(0) === '/') h = h.slice(1);
  const qIdx = h.indexOf('?');
  let query = {};
  if (qIdx >= 0) {
    const qs = new URLSearchParams(h.slice(qIdx + 1));
    qs.forEach((v, k) => { query[k] = v; });
    h = h.slice(0, qIdx);
  }
  const parts = h.split('/').filter(Boolean).map(decodeURIComponent);
  return { view: parts[0] || 'home', parts: parts.slice(1), query };
}

function go(hash) {
  if (location.hash === hash) {
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else {
    location.hash = hash;
  }
}

/* 对话框。键盘可用的四件事缺一不可:
   ① 打开时把焦点送进对话框(否则读屏与键盘用户还停在背景页面);
   ② Tab 在对话框内循环(不用把整个背景页面一串按钮都 Tab 一遍);
   ③ Esc 可关闭;
   ④ 关闭后焦点回到打开它的那个按钮(否则焦点掉到 body,后续 Tab 从头开始)。 */
let modalSeq = 0;
let modalReturnFocus = null;

function modal(title, bodyHtml, buttons) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  const titleId = 'modal-title-' + (++modalSeq);
  wrap.innerHTML = `
    <div class="modal" role="dialog" aria-modal="true" aria-labelledby="${titleId}">
      <div class="modal-head"><strong id="${titleId}">${esc(title)}</strong><button class="icon-btn" data-close aria-label="关闭" title="关闭">✕</button></div>
      <div class="modal-body">${bodyHtml}</div>
      <div class="modal-foot"></div>
    </div>`;
  const foot = $('.modal-foot', wrap);
  (buttons || []).forEach(b => {
    const btn = document.createElement('button');
    btn.className = 'btn ' + (b.primary ? 'btn-primary ' : '') + (b.danger ? 'btn-danger' : '');
    btn.textContent = b.label;
    btn.onclick = () => { if (!b.onClick || b.onClick(wrap) !== false) closeModal(wrap); };
    foot.appendChild(btn);
  });
  function closeModal(w) {
    document.removeEventListener('keydown', onKey, true);
    w.remove();
    const back = modalReturnFocus;
    modalReturnFocus = null;
    if (back && document.contains(back) && typeof back.focus === 'function') back.focus();
  }
  function focusables() {
    return Array.from(wrap.querySelectorAll(
      'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter(el => !el.disabled && el.offsetParent !== null);
  }
  function onKey(e) {
    if (e.key === 'Escape' || e.key === 'Esc') { e.preventDefault(); closeModal(wrap); return; }
    if (e.key !== 'Tab') return;
    const list = focusables();
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1];
    const active = document.activeElement;
    if (e.shiftKey && (active === first || !wrap.contains(active))) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || !wrap.contains(active))) { e.preventDefault(); first.focus(); }
  }
  $('[data-close]', wrap).onclick = () => closeModal(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(wrap); });
  modalReturnFocus = document.activeElement;
  document.body.appendChild(wrap);
  document.addEventListener('keydown', onKey, true);
  const firstTarget = foot.firstElementChild || $('[data-close]', wrap);
  if (firstTarget) firstTarget.focus();
  return wrap;
}
