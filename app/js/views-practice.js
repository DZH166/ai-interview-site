/* 练习视图:浏览与搜索 / 学习模式 / 自测与模拟面试 */
'use strict';

/* ---------- 浏览与搜索 ---------- */
const BrowseView = (() => {
  let detailRequest = 0;
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
        /* 关键词匹配覆盖题干/答案/标签。全量字段未合并时 answer/prompt 为 undefined:
           标题/标签(id)仍可匹配,等全量就绪后 Data.init 重建时 refreshList 会重算
           (needs-full 门控已在详情层兜底),这里不因字段缺失而抛错。 */
        const hay = (q.title + ' ' + (q.prompt || '') + ' ' + (q.answer || '') + ' ' + (q.tags || []).join(' ') + ' ' + q.id).toLowerCase();
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
        <div class="q-detail" id="q-detail" tabindex="-1"></div>
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

    /* 列表渲染与详情选中统一交给 refreshList(含选中项被筛掉时的回退),
       这里不再单独 select 一次 —— 否则首次进入会把详情渲染两遍。 */
    refreshList(root, f);
  }

  /* Fix3: 分批渲染——首屏 100 条,点"加载更多"追加,避免 3900 题一次性渲染 DOM 卡顿 */
  var QUIZ_PAGE_SIZE = 100;

  function listItem(qid, f) {
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
    const shown = ids.slice(0, QUIZ_PAGE_SIZE);
    list.innerHTML = shown.map(qid => listItem(qid, f)).join('');
    /* Fix3: 加载更多按钮(超过 100 条时显示) */
    if (ids.length > QUIZ_PAGE_SIZE) {
      const loadMore = document.createElement('button');
      loadMore.className = 'btn btn-small';
      loadMore.style.cssText = 'display:block;width:100%;margin:8px auto;padding:8px;';
      loadMore.textContent = '加载更多(剩余 ' + (ids.length - QUIZ_PAGE_SIZE) + ' 题)';
      loadMore.addEventListener('click', () => {
        const rendered = list.querySelectorAll('.q-item').length;
        const more = ids.slice(rendered, rendered + QUIZ_PAGE_SIZE);
        const html = more.map(qid => listItem(qid, f)).join('');
        loadMore.insertAdjacentHTML('beforebegin', html);
        wireQItems(list, root);
        if (list.querySelectorAll('.q-item').length >= ids.length) loadMore.remove();
        else loadMore.textContent = '加载更多(剩余 ' + (ids.length - list.querySelectorAll('.q-item').length) + ' 题)';
      });
      list.appendChild(loadMore);
    }
    list.classList.toggle('batching', batchMode);
    wireQItems(list, root);

    /* 详情面板必须与当前筛选集一致。选中项被筛掉时(切专题/难度/关键词),详情会停在
       列表里已不存在的题上,分页分母还会因 NavCtx 回退全量而虚高
       (实测:切到 RAG 后左栏 71 条,右栏却仍是 AG-001、指示器 1 / 349)。
       首次渲染时 #q-detail 是空的,同样在这里补一次选中 —— 两个条件合成一处判断,
       避免「列表已换、详情没换」这种半同步状态。 */
    const detail = $('#q-detail', root);
    if (!ids.includes(DetailQid) || !detail || !detail.firstElementChild) {
      const next = (f.qid && ids.includes(f.qid)) ? f.qid : ids[0];
      if (next) select(root, f, next);
    }
  }

  function select(root, f, qid) {
    const request = ++detailRequest, route = location.hash;
    f.qid = qid; saveFilters(f);
    DetailQid = qid;
    $$('.q-item', root).forEach(el => el.classList.toggle('active', el.dataset.qid === qid));
    const q = Data.question(qid);
    if (!q) return;
    /* 详情面板渲染标准区块(答案/追问/理解检查)需要全量题字段(Track E):
       全量未合并时先上占位,就绪后重进本函数;此时列表/选中态已同步,不重做。 */
    if (q.answer === undefined && !q.followups && !q.sources) {
      $('#q-detail', root).innerHTML = '<div class="empty" role="status">题库加载中…</div>';
      (Data.ensureQuestion ? Data.ensureQuestion(qid) : Data.questionsReady()).then(() => {
        if (!root.isConnected || DetailQid !== qid || request !== detailRequest || location.hash !== route) return;
        select(root, filters(), qid);
        const detail = $('#q-detail', root);
        const focused = document.activeElement;
        // Filters remain mounted while the detail loads; keep an in-progress edit focused.
        const editing = focused && (/^(INPUT|TEXTAREA|SELECT)$/.test(focused.tagName) || focused.isContentEditable);
        if (detail && !editing && (focused === document.body || root.contains(focused))) detail.focus({ preventScroll: true });
      }).catch(() => {
        if (request !== detailRequest || location.hash !== route) return;
        $('#q-detail', root).innerHTML = '<div class="empty">' + (navigator.onLine === false ? '当前离线，尚未下载本题所属专题。' : '本题暂时无法加载。') + '<button class="btn" data-load-retry>重试</button></div>';
        $('[data-load-retry]', root).onclick = () => select(root, filters(), qid);
      });
      return;
    }
    Store.markViewed(qid);
    const nb = NavCtx.neighbors(qid);
    $('#q-detail', root).innerHTML = `
      <div class="detail-toolbar">
        <button class="btn btn-small" data-go="${nb.prev || ''}" ${nb.prev ? '' : 'disabled'}>← 上一题</button>
        <span class="muted">${nb.pos} / ${nb.total}</span>
        <button class="btn btn-small" data-go="${nb.next || ''}" ${nb.next ? '' : 'disabled'}>下一题 →</button>
        <span class="flex1"></span>
        ${QRender.focusToggle()}
        <a class="btn btn-small" href="#/study/${qid}">完整学习页</a>
      </div>
      ${QRender.recordBar(qid)}
      ${QRender.metaLine(q)}
      <h2 class="q-title-sm">${esc(q.title)}</h2>
      ${QRender.promptHtml(q)}
      <div class="rel-links">${QRender.relLinks(q)}</div>
      <div class="q-secs">${QRender.standardSections(q)}</div>`;
    wireDetail(root);
  }

  /* Fix3: 列表项事件绑定(分批渲染后每次追加都要重新绑定) */
  function wireQItems(list, root) {
    $$('.q-item', list).forEach(item => {
      if (item.dataset.wired) return;
      item.dataset.wired = '1';
      item.addEventListener('click', () => {
        select(root, filters(), item.dataset.qid);
      });
      item.addEventListener('keydown', e => {
        if (e.target !== item) return;
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(root, filters(), item.dataset.qid); }
      });
    });
  }

  function wireDetail(root) {
    QRender.wireFocusToggle(root);
    QRender.wireQuizToggle(root);
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

  /* 远端合并后的定向更新:当前详情的工具条就地同步;列表项徽章改文字与颜色。
     不重渲染列表/详情——保住已展开的答案区块与滚动位置。 */
  function applyRemote(changes) {
    const qids = changes.qids || [];
    if (!qids.length) return;
    const list = $('#q-list', document);
    qids.forEach(qid => {
      if (!Data.question(qid)) return;
      const item = list && list.querySelector(`.q-item[data-qid="${qid}"]`);
      if (item) {
        const st = Data.statusInfo(qid);
        const badge = item.querySelector('.badge.st-none, .badge.st-weak, .badge.st-ok, .badge.st-review');
        if (badge) { badge.className = 'badge ' + st.cls; badge.textContent = st.label; }
      }
    });
    if (DetailQid && qids.includes(DetailQid)) {
      const detail = $('#q-detail', document);
      if (detail) {
        QRender.syncRecordBar(detail, DetailQid);
        const meta = detail.querySelector('.q-meta');
        if (meta) {
          const badges = meta.querySelectorAll('.badge.st-none, .badge.st-weak, .badge.st-ok, .badge.st-review');
          badges.forEach(b => { const st = Data.statusInfo(DetailQid); b.className = 'badge ' + st.cls; b.textContent = st.label; });
        }
      }
    }
  }

  return { render, filters, apply, select: selectWrapper, applyRemote };
})();

