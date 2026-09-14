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

/* ================= 表达卡导出(工作台的「出口」) =================
   本站原来只有「导出备份」:那是给电脑恢复数据用的 JSON,人拿着读不了、念不了。
   表达卡是给人用的:我的回答 + 面试口述版 + 参考要点,能复制、能打印。
   生成逻辑在 express.js(纯函数,Node 里可测);这里只负责把它交到用户手上。 */

/* 我标记为「还不熟 / 待复习」的题 —— 与复习中心今日队列同一套判定 */
function pendingMarks() {
  return Data.allQuestions()
    .map(q => ({ q, r: Store.rec(q.id) }))
    .filter(x => x.r.status === 'weak' || x.r.status === 'review')
    .map(x => ({ qid: x.q.id, status: x.r.status, note: x.r.note || '' }));
}

function buildExpressCard(kind, index) {
  const rounds = (Store.data.mock && Store.data.mock.rounds) || [];
  if (kind === 'round') return ExpressCard.buildFromRound(rounds, index || 0, id => Data.question(id));
  if (kind === 'project') {
    const selection = index || {};
    const project = ((window.APP_DATA.projects || {}).projects || []).find(p => p.id === selection.projectId);
    return ExpressCard.buildFromProject(project, (Store.data.ui.projectDrafts || {})[selection.projectId],
      (Store.data.ui.projectRuns || {})[selection.projectId], selection.runId);
  }
  return ExpressCard.buildFromMarks(pendingMarks(), id => Data.question(id));
}

/* 待攻克清单 → Anki 导入用 CSV(数据源与表达卡同一套 pendingMarks) */
/* The first field is our stable ID; Anki owns its internal GUID. */
const ANKI_GUIDE = [
  '# Anki 导入指南', '',
  '## 准备笔记类型与卡片模板',
  '在Anki管理笔记类型中复制基础类型，命名为「面试加油工作台」。',
  '设置三个字段，顺序为：题号、正面、背面。',
  '在卡片模板编辑器中，将正面模板设置为下面一行：',
  '```html', '{{正面}}', '```',
  '将背面模板设置为：',
  '```html', '{{FrontSide}}<hr id="answer">{{背面}}', '```', '',
  '## 导入与更新',
  '选择下载的CSV。使用上述笔记类型及目标牌组，字段映射为第1列→题号、第2列→正面、第3列→背面。',
  '开启HTML字段；文件头已声明逗号分隔、HTML及列名。',
  '再次导入时选择更新现有笔记，并使用同一笔记类型，以第一字段题号匹配。不要选择导入为新笔记。',
  '题号是自定义稳定ID，不是Anki内部GUID；文件不设置GUID特殊列。',
  '曾导入旧版四列文件时，也要按当前三列映射核对，并先用一题验证更新结果，勿删除已有卡片。', '',
  '## 验证范围',
  '站内测试覆盖CSV解析、转义与下载；真实Anki桌面版尚未验证。',
  '首次导入核对题干正面、答案背面；重复导入确认笔记数量、内容更新和已有排程。',
  '官方规则：https://docs.ankiweb.net/importing/text-files.html'
].join('\n');

function exportAnkiCsv() {
  let r;
  try { r = ExpressCard.buildAnkiCsv(pendingMarks(), id => Data.question(id)); }
  catch (e) { toast('生成 Anki CSV 失败:' + e.message, 'err'); return; }
  if (!r || !r.ok) { toast((r && r.error) || '生成 Anki CSV 失败', 'err'); return; }
  modal('导出 Anki CSV', `
    <p>共 <b>${r.count}</b> 题。首次使用需要一次性准备:在 Anki 建笔记类型「面试加油工作台」,
    字段依次为 <b>题号 / 正面 / 背面</b>(完整步骤见「下载导入指南」)。</p>
    <ul style="margin:6px 0 0 18px">
      <li>字段映射:第 1 列题号、第 2 列正面、第 3 列背面；使用指南中的卡片模板显示正反面;</li>
      <li>HTML 已在文件头声明为开,内容均已转义;</li>
      <li>重复导入时选择更新现有笔记，以同一笔记类型的首字段题号匹配；先核对一题的更新结果。</li>
    </ul>
    <p class="muted small" style="margin-top:6px">真实 Anki 桌面版导入受版本影响:首次导入后请核对一张卡片的正反面。</p>`, [
    { label: '下载 CSV', primary: true, onClick: () => {
        download(r.name, '\ufeff' + r.csv, 'text/csv');
        toast('已下载 ' + r.name);
      } },
    { label: '下载导入指南', onClick: () => {
        download('Anki导入指南.md', ANKI_GUIDE, 'text/markdown');
      } },
    { label: '取消' }
  ]);
  return r;
}

/* 打印版:开一个真正的新页面(Blob URL),用户在那里 Ctrl+P 就能存 PDF */
function openPrintVersion(html) {
  let url = '';
  try {
    url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }));
    const w = window.open(url, '_blank');
    if (!w) {
      URL.revokeObjectURL(url);
      toast('浏览器拦截了新窗口,请允许弹出窗口后重试', 'err');
      return false;
    }
  } catch (e) {
    if (url) URL.revokeObjectURL(url);
    toast('打开打印版失败:' + e.message, 'err');
    return false;
  }
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return true;
}

/* kind: 'round'(某轮模拟面试) | 'marks'(待攻克清单)
   失败一律明说原因,不产出看起来像材料的空文件。 */
function exportExpressCard(kind, index) {
  let r;
  try { r = buildExpressCard(kind, index); }
  catch (e) { toast('生成表达卡失败:' + e.message, 'err'); return null; }
  if (!r || !r.ok) { toast((r && r.error) || '生成表达卡失败', 'err'); return null; }
  modal('导出表达卡', `
    <p>${r.summary ? esc(r.summary) : `共 <b>${r.count}</b> 题`},内容取自你本机浏览器的学习记录(不会上传)。</p>
    ${(r.notes || []).map(n => `<p class="muted small">${esc(n)}</p>`).join('')}
    <p class="muted small" style="margin-top:6px">两种格式按用途选:</p>
    <ul style="margin:6px 0 0 18px">
      <li><b>Markdown(.md)</b> — 复制进笔记软件、发给自己。</li>
      <li><b>打印版(.html)</b> — 在新页面里 Ctrl+P 存成 PDF,面试前手机上翻。</li>
    </ul>`, [
    { label: '下载 Markdown', primary: true, onClick: () => {
        download(r.mdName, r.markdown, 'text/markdown');
        toast('已下载 ' + r.mdName);
      } },
    { label: '打开打印版', onClick: () => { openPrintVersion(r.html); } },
    { label: '下载打印版 HTML', onClick: () => { download(r.htmlName, r.html, 'text/html'); } },
    { label: '取消' }
  ]);
  return r;
}
