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
      const st = (Store.rec(q.id).status || '');
      if (f.status === '__none') { if (st !== '') return false; }
      else if (f.status && st !== f.status) return false;
      const r = Store.rec(q.id);
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
    /* 消费路由参数:首页专题导航链接形如 #/browse?t=python-backend */
    const routeQuery = parseHash().query;
    if (routeQuery.t && routeQuery.t !== f.topic) {
      f.topic = routeQuery.t;
      saveFilters(f);
      history.replaceState(null, '', '#/browse'); /* 清理参数,避免刷新重复应用 */
    }
    if (routeQuery.qid && Data.question(routeQuery.qid)) {
      f.qid = routeQuery.qid;
      saveFilters(f);
      history.replaceState(null, '', '#/browse');
    }
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
          <option value="__none" ${f.status === '__none' ? 'selected' : ''}>未练习</option>
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
        <div class="q-item ${f.qid === qid ? 'active' : ''}" data-qid="${qid}" role="button" tabindex="0" aria-label="打开题目 ${esc(q.title)}">
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
      item.addEventListener('keydown', e => {
        /* 复选框等交互子元素不拦截 */
        if (e.target !== item) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(root, filters(), item.dataset.qid); }
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
    /* 理解检查:浏览详情与完整学习页共用同一交互 */
    $$('#q-detail [data-reveal-check]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const sec = btn.closest('.q-sec');
        const box = sec && $('.chk-a', sec);
        if (!box) return;
        box.classList.toggle('hidden');
        btn.textContent = box.classList.contains('hidden') ? '查看答案' : '收起答案';
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
  let activeKeyHandler = null;

  /* 快捷键只在焦点不在任何交互控件上时生效 */
  function isInteractiveTarget(t) {
    return !!(t && t.closest && t.closest('button, a, input, textarea, select, [contenteditable="true"], summary'));
  }
  function setKeyHandler(handler) {
    if (activeKeyHandler) document.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = handler;
    if (handler) document.addEventListener('keydown', handler);
  }
  /* 路由离开学习页时清理全局监听(App.route 调用) */
  function cleanup() { setKeyHandler(null); }

  /* pagehide 兜底:输入框里尚未过防抖的笔记立即写入记录(防「打完字马上关页」丢失) */
  function flushNote() {
    const ta = $('#note-area');
    if (!ta || !currentQid) return;
    if ((Store.rec(currentQid).note || '') !== ta.value) {
      Store.setNote(currentQid, ta.value);
      Store.saveNow();
      Search.build(currentCtx()); /* 绕过了防抖路径,索引需手动重建 */
    }
  }

  /* 搜索/锚点定位:展开对应区块并滚动(检查题同时揭示答案;笔记滚动到输入框)。
     通过搜索明确打开命中内容属于有意揭示,与默认折叠不冲突。 */
  function revealAnchor(root, anchor) {
    if (!anchor) return;
    setTimeout(() => {
      if (anchor === 'note') {
        const nb = $('.q-note-box', root);
        if (nb) { scrollFlash(root, nb); }
        return;
      }
      /* 'top'(题名/标签命中)无需定位,页面默认就在顶部 */
      if (anchor === 'top') return;
      const sec = root.querySelector(`.q-sec[data-sec="${CSS.escape(anchor)}"]`);
      if (!sec) return;
      sec.classList.add('open');
      const arrow = $('.q-sec-arrow', sec);
      if (arrow) arrow.textContent = '−';
      if (anchor === 'check') {
        const a = $('.chk-a', sec);
        const btn = $('[data-reveal-check]', sec);
        if (a) a.classList.remove('hidden');
        if (btn) btn.textContent = '收起答案';
      }
      scrollFlash(root, sec);
    }, 80);
  }

  function scrollFlash(root, el) {
    /* instant:绕过 CSS scroll-behavior:smooth,保证定位后位置读取与高亮即时生效 */
    const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 80);
    window.scrollTo({ top: y, behavior: 'instant' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
  }

  function checkHtml(q) {
    const c = q.check || {};
    return `
      <div class="chk-q">${QRender.mdHtml(c.q || '')}</div>
      <button class="btn btn-small" data-reveal-check>查看答案</button>
      <div class="chk-a hidden"><div class="chk-answer">${QRender.mdHtml(c.a || '')}</div>
      ${c.explain ? `<div class="chk-explain">检验点:${QRender.mdHtml(c.explain)}</div>` : ''}</div>`;
  }

  function render(root, qid, anchor) {
    const q = Data.question(qid);
    if (!q) { root.innerHTML = '<div class="empty">未找到题目:' + esc(qid) + '</div>'; return; }
    currentQid = qid;
    Store.markViewed(qid);
    const nb = NavCtx.neighbors(qid);
    /* 内容修订提醒:实质修订过且你还没确认过新版 → 提示;旧笔记/记录保留,由你决定 */
    const cv = q.content_version;
    const needRevNotice = !!(cv && Store.rec(qid).contentRev !== cv.rev);
    root.innerHTML = `
      <div class="study-wrap">
        ${needRevNotice ? `
        <div class="notice rev-notice" data-rev-notice>
          <b>♻ 本题内容有更新(${esc(cv.rev)})</b>:${esc(cv.summary)}
          <ul class="rev-changes">${(cv.changes || []).map(c => `<li>${esc(c)}</li>`).join('')}</ul>
          <div class="btn-row" style="margin-top:6px">
            <button class="btn btn-small btn-primary" data-rev-redo>标记待复习(重做)</button>
            <button class="btn btn-small" data-rev-ack>知道了(旧笔记与记录保留)</button>
          </div>
        </div>` : ''}
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
          <label class="note-label">为什么没掌握(可多选,排进今日复习的理由)</label>
          <div class="reason-group" id="reason-group">
            ${[['concept', '概念不清'], ['prereq', '前置缺失'], ['causal', '因果混淆'], ['exec', '代码执行误判'], ['edge', '边界没考虑'], ['expression', '表达不完整']].map(([v, label]) => {
              const on = (Store.rec(qid).reviewReasons || []).includes(v);
              return `<label class="chk"><input type="checkbox" data-reason="${v}" ${on ? 'checked' : ''}> ${label}</label>`;
            }).join('')}
          </div>
          <label class="note-label" style="margin-top:8px">我的笔记(参与全文搜索)</label>
          <textarea id="note-area" placeholder="写下你的理解、易错点或自己的例子……">${esc(Store.rec(qid).note || '')}</textarea>
        </div>
      </div>`;
    wire(root, qid);
    $$('[data-reason]', root).forEach(cb => {
      cb.addEventListener('change', () => {
        const r = Store.rec(qid);
        const set = new Set(r.reviewReasons || []);
        cb.checked ? set.add(cb.dataset.reason) : set.delete(cb.dataset.reason);
        r.reviewReasons = [...set];
        r._updatedAt = Date.now();
        Store.saveNow();
      });
    });
    revealAnchor(root, anchor);
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
    /* 修订提醒:重做 → 标待复习并记录已读新版;知道了 → 只记录已读,不清任何记录 */
    const revBox = $('[data-rev-notice]', root);
    if (revBox) {
      const cv = (Data.question(qid) || {}).content_version;
      const ack = () => { const r = Store.rec(qid); r.contentRev = cv.rev; r._updatedAt = Date.now(); Store.saveNow(); };
      $('[data-rev-redo]', revBox).addEventListener('click', () => {
        ack(); Store.setStatus(qid, 'review'); toast('已标记待复习;你的笔记与历史保留'); render(root, qid);
      });
      $('[data-rev-ack]', revBox).addEventListener('click', () => { ack(); render(root, qid); });
    }
    /* 键盘快捷键:← 上一题 → 下一题,空格展开全部。
       焦点在按钮/链接/输入框等交互控件上时不拦截(保留 Space/Enter 原生激活)。 */
    setKeyHandler((e) => {
      if (isInteractiveTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') { const b = $('[data-nav]', root); if (b && !b.disabled) b.click(); }
      if (e.key === 'ArrowRight') { const btns = $$('[data-nav]', root); if (btns.length > 1 && !btns[1].disabled) btns[1].click(); }
      if (e.key === ' ') { e.preventDefault(); const b = $('#expand-all', root); if (b) b.click(); }
    });
  }

  function currentCtx() {
    return {
      questions: Data.allQuestions(),
      docs: Data.allDocs(),
      userDocs: Data.allUserDocs(),
      records: Store.data
    };
  }

  return { render, checkHtml, currentCtx, cleanup, flushNote };
})();

/* ---------- 自测与模拟面试 ----------
   会话状态(含未写完的回答草稿)实时落盘 Store.data.mock.draft:
   切题/对照/复盘/翻页即保存,刷新或离开后可从配置页恢复继续;完成或放弃才清除。 */
const MockView = (() => {
  let state = null; /* {config, items:[{qid}], idx, answers:{qid:{self, revealed, mark}}, directed, label, sid} */
  let sessionSeq = 0;

  function draftLoad() { return (Store.data.mock && Store.data.mock.draft) || null; }
  function draftSave() {
    if (!state || state.ended) return; /* 会话已终结:任何残留回调不得再写 */
    Store.data.mock.draft = {
      config: state.config, items: state.items, idx: state.idx,
      answers: state.answers, directed: !!state.directed,
      label: state.label || '', savedAt: Date.now()
    };
    Store.saveNow(); /* 同步写,刷新/关闭不丢草稿 */
  }
  function draftClear() {
    if (Store.data.mock && Store.data.mock.draft) { Store.data.mock.draft = null; Store.save(); }
  }

  /* 把输入框当前内容同步进会话(不经防抖)。所有离开当前题的动作前调用:
     下一题/上一题/对照/复盘/结束/完成/路由离开。 */
  function captureInput() {
    const ta = $('#m-self');
    if (!ta || !state || state.ended) return;
    const q = Data.question(state.items[state.idx].qid || state.items[state.idx].id);
    if (!q) return;
    const ans = state.answers[q.id] || {};
    if ((ans.self || '') !== ta.value) {
      state.answers[q.id] = Object.assign(ans, { self: ta.value });
      draftSave();
    }
  }
  /* pagehide 兜底:与 captureInput 相同(名称保留供 App.flush 调用) */
  function flushDraft() { captureInput(); }

  /* 结束/放弃会话:作废所有挂起的防抖回调(按会话 ID 判定),清除草稿 */
  function endSession() {
    if (state) state.ended = true;
    draftClear();
  }

  function render(root, parts) {
    if (parts && parts[0] === 'run') {
      if (!state) {
        const d = draftLoad();
        if (d && Array.isArray(d.items) && d.items.length) {
          state = {
            config: d.config || { topics: [], diffs: [], count: d.items.length },
            items: d.items, idx: Math.min(d.idx || 0, d.items.length - 1),
            answers: d.answers || {}, directed: !!d.directed, label: d.label || '',
            sid: ++sessionSeq, ended: false
          };
        }
      }
      if (state) { renderRun(root); return; }
      renderConfig(root); return;
    }
    if (parts && parts[0] === 'done' && state) { renderDone(root); return; }
    renderConfig(root);
  }

  function renderConfig(root) {
    const draft = draftLoad();
    const hasDraft = draft && Array.isArray(draft.items) && draft.items.length;
    const topics = (window.APP_DATA.topics || []);
    const counts = {};
    Data.allQuestions().forEach(q => { counts[q.topic] = (counts[q.topic] || 0) + 1; });
    root.innerHTML = `
      ${hasDraft ? `
      <div class="card mock-resume" style="margin-bottom:14px;border-color:var(--warn)">
        <b>⏸ 上次未完成的${draft.directed ? esc(draft.label || '定向复习') : '自测'}</b>
        <span class="muted" style="margin-left:8px;font-size:13px">
          共 ${draft.items.length} 题 · 进行到第 ${Math.min((draft.idx || 0) + 1, draft.items.length)} 题 · 草稿保存于 ${fmtTime(draft.savedAt)}
        </span>
        <div style="margin-top:8px">
          <button class="btn btn-primary btn-small" id="m-resume">继续上次${draft.directed ? '复习' : '自测'}</button>
          <button class="btn btn-small" id="m-discard">放弃草稿</button>
        </div>
      </div>` : ''}
      <div class="card mock-config">
        <h2>自测 / 模拟面试</h2>
        <p class="muted">参考答案默认隐藏:先在输入框写下你的回答,再对照参考要点并自我复盘。抽题会优先选择你最近没有练过的题。未完成的轮次会自动保存草稿,刷新后可继续。</p>
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
    if (hasDraft) {
      $('#m-resume', root).addEventListener('click', () => go('#/mock/run'));
      $('#m-discard', root).addEventListener('click', () => {
        endSession();
        state = null;
        toast('已放弃未完成的草稿');
        renderConfig(root);
      });
    }
    $('#m-start').addEventListener('click', () => {
      const selTopics = $$('#m-topics input:checked').map(i => i.value);
      const selDiffs = $$('#m-diffs input:checked').map(i => i.value);
      const count = parseInt($('#m-count').value, 10);
      const pool = Data.allQuestions().filter(q => selTopics.includes(q.topic) && selDiffs.includes(q.difficulty));
      if (!pool.length) { toast('没有符合条件的题目,请放宽筛选', 'err'); return; }
      endSession(); /* 丢弃旧会话(作废其挂起回调) */
      state = {
        config: { topics: selTopics, diffs: selDiffs, count },
        items: sample(pool, Math.min(count, pool.length)).map(q => ({ qid: q.id })),
        idx: 0, answers: {}, directed: false, label: '',
        sid: ++sessionSeq, ended: false
      };
      draftSave();
      go('#/mock/run');
    });
  }

  /* 定向复习入口(今日复习/错题本重做等):只包含给定队列的普通自测会话 */
  function startDirected(qids, label) {
    if (!qids || !qids.length) { toast('队列为空', 'err'); return; }
    endSession();
    state = {
      config: { topics: [], diffs: [], count: qids.length, label: label || '定向复习' },
      items: qids.map(id => ({ qid: id })),
      idx: 0, answers: {}, directed: true, label: label || '定向复习',
      sid: ++sessionSeq, ended: false
    };
    draftSave();
    go('#/mock/run');
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
    if (!q) { toast('题目不存在,跳过', 'err'); state.idx++; if (state.idx >= state.items.length) finish(root); else renderRun(root); return; }
    const qid = q.id;
    const ans = state.answers[qid] || { self: '', revealed: false, mark: '' };
    root.innerHTML = `
      <div class="card mock-run">
        <div class="mock-progress">
          <span>第 ${state.idx + 1} / ${state.items.length} 题${state.directed ? ` · ${esc(state.label || '定向复习')}` : ''}</span>
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
    const sid = state.sid; /* 回调绑定本题所属会话:会话结束/更换后不得写回 */
    selfBox.addEventListener('input', debounce(() => {
      if (!state || state.ended || state.sid !== sid) return;
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { self: selfBox.value });
      draftSave();
    }, 200));

    const revealBtn = $('#m-reveal');
    if (revealBtn) revealBtn.addEventListener('click', () => {
      captureInput();
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { revealed: true, self: selfBox.value });
      Store.markPracticed(qid, 'mock');
      draftSave();
      renderRun(root);
    });
    $$('[data-mark]', root).forEach(b => b.addEventListener('click', () => {
      captureInput();
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { mark: b.dataset.mark });
      Store.setStatus(qid, b.dataset.mark);
      draftSave();
      renderRun(root);
    }));
    const prev = $('#m-prev');
    if (prev) prev.addEventListener('click', () => { captureInput(); state.idx--; draftSave(); renderRun(root); });
    const next = $('#m-next');
    if (next) next.addEventListener('click', () => { captureInput(); state.idx++; draftSave(); renderRun(root); });
    const finishBtn = $('#m-finish');
    if (finishBtn) finishBtn.addEventListener('click', () => finish(root));
    const quitBtn = $('#m-quit');
    if (quitBtn) quitBtn.addEventListener('click', () => finish(root));
  }

  function finish(root) {
    captureInput(); /* 同步捕获当前输入,快速结束时最后一个回答不丢 */
    const sid = state.sid;
    const answered = Object.keys(state.answers).filter(k => (state.answers[k].self || '').trim() || state.answers[k].revealed).length;
    if (!answered) { toast('本轮还没有作答,已按原样记录'); }
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
    endSession(); /* 会话终结:挂起的防抖回调不得再写回草稿 */
    Store.save();
    state.round = round;
    state.sid = sid;
    go('#/mock/done');
  }

  function renderDone(root) {
    const round = state.round;
    if (!round) { renderConfig(root); return; }
    const revealed = round.items.filter(i => i.revealed);
    const weak = round.items.filter(i => i.mark === 'weak');
    root.innerHTML = `
      <div class="card">
        <h2>本轮完成</h2>
        <p class="muted">${fmtTime(round.ts)} · 共 ${round.items.length} 题 · 对照参考要点 ${revealed.length} 题${weak.length ? ` · 标记还不熟 ${weak.length} 题(已进入错题本与今日复习)` : ''}</p>
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
    $('#m-again').addEventListener('click', () => { endSession(); state = null; go('#/mock'); });
  }

  return { render, startDirected, flushDraft };
})();