/* ---------- 学习模式 ---------- */
const StudyView = (() => {
  let renderRequest = 0;
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
  function cleanup() { renderRequest++; setKeyHandler(null); }

  /* 同页动作前同步:把文本框值写进内存+立即落盘(重渲染将读 Store 最新值) */
  function captureNote(qid) {
    const ta = $('#note-area');
    if (!ta || !currentQid || qid !== currentQid) return;
    /* 只有用户真正编辑过(dirty)的输入才可提交:
       远端合并后的过时 DOM 值不是用户输入,写回会覆盖另一页已保存的新笔记(ST-02)。 */
    if (remoteNotePending !== null) { Store.saveNoteDraft(qid, ta.value); return; }
    if (ta.dataset.dirty === '1' && (Store.rec(qid).note || '') !== ta.value) {
      Store.setNote(qid, ta.value);
      Store.saveNow();
    }
  }

  /* pagehide/路由离开兜底:只提交 dirty 的输入。
     每次击键已同步进内存;非 dirty 的过时 DOM 值一律不写回——
     「值不相等」不再被当成用户编辑(远端合并也会造成不相等)。 */
  function flushNote() { if (currentQid) captureNote(currentQid); }

  /* ---- 远端合并后的定向更新(ST-01f/ST-02) ----
     只处理当前题;未编辑的笔记框就地更新(焦点/选区/滚动/展开状态不动);
     用户正在编辑同字段时保留本地输入,暂存对方版本并给出显式处置入口,不静默替用户选择。 */
  let remoteNotePending = null;
  function applyRemote(changes) {
    if (!currentQid || !(changes.qids || []).includes(currentQid)) return;
    const r = Store.rec(currentQid);
    const ta = $('#note-area');
    if (ta) {
      if ((changes.sections || []).includes('reset')) {
        ta.value = r.note || ''; ta.dataset.dirty = '0';
        clearRemoteNotice();
      }
      const dirty = ta.dataset.dirty === '1';
      const remoteNote = r.note || '';
      if (!dirty) {
        if (ta.value !== remoteNote) { ta.value = remoteNote; ta.dataset.dirty = '0'; }
        clearRemoteNotice();
      } else if (ta.value !== remoteNote) {
        const newCanonicalConflict = remoteNotePending !== remoteNote;
        remoteNotePending = remoteNote;
        if (newCanonicalConflict) Store.saveNoteDraft(currentQid, ta.value);
        showRemoteNoteNotice();
      }
    }
    /* 记录工具条(状态按钮/收藏/到期提示)就地同步 */
    const bar = $('.record-bar', root() || document);
    if (bar) QRender.syncRecordBar(bar, currentQid);
  }
  function root() { return document.getElementById('view'); }
  function clearRemoteNotice() {
    const box = document.getElementById('remote-note-conflict');
    if (box) box.remove();
    remoteNotePending = null;
  }
  function showRemoteNoteNotice() {
    let box = document.getElementById('remote-note-conflict');
    if (!box) {
      const ta = $('#note-area');
      if (!ta) return;
      box = document.createElement('div');
      box.id = 'remote-note-conflict';
      box.className = 'notice warn';
      box.style.marginTop = '6px';
      box.innerHTML = '<b>另一个标签页也保存了这道题的笔记</b>:你的输入已保留,没有被覆盖。'
        + '<button class="btn btn-small" id="rn-view" type="button">查看对方版本</button> '
        + '<button class="btn btn-small" id="rn-mine" type="button">保留我的</button> '
        + '<button class="btn btn-small btn-primary" id="rn-theirs" type="button">采用对方版本</button>';
      ta.insertAdjacentElement('afterend', box);
      $('#rn-view', box).addEventListener('click', () => {
        modal('对方保存的笔记版本', '<pre class="code">' + esc(remoteNotePending || '') + '</pre>', [{ label: '关闭' }]);
      });
      $('#rn-mine', box).addEventListener('click', () => {
        Store.setNote(currentQid, ta.value);
        if (!Store.saveNoteDraft(currentQid, ta.value, true)) return;
        clearRemoteNotice();
        ta.dataset.dirty = '0';
      });
      $('#rn-theirs', box).addEventListener('click', () => {
        ta.value = remoteNotePending || '';
        ta.dataset.dirty = '0';
        Store.setNote(currentQid, ta.value);
        if (!Store.saveNoteDraft(currentQid, ta.value, true)) return;
        clearRemoteNotice();
        toast('已采用对方版本');
      });
    }
  }

  /* 搜索/锚点定位:展开对应区块并滚动(检查题同时揭示答案;笔记滚动到输入框)。
     通过搜索明确打开命中内容属于有意揭示,与默认折叠不冲突。 */
  function revealAnchor(root, anchor) {
    if (!anchor) return;
    const request = renderRequest, route = location.hash;
    setTimeout(() => {
      if (!root.isConnected || request !== renderRequest || location.hash !== route) return;
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
    /* 显式打开的命中区块必须参与排版。content-visibility:auto 在滚动后的
       可见性重算期间可能再次跳过正文,导致已高亮的锚点短暂空白。仅固定目标区块,
       其余长区块仍按需排版;先排版再测量,不拿占位高度计算定位。 */
    el.style.contentVisibility = 'visible';
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
    const request = ++renderRequest, route = location.hash;
    let q = Data.question(qid);
    /* 壳里只有索引元数据，正文只等待本题所属分片。
       导入题/完整存档直接渲染；加载失败保留重试入口。 */
    if (q && q.answer === undefined && !q.followups && !q.sources) {
      root.innerHTML = '<div class="empty" role="status">题库加载中…</div>';
      (Data.ensureQuestion ? Data.ensureQuestion(qid) : Data.questionsReady()).then(() => {
        if (!root.isConnected || request !== renderRequest || location.hash !== route) return;
        render(root, qid, anchor);                      /* 就绪后按同一 qid 重进;缺失走下方空态 */
        if (document.activeElement === document.body || root.contains(document.activeElement)) root.focus({ preventScroll: true });
      }).catch(() => {
        if (request !== renderRequest || location.hash !== route) return;
        root.innerHTML = '<div class="empty">' + (navigator.onLine === false ? '当前离线，尚未下载本题所属专题。' : '本题暂时无法加载。') + '<button class="btn" data-load-retry>重试</button></div>';
        $('[data-load-retry]', root).onclick = () => render(root, qid, anchor);
      });
      return;
    }
    if (!q) { root.innerHTML = '<div class="empty">题目不存在:' + esc(qid) + '</div>'; return; }
    currentQid = qid;
    remoteNotePending = null;
    Store.markViewed(qid);
    const nb = NavCtx.neighbors(qid);
    /* 内容修订提醒:实质修订过且你还没确认过新版 → 提示;旧笔记/记录保留,由你决定 */
    const cv = q.content_version;
    const needRevNotice = !!(cv && Store.rec(qid).contentRev !== cv.rev);
    root.innerHTML = `
      <div class="study-wrap">
        ${q.archived ? '<p class="notice">这道题已归入历史存档。旧笔记和练习仍保留，统计与新抽题使用当前题库。</p>' : ''}
        ${needRevNotice ? `
        <div class="notice rev-notice" data-rev-notice>
          <b>♻ 本题内容有更新(${esc(cv.rev)})</b>:${esc(cv.summary)}
          ${(cv.changes || []).length ? `<details class="rev-changes-box"><summary>改了哪些(共 ${cv.changes.length} 条)</summary><ul class="rev-changes">${cv.changes.map(c => `<li>${esc(c)}</li>`).join('')}</ul></details>` : ''}
          <div class="btn-row" style="margin-top:6px">
            <button class="btn btn-small btn-primary" data-rev-redo>标记待复习(重做)</button>
            <button class="btn btn-small" data-rev-ack>知道了(旧笔记与记录保留)</button>
          </div>
        </div>` : ''}
        <div class="detail-toolbar">
          <button class="btn btn-small" data-nav="${nb.prev || ''}" ${nb.prev ? '' : 'disabled'}>← 上一题</button>
          <button class="btn btn-small" data-nav="${nb.next || ''}" ${nb.next ? '' : 'disabled'}>下一题 →</button>
          <span class="muted">${nb.pos} / ${nb.total}</span>
          <span class="flex1"></span>
          ${QRender.focusToggle()}
          <button class="btn btn-small" id="collapse-all">折叠全部</button>
        </div>
        ${QRender.recordBar(qid)}
        ${leechNotice(qid)}
        ${QRender.metaLine(q)}
        <h1 class="q-title">${esc(q.title)}</h1>
        ${QRender.promptHtml(q)}
        <div class="rel-links">${QRender.relLinks(q)}</div>
        <div class="q-secs">${QRender.standardSections(q)}</div>
        <div class="q-note-box">
          <label class="note-label">为什么没掌握(可多选,排进今日复习的理由)</label>
          <div class="reason-group" id="reason-group">
            ${[['concept', '概念不清'], ['prereq', '前置缺失'], ['causal', '因果混淆'], ['exec', '代码执行误判'], ['edge', '边界没考虑'], ['expression', '表达不完整']].map(([v, label]) => {
              const on = (Store.rec(qid).reviewReasons || []).includes(v);
              return `<label class="chk"><input type="checkbox" data-reason="${v}" ${on ? 'checked' : ''}> ${label}</label>`;
            }).join('')}
          </div>
          <label class="note-label" style="margin-top:8px">我的笔记(参与全文搜索)</label>
          <textarea id="note-area" data-dirty="0" placeholder="写下你的理解、易错点或自己的例子……">${esc(Store.rec(qid).note || '')}</textarea>
          ${Store.rec(qid).noteDraft ? '<button class="btn btn-small" id="note-versions">查看保留的输入副本</button>' : ''}
        </div>
      </div>`;
    wire(root, qid);
    const versionsButton = $('#note-versions', root);
    if (versionsButton) versionsButton.addEventListener('click', () => {
      const draft = Store.rec(qid).noteDraft || {};
      const versions = Object.values(draft.versions || { current: { text: draft.text || '' } });
      modal('保留的冲突输入副本', versions.map(v => '<pre>' + esc(v.text) + '</pre>').join(''), [{ label: '关闭' }]);
    });
    const pending = Store.rec(qid).noteDraft;
    if (pending && !pending.resolved) {
      const ta = $('#note-area');
      ta.value = pending.text; ta.dataset.dirty = '1';
      remoteNotePending = Store.rec(qid).note || '';
      showRemoteNoteNotice();
    }
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

  /* 顽固弱点(Stage3):lapses ≥ SRS.LEECH_LAPSES 的题在学习页给提示与出口。
     继续排期对这类题收效有限,拆解重练(题目自带的追问二跳)才是正解。 */
  function leechNotice(qid) {
    if (typeof SRS === 'undefined' || !SRS.isLeech || !SRS.isLeech(Store.rec(qid))) return '';
    const lapses = (Store.rec(qid).srs || {}).lapses || 0;
    return `
      <div class="notice" style="border-color:var(--warn,#d97706);background:#fffbeb;margin:8px 0">
        <b>⚠ 顽固弱点</b>
        <span class="small muted" style="margin-left:6px">这道题已经反复遗忘了 ${lapses} 次——靠「再看一遍」收效有限。建议把它开成定向自测:先自己完整讲一遍,再对照参考,顺着追问二跳把漏洞逐层挖出来。</span>
        <div style="margin-top:6px"><button class="btn btn-small" id="leech-drill">🎯 拆解重练</button></div>
      </div>`;
  }

  function wire(root, qid) {
    QRender.wireFocusToggle(root);
    QRender.wireQuizToggle(root);
    const leechBtn = $('#leech-drill', root);
    if (leechBtn) leechBtn.addEventListener('click', () => MockView.startDirected([qid], '顽固弱点重练'));
    $$('.q-sec-head', root).forEach(h => {
      h.addEventListener('click', () => {
        const sec = h.parentElement;
        sec.classList.toggle('open');
        $('.q-sec-arrow', sec).textContent = sec.classList.contains('open') ? '−' : '+';
      });
    });
    /* 「展开全部」已删除:默认就是全展开,这个按钮按下去什么都不会发生。
       「折叠全部」保留 —— 它和「只看题干」不同:前者保留区块标题(能看清这题
       有哪些部分),后者整块隐藏(纯自测)。 */
    $('#collapse-all', root).addEventListener('click', () => {
      $$('.q-sec', root).forEach(s => { s.classList.remove('open'); $('.q-sec-arrow', s).textContent = '+'; });
    });
    $$('[data-status]', root).forEach(b => {
      b.addEventListener('click', () => {
        captureNote(qid);              /* 重渲染前同步笔记(内存已最新,此处确保磁盘) */
        Store.setStatus(qid, b.dataset.status);
        render(root, qid);
      });
    });
    $('[data-fav]', root).addEventListener('click', () => {
      captureNote(qid);
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
    /* 每次击键同步进内存学习状态(Store),磁盘写入防抖(250ms);
       这样任何后续重渲染读 Store 都是最新值,不会拿旧记录覆盖文本框。 */
    note.addEventListener('input', () => {
      note.dataset.dirty = '1';
      if (remoteNotePending !== null) { Store.saveNoteDraft(qid, note.value); return; }
      const r = Store.rec(qid);
      if (r.note !== note.value) { r.note = note.value; r._updatedAt = Date.now(); Store.save(); }
    });
    note.addEventListener('input', debounce(() => {
      window.rebuildIndex();   /* 索引重建可防抖;内存已同步 */
    }, 400));
    $$('[data-nav]', root).forEach(b => {
      b.addEventListener('click', () => { captureNote(qid); if (b.dataset.nav) go('#/study/' + b.dataset.nav); });
    });
    /* 修订提醒:重做 → 标待复习并记录已读新版;知道了 → 只记录已读,不清任何记录 */
    const revBox = $('[data-rev-notice]', root);
    if (revBox) {
      const cv = (Data.question(qid) || {}).content_version;
      const ack = () => { const r = Store.rec(qid); r.contentRev = cv.rev; r._updatedAt = Date.now(); Store.saveNow(); };
      $('[data-rev-redo]', revBox).addEventListener('click', () => {
        captureNote(qid); ack(); Store.setStatus(qid, 'review'); toast('已标记待复习;你的笔记与历史保留'); render(root, qid);
      });
      $('[data-rev-ack]', revBox).addEventListener('click', () => { captureNote(qid); ack(); render(root, qid); });
    }
    /* 键盘快捷键:← 上一题 → 下一题。
       焦点在按钮/链接/输入框等交互控件上时不拦截(保留 Space/Enter 原生激活)。
       曾经还把空格绑到「展开全部」——该功能早已移除,$('#expand-all') 永远为 null,
       但 e.preventDefault() 照吞不误,导致学习页任何非交互焦点下按空格打不出空格,已删。 */
    setKeyHandler((e) => {
      if (isInteractiveTarget(e.target)) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'ArrowLeft') { const b = $('[data-nav]', root); if (b && !b.disabled) b.click(); }
      if (e.key === 'ArrowRight') { const btns = $$('[data-nav]', root); if (btns.length > 1 && !btns[1].disabled) btns[1].click(); }
    });
  }

  function currentCtx() {
    return {
      contentVersion: Data.contentVersionOf(),
      questions: Data.allQuestions(),
      docs: Data.allDocs(),
      userDocs: Data.allUserDocs(),
      records: Store.data,
      concepts: (window.APP_DATA.concepts && window.APP_DATA.concepts.concepts) || [],
      projects: (window.APP_DATA.projects && window.APP_DATA.projects.projects) || [],
      drills: (window.APP_DATA.paths.paths || []).flatMap(p => p.stages).flatMap(s => (s.drills || []).map(d => ({ ...d, stage: s.id }))),
      drillAttempts: Store.data.drillAttempts || {}
    };
  }

  return { render, checkHtml, currentCtx, cleanup, flushNote, applyRemote };
})();

/* ---------- 自测与模拟面试 ----------
   会话状态(含未写完的回答草稿)实时落盘 Store.data.mock.draft:
   切题/对照/复盘/翻页即保存,刷新或离开后可从配置页恢复继续;完成或放弃才清除。 */
const MockView = (() => {
  let state = null; /* {config, items:[{qid}], idx, answers:{qid:{self, revealed, mark}}, directed, label, sid, sessionId} */
  let sessionSeq = 0;
  let renderRequest = 0;
  const clone = value => JSON.parse(JSON.stringify(value));

  /* 跨页稳定的会话身份(SP-06):完成/放弃登记进 mock.ended,
     其它页据此拒绝旧草稿复活;旧数据无 sessionId 时按内容补确定性 ID。 */
  function newSessionId() { return 'ms-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8); }
  function sessionIdentity(d) { return d && (d.sessionId || ('legacy-' + Store.contentHash(JSON.stringify([d.savedAt, d.items])))); }

  function draftLoad() { return (Store.data.mock && Store.data.mock.draft) || null; }
  function activeSession() {
    if (!state || state.ended) return false;
    const result = Store.refreshFromDisk();
    if (!result.ok) { toast('读取最新会话失败:' + result.error, 'err'); return false; }
    const reset = [Store.data.resetEpoch || 0, Store.data.resetTs || 0].join('|');
    if (!state.resetVersion) state.resetVersion = reset;
    if (Store.data.mock.ended[state.sessionId] || state.resetVersion !== reset) {
      state.ended = true;
      const host = document.querySelector('.mock-run');
      if (host) {
        host.querySelectorAll('textarea, button').forEach(el => { el.disabled = true; });
        const notice = document.createElement('p'); notice.className = 'notice';
        notice.textContent = '此会话已在另一页结束或记录已清空，当前输入未作为新练习保存。请返回自测页开始新会话。';
        host.prepend(notice);
      }
      return false;
    }
    return true;
  }
  function applyRemote() { if (state && !state.ended) activeSession(); }
  function questionForSession(qid) {
    const ans = state.answers[qid] || (state.answers[qid] = { self: '', revealed: false, mark: '' });
    if (!ans.questionSnapshot) {
      const current = Data.question(qid);
      if (!current) return null;
      if (state.guideSnapshot) {
        ans.snapshotCapturedLate = !!(ans.self || ans.revision || ans.revealed || Object.keys(ans.fu || {}).length);
        ans.questionSnapshot = ExpressCard.questionForGuide(current, state.guideSnapshot);
        return ans.questionSnapshot;
      }
      /* 索引元数据不能存成永久快照。renderRun 按题加载，
         尚未访问的题保持无快照；旧草稿完整快照不依赖当前题库。 */
      if (current.answer === undefined && !current.followups && !current.sources) return null;
      ans.snapshotCapturedLate = !!(ans.self || ans.revision || ans.revealed || Object.keys(ans.fu || {}).length);
      ans.questionSnapshot = JSON.parse(JSON.stringify(Object.fromEntries(
        ['id','title','format','options','qtype','topic','type','difficulty','tags','prompt','answer','plain','interview','pitfalls','fusion_notes','followups','content_version']
          .filter(k => current[k] !== undefined).map(k => [k, current[k]]))));
      ans.qRev = ans.qRev || (current.content_version && current.content_version.rev) || '';
    }
    return ans.questionSnapshot;
  }

  function draftOf(s) {
    return clone({ config: s.config, items: s.items, idx: s.idx, answers: s.answers,
      directed: !!s.directed, label: s.label || '', savedAt: Date.now(), sessionId: s.sessionId,
      qms: s.qms || {}, durationMs: s.durationMs || 0, guideId: s.guideId, guideSnapshot: s.guideSnapshot });
  }
  function stateOf(d) {
    return Object.assign(clone(d), { config: d.config || { count: d.items.length }, answers: clone(d.answers || {}),
      idx: Math.min(Math.max(d.idx || 0, 0), d.items.length - 1),
      sessionId: sessionIdentity(d),
      sid: ++sessionSeq, ended: false, qms: clone(d.qms || {}), durationMs: d.durationMs || 0, qStartAt: null });
  }
  function draftSave() {
    if (!activeSession()) return false;
    Store.data.mock.draft = draftOf(state);
    const ok = Store.saveNow();
    state.saveError = !ok;
    const indicator = $('#mock-save-status');
    if (indicator) indicator.textContent = ok ? '草稿已保存' : '保存失败，回答保留在当前页面，请重试';
    return ok;
  }
  /* 会话终结登记:completed(有轮次)/abandoned(放弃)——终态优先于旧草稿 */
  function markEnded(sessionId, status) {
    if (!sessionId) return;
    Store.data.mock.ended = Store.data.mock.ended || {};
    const cur = Store.data.mock.ended[sessionId];
    if (!cur || status === 'completed' || (cur.ts || 0) > Date.now()) {
      Store.data.mock.ended[sessionId] = { status, ts: Date.now() };
    }
  }
  /* 草稿的追问回答统一为按 ID 的对象存储(SP-02):
     { [fuId]: {id, q(作答时题面), self, revealed} };
     旧格式(数组下标键 0/1/…)无法确定与当前题面的对应关系——
     保留原文并标记 legacy,渲染为「待核对」,绝不按位置绑到另一道追问。 */
  function normalizeFu(raw) {
    const out = { fu: {}, legacy: [] };
    if (!raw) return out;
    if (Array.isArray(raw)) {
      raw.forEach((entry, i) => {
        if (entry && typeof entry === 'object' && entry.id) out.fu[entry.id] = JSON.parse(JSON.stringify(entry));
        else if (entry && typeof entry === 'object' && ((entry.self || '').trim() || entry.revealed)) {
          out.legacy.push({ legacyIndex: i, self: String(entry.self || ''), revealed: !!entry.revealed });
        }
      });
      return out;
    }
    Object.keys(raw).forEach(k => {
      const entry = raw[k];
      if (!entry || typeof entry !== 'object') return;
      if (/^\d+$/.test(k)) {
        if ((entry.self || '').trim() || entry.revealed) out.legacy.push({ legacyIndex: Number(k), self: String(entry.self || ''), revealed: !!entry.revealed });
      } else {
        out.fu[k] = JSON.parse(JSON.stringify(entry));
      }
    });
    return out;
  }

  /* 把输入框当前内容同步进会话(不经防抖)。所有离开当前题的动作前调用:
     下一题/上一题/对照/复盘/结束/完成/路由离开。
     同时同步追问二跳的回答框(按追问 ID):追问回答也是会话草稿的一部分。 */
  function captureInput() {
    const ta = $('#m-self');
    if (!ta || !state || state.ended || ta.dataset.sessionId !== state.sessionId) return;
    const id = state.items[state.idx].qid || state.items[state.idx].id;
    const q = questionForSession(id) || { id };
    const ans = state.answers[q.id] || (state.answers[q.id] = {});
    let changed = false;
    if (!ta.readOnly && (ans.self || '') !== ta.value) {
      Object.assign(ans, { self: ta.value, qRev: q.content_version ? q.content_version.rev : '' });
      changed = true;
    }
    const revision = $('#m-revision');
    if (revision && revision.dataset.sessionId === state.sessionId && revision.dataset.questionId === id
        && (ans.revision || '') !== revision.value) {
      ans.revision = revision.value;
      changed = true;
    }
    $$('#mock-fu-list [data-fu-id]', document).forEach(el => {
      /* 与主回答同一条纪律(ST-02):只有用户真实编辑过(dirty)的输入才可提交;
         未编辑的过时 DOM 值不得覆盖 session/Store 里的已有内容 */
      if (el.dataset.dirty !== '1') return;
      const id = el.dataset.fuId;
      const fq = el.dataset.fuQ || '';
      const cur = (state.answers[q.id].fu = state.answers[q.id].fu || {})[id] || { id, q: fq };
      if ((cur.self || '') !== el.value) {
        cur.self = el.value;
        cur.q = fq;                     /* 作答时题面快照 */
        state.answers[q.id].fu[id] = cur;
        changed = true;
      }
    });
    if (changed) draftSave();
  }
  /* pagehide 兜底:与 captureInput 相同(名称保留供 App.flush 调用) */
  function flushDraft() {
    stopCountdown(); stopMic();
    if (!state || state.ended) return true;
    captureInput();
    if (state.qStartAt == null) return !state.saveError;
    settleQms();
    state.qStartAt = null;
    return draftSave();
  }

  /* 计时(Track A):结算当前题自上次进入以来的时长,累加进 qms[qid] 并重置起点。
     供所有离开当前题的动作调用(自评/导航/结束);state 缺计时字段时静默初始化,
     旧草稿/异常路径不因计时崩溃。 */
  function settleQms() {
    if (!state || state.ended) return;
    const q = state.items[state.idx] || {};
    const id = q.qid || q.id;
    if (!id) return;
    if (state.qStartAt == null) return;
    const now = Date.now();
    if (now > state.qStartAt) {
      state.qms = state.qms || {};
      state.qms[id] = (state.qms[id] || 0) + (now - state.qStartAt);
      state.durationMs = (state.durationMs || 0) + (now - state.qStartAt);
    }
    state.qStartAt = now;   /* 重置起点:同一题多次结算只计新增段 */
  }

  /* 切换只有一个提交点:先保存完整的候选 mock，再更换编辑态和路由。
     失败时原草稿/副本/终态一起回滚，重试不会把旧回答抹掉。 */
  function switchSession(candidate, disposition, expectedId) {
    if (!flushDraft()) return false;
    const fresh = Store.refreshFromDisk();
    if (!fresh.ok) { toast('读取最新草稿失败，请重试', 'err'); return false; }
    const current = draftLoad();
    const currentId = sessionIdentity(current);
    if ((currentId || '') !== (expectedId || '')) {
      toast('草稿已在另一页变化，请关闭弹窗后重新选择。', 'err'); return false;
    }
    const before = clone(Store.data.mock);
    const next = clone(before);
    next.alternates = (next.alternates || []).filter(d => sessionIdentity(d) !== candidate?.sessionId);
    if (current && currentId !== candidate?.sessionId) {
      if (disposition === 'keep') {
        next.alternates = next.alternates.filter(d => sessionIdentity(d) !== currentId);
        next.alternates.push({ ...clone(current), sessionId: currentId });
      } else if (disposition === 'discard') {
        next.ended = next.ended || {};
        next.ended[currentId] = { status: 'abandoned', ts: Date.now() };
      }
    }
    next.draft = candidate ? clone(candidate) : null;
    Store.data.mock = next;
    if (!Store.saveNow()) {
      Store.data.mock = before;
      toast('切换未保存，原草稿完整保留。恢复存储后可重试。', 'err');
      return false;
    }
    if (state) state.ended = true;
    state = candidate ? stateOf(candidate) : null;
    if (candidate) {
      if (location.hash === '#/mock/run') renderRun($('#view'));
      else go('#/mock/run');
    }
    return true;
  }

  function continueDraft() {
    const d = draftLoad();
    if (!d || !d.items?.length) return false;
    state = stateOf(d);
    if (location.hash === '#/mock/run') renderRun($('#view')); else go('#/mock/run');
    return true;
  }

  function requestSession(candidate) {
    candidate = { ...clone(candidate), sessionId: sessionIdentity(candidate), savedAt: Date.now() };
    if (!flushDraft()) { toast('请先保存当前回答，再开始新练习。', 'err'); return; }
    const fresh = Store.refreshFromDisk();
    if (!fresh.ok) { toast('读取最新草稿失败，请重试。', 'err'); return; }
    const d = draftLoad();
    if (!d || !d.items?.length) { switchSession(candidate, 'keep', ''); return; }
    const expectedId = sessionIdentity(d);
    modal('保留未完成的练习', `<p>「${esc(d.label || '上次自测')}」还有未完成内容。请选择如何处理。</p><p class="muted small">保留的草稿可在自测页继续；只有保存成功才会切换。</p>`, [
      { label: '继续上次练习', primary: true, onClick: continueDraft },
      { label: '保留草稿并开始新练习', onClick: () => switchSession(candidate, 'keep', expectedId) },
      { label: '放弃旧草稿并开始新练习', danger: true, onClick: () => switchSession(candidate, 'discard', expectedId) }
    ]);
  }

  /* 每次进入不同题重新计时；同题判题/揭示等重绘保留剩余时间。
     隐藏/离开页面暂停，恢复后续计；刷新恢复仍从本题限时起点开始，
     已练时长独立由 qms 累计。超时出口先捕获未防抖的输入。 */
  let countdownTimer = null, countdownClock = null;
  function stopCountdown() {
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (countdownClock && countdownClock.deadline !== null) {
      countdownClock.remaining = Math.max(0, countdownClock.deadline - Date.now());
      countdownClock.deadline = null;
    }
  }
  function armCountdown(qid) {
    stopCountdown();
    if (!state || state.ended || document.hidden || !state.config.timeLimitSec) return;
    const sid = state.sid;
    if (!countdownClock || countdownClock.sid !== sid || countdownClock.qid !== qid) {
      countdownClock = { sid, qid, remaining: state.config.timeLimitSec * 1000, deadline: null };
    }
    const deadline = countdownClock.deadline = Date.now() + countdownClock.remaining;
    const fmt = (ms) => {
      const s = Math.max(0, Math.ceil(ms / 1000));
      return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    };
    countdownTimer = setInterval(() => {
      /* 定时器回调一律重查 DOM(计时牌随 renderRun 重建,闭包里的旧节点已脱离文档) */
      const el = document.getElementById('m-countdown');
      if (!state || state.ended || state.sid !== sid || location.hash !== '#/mock/run') { stopCountdown(); return; }
      const cur = state.items[state.idx] || {};
      if ((cur.qid || cur.id) !== qid) { stopCountdown(); return; }   /* 已手动换题 */
      const remain = deadline - Date.now();
      if (remain <= 0) {
        stopCountdown();
        captureInput();
        if (!activeSession()) return;
        state.answers[qid] = Object.assign(state.answers[qid] || {}, { timeout: true });
        settleQms();
        state.qStartAt = null;
        stopMic();
        toast('⏰ 时间到,已自动进入下一题');
        if (state.idx < state.items.length - 1) { state.idx++; draftSave(); renderRun(rootEl()); }
        else finish(rootEl());
        return;
      }
      if (el) {
        el.textContent = fmt(remain);
        el.classList.toggle('mock-cd-warn', remain < 30000);
      }
    }, 250);
    const el0 = document.getElementById('m-countdown');
    if (el0) el0.textContent = fmt(countdownClock.remaining);
  }
  /* renderRun 的递归入口需要 root;#view 是路由常驻容器,取当前实例 */
  function rootEl() { return document.getElementById('view') || document.body; }

  /* ---- 语音口述输入(Stage2)----
     Web Speech API 由浏览器提供，可能使用浏览器的联网识别服务。连续模式:最终结果追加进回答框
     (保留手写内容,句读补「。」),中间结果只上屏到提示行不动正文。
     Firefox 等无实现时按钮整个不渲染(无死 UI);Chrome 静音自动停 → onend 续录,
     权限拒绝/无声音等错误 toast 原因并干净收尾。 */
  let micRec = null, micOn = false;
  function stopMic() {
    micOn = false;
    if (micRec) {
      const rec = micRec; micRec = null;
      rec.onresult = rec.onerror = rec.onend = null;
      try { rec.stop(); } catch (e) {}
    }
    const btn = document.getElementById('m-mic');
    if (btn) { btn.classList.remove('recording'); btn.textContent = '🎤 口述输入'; }
    const live = document.getElementById('mic-live');
    if (live) live.textContent = '';
  }

  function render(root, parts) {
    renderRequest++;
    if (parts && parts[0] === 'run') {
      if (!state) {
        const d = draftLoad();
        if (d && Array.isArray(d.items) && d.items.length) {
          state = stateOf(d);
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
    const alternates = (Store.data.mock.alternates || []).filter(d => d.items?.length && !Store.data.mock.ended?.[d.sessionId]);
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
      ${alternates.length ? `<details class="card" style="margin-bottom:12px"><summary>保留的练习草稿 · ${alternates.length} 份</summary>${alternates.map((d, i) => `<p>${esc(d.label || '自测')} · ${d.items.length} 题 · ${fmtTime(d.savedAt)} <button class="btn btn-small" data-m-alternate="${i}">继续这份草稿</button></p>`).join('')}</details>` : ''}
      <div class="card mock-config">
        <h2>自测 / 模拟面试</h2>
        <p class="muted">参考答案默认隐藏:先在输入框写下你的回答,再对照参考要点并自我复盘。抽题会优先选择你最近没有练过的题。未完成的轮次会自动保存草稿,刷新后可继续。</p>
        <div class="notice" style="border-color:var(--primary);background:#eff6ff">
          <b>追问梯度(自我检查):</b>概念是什么 → 为什么这样设计 → 代码怎么写 → 边界条件 → 出错怎么排查 → 方案怎么取舍。
          <span class="muted small">答不上某层就回到对应题目,别背整段稿。</span>
        </div>
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
        <div class="form-row">
          <label>练习模式</label>
          <div class="chk-group">
            <label class="chk"><input type="checkbox" id="m-exam"> 考试模式(答完统一对答案)</label>
            <label class="chk">单题限时
              <select id="m-tlimit" class="input" style="width:auto;margin-left:6px">
                <option value="0" selected>不限时</option>
                <option value="0.5">30 秒</option><option value="1">1 分钟</option>
                <option value="2">2 分钟</option><option value="3">3 分钟</option>
                <option value="5">5 分钟</option><option value="8">8 分钟</option>
                <option value="15">15 分钟</option>
              </select>
            </label>
          </div>
          <p class="muted small" style="margin:4px 0 0">考试模式练习「限时组织语言」:期间不显示参考要点或选择题对错,完成本轮后统一对照。限时到自动进入下一题,超时的题会打 ⏰ 标记。</p>
        </div>
        <button class="btn btn-primary" id="m-start">开始练习</button>
      </div>`;
    if (hasDraft) {
      $('#m-resume', root).addEventListener('click', continueDraft);
      $('#m-discard', root).addEventListener('click', () => {
        const d = draftLoad();
        if (!d) return;
        modal('放弃这份草稿？', '<p>这会删除本次未完成回答。已完成的历史轮次会保留。</p>', [
          { label: '继续保留', primary: true },
          { label: '确认放弃', danger: true, onClick: () => {
            if (!switchSession(null, 'discard', sessionIdentity(d))) return false;
            toast('已放弃未完成的草稿'); renderConfig(root);
          } }
        ]);
      });
    }
    $$('[data-m-alternate]', root).forEach(btn => btn.addEventListener('click', () => requestSession(alternates[Number(btn.dataset.mAlternate)])));
    $('#m-start').addEventListener('click', () => {
      const selTopics = $$('#m-topics input:checked').map(i => i.value);
      const selDiffs = $$('#m-diffs input:checked').map(i => i.value);
      const count = parseInt($('#m-count').value, 10);
      /* Stage2:考试模式(期间不揭示参考)+ 单题限时(秒;0=不限时)。
         config 随会话/轮次落盘,renderRun/renderDone/复习历史都从 config 读。 */
      const examMode = $('#m-exam').checked;
      const timeLimitSec = Math.round(parseFloat($('#m-tlimit').value) * 60) || 0;
      const pool = Data.allQuestions().filter(q => selTopics.includes(q.topic) && selDiffs.includes(q.difficulty));
      if (!pool.length) { toast('没有符合条件的题目,请放宽筛选', 'err'); return; }
      /* 抽题只需索引；进入每一题时由 renderRun 按需加载正文。 */
      requestSession({
        config: { topics: selTopics, diffs: selDiffs, count, examMode, timeLimitSec },
        items: sample(pool, Math.min(count, pool.length)).map(q => ({ qid: q.id })),
        idx: 0, answers: {}, directed: false, label: '',
        sessionId: newSessionId(),
        savedAt: Date.now(), qms: {}, durationMs: 0
      });
    });
  }

  /* 定向复习入口(今日复习/错题本重做等):只包含给定队列的普通自测会话 */
  function startDirected(qids, label, metadata = {}) {
    if (!qids || !qids.length) { toast('队列为空', 'err'); return; }
    const ids = [...new Set(qids)].filter(id => Data.question(id));
    if (!ids.length) { toast('队列中的题目已不存在', 'err'); return; }
    requestSession({
        config: { topics: [], diffs: [], count: ids.length, label: label || '定向复习' },
        items: ids.map(id => ({ qid: id })),
        idx: 0, answers: {}, directed: true, label: label || '定向复习',
        sessionId: newSessionId(),
        savedAt: Date.now(), qms: {}, durationMs: 0,
        guideId: metadata.guideId, guideSnapshot: metadata.guideSnapshot ? clone(metadata.guideSnapshot) : undefined
    });
  }

  function sample(pool, n) {
    const recs = Store.data.questions;
    const unseen = pool.filter(q => !recs[q.id] || !recs[q.id].lastPracticedAt);
    const seen = pool.filter(q => recs[q.id] && recs[q.id].lastPracticedAt)
      .sort((a, b) => (recs[a.id].lastPracticedAt || 0) - (recs[b.id].lastPracticedAt || 0));
    return shuffle(unseen).concat(seen).slice(0, n);
  }

  /* 追问二跳:面试的真实压力在追问,不在主题。对照参考要点后出现,
     每个追问同样先写后看;回答进会话草稿(刷新可恢复),完成时记入轮次与表达卡。 */
  function renderFollowups(q, ans) {
    const fus = q.followups || [];
    const norm = normalizeFu(ans.fu);
    /* 孤儿回答:草稿里有 ID,但当前题库中不存在对应题面(被改写/删除)——
       保留原回答与作答时题面快照,标记待核对;不按位置绑定到其它追问(SP-02) */
    const currentIds = new Set(fus.map(f => fuId(q.id, f.q)));
    const orphans = Object.keys(norm.fu).filter(k => !currentIds.has(k)).map(k => norm.fu[k]);
    if (!fus.length && !norm.legacy.length && !orphans.length) return '';
    return `
      <div class="mock-fu" id="mock-fu-list">
        <h4>追问二跳(面试官会顺着你的回答往下挖)</h4>
        ${fus.map((f, i) => {
          const id = fuId(q.id, f.q);
          const st = norm.fu[id] || {};
          return `
          <div class="fu fu-mock" data-fu-item="${esc(id)}">
            <div class="fu-q">追问 ${i + 1}:${esc(f.q)}</div>
            <textarea data-fu-id="${esc(id)}" data-fu-q="${esc(f.q)}" data-dirty="0" class="mock-fu-self" placeholder="先写下你的回答(自动保存)……">${esc(st.self || '')}</textarea>
            ${st.revealed
              ? `<div class="fu-a" data-fu-reference="${esc(id)}" tabindex="-1">${QRender.mdHtml(f.a)}</div>`
              : `<button class="btn btn-small" data-fu-reveal="${esc(id)}">对照参考要点</button>`}
          </div>`;
        }).join('')}
        ${(orphans.length || norm.legacy.length) ? `
        <div class="fu fu-legacy">
          <div class="fu-q muted">⚠ 以下回答对应的追问题面在当前题库中已不存在或已被改写,保留原文待你核对:</div>
          ${orphans.map(e => `
            <div class="muted small" style="margin:4px 0">
              <span class="badge vf-todo">待核对</span> 题面(作答时):${esc(e.q || '(未记录)')} — 回答:${esc(e.self || '(未写)')}
            </div>`).join('')}
          ${norm.legacy.map(l => `
            <div class="muted small" style="margin:4px 0">
              <span class="badge vf-todo">待核对</span> 旧版草稿(题面未记录) — 回答:${esc(l.self || '(未写)')}
            </div>`).join('')}
        </div>` : ''}
      </div>`;
  }

  function renderRun(root, preserve = false, focusSelector = '') {
    if (!state || state.ended) return;
    stopCountdown(); stopMic();
    settleQms(); state.qStartAt = null;
    const request = ++renderRequest, route = location.hash, session = state.sessionId;
    const id = state.items[state.idx].qid || state.items[state.idx].id;
    const current = Data.question(id);
    const matches = () => request === renderRequest && state?.sessionId === session && !state.ended && location.hash === route;
    if (!state.answers[id]?.questionSnapshot && !state.guideSnapshot && current && current.answer === undefined && !current.followups && !current.sources) {
      root.innerHTML = '<div class="empty" role="status">正在加载本题…</div>';
      (Data.ensureQuestion ? Data.ensureQuestion(id) : Data.questionsReady()).then(() => {
        if (matches()) {
          renderRun(root);
          if (document.activeElement === document.body || root.contains(document.activeElement)) root.focus({ preventScroll: true });
        }
      }).catch(() => {
        if (!matches()) return;
        root.innerHTML = '<div class="empty">' + (navigator.onLine === false ? '当前离线，尚未下载本题所属专题；草稿已保留。' : '本题暂时无法加载，草稿已保留。') + '<button class="btn" data-load-retry>重试</button></div>';
        $('[data-load-retry]', root).onclick = () => renderRun(root);
      });
      return;
    }
    const q = questionForSession(id) || { id, title: id + ' · 题目已下架，原题面未记录' };
    const scroll = { x: window.scrollX, y: window.scrollY };
    const focused = preserve && document.activeElement;
    const focusId = focused?.id, focusFu = focused?.dataset?.fuId, focusMark = focused?.dataset?.mark;
    const selection = focused && typeof focused.selectionStart === 'number' ? [focused.selectionStart, focused.selectionEnd] : null;
    const qid = q.id;
    /* 计时(Track A):每次进入本题重置起点;离开本题的各出口(自评/上一题/下一题/完成)
       把「now - 起点」累加进 qms,而不是覆盖——用户回看旧题再花的时间也算练过 */
    state.qStartAt = document.hidden ? null : Date.now();
    const ans = state.answers[qid] || { self: '', revealed: false, mark: '' };
    const examMode = !!(state.config && state.config.examMode);
    const referenceOpen = !examMode && ans.revealed;
    const hasLimit = !!(state.config && state.config.timeLimitSec);
    const SRClass = window.SpeechRecognition || window.webkitSpeechRecognition;
    root.innerHTML = `
      <div class="card mock-run">
        <div class="mock-progress">
          <span>第 ${state.idx + 1} / ${state.items.length} 题${state.directed ? ` · ${esc(state.label || '定向复习')}` : ''}${examMode ? ' · <span class="badge b-topic">考试模式</span>' : ''}</span>
          ${hasLimit ? '<span class="mock-countdown" id="m-countdown" title="本题剩余时间">--:--</span>' : ''}
          <div class="progress"><div class="progress-in" style="width:${(state.idx / state.items.length) * 100}%"></div></div>
          <button class="btn btn-small" id="m-quit">结束本轮</button>
        </div>
        ${QRender.metaLine(q)}
        <h2 class="q-title-sm">${esc(q.title)}</h2>
        ${QRender.promptHtml(q)}
        ${q.sourceQuestionId ? `<p class="muted small">本次练习：训练单元主问 · <a href="#/study/${encodeURIComponent(q.sourceQuestionId)}">来源关联题 ${esc(q.sourceQuestionId)} · ${esc(q.sourceQuestionTitle || '')}</a> · 资料版本 ${esc(q.guideRevision || '')}</p>` : ''}
        ${q.format === 'quiz' ? QRender.quizOptionsHtml(q, ans.revealed, false, ans, { examMode }) : ''}
        ${q.referenceKind !== 'guide' && !q.options && Data.question(qid)?.format === 'quiz' ? '<p class="notice">旧练习未保存选项，原题面不完整；请打开当前题目重新练习。</p>' : ''}
        <label class="note-label" for="m-self">${referenceOpen ? '你的原回答' : '你的回答(先自己写,再对照)'}</label>
        ${SRClass && !referenceOpen ? '<div><button type="button" class="btn btn-small mic-btn" id="m-mic">🎤 口述输入</button><span class="muted small">由浏览器识别，可能联网；点击后才启用。</span><span class="muted small" id="mic-live" aria-live="polite"></span></div>' : ''}
        <textarea id="m-self" data-session-id="${esc(state.sessionId)}" class="mock-self" ${referenceOpen ? 'readonly aria-describedby="m-original-hint"' : ''} placeholder="像面试口述一样,写下你的答案要点……">${esc(ans.self || '')}</textarea>
        ${referenceOpen ? '<p id="m-original-hint" class="muted small">原回答已保留，请在下方修订或补充。</p>' : ''}
        <div class="muted small" role="status" aria-live="polite" id="mock-save-status">${state.saveError ? '保存失败，回答保留在当前页面，请重试' : '草稿已保存'}</div>
        <button class="btn btn-small" id="mock-save-retry">保存草稿</button>
        <div class="mock-actions">
          ${examMode
            ? '<p class="muted small" style="margin:6px 0">🔒 考试模式:参考要点已锁定,完成本轮后统一对照。</p>'
            : ''}
          ${!ans.revealed && !examMode
            ? '<button class="btn btn-primary" id="m-reveal">对照参考要点</button>'
            : !examMode && ans.revealed ? `<div class="mock-ref">
                 <h4 id="m-reference-title" tabindex="-1">${q.referenceKind === 'guide' ? '参考学习资料 · 60 秒口述' : '参考要点(直接答案)'}</h4>
                 ${QRender.mdHtml(q.answer)}
                 ${q.plain ? `<details><summary>${q.format === 'quiz' ? '展开解析' : '展开大白话解释'}</summary>${QRender.mdHtml(q.plain)}</details>` : ''}
                 ${q.interview ? `<details><summary>${q.referenceKind === 'guide' ? '参考学习资料 · 3 分钟展开' : '展开面试表达'}</summary>${QRender.mdHtml(q.interview)}</details>` : ''}
                 <a href="#/study/${qid}" target="_self">查看完整解析 →</a>
               </div>
               ${renderFollowups(q, ans)}
               <div class="mock-revision">
                 <label class="note-label" for="m-revision">参考后修订 / 补充</label>
                 <p id="m-revision-hint" class="muted small">用自己的话重写或补充，说明刚才遗漏的原理、边界或证据。这里单独保存，原回答与追问不会被覆盖。</p>
                 <textarea id="m-revision" data-session-id="${esc(state.sessionId)}" data-question-id="${esc(qid)}" class="mock-self" aria-describedby="m-revision-hint" placeholder="对照参考后，我会这样回答……">${esc(ans.revision || '')}</textarea>
               </div>
               <div class="mock-mark">
                 <span>自我复盘:</span>
                 <button class="status-btn st-ok ${ans.mark === 'ok' ? 'active' : ''}" data-mark="ok">基本掌握了</button>
                 <button class="status-btn st-weak ${ans.mark === 'weak' ? 'active' : ''}" data-mark="weak">还不熟</button>
                 <button class="status-btn st-review ${ans.mark === 'review' ? 'active' : ''}" data-mark="review">下次再练</button>
               </div>` : ''}
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
    /* 判分只使用本轮题面快照。回调在重绘前捕获尚未防抖的个人文字。 */
    QRender.wireQuizToggle(root, {
      question: q, examMode,
      canJudge: () => state && state.sid === sid && activeSession(),
      onJudge: ({ qid: judgeQid, correct, picked }) => {
        if (!state || state.ended || state.sid !== sid || judgeQid !== qid) return;
        captureInput();
        const a = state.answers[qid];
        a.revealed = !examMode; a.quizJudged = true; a.quizPicked = picked.slice(); a.quizCorrect = correct;
        if (!examMode && !correct) a.mark = 'weak';
        draftSave();
        renderRun(root, true, '[data-quiz-redo]:not([hidden])');
      },
      onRedo: ({ qid: redoQid }) => {
        if (!state || state.ended || state.sid !== sid || redoQid !== qid) return;
        captureInput();
        const a = state.answers[qid];
        delete a.quizPicked; delete a.quizCorrect; delete a.quizJudged;
        a.revealed = false;
        draftSave();
        renderRun(root, true, '[data-quiz-pick][tabindex="0"]');
      }
    });
    /* 判题和重做会替换触发控件；让键盘继续停在本题可操作的位置，
       并通过重做按钮的描述读出刚才的判题结果。 */
    const quizResult = $('[data-quiz-result]', root);
    if (quizResult) {
      quizResult.id = 'm-quiz-result';
      $('[data-quiz-redo]', root)?.setAttribute('aria-describedby', quizResult.id);
    }
    $('#mock-save-retry', root).onclick = () => { captureInput(); settleQms(); draftSave(); };
    selfBox.addEventListener('input', debounce(() => {
      if (!state || state.ended || state.sid !== sid || !selfBox.isConnected || selfBox.readOnly) return;
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { self: selfBox.value });
      /* 计时(Track A):自评落笔时结算一次,本题已花的时长先入账;
         后续再停留则由导航/结束时继续累计 */
      if (qid === (state.items[state.idx].qid || state.items[state.idx].id)) settleQms();
      draftSave();
    }, 200));
    const revisionBox = $('#m-revision', root);
    if (revisionBox) revisionBox.addEventListener('input', debounce(() => {
      if (!state || state.ended || state.sid !== sid || !revisionBox.isConnected) return;
      if (qid !== (state.items[state.idx].qid || state.items[state.idx].id)) return;
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { revision: revisionBox.value });
      settleQms();
      draftSave();
    }, 200));

    const revealBtn = $('#m-reveal');
    if (revealBtn) revealBtn.addEventListener('click', () => {
      captureInput();
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { revealed: true, self: selfBox.value });
      draftSave();
      renderRun(root, true, '#m-reference-title');
    });
    /* quiz 点击作答(Stage1):共用 common.js 的判定,判定完成后把同一信号写进
       会话草稿 —— 等价于一次「对照后自评」:答错记 mark=weak(完成轮次时经
       setStatus reschedule 排期,与复盘标记同一条路径),picked 存进草稿供轮次
       回看;答对只记 picked,不替用户自评。钩子绑定本题所属会话(sid),会话
       结束/更换后不得写回。 */

    /* 语音口述(Stage2):按钮存在 = 浏览器支持(不支持时根本不渲染,无死 UI) */
    const micBtn = $('#m-mic');
    if (micBtn) micBtn.addEventListener('click', () => {
      if (micOn) { stopMic(); return; }
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!SR) { toast('此浏览器不支持语音识别', 'err'); return; }
      let rec;
      try { rec = new SR(); } catch (e) { toast('语音识别启动失败', 'err'); return; }
      micRec = rec;
      rec.lang = 'zh-CN';
      rec.continuous = true;
      rec.interimResults = true;
      rec.onresult = (ev) => {
        if (!micOn || micRec !== rec || !state || state.ended || state.sid !== sid
            || (state.items[state.idx].qid || state.items[state.idx].id) !== qid
            || !selfBox.isConnected || selfBox.readOnly || location.hash !== '#/mock/run') return;
        let finalText = '', interim = '';
        for (let i = ev.resultIndex; i < ev.results.length; i++) {
          const t = ev.results[i][0].transcript || '';
          if (ev.results[i].isFinal) finalText += t; else interim += t;
        }
        const live = $('#mic-live');
        if (live) live.textContent = interim ? '听到:' + interim : '';
        if (finalText.trim()) {
          const cur = selfBox.value;
          selfBox.value = cur ? cur.replace(/\s+$/, '') + '。\n' + finalText.trim() : finalText.trim();
          selfBox.dispatchEvent(new Event('input'));   /* 走既有防抖落盘路径 */
        }
      };
      rec.onerror = (ev) => {
        if (micRec !== rec) return;
        const why = ev.error === 'not-allowed' ? '麦克风权限被拒绝'
          : ev.error === 'no-speech' ? '没有听到说话' : ev.error;
        toast('语音识别:' + why, 'err');
        stopMic();
      };
      rec.onend = () => {
        /* Chrome 对静音自动停:只要用户没点停止就续录,保持「一句话停顿后还能接着说」 */
        if (micOn && micRec === rec && state && !state.ended && state.sid === sid
            && selfBox.isConnected && location.hash === '#/mock/run') { try { rec.start(); } catch (e) { stopMic(); } }
      };
      micOn = true;
      micBtn.classList.add('recording');
      micBtn.textContent = '⏹ 停止口述';
      try { rec.start(); } catch (e) { toast('语音识别启动失败', 'err'); stopMic(); }
    });

    /* 追问二跳:回答框防抖落盘;揭示按钮只放开对应追问的参考要点 */
    $$('#mock-fu-list [data-fu-id]', root).forEach(el => {
      const id = el.dataset.fuId;
      const fq = el.dataset.fuQ || '';
      el.addEventListener('input', () => { el.dataset.dirty = '1'; });
      el.addEventListener('input', debounce(() => {
        if (!state || state.ended || state.sid !== sid) return;
        state.answers[qid] = state.answers[qid] || {};
        state.answers[qid].fu = state.answers[qid].fu || {};
        const cur = state.answers[qid].fu[id] || { id, q: fq };
        cur.self = el.value; cur.q = fq;
        state.answers[qid].fu[id] = cur;
        draftSave();
      }, 200));
    });
    $$('[data-fu-reveal]', root).forEach(b => b.addEventListener('click', () => {
      captureInput();
      const id = b.dataset.fuReveal;
      const f = (questionForSession(qid).followups || []).find(x => fuId(qid, x.q) === id);
      state.answers[qid] = state.answers[qid] || {};
      state.answers[qid].fu = state.answers[qid].fu || {};
      const cur = state.answers[qid].fu[id] || { id, q: f ? f.q : '' };
      cur.revealed = true;
      cur.q = f ? f.q : cur.q;
      state.answers[qid].fu[id] = cur;
      draftSave();
      renderRun(root, true, `[data-fu-reference="${CSS.escape(id)}"]`);
    }));
    $$('[data-mark]', root).forEach(b => b.addEventListener('click', () => {
      captureInput();
      state.answers[qid] = Object.assign(state.answers[qid] || {}, { mark: b.dataset.mark });
      /* 复盘标记是真实的练习信号,但信号以「本轮内最后一次不同的选择」为准:
         同一轮重复点击同一按钮不重复排期(否则间隔被连续推大,一次点击变成 N 次练习);
         更改自评(如 ok→weak)= 以新信号重新排期,替换上一信号的排期结果。 */
      const last = state.answers[qid].scheduledMark || '';
      if (b.dataset.mark !== last) {
        const answer = state.answers[qid];
        if (!Object.hasOwn(answer, 'srsBase')) {
          answer.srsBase = Store.rec(qid).srs ? JSON.parse(JSON.stringify(Store.rec(qid).srs)) : null;
          answer.srsAt = Date.now();
        }
        Store.setStatus(qid, b.dataset.mark, { reschedule: true, base: answer.srsBase, at: answer.srsAt });
        state.answers[qid].scheduledMark = b.dataset.mark;
      } else {
        Store.setStatus(qid, b.dataset.mark);   /* 同一信号重复点击:状态幂等,不再排期 */
      }
      draftSave();
      renderRun(root, true);
    }));
    const prev = $('#m-prev');
    if (prev) prev.addEventListener('click', () => { captureInput(); settleQms(); state.qStartAt = null; state.idx--; draftSave(); renderRun(root); });
    const next = $('#m-next');
    if (next) next.addEventListener('click', () => { captureInput(); settleQms(); state.qStartAt = null; state.idx++; draftSave(); renderRun(root); });
    const finishBtn = $('#m-finish');
    if (finishBtn) finishBtn.addEventListener('click', () => finish(root));
    const quitBtn = $('#m-quit');
    if (quitBtn) quitBtn.addEventListener('click', () => finish(root));
    armCountdown(qid);
    if (preserve) {
      const target = focusSelector ? root.querySelector(focusSelector)
        : focusId ? document.getElementById(focusId)
        : focusFu ? root.querySelector(`[data-fu-id="${CSS.escape(focusFu)}"]`)
        : focusMark ? root.querySelector(`[data-mark="${CSS.escape(focusMark)}"]`) : null;
      if (target) { target.focus({ preventScroll: true }); if (selection && target.setSelectionRange) target.setSelectionRange(...selection); }
      window.scrollTo({ left: scroll.x, top: scroll.y, behavior: 'instant' });
    }
  }

  function finish(root) {
    captureInput(); /* 同步捕获当前输入,快速结束时最后一个回答不丢 */
    settleQms();    /* 计时(Track A):结束前结算最后一题的时长 */
    stopCountdown(); stopMic();   /* Stage2:轮次结束,倒计时/口述一并收尾 */
    if (!activeSession()) return;
    const sid = state.sid;
    const previousMock = JSON.parse(JSON.stringify(Store.data.mock));
    const previousQuestions = JSON.parse(JSON.stringify(Store.data.questions));
    /* 真实作答 = 已提交选择、主回答、追问或本人修订，与历史和表达卡共用判定。 */
    const answered = state.items.filter(q => {
      const a = state.answers[q.qid || q.id] || {};
      const fu = a.fu || {};
      return ExpressCard.itemAnswered({ ...a, followups: Object.values(fu) });
    }).length;
    if (!answered) { toast('本轮还没有真实作答,已按原样记录'); }
    const round = {
      ts: Date.now(),
      sessionId: state.sessionId,
      /* 只累计题面可见时长，刷新恢复已保存的时间；旧记录缺失时记 0。 */
      durationMs: state.durationMs || 0,
      guideId: state.guideId, guideSnapshot: state.guideSnapshot,
      config: state.config,
      items: state.items.map(q => {
        const id = q.qid || q.id;
        const a = state.answers[id] || {};
        /* 只归档实际访问时捕获的快照。结束一轮不能把未访问的题补成
           当前正文快照，也不能写入备份校验明确不接受的 null。 */
        const question = a.questionSnapshot || null;
        const meta = question || Data.question(id) || q;
        /* 追问二跳的记录:只保留真实写过的(有回答或已对照),没碰过的不占位 */
        /* 追问按 ID 收集(含旧格式迁移的待核对条目),带作答时题面快照;
           题目当前不在题库也照常收集(历史真实发生过) */
        const fuObj = a.fu || {};
        const followups = Object.keys(fuObj).map(k => {
          const e = fuObj[k] || {};
          return { id: e.id || k, q: e.q || '', self: e.self || '', revealed: !!e.revealed, legacy: !!e.legacy || /^\d+$/.test(k) };
        }).filter(x => x.self.trim() || x.revealed);
        const qRev = a.qRev || '';
        /* quiz 点击作答(Stage1):picked 字母序列随轮次留档(历史真实发生过) */
        return { qid: id, title: meta.title || id, self: a.self || '', revision: a.revision || '', revealed: !!a.revealed, mark: a.mark || '', qRev,
                 quizPicked: a.quizPicked, quizCorrect: a.quizCorrect, quizJudged: !!a.quizJudged, timeout: !!a.timeout,
                 ms: (state.qms || {})[id] || 0,   /* 计时(Track A):本题累计毫秒;无数据为 0,消费方 ms || 0 兜底 */
                 ...(question ? { questionSnapshot: question, snapshotCapturedLate: !!a.snapshotCapturedLate } : {}), followups };
      })
    };
    /* 考试提交期间只保存本轮草稿。成功完成时再把最终选择、判定与薄弱状态
       同轮次一起提交；下方保存失败会回滚整份 questions/mock，不污染既有历史。 */
    if (round.config?.examMode) round.items.forEach(it => {
      const correct = quizVerdict(it);
      if (correct === null) return;
      it.quizCorrect = correct; it.quizJudged = true;
      it.mark = correct ? '' : 'weak';
      const rec = Store.rec(it.qid);
      rec.lastSelfTest = { at: round.ts, correct, picked: it.quizPicked.slice() };
      rec._updatedAt = Date.now();
      if (!correct) Store.setStatus(it.qid, 'weak');
    });
    Store.data.mock.rounds.unshift(round);
    /* 上限只有一份:Store.MAX_ROUNDS(备份合并 mergeRounds 用同一个数,
       此前两处各写一个数字导致 50/100 不一致,长期用会静默丢历史轮次) */
    Store.data.mock.rounds = Store.data.mock.rounds.slice(0, Store.MAX_ROUNDS);
    if (!round.id) round.id = Store.roundId(round);   /* 落盘即有稳定 ID:搜索深链/去重都依赖 */
    markEnded(state.sessionId, 'completed');   /* 终态先于草稿清除落盘:其它页据此拒绝旧草稿 */
    Store.data.mock.draft = null;
    round.items.filter(ExpressCard.itemAnswered).forEach(it => Store.markPracticed(it.qid, 'mock'));
    if (!Store.saveNow()) {
      Store.data.mock = previousMock;
      Store.data.questions = previousQuestions;
      toast('本轮未完成保存，回答仍保留，请恢复存储后再次点击完成。', 'err');
      return;
    }
    state.ended = true;
    state.round = round;
    state.sid = sid;
    go('#/mock/done');
  }

  /* 阶段8:练后下一步建议——只基于本轮真实记录(作答/自评/追问),区分事实与推断。
     事实 = 本轮实际写了什么;推断 = 「可能没讲清」的判断,由用户自评或未答触发,不自动打分。 */
  function renderNextSteps(round) {
    const unanswered = round.items.filter(it => !ExpressCard.itemAnswered(it));
    const weakIds = round.items.filter(it => it.mark === 'weak').map(it => it.qid);
    const fuMissing = round.items.filter(it => it.revealed && (it.followups || []).some(fu => !((fu.self || '').trim())));
    const notes = [];
    if (weakIds.length) notes.push({ fact: `你把 ${weakIds.length} 题标了「还不熟」(${weakIds.slice(0, 3).join(', ')}${weakIds.length > 3 ? '…' : ''})`,
      step: '它们已进错题本与今日复习队列;明天复习时先不看答案,重写一遍回答再对照。', href: '#/review', label: '去复习队列' });
    if (unanswered.length) notes.push({ fact: `${unanswered.length} 题本轮没有提交作答(${unanswered.slice(0, 3).map(i => i.qid).join(', ')}${unanswered.length > 3 ? '…' : ''})`,
      step: '只对照参考不算练过;重开一轮时勾选这些题所在专题,先写再比。', href: '#/mock', label: '再练一轮' });
    if (fuMissing.length) notes.push({ fact: `${fuMissing.length} 题的追问对照了参考但没写回答`,
      step: '面试官会顺着回答追问——挑一题进学习页,把追问的回答补写一遍。', href: '#/study/' + (fuMissing[0].qid || ''), label: '去补追问' });
    const answered = round.items.filter(it => ExpressCard.itemAnswered(it)).length;
    if (answered && !notes.length) notes.push({ fact: `本轮 ${answered} 题都有真实作答且没有标记薄弱`,
      step: '间隔重复会在到期后提醒你再看;现在可以导出表达卡带走,或去学新题。', href: '#/browse', label: '去学新题' });
    if (!notes.length) return '';
    return `
      <div class="card" style="margin-top:12px;border-color:var(--primary)">
        <h3 style="margin-top:0">下一步(基于本轮记录)</h3>
        ${notes.map(n => `
          <div style="margin:8px 0">
            <div class="small"><b>事实:</b>${esc(n.fact)}</div>
            <div class="small muted"><b>推断的下一步:</b>${esc(n.step)} <a class="rel-link" href="${esc(n.href)}">${esc(n.label)} →</a></div>
          </div>`).join('')}
        <p class="muted small" style="margin:6px 0 0">「事实」来自你本轮的实际操作;「下一步」是基于它的建议,不是评分。</p>
      </div>`;
  }

  /* Stage2:轮次项的 quiz 判定结果。quizPicked(判定过的字母序列)× 快照选项的
     right 标记 → true/false;没判定过或快照缺选项(旧数据)→ null 不显示 */
  function quizVerdict(it) {
    if (!Array.isArray(it.quizPicked) || !it.quizPicked.length) return null;
    if (!it.questionSnapshot || !Array.isArray(it.questionSnapshot.options)) return null;
    const right = it.questionSnapshot.options.filter(o => o.right).map(o => o.label).sort().join(',');
    return [...it.quizPicked].sort().join(',') === right;
  }

  function renderDone(root) {
    const round = state.round;
    if (!round) { renderConfig(root); return; }
    const revealed = round.items.filter(i => i.revealed);
    const weak = round.items.filter(i => i.mark === 'weak');
    const examMode = !!(round.config && round.config.examMode);
    /* 与表达卡同一资格判定:有真实作答(主回答或追问)的题数;追问单独计数,不冒充主问题 */
    const mainAnswered = round.items.filter(i => (i.self || '').trim()).length;
    const revised = round.items.filter(i => (i.revision || '').trim()).length;
    const quizAnswered = round.items.filter(i => i.quizPicked?.length).length;
    const fuAnswered = round.items.reduce((n, i) => n + (i.followups || []).filter(fu => (fu.self || '').trim()).length, 0);
    const realAnswered = round.items.filter(i => ExpressCard.itemAnswered(i)).length;
    root.innerHTML = `
      <div class="card">
        <h2>本轮完成</h2>
        <p class="muted">${fmtTime(round.ts)} · 共 ${round.items.length} 题 · 有真实作答 ${realAnswered} 题(文字主回答 ${mainAnswered} · 已提交选择 ${quizAnswered} · 追问回答 ${fuAnswered} 条 · 修订/补充 ${revised} 题) · 对照参考要点 ${revealed.length} 题${weak.length ? ` · 标记还不熟 ${weak.length} 题(已进入错题本与今日复习)` : ''}${examMode ? ' · <span class="badge b-topic">考试模式</span>' : ''}</p>
        <div class="round-list">
          ${round.items.map((it, i) => {
            const v = quizVerdict(it);
            return `
            <div class="round-item">
              <div class="round-head">
                <span class="qid">${i + 1}. ${esc(it.qid)}</span>
                ${v === null ? '' : (v ? '<span class="badge st-ok">✓ 答对</span>' : '<span class="badge st-weak">✗ 答错</span>')}
                ${it.timeout ? '<span class="badge vf-todo" title="单题限时到,自动进入下一题">⏰ 超时</span>' : ''}
                ${it.mark ? QRender.badge(Store.STATUS.find(s => s.id === it.mark).label, 'st-' + it.mark) : '<span class="muted">未复盘</span>'}
                <a class="rel-link" href="#/study/${it.qid}">打开题目</a>
              </div>
              <div class="round-title">${esc(it.title)}</div>
              ${ExpressCard.answerText(it) ? `<div class="round-self"><b>我的回答:</b>${esc(ExpressCard.answerText(it))}</div>` : '<div class="round-self muted">(主回答未写)</div>'}
              ${(it.followups || []).filter(fu => (fu.self || '').trim() || fu.revealed).map(fu => `
                <div class="round-self"><b>追问(${esc((fu.q || '').slice(0, 40))}${(fu.q || '').length > 40 ? '…' : ''}):</b>${(fu.self || '').trim() ? esc(fu.self) : '<span class="muted">对照过参考,未写回答</span>'}</div>`).join('')}
              ${(it.revision || '').trim() ? `<div class="round-self"><b>参考后修订 / 补充:</b>${esc(it.revision)}</div>` : ''}
              ${examMode && it.questionSnapshot && it.questionSnapshot.answer ? `
                <details class="exam-ref">
                  <summary>参考要点(考试模式 · 完成后统一对照)</summary>
                  <div class="fu-a">${QRender.mdHtml(it.questionSnapshot.answer)}</div>
                </details>` : ''}
            </div>`; }).join('')}
        </div>
        <div class="mock-nav">
          <button class="btn" id="m-again">再来一轮</button>
          <button class="btn btn-primary" id="m-card">导出这一轮的个人表达卡</button>
          <a class="btn" href="#/review">查看历史轮次</a>
          <a class="btn" href="#/home">返回工作台</a>
        </div>
        <p class="muted small" style="margin-top:8px">表达卡 = 你写的回答 + 面试口述版 + 参考要点,可下载 Markdown 或打印成 PDF。</p>
        ${renderNextSteps(round)}
      </div>`;
    /* 完成时已提交终态；返回配置页不能清掉另一页后来创建的草稿。 */
    $('#m-again').addEventListener('click', () => { state = null; go('#/mock'); });
    $('#m-card').addEventListener('click', () => exportExpressCard('round', { roundId: round.id || Store.roundId(round) }));
  }

  document.addEventListener('visibilitychange', () => {
    if (!state || state.ended || !document.querySelector('.mock-run')) return;
    if (document.hidden) flushDraft();
    else if (location.hash === '#/mock/run') {
      state.qStartAt = Date.now();
      armCountdown(state.items[state.idx].qid || state.items[state.idx].id);
    }
  });
  return { render, startDirected, flushDraft, applyRemote };
})();
