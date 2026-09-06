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

function toast(msg, type) {
  let box = $('#toast-box');
  if (!box) {
    box = document.createElement('div');
    box.id = 'toast-box';
    document.body.appendChild(box);
  }
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

function modal(title, bodyHtml, buttons) {
  const wrap = document.createElement('div');
  wrap.className = 'modal-wrap';
  wrap.innerHTML = `
    <div class="modal" role="dialog">
      <div class="modal-head"><strong>${esc(title)}</strong><button class="icon-btn" data-close>✕</button></div>
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
  function closeModal(w) { w.remove(); }
  $('[data-close]', wrap).onclick = () => closeModal(wrap);
  wrap.addEventListener('click', e => { if (e.target === wrap) closeModal(wrap); });
  document.body.appendChild(wrap);
  return wrap;
}
