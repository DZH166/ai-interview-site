/* 练习视图:浏览与搜索 / 学习模式 / 自测与模拟面试 */
'use strict';

/* ---------- 浏览与搜索 ---------- */
const BrowseView = (() => {
  const defaults = { topic: '', diff: '', type: '', status: '', fav: false, kw: '', qid: '' };
  let batchMode = false;

  function filters() {
    const saved = Store.data.ui.browse || {};
    return Object.assign({}, defaults, saved);
  }
  function saveFilters(f) { Store.data.ui.browse = f; Store.save(); }

  function apply(f) {
    const kw = f.kw.trim().toLowerCase();
    return Data.allQuestions().filter(q => {
      if (f.topic && q.topic !== f.topic) return false;
      if (f.diff && q.difficulty !== f.diff) return false;
      if (f.type && q.type !== f.type) return false;
      const r = Store.rec(q.id);
      if (f.status && (r.status || '') !== f.status) return false;
      if (f.fav && !r.fav) return false;
      if (kw) {
        const hay = (q.title + ' ' + q.answer + ' ' + (q.tags || []).join(' ') + ' ' + q.id).toLowerCase();
        if (!kw.split(/\s+/).every(t => hay.includes(t))) return false;
      }
      return true;
    }).map(q => q.id);
  }

  function render(root) {
    const f = filters();
    const ids = apply(f);
    NavCtx.set(ids);
    const topics = (window.APP_DATA.topics || []);
    root.innerHTML = `
      <div class="filter-bar">
        <input id="f-kw" class="input" placeholder="关键词(题干/答案/标签/题号)" value="${esc(f.kw)}">
        <select id="f-topic" class="input"><option value="">全部专题</option>
          ${topics.map(t => `<option value="${t.id}" ${f.topic === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
        </select>
        <select id="f-diff" class="input"><option value="">全部难度</option>
          ${Object.entries(Data.DIFFS).map(([k, v]) => `<option value="${k}" ${f.diff === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="f-type" class="input"><option value="">全部题型</option>
          ${Object.entries(Data.TYPES).map(([k, v]) => `<option value="${k}" ${f.type === k ? 'selected' : ''}>${v}</option>`).join('')}
        </select>
        <select id="f-status" class="input"><option value="">全部状态</option>
          ${Store.STATUS.filter(s => s.id).map(s => `<option value="${s.id}" ${f.status === s.id ? 'selected' : ''}>${s.label}</option>`).join('')}
        </select>
        <label class="chk"><input type="checkbox" id="f-fav" ${f.fav ? 'checked' : ''}> 只看收藏</label>
        <span class="muted" id="f-count">${ids.length} 题</span>
        <button class="btn btn-small" id="f-reset">重置</button>
        <button class="btn btn-small" id="f-batch">☑ 批量</button>
      </div>
      <div class="batch-bar hidden" id="batch-bar">
        <span class="muted">已选 <b id="batch-count">0</b> 题</span>
        <span class="flex1"></span>
        <button class="btn btn-small" data-bs="ok">✅ 掌握</button>
        <button class="btn btn-small" data-bs="weak">❌ 不熟</button>
        <button class="btn btn-small" data-bs="review">📌 待复习</button>
        <button class="btn btn-small" data-bf="1">★ 收藏</button>
        <button class="btn btn-small" data-bcancel>取消</button>
      </div>
      <div class="browse-pane">
        <div class="q-list" id="q-list"></div>
        <div class="q-detail" id="q-detail"></div>
      </div>`;

    const kwInput = $('#f-kw');
    kwInput.addEventListener('input', debounce(() => {
      f.kw = kwInput.value; saveFilters(f); refreshList(root, f);
    }, 250));
    [['#f-topic', 'topic'], ['#f-diff', 'diff'], ['#f-type', 'type'], ['#f-status', 'status']].forEach(([sel, key]) => {
      $(sel).addEventListener('change', e => {
        f[key] = e.target.value; saveFilters(f); refreshList(root, f);
      });
    });
    $('#f-fav').addEventListener('change', e => { f.fav = e.target.checked; saveFilters(f); refreshList(root, f); });
    $('#f-reset').addEventListener('click', () => { saveFilters(defaults); render(root); });

    /* 批量操作 */
    const $bc = () => root.querySelector('#batch-bar');
    function refreshBatch() {
      const checked = [...root.querySelectorAll('.q-ck:checked')];
      const cnt = root.querySelector('#batch-count');
      if (cnt) cnt.textContent = checked.length;
      const bar = $bc();
      if (bar) bar.classList.toggle('hidden', !batchMode || !checked.length);
    }
    $('#f-batch').addEventListener('click', () => {
      batchMode = !batchMode;
      root.classList.toggle('batching', batchMode);
      const bar = $bc();
      if (bar) bar.classList.toggle('hidden', !batchMode);
      refreshList(root, f);
    });
    $$('[data-bs]', root).forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('.q-ck:checked').forEach(c => {
        const qid = c.closest('.q-item').dataset.qid;
        Store.setStatus(qid, b.dataset.bs);
      });
      toast('批量更新完成');
      batchMode = false; root.classList.remove('batching');
      refreshList(root, f);
    }));
    $$('[data-bf]', root).forEach(b => b.addEventListener('click', () => {
      root.querySelectorAll('.q-ck:checked').forEach(c => {
        const qid = c.closest('.q-item').dataset.qid;
        if (!Store.rec(qid).fav) Store.toggleFav(qid);
      });
      toast('已批量收藏');
      refreshList(root, f);
    }));
    $('[data-bcancel]', root).addEventListener('click', () => {
      batchMode = false; root.classList.remove('batching');
      refreshList(root, f);
    });

    refreshList(root, f);
    /* 恢复上次选中 */
    const lastQid = f.qid && Data.question(f.qid) ? f.qid : ids[0];
    if (lastQid) select(root, f, lastQid);
  }

  function refreshList(root, f) {
    const ids = apply(f);
    NavCtx.set(ids);
    $('#f-count', root).textContent = ids.length + ' 题';
    const list = $('#q-list', root);
    if (!ids.length) {
      list.innerHTML = '<div class="empty">没有符合条件的题目,试试放宽筛选。</div>';
      return;
    }
    list.innerHTML = ids.map(qid => {
      const q = Data.question(qid);
      const st = Data.statusInfo(qid);
      const r = Store.rec(qid);
      const ck = batchMode ? `<input type="checkbox" class="q-ck" data-qid="${qid}">` : '';
      return `
        <div class="q-item ${f.qid === qid ? 'active' : ''}" data-qid="${qid}">
          ${ck}<div class="q-item-body">
          <div class="q-item-title">${esc(q.title)}</div>
          <div class="q-item-meta">
            <span class="qid">${qid}</span>
            ${QRender.badge(Data.topicShort(q.topic), 'b-topic')}
            ${QRender.badge(Data.diffLabel(q.difficulty), 'b-diff-' + q.difficulty)}
            ${QRender.badge(st.label, st.cls)}
            ${r.fav ? '<span class="star">★</span>' : ''}
          </div></div>
        </div>`;
    }).join('');
    list.classList.toggle('batching', batchMode);
    $$('.q-item', list).forEach(item => {
      item.addEventListener('click', () => {
        select(root, filters(), item.dataset.qid);
      });
    });
  }

  function select(root, f, qid) {
    f.qid = qid; saveFilters(f);
    DetailQid = qid;
    $$('.q-item', root).forEach(el => el.classList.toggle('active', el.dataset.qid === qid));
    const q = Data.question(qid);
    if (!q) return;
    Store.markViewed(qid);
    const nb = NavCtx.neighbors(qid);
    $('#q-detail', root).innerHTML = `
      <div class="detail-toolbar">
        <button class="btn btn-small" data-go="${nb.prev || ''}" ${nb.prev ? '' : 'disabled'}>← 上一题</button>
        <span class="muted">${nb.pos} / ${nb.total}</span>
        <button class="btn btn-small" data-go="${nb.next || ''}" ${nb.next ? '' : 'disabled'}>下一题 →</button>
        <span class="flex1"></span>
        <a class="btn btn-small" href="#/study/${qid}">完整学习页</a>
      </div>
      ${QRender.recordBar(qid)}
      ${QRender.metaLine(q)}
      <h2 class="q-title-sm">${esc(q.title)}</h2>
      <div class="rel-links">${QRender.relLinks(q)}</div>
      <div class="q-secs">
        ${QRender.section('answer', '直接答案', QRender.mdHtml(q.answer), false)}
        ${QRender.section('plain', '大白话解释', QRender.mdHtml(q.plain), false)}
        ${QRender.section('deep', '原理拆解', QRender.mdHtml(q.deep), false)}
        ${QRender.section('example', '具体例子', QRender.mdHtml(q.example), false)}
        ${QRender.section('interview', '面试表达', QRender.mdHtml(q.interview), false)}
        ${QRender.section('followups', '常见追问', (q.followups || []).map((fu, i) => `<div class="fu"><div class="fu-q">追问 ${i + 1}:${esc(fu.q)}</div><div class="fu-a">${QRender.mdHtml(fu.a)}</div></div>`).join(''), false)}
        ${QRender.section('pitfalls', '常见误区', `<ul class="pf-list">${(q.pitfalls || []).map(p => `<li>${QRender.mdHtml(p)}</li>`).join('')}</ul>`, false)}
        ${QRender.section('check', '理解检查', StudyView.checkHtml(q), false)}
        ${QRender.section('sources', '出处与核查状态', QRender.verifyBlock(q), false)}
      </div>`;
    wireDetail(root);
  }

  function wireDetail(root) {
    $$('#q-detail [data-go]', root).forEach(btn => {
      btn.addEventListener('click', () => { if (btn.dataset.go) select(root, filters(), btn.dataset.go); });
    });
    $$('#q-detail .q-sec-head', root).forEach(h => {
      h.addEventListener('click', () => {
        const sec = h.parentElement;
        sec.classList.toggle('open');
        $('.q-sec-arrow', sec).textContent = sec.classList.contains('open') ? '−' : '+';
      });
    });
    $$('#q-detail [data-status]', root).forEach(b => {
      b.addEventListener('click', () => {
        Store.setStatus(DetailQid, b.dataset.status);
        select(root, filters(), DetailQid);
        refreshList(root, filters());
      });
    });
    const favBtn = $('#q-detail [data-fav]', root);
    if (favBtn) favBtn.addEventListener('click', () => {
      Store.toggleFav(DetailQid);
      select(root, filters(), DetailQid);
      refreshList(root, filters());
    });
  }

  let DetailQid = '';

  function selectWrapper(root, qid) { DetailQid = qid; select(root, filters(), qid); }

  return { render, filters, apply, select: selectWrapper };
})();

/* ---------- 学习模式 ---------- */
const StudyView = (() => {
  let currentQid = '';

  function checkHtml(q) {
    const c = q.check || {};
    return `
      <div class="chk-q">${QRender.mdHtml(c.q || '')}</div>
      <button class="btn btn-small" data-reveal-check>查看答案</button>
      <div class="chk-a hidden"><div class="chk-answer">${QRender.mdHtml(c.a || '')}</div>
      ${c.explain ? `<div class="chk-explain">检验点:${QRender.mdHtml(c.explain)}</div>` : ''}</div>`;
  }

  function render(root, qid) {
    const q = Data.question(qid);
    if (!q) { root.innerHTML = '<div class="empty">未找到题目:' + esc(qid) + '</div>'; return; }
    currentQid = qid;
    Store.markViewed(qid);
    const nb = NavCtx.neighbors(qid);
    root.innerHTML = `
      <div class="study-wrap">
        <div class="detail-toolbar">
          <a class="btn btn-small" href="#/browse">← 浏览</a>
          <button class="btn btn-small" data-nav="${nb.prev || ''}" ${nb.prev ? '' : 'disabled'}>← 上一题</button>
          <button class="btn btn-small" data-nav="${nb.next || ''}" ${nb.next ? '' : 'disabled'}>下一题 →</button>
          <span class="muted">${nb.pos} / ${nb.total}</span>
          <span class="flex1"></span>
          <button class="btn btn-small" id="expand-all">展开全部</button>
          <button class="btn btn-small" id="collapse-all">折叠全部</button>
        </div>
        ${QRender.recordBar(qid)}
        ${QRender.metaLine(q)}
        <h1 class="q-title">${esc(q.title)}</h1>
        <div class="rel-links">${QRender.relLinks(q)}</div>
        <div class="q-secs">
          ${QRender.section('answer', '直接答案', QRender.mdHtml(q.answer), false)}
          ${QRender.section('plain', '大白话解释', QRender.mdHtml(q.plain), false)}
          ${QRender.section('deep', '原理拆解', QRender.mdHtml(q.deep), false)}
          ${QRender.section('example', '具体例子', QRender.mdHtml(q.example), false)}
          ${QRender.section('interview', '面试表达', QRender.mdHtml(q.interview), false)}
          ${QRender.section('followups', '常见追问', (q.followups || []).map((f, i) => `<div class="fu"><div class="fu-q">追问 ${i + 1}:${esc(f.q)}</div><div class="fu-a">${QRender.mdHtml(f.a)}</div></div>`).join(''), false)}
          ${QRender.section('pitfalls', '常见误区', `<ul class="pf-list">${(q.pitfalls || []).map(p => `<li>${QRender.mdHtml(p)}</li>`).join('')}</ul>`, false)}
          ${QRender.section('check', '理解检查', checkHtml(q), false)}
          ${QRender.section('sources', '出处与核查状态', QRender.verifyBlock(q), false)}
        </div>
        <div class="q-note-box">
          <label class="note-label">我的笔记(参与全文搜索)</label>
          <textarea id="note-area" placeholder="写下你的理解、易错点或自己的例子……">${esc(Store.rec(qid).note || '')}</textarea>
        </div>
      </div>`;
    wire(root, qid);
  }

  function wire(root, qid) {
    $$('.q-sec-head', root).forEach(h => {
      h.addEventListener('click', () => {
        const sec = h.parentElement;
        sec.classList.toggle('open');
        $('.q-sec-arrow', sec).textContent = sec.classList.contains('open') ? '−' : '+';
      });
    });
    $('#expand-all', root).addEventListener('click', () => {
      $$('.q-sec', root).forEach(s => { s.classList.add('open'); $('.q-sec-arrow', s).textContent = '−'; });
    });
    $('#collapse-all', root).addEventListener('click', () => {
      $$('.q-sec', root).forEach(s => { s.classList.remove('open'); $('.q-sec-arrow', s).textContent = '+'; });
    });
    $$('[data-status]', root).forEach(b => {
      b.addEventListener('click', () => {
        Store.setStatus(qid, b.dataset.status);
        render(root, qid);
      });
    });
    $('[data-fav]', root).addEventListener('click', () => {
      Store.toggleFav(qid);
      render(root, qid);
    });
    const rv = $('[data-reveal-check]', root);
    if (rv) rv.addEventListener('click', () => {
      const box = $('.chk-a', root);
      box.classList.toggle('hidden');
      rv.textContent = box.classList.contains('hidden') ? '查看答案' : '收起答案';
    });
    const note = $('#note-area', root);
    note.addEventListener('input', debounce(() => {
      Store.setNote(qid, note.value);
      Search.build(currentCtx());
    }, 400));
    $$('[data-nav]', root).forEach(b => {
      b.addEventListener('click', () => { if (b.dataset.nav) go('#/study/' + b.dataset.nav); });
    });
    /* 键盘快捷键:← 上一题 → 下一题 */
    root._keyHandler = (e) => {
      if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'INPUT') return;
      if (e.key === 'ArrowLeft') { const b = $('[data-nav]', root); if (b && !b.disabled) b.click(); }
      if (e.key === 'ArrowRight') { const btns = $$('[data-nav]', root); if (btns.length > 1 && !btns[1].disabled) btns[1].click(); }
      if (e.key === ' ') { e.preventDefault(); $('#expand-all', root) ? $('#expand-all', root).click() : 0; }
    };
    document.addEventListener('keydown', root._keyHandler);
    // 清理旧 handler
    if (root._oldKeyHandler) document.removeEventListener('keydown', root._oldKeyHandler);
    root._oldKeyHandler = root._keyHandler;
  }

  function currentCtx() {
    return {
      questions: Data.allQuestions(),
      docs: Data.allDocs(),
      userDocs: Data.allUserDocs(),
      records: Store.data
    };
  }

  return { render, checkHtml, currentCtx };
})();

/* ---------- 自测与模拟面试 ---------- */
const MockView = (() => {
  let state = null; /* {config, items:[{qid}], idx, answers:{qid:{self, revealed, mark}}} */

  function render(root, parts) {
    if (parts && parts[0] === 'run' && state) { renderRun(root); return; }
    if (parts && parts[0] === 'done' && state) { renderDone(root); return; }
    renderConfig(root);
  }

  function renderConfig(root) {
    const topics = (window.APP_DATA.topics || []);
    const counts = {};
    Data.allQuestions().forEach(q => { counts[q.topic] = (counts[q.topic] || 0) + 1; });
    root.innerHTML = `
      <div class="card mock-config">
        <h2>自测 / 模拟面试</h2>
        <p class="muted">参考答案默认隐藏:先在输入框写下你的回答,再对照参考要点并自我复盘。抽题会优先选择你最近没有练过的题。</p>
        <div class="form-row">
          <label>专题(可多选)</label>
          <div class="chk-group" id="m-topics">
            ${topics.map(t => `<label class="chk"><input type="checkbox" value="${t.id}" checked> ${esc(t.name)}(${counts[t.id] || 0})</label>`).join('')}
          </div>
        </div>
        <div class="form-row">
          <label>难度</label>
          <div class="chk-group" id="m-diffs">
            ${Object.entries(Data.DIFFS).map(([k, v]) => `<label class="chk"><input type="checkbox" value="${k}" checked> ${v}</label>`).join('')}
          </div>
        </div>
        <div class="form-row">
          <label>题数</label>
          <select id="m-count" class="input">
            <option value="5">5 题</option><option value="10" selected>10 题</option>
            <option value="15">15 题</option><option value="20">20 题</option>
          </select>
        </div>
        <button class="btn btn-primary" id="m-start">开始练习</button>
      </div>`;
    $('#m-start').addEventListener('click', () => {
      const selTopics = $$('#m-topics input:checked').map(i => i.value);
      const selDiffs = $$('#m-diffs input:checked').map(i => i.value);
      const count = parseInt($('#m-count').value, 10);
      const pool = Data.allQuestions().filter(q => selTopics.includes(q.topic) && selDiffs.includes(q.difficulty));
      if (!pool.length) { toast('没有符合条件的题目,请放宽筛选', 'err'); return; }
      state = { config: { topics: selTopics, diffs: selDiffs, count }, items: sample(pool, Math.min(count, pool.length)), idx: 0, answers: {} };
      go('#/mock/run');
    });
  }

  function sample(pool, n) {
    const recs = Store.data.questions;
    const unseen = pool.filter(q => !recs[q.id] || !recs[q.id].lastPracticedAt);
    const seen = pool.filter(q => recs[q.id] && recs[q.id].lastPracticedAt)
      .sort((a, b) => (recs[a.id].lastPracticedAt || 0) - (recs[b.id].lastPracticedAt || 0));
    return shuffle(unseen).concat(seen).slice(0, n);
  }

  function renderRun(root) {
    const q = Data.question(state.items[state.idx].qid || state.items[state.idx].id);
    const qid = q.id;
    const ans = state.answers[qid] || { self: '', revealed: false, mark: '' };
    root.innerHTML = `
      <div class="card mock-run">
        <div class="mock-progress">
          <span>第 ${state.idx + 1} / ${state.items.length} 题</span>
          <div class="progress"><div class="progress-in" style="width:${(state.idx / state.items.length) * 100}%"></div></div>
          <button class="btn btn-small" id="m-quit">结束本轮</button>
        </div>
        ${QRender.metaLine(q)}
        <h2 class="q-title-sm">${esc(q.title)}</h2>
        <label class="note-label">你的回答(先自己写,再对照)</label>
        <textarea id="m-self" class="mock-self" placeholder="像面试口述一样,写下你的答案要点……">${esc(ans.self || '')}</textarea>
        <div class="mock-actions">
          ${!ans.revealed
            ? '<button class="btn btn-primary" id="m-reveal">对照参考要点</button>'
            : `<div class="mock-ref">
                 <h4>参考要点(直接答案)</h4>
                 ${QRender.mdHtml(q.answer)}
                 <details><summary>展开大白话解释</summary>${QRender.mdHtml(q.plain)}</details>
                 <details><summary>展开面试表达</summary>${QRender.mdHtml(q.interview)}</details>
                 <a href="#/study/${qid}" target="_self">查看完整解析 →</a>
               </div>
               <div class="mock-mark">
                 <span>自我复盘:</span>
                 <button class="status-btn st-ok ${ans.mark === 'ok' ? 'active' : ''}" data-mark="ok">基本掌握了</button>
                 <button class="status-btn st-weak ${ans.mark === 'weak' ? 'active' : ''}" data-mark="weak">还不熟</button>
                 <button class="status-btn st-review ${ans.mark === 'review' ? 'active' : ''}" data-mark="review">下次再练</button>
               </div>`}
        </div>
        <div class="mock-nav">
          <button class="btn" id="m-prev" ${state.idx === 0 ? 'disabled' : ''}>← 上一题</button>
          ${state.idx === state.items.length - 1
            ? '<button class="btn btn-primary" id="m-finish">完成本轮</button>'
            : '<button class="btn btn-primary" id="m-next">下一题 →</button>'}
        </div>
      </div>`;

    const selfBox = $('#m-self');
    selfBox.addEventListener('input', debounce(() => {
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { self: selfBox.value });
    }, 200));

    const revealBtn = $('#m-reveal');
    if (revealBtn) revealBtn.addEventListener('click', () => {
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { revealed: true, self: selfBox.value });
      Store.markPracticed(qid, 'mock');
      renderRun(root);
    });
    $$('[data-mark]', root).forEach(b => b.addEventListener('click', () => {
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { mark: b.dataset.mark });
      Store.setStatus(qid, b.dataset.mark);
      renderRun(root);
    }));
    const prev = $('#m-prev');
    if (prev) prev.addEventListener('click', () => { state.idx--; renderRun(root); });
    const next = $('#m-next');
    if (next) next.addEventListener('click', () => { state.idx++; renderRun(root); });
    const finishBtn = $('#m-finish');
    if (finishBtn) finishBtn.addEventListener('click', finish);
    const quitBtn = $('#m-quit');
    if (quitBtn) quitBtn.addEventListener('click', finish);
  }

  function finish() {
    const answered = Object.keys(state.answers).length;
    if (!answered) { toast('本轮还没有作答,继续加油'); }
    const round = {
      ts: Date.now(),
      config: state.config,
      items: state.items.map(q => {
        const id = q.qid || q.id;
        const a = state.answers[id] || {};
        const question = Data.question(id);
        return { qid: id, title: question ? question.title : id, self: a.self || '', revealed: !!a.revealed, mark: a.mark || '' };
      })
    };
    Store.data.mock.rounds.unshift(round);
    Store.data.mock.rounds = Store.data.mock.rounds.slice(0, 50);
    Store.save();
    state.round = round;
    go('#/mock/done');
  }

  function renderDone(root) {
    const round = state.round;
    if (!round) { renderConfig(root); return; }
    const revealed = round.items.filter(i => i.revealed);
    root.innerHTML = `
      <div class="card">
        <h2>本轮完成</h2>
        <p class="muted">${fmtTime(round.ts)} · 共 ${round.items.length} 题 · 对照参考要点 ${revealed.length} 题</p>
        <div class="round-list">
          ${round.items.map((it, i) => `
            <div class="round-item">
              <div class="round-head">
                <span class="qid">${i + 1}. ${esc(it.qid)}</span>
                ${it.mark ? QRender.badge(Store.STATUS.find(s => s.id === it.mark).label, 'st-' + it.mark) : '<span class="muted">未复盘</span>'}
                <a class="rel-link" href="#/study/${it.qid}">打开题目</a>
              </div>
              <div class="round-title">${esc(it.title)}</div>
              ${it.self ? `<div class="round-self"><b>我的回答:</b>${esc(it.self)}</div>` : '<div class="round-self muted">(未作答)</div>'}
            </div>`).join('')}
        </div>
        <div class="mock-nav">
          <button class="btn" id="m-again">再来一轮</button>
          <a class="btn" href="#/review">查看历史轮次</a>
          <a class="btn btn-primary" href="#/home">返回首页</a>
        </div>
      </div>`;
    $('#m-again').addEventListener('click', () => { state = null; go('#/mock'); });
  }

  return { render };
})();
