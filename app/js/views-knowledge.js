/* 文档阅读与检索工作区 + 全局搜索结果 + 首页 */
'use strict';

/* ---------- 文档阅读 ---------- */
const DocsView = (() => {
  function catalogHtml(activeId) {
    const topics = (window.APP_DATA.topics || []);
    const userDocs = Data.allUserDocs();
    return `
      <div class="doc-catalog">
        <div class="cat-title">章节目录</div>
        <a class="cat-item ${!activeId ? 'active' : ''}" href="#/docs"><span>📖 总览</span></a>
        ${topics.map(t => {
          const ds = Data.allDocs().filter(d => d.topic === t.id);
          if (!ds.length) return '';
          return `<div class="cat-group">
            <div class="cat-group-title">${esc(t.name)}</div>
            ${ds.map(d => `<a class="cat-item ${activeId === d.id ? 'active' : ''}" href="#/docs/${d.id}">${esc(d.title)}</a>`).join('')}
          </div>`;
        }).join('')}
        <div class="cat-group">
          <div class="cat-group-title">我导入的资料</div>
          ${userDocs.length ? userDocs.map(d => `
            <a class="cat-item ${activeId === d.id ? 'active' : ''}" href="#/docs/${d.id}">
              <span>${d.parsed === false ? '📄' : '📝'} ${esc(d.title)}</span>
              <button class="icon-btn tiny" data-del-doc="${d.id}" title="删除">✕</button>
            </a>`).join('')
          : '<div class="cat-empty muted">还没有导入资料</div>'}
        </div>
        <div class="cat-actions">
          <button class="btn btn-small" id="doc-import">导入 MD / TXT / JSON</button>
          <div class="cat-hint muted">PDF 暂不做自动解析:只记住文件名,需要时可重新选择原文件打开。</div>
        </div>
      </div>`;
  }

  function render(root, parts) {
    const docId = parts && parts[0];
    root.innerHTML = `
      <div class="docs-pane">
        ${catalogHtml(docId)}
        <div class="doc-main" id="doc-main"></div>
      </div>
      <div class="reading-progress" id="reading-bar" style="width:0%"></div>`;
    bindCatalog(root);
    const main = $('#doc-main', root);
    if (docId) {
      const d = Data.doc(docId);
      if (!d) { main.innerHTML = '<div class="empty">未找到文档</div>'; return; }
      renderReader(main, d);
    } else {
      renderIndex(main);
    }
  }

  function bindCatalog(root) {
    const btn = $('#doc-import', root);
    if (btn) btn.addEventListener('click', () => importDoc().then(ok => { if (ok) App.route(); }));
    $$('[data-del-doc]', root).forEach(b => {
      b.addEventListener('click', e => {
        e.preventDefault(); e.stopPropagation();
        const id = b.dataset.delDoc;
        modal('删除导入资料?', `<p>将删除「${esc((Data.doc(id) || {}).title || id)}」,不影响内置章节与题目记录。</p>`, [
          { label: '取消' },
          { label: '删除', danger: true, onClick: () => {
              const next = Data.allUserDocs().filter(d => d.id !== id);
              if (!Store.userDocsSave(next)) { toast('删除失败:本地存储写入未成功', 'err'); return false; }
              Data.reloadUserDocs(); /* 同步数据层闭包,目录/索引立即更新 */
              rebuildSearch();
              toast('已删除');
              App.route();
            } }
        ]);
      });
    });
  }

  function renderIndex(main) {
    const docs = Data.allDocs();
    const pos = Store.data.ui.docPos || {};
    const topics = (window.APP_DATA.topics || []);
    main.innerHTML = `
      <div class="doc-welcome">
        <h1>文档阅读与检索</h1>
        <p>这里提供连续阅读的原理章节,与题目共用同一套知识内容和题号:阅读中遇到的知识点可直接跳到对应练习,做题时也能返回原理章节与来源。</p>
        ${pos.docId && Data.doc(pos.docId) ? `<button class="btn btn-primary" id="resume-read">继续阅读:${esc(Data.doc(pos.docId).title)}</button>` : ''}
        <p class="muted">全文检索在页面顶部搜索框,覆盖章节、题干、答案、解析与你的笔记。</p>
      </div>
      ${topics.map(t => {
        const ds = docs.filter(d => d.topic === t.id);
        if (!ds.length) return '';
        return `<div class="doc-topic-block">
          <h2>${esc(t.name)}</h2>
          <p class="muted">${esc(t.desc)}</p>
          <div class="doc-cards">
            ${ds.map(d => `
              <a class="doc-card" href="#/docs/${d.id}">
                <div class="doc-card-title">${esc(d.title)}</div>
                <div class="doc-card-sum">${esc(d.summary || '')}</div>
                <div class="doc-card-meta muted">${(d.sections || []).length} 个小节</div>
              </a>`).join('')}
          </div>
        </div>`;
      }).join('')}
      ${Data.allUserDocs().length ? `<div class="doc-topic-block"><h2>我导入的资料</h2>
        <div class="doc-cards">${Data.allUserDocs().map(d => `
          <a class="doc-card" href="#/docs/${d.id}">
            <div class="doc-card-title">${d.parsed === false ? '📄(未解析)' : '📝'} ${esc(d.title)}</div>
            <div class="doc-card-sum">${esc(d.note || (d.parsed === false ? 'PDF 未解析;打开后可重新选择原文件' : ''))}</div>
            <div class="doc-card-meta muted">${fmtTime(d.ts)} 导入</div>
          </a>`).join('')}</div></div>` : ''}`;
    const btn = $('#resume-read', main);
    if (btn) btn.addEventListener('click', () => go('#/docs/' + pos.docId + (pos.secId ? '?s=' + pos.secId : '')));
  }

  function renderReader(main, d) {
    const isUser = d.id.startsWith('udoc-');
    const topicName = d.topic ? Data.topicName(d.topic) : '导入资料';
    const secList = (d.sections || []).filter(s => s.level <= 3 && s.level >= 2);
    const ds = isUser ? null : Data.allDocs();
    let prevDoc = null, nextDoc = null;
    if (ds) {
      const idx = ds.findIndex(x => x.id === d.id);
      prevDoc = idx > 0 ? ds[idx - 1] : null;
      nextDoc = idx >= 0 && idx < ds.length - 1 ? ds[idx + 1] : null;
    }
    main.innerHTML = `
      <div class="doc-reader">
        <div class="doc-head">
          <div class="doc-crumb muted">
            <a href="#/docs">文档</a> / ${esc(topicName)}
            ${isUser ? '<span class="badge b-tag">导入</span>' : ''}
            ${d.parsed === false ? '<span class="badge vf-todo">未解析</span>' : ''}
          </div>
          <h1>${esc(d.title)}</h1>
          ${d.summary ? `<p class="doc-summary muted">${esc(d.summary)}</p>` : ''}
          ${d.parsed === false ? `<div class="notice warn">该文件类型(PDF)未做自动解析,本站只记住了文件名,未建立索引(不会出现在正文搜索里)。需要查看内容时,点下面的按钮重新选择这份 PDF,会用本机阅读器打开;如需检索,请另存为 Markdown / TXT 后重新导入。</div>
          <div style="margin:10px 0"><button class="btn btn-small" id="pdf-open">选择原 PDF 打开</button></div>` : ''}
        </div>
        <div class="doc-body-wrap">
          ${secList.length ? `
          <details class="doc-toc">
            <summary>本页目录</summary>
            <div class="doc-toc-list">
              ${secList.map(s => `<a class="toc-l${s.level}" href="javascript:void(0)" data-toc="${s.id}">${esc(s.text)}</a>`).join('')}
            </div>
          </details>` : ''}
          <article class="doc-content" id="doc-content">${d.parsed === false ? '' : Markdown.render(d.md || d.text || '', { anchorPrefix: `doc-${d.id}-` })}</article>
        </div>
        <div class="doc-nav">
          ${prevDoc ? `<a class="btn btn-small" href="#/docs/${prevDoc.id}">← ${esc(prevDoc.title)}</a>` : '<span></span>'}
          ${nextDoc ? `<a class="btn btn-small" href="#/docs/${nextDoc.id}">${esc(nextDoc.title)} →</a>` : '<span></span>'}
        </div>
      </div>`;
    /* 未解析 PDF:运行时选择原文件,以 object URL 打开(本地完成,不上传) */
    const pdfBtn = $('#pdf-open', main);
    if (pdfBtn) pdfBtn.addEventListener('click', () => {
      openFileAny('.pdf').then(f => {
        const url = URL.createObjectURL(f);
        const w = window.open(url, '_blank');
        if (!w) toast('浏览器拦截了新窗口,请允许弹出窗口后重试', 'err');
        setTimeout(() => URL.revokeObjectURL(url), 60000);
      }).catch(() => {});
    });
    /* 页内目录跳转 */
    $$('[data-toc]', main).forEach(a => {
      a.addEventListener('click', () => {
        jumpToSection(d.id, a.dataset.toc);
      });
    });
    /* 阅读位置:实际滚动发生在 window(#view 未做内部滚动容器),统一监听 window。
       每次渲染生成新令牌;滚动回调只在自己仍是当前令牌时写位置——
       视图退出(cleanup)作废旧令牌并注销监听,跨视图的滚动(如新页面回顶)不会污染文档位置。 */
    const token = ++DocsView._renderToken;
    DocsView._activeDoc = d;
    if (DocsView._onScroll) window.removeEventListener('scroll', DocsView._onScroll);
    DocsView._onScroll = debounce(() => {
      if (DocsView._renderToken !== token) return; /* 已离开本文档:忽略 */
      const cur = currentSection(d);
      Store.data.ui.docPos = { docId: d.id, secId: cur, y: window.scrollY };
      Store.save();
      /* 更新阅读进度条 */
      const bar = document.getElementById('reading-bar');
      if (bar) {
        const total = document.documentElement.scrollHeight - window.innerHeight;
        bar.style.width = total > 0 ? Math.min(100, (window.scrollY / total) * 100) + '%' : '0%';
      }
    }, 100);
    window.addEventListener('scroll', DocsView._onScroll, { passive: true });
    /* 恢复位置或跳转到指定小节 */
    const qs = parseHash().query;
    if (qs.s) {
      setTimeout(() => jumpToSection(d.id, qs.s), 60);
    } else {
      const pos = Store.data.ui.docPos;
      if (pos && pos.docId === d.id && pos.y > 0) {
        setTimeout(() => { window.scrollTo({ top: pos.y, behavior: 'instant' }); }, 30);
      }
    }
  }

  function currentSection(d) {
    const prefix = `doc-${d.id}-sec-`;
    const headings = $$(`[id^="${prefix}"]`);
    let cur = '';
    headings.forEach(h => {
      if (h.getBoundingClientRect().top < 120) cur = h.id.replace(prefix, '');
    });
    return cur; /* 裸编号,如 '5' */
  }

  /* secId 统一归一化:剥离可能带的 'sec-' 前缀后拼接,兼容 TOC(sec-N)/
     搜索锚点(sec-N)/阅读位置(裸编号)三种来源。
     scrollTo 用 instant:CSS 的 scroll-behavior:smooth 会把滚动变成异步动画,
     导致随后的 scrollY 读取与 docPos 保存拿到 0。 */
  function jumpToSection(docId, secId) {
    const bare = String(secId || '').replace(/^sec-/, '');
    const el = document.getElementById(`doc-${docId}-sec-${bare}`);
    if (!el) return;
    const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 70);
    window.scrollTo({ top: y, behavior: 'instant' });
    el.classList.add('flash');
    setTimeout(() => el.classList.remove('flash'), 1600);
    Store.data.ui.docPos = { docId, secId: bare, y: window.scrollY };
    Store.save();
  }

  /* 视图退出(App.route 统一调用):
     1) 以当前真实滚动位置保存一次阅读位置(比最后一条防抖更准);
     2) 作废令牌(挂起的防抖回调不再写位置);
     3) 注销 window 滚动监听——离开后新页面的滚动与本视图无关。 */
  function cleanup() {
    const d = DocsView._activeDoc;
    if (d) {
      Store.data.ui.docPos = { docId: d.id, secId: currentSection(d), y: window.scrollY };
      Store.save();
    }
    DocsView._activeDoc = null;
    DocsView._renderToken++;
    if (DocsView._onScroll) { window.removeEventListener('scroll', DocsView._onScroll); DocsView._onScroll = null; }
  }

  function importDoc() {
    return openFileText('.md,.markdown,.txt,.json,.pdf').then(({ name, text }) => {
      const ext = (name.split('.').pop() || '').toLowerCase();
      const id = 'udoc-' + Date.now();
      const arr = Data.allUserDocs();
      if (ext === 'pdf') {
        /* 诚实降级:PDF 不解析、不索引,只记住文件名;需要时可重新选择原文件打开 */
        arr.unshift({ id, title: name, text: '', ts: Date.now(), kind: 'pdf', parsed: false, note: 'PDF 未解析;打开条目后可重新选择原文件' });
        if (!Store.userDocsSave(arr)) return false;
        Data.reloadUserDocs();
        toast('PDF 未做解析,已记住文件名(未建索引)');
        return true;
      }
      let content = text;
      if (ext === 'json') {
        try {
          const obj = JSON.parse(text);
          content = '```json\n' + JSON.stringify(obj, null, 2) + '\n```';
        } catch (e) { content = text; }
      }
      if (content.length > 1024 * 1024) {
        toast('文件超过 1MB,可能保存失败', 'err');
      }
      arr.unshift({ id, title: name.replace(/\.[^.]+$/, ''), text: content, ts: Date.now(), kind: ext, parsed: true });
      if (!Store.userDocsSave(arr)) return false;
      Data.reloadUserDocs();
      rebuildSearch();
      toast('导入成功,已建立索引');
      return true;
    }).catch(err => { if (err.message !== '未选择文件') toast(err.message, 'err'); return false; });
  }

  function rebuildSearch() {
    window.rebuildIndex();
  }

  return { render, rebuildSearch, cleanup, _renderToken: 0, _activeDoc: null, _onScroll: null };
})();

/* ---------- 全局搜索 ---------- */
const SearchView = (() => {
  function render(root, parts, query) {
    const fromPath = parts && parts.length ? parts.join('/') : '';
    const fromQuery = (query && query.q) ? String(query.q) : '';
    const q = fromPath || fromQuery || (Store.data.ui.search.q || '');
    const saved = Store.data.ui.search || {};
    root.innerHTML = `
      <div class="search-page">
        <div class="search-bar">
          <input id="s-input" class="input input-lg" placeholder="搜索题干、答案、解析、文档、笔记……" value="${esc(q)}">
          <button class="btn btn-primary" id="s-go">搜索</button>
        </div>
        <div class="filter-bar">
          <select id="s-scope" class="input">
            <option value="" ${!saved.scope ? 'selected' : ''}>全部范围</option>
            <option value="q" ${saved.scope === 'q' ? 'selected' : ''}>仅题目与笔记</option>
            <option value="doc" ${saved.scope === 'doc' ? 'selected' : ''}>仅文档资料</option>
            <option value="note" ${saved.scope === 'note' ? 'selected' : ''}>仅我的笔记</option>
          </select>
          <select id="s-topic" class="input">
            <option value="">全部专题</option>
            ${(window.APP_DATA.topics || []).map(t => `<option value="${t.id}" ${saved.topic === t.id ? 'selected' : ''}>${esc(t.name)}</option>`).join('')}
          </select>
          <span class="muted" id="s-count"></span>
        </div>
        <div id="s-results"></div>
      </div>`;
    const input = $('#s-input');
    $('#s-go').addEventListener('click', () => doSearch(input.value));
    input.addEventListener('keydown', e => { if (e.key === 'Enter') doSearch(input.value); });
    $('#s-scope').addEventListener('change', e => { saved.scope = e.target.value; doSearch(input.value, true); });
    $('#s-topic').addEventListener('change', e => { saved.topic = e.target.value; doSearch(input.value, true); });
    if (q) doSearch(q, true); else $('#s-results').innerHTML = '<div class="empty">输入关键词开始搜索;支持多个关键词(空格分隔,需同时命中)。</div>';
  }

  function doSearch(q, keepUrl) {
    const scope = $('#s-scope').value;
    const topic = $('#s-topic').value;
    Store.data.ui.search = { q, scope, topic }; Store.save();
    if (!keepUrl) go('#/search/' + encodeURIComponent(q));
    const results = Search.query(q, { scope, topic: topic || '' });
    $('#s-count').textContent = results.length ? `约 ${results.length} 条结果` : '';
    const box = $('#s-results');
    if (!q.trim()) { box.innerHTML = ''; return; }
    if (!results.length) {
      box.innerHTML = `<div class="empty">没有找到与「${esc(q)}」相关的内容。<br><span class="muted">提示:换更短的关键词,或检查范围/专题筛选。</span></div>`;
      return;
    }
    const kindName = { q: '题目', note: '我的笔记', doc: '章节', udoc: '导入资料', concept: '概念', project: '动手项目', drill: '专项练习', try: '我的尝试', run: '我的运行记录', draft: '我的项目草稿' };
    box.innerHTML = results.map(r => {
      const u = r.unit;
      let href, title, sub = '';
      if (u.kind === 'try') {
        /* 命中「哪一次尝试」:带上 attemptId,落到该专项并展开复盘区 */
        href = `#/path?d=${encodeURIComponent(u.drillId)}` + (u.attemptId ? `&at=${encodeURIComponent(u.attemptId)}` : '');
        const stName = { draft: '草稿', completed: '已完成', abandoned: '已放弃' }[u.status] || '';
        title = '专项尝试(' + u.drillId + ')';
        sub = stName ? `<span class="badge b-tag">${esc(stName)}</span>` : '';
      } else if (u.kind === 'drill') {
        href = `#/path?d=${encodeURIComponent(u.drillId)}`;
        const dd = (window.APP_DATA.paths.paths || []).flatMap(p => p.stages).flatMap(s => s.drills || []).find(x => x.id === u.drillId);
        title = dd ? (dd.type + ':' + dd.q.slice(0, 40) + '…') : u.drillId;
      } else if (u.kind === 'run') {
        /* 命中「某一次运行记录」:落到该项目并展开那一条 */
        href = `#/path?p=${encodeURIComponent(u.pid)}` + (u.runId ? `&r=${encodeURIComponent(u.runId)}` : '');
        title = (window.APP_DATA.projects.projects.find(x => x.id === u.pid) || {}).name || u.pid;
        sub = '<span class="badge b-tag">运行记录</span>';
      } else if (u.kind === 'draft') {
        href = `#/path?p=${encodeURIComponent(u.pid)}&tab=draft`;
        title = (window.APP_DATA.projects.projects.find(x => x.id === u.pid) || {}).name || u.pid;
        sub = '<span class="badge b-tag">草稿</span>';
      } else if (u.kind === 'concept') {
        /* 概念有身份:落到概念地图并展开该条,而不是跳到「关联题的第一题」冒充命中 */
        href = `#/path?c=${encodeURIComponent(u.cid)}`;
        title = (window.APP_DATA.concepts.concepts.find(c => c.id === u.cid) || {}).name || u.cid;
      } else if (u.kind === 'project') {
        href = `#/path?p=${encodeURIComponent(u.pid)}`;
        title = (window.APP_DATA.projects.projects.find(x => x.id === u.pid) || {}).name || u.pid;
      } else if (u.kind === 'q' || u.kind === 'note') {
        /* 带上命中的区块锚点:学习页会按需展开并定位到该层级(检查题同时揭示答案) */
        const a = u.anchor && u.anchor !== 'top' ? `?a=${encodeURIComponent(u.anchor)}` : '';
        href = `#/study/${u.qid}${a}`;
        title = Data.question(u.qid) ? Data.question(u.qid).title : u.qid;
      } else if (u.anchor) {
        href = `#/docs/${u.docId}?s=${encodeURIComponent(u.anchor)}`;
        const d = Data.doc(u.docId);
        title = d ? d.title : u.docId;
      } else {
        href = `#/docs/${u.docId}`;
        const d = Data.doc(u.docId);
        title = d ? d.title : u.docId;
      }
      const fieldLabel = ({ title: '题名', tags: '标签', answer: '直接答案', plain: '大白话', deep: '原理', example: '例子', interview: '面试表达', followups: '追问', pitfalls: '误区', check: '理解检查', note: '笔记', section: '章节', concept: '概念定义', project: '项目说明', drill: '专项练习', try: '我的复盘', run: '运行记录', draft: '项目草稿' }[u.field]) || u.field;
      return `
        <a class="search-item" href="${esc(href)}">
          <div class="si-head">
            <span class="badge b-topic">${kindName[u.kind] || u.kind}</span>
            <span class="badge b-tag">${esc(fieldLabel)}</span>
            ${sub}
            ${u.qid ? `<span class="qid">${esc(u.qid)}</span>` : ''}
            <span class="si-title">${esc(title)}</span>
          </div>
          <div class="si-snippet">${r.snippet}</div>
        </a>`;
    }).join('');
  }

  return { render };
})();

/* ---------- 学习路径 ---------- */
const PathView = (() => {
  /* 路径定义来自 data/paths.json(稳定题号);完成与否由用户手动确认,进度存 Store。
     条目形状:{done?: ts, cancelled?: ts}(旧版 number 自动迁移为 {done:n},见 store 合并)。
     状态判定:按最新事件(done vs cancelled),晚者胜;同刻本地事件胜(此处即单一数据源)。 */
  function progress() { return Store.data.ui.pathProgress || {}; }
  /* 统一读取:返回 {state:'done'|'cancelled'|'none', ts} */
  function stageStatus(entry) {
    if (entry == null) return { state: 'none', ts: 0 };
    if (typeof entry === 'number') return { state: 'done', ts: entry }; /* 旧版形状 */
    const done = typeof entry.done === 'number' && isFinite(entry.done) ? entry.done : 0;
    const cancelled = typeof entry.cancelled === 'number' && isFinite(entry.cancelled) ? entry.cancelled : 0;
    if (done > cancelled) return { state: 'done', ts: done };
    if (cancelled > 0) return { state: 'cancelled', ts: cancelled };
    if (done > 0) return { state: 'done', ts: done };
    return { state: 'none', ts: 0 };
  }
  /* 标记完成/取消:都写事件,不删条目(取消留痕,旧备份不会复活完成态) */
  function markStage(stageId, done) {
    const p = Store.data.ui.pathProgress || {};
    const cur = (typeof p[stageId] === 'object' && p[stageId]) || {};
    const now = Date.now();
    p[stageId] = done
      ? { done: now, cancelled: cur.cancelled && cur.cancelled > now ? cur.cancelled : (cur.cancelled || 0) || 0 }
      : { cancelled: now, done: cur.done || 0 };
    /* done 与 cancelled 同时为 0 时清理为 undefined 字段,避免无意义对象 */
    const e = p[stageId];
    if (!e.done && !e.cancelled) delete p[stageId];
    Store.data.ui.pathProgress = p;
    Store.save();
  }

  /* 深锚点定位:把 ?d/?at/?p/?r/?c 对应的条目展开、滚动、闪烁标记。
     任何一条都找不到时不做任何滚动(App.route 的常规返回顶部仍然生效)。 */
  function applyFocus(root) {
    const q = parseHash().query || {};
    const targets = [];
    if (q.d) {
      const box = root.querySelector(`.path-drill[data-drill="${cssEsc(q.d)}"]`);
      if (box) {
        targets.push(box);
        const ref = box.querySelector('[data-drill-ref]');
        if (ref) ref.open = true;
        if (q.at) {
          const rec = box.querySelector('[data-drill-record]');
          if (rec) rec.open = true;
        }
      }
    }
    if (q.p) {
      const box = root.querySelector(`details[data-proj="${cssEsc(q.p)}"]`);
      if (box) {
        targets.push(box);
        box.open = true;
        if (q.r) {
          const runBox = box.querySelector(`[data-proj-runbox="${cssEsc(q.r)}"]`);
          if (runBox) { runBox.open = true; targets.push(runBox); }
        }
        if (q.tab === 'draft') {
          const rec = box.querySelector('[data-proj-record]');
          if (rec) rec.open = true;
        }
      }
    }
    if (q.c) {
      const box = root.querySelector(`details[data-cid="${cssEsc(q.c)}"]`);
      if (box) { box.open = true; targets.push(box); }
    }
    if (!targets.length) return;
    const el = targets[targets.length - 1];
    /* 目标可能被若干层折叠容器包着(例如运行记录在「我的运行记录」里):
       逐层打开祖先 <details>,否则内容未渲染、innerText 为空、滚动也不生效。 */
    for (let p = el.parentElement; p && p !== root; p = p.parentElement) {
      if (p.tagName === 'DETAILS') p.open = true;
    }
    el.scrollIntoView({ behavior: 'instant', block: 'start' });
    targets.forEach(t => {
      t.classList.add('flash');
      setTimeout(() => t.classList.remove('flash'), 2000);
    });
  }
  function cssEsc(s) { return String(s || '').replace(/["\\]/g, '\\$&'); }

  function render(root) {
    const paths = (window.APP_DATA.paths && window.APP_DATA.paths.paths) || [];
    if (!paths.length) { root.innerHTML = '<div class="empty">暂无路径定义</div>'; return; }
    const path = paths[0];
    const prog = progress();
    const doneCount = path.stages.filter(s => stageStatus(prog[s.id]).state === 'done').length;
    root.innerHTML = `
      <div class="path-head">
        <h1>${esc(path.name)}</h1>
        <p class="muted">${esc(path.audience || '')} 完成与否由你自己确认——能讲给别人听才算懂,点过不算。</p>
        <div class="progress" style="max-width:420px"><div class="progress-in" style="width:${path.stages.length ? Math.round(doneCount / path.stages.length * 100) : 0}%"></div></div>
        <span class="muted small">${doneCount} / ${path.stages.length} 阶段已确认理解</span>
      </div>
      ${renderConceptMap()}
      ${path.stages.map((s, si) => renderStage(s, si, prog)).join('')}
      ${path.optional ? `
      <div class="card" style="margin-top:14px">
        <h3>⚪ ${esc(path.optional.name)}</h3>
        <div class="rel-row">${(path.optional.questions || []).map(id => Data.question(id)
          ? `<a class="rel-link" href="#/study/${id}">${id}</a>` : '').join(' ')}</div>
      </div>` : ''}
      ${renderProjects()}`;
    /* 深锚点:搜索/复习入口带 d(专项)/ at(具体尝试)/ p(项目)/ r(某次运行)/ c(概念),
       落到具体条目并展开,而不是把用户丢在页面顶部。 */
    applyFocus(root);
    $$('.path-stage-actions [data-done]', root).forEach(b => {
      b.addEventListener('click', () => { markStage(b.dataset.done, true); render(root); toast('已确认本阶段理解;可随时取消'); });
    });
  
  /* 项目个人记录交互:草稿击键同步 ui.projectDrafts;提交写入 ui.projectRuns(幂等按 runId)。
     所有落盘动作都以真实结果为准:写失败必须说出来并给出重试,不说「已保存」。 */
  function wireProjectRecords(root) {
    const drafts = Store.data.ui.projectDrafts = Store.data.ui.projectDrafts || {};
    /* 记录字段:textarea[data-proj-field][data-proj] */
    $$('textarea[data-proj-field][data-proj]', root).forEach(el => {
      const pid = el.dataset.proj;
      const field = el.dataset.projField;
      drafts[pid] = drafts[pid] || {};
      el.value = drafts[pid][field] || '';
      el.addEventListener('input', () => {
        drafts[pid] = drafts[pid] || {};
        drafts[pid][field] = el.value;
        drafts[pid].updatedAt = Date.now();
        delete drafts[pid].saveError;
        Store.save();
      });
    });
    /* 口述字段:textarea[data-proj-speak-field][data-proj-speak] */
    $$('textarea[data-proj-speak-field][data-proj-speak]', root).forEach(el => {
      const pid = el.dataset.projSpeak;
      const field = 'speak_' + el.dataset.projSpeakField;
      drafts[pid] = drafts[pid] || {};
      el.value = drafts[pid][field] || '';
      el.addEventListener('input', () => {
        drafts[pid] = drafts[pid] || {};
        drafts[pid][field] = el.value;
        drafts[pid].updatedAt = Date.now();
        delete drafts[pid].saveError;
        Store.save();
      });
    });
    /* 诚实分级:选「只讲设计」时明确警告不能在面试里说成「我做过」 */
    $$('[data-proj-level]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.proj;
        drafts[pid] = drafts[pid] || {};
        drafts[pid].speakLevel = btn.dataset.projLevel;
        drafts[pid].updatedAt = Date.now();
        if (Store.saveNow() === false) { toast('保存失败:' + (Store.lastSaveError || ''), 'err'); return; }
        render(root);
      });
    });
    /* 30 秒 / 2 分钟计时:对着钟念一遍,才是最接近面试的表达练习 */
    $$('[data-proj-timer]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.proj;
        const total = parseInt(btn.dataset.projTimer, 10) || 30;
        const out = root.querySelector(`[data-proj-clock="${pid}"]`);
        if (!out) return;
        let left = total;
        if (btn.__timer) clearInterval(btn.__timer);
        const tick = () => {
          out.textContent = `⏱ 剩余 ${left} 秒`;
          if (left <= 0) {
            clearInterval(btn.__timer); btn.__timer = null;
            out.textContent = `⏱ ${total} 秒到——说完了吗?没说完就精简结构,别靠语速。`;
            return;
          }
          left--;
        };
        tick();
        btn.__timer = setInterval(tick, 1000);
      });
    });
    $$('[data-proj-step]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.proj;
        drafts[pid] = drafts[pid] || {};
        drafts[pid].stepStatus = btn.dataset.projStep;
        drafts[pid].updatedAt = Date.now();
        if (Store.saveNow() === false) { toast('保存失败:' + (Store.lastSaveError || ''), 'err'); return; }
        $$(`[data-proj-step][data-proj="${pid}"]`, root).forEach(b => b.classList.remove('btn-primary'));
        btn.classList.add('btn-primary');
        toast('步骤状态已保存');
      });
    });
    /* 保存运行记录:恰好一条记录(带 runId),立即落盘并按真实结果反馈 */
    $$('[data-proj-save]', root).forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const pid = btn.dataset.projSave;
        const d = drafts[pid] || {};
        if (!((d.runOutput || '').trim() || (d.debug || '').trim() || (d.todo || '').trim())) {
          toast('先写下运行输出或排查过程,再保存为记录', 'err');
          return;
        }
        const runId = 'run-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
        const runs = Store.data.ui.projectRuns = Store.data.ui.projectRuns || {};
        runs[pid] = runs[pid] || [];
        runs[pid].push({
          runId, ts: Date.now(), updatedAt: Date.now(),
          runOutput: d.runOutput || '', debug: d.debug || '', todo: d.todo || '',
          stepStatus: d.stepStatus || '', speakLevel: d.speakLevel || '',
        });
        const ok = Store.saveNow() !== false;
        if (!ok) {
          runs[pid].pop();                       /* 回滚:内存不得比磁盘多一条 */
          drafts[pid].saveError = Store.lastSaveError || '写入未成功';
          render(root);
          toast('保存失败,记录未写入:' + drafts[pid].saveError, 'err');
          return;
        }
        drafts[pid].lastRunAt = Date.now();
        window.rebuildIndex();
        /* 重新渲染:新记录立刻出现在「我的运行记录」里,可点开核对自己的原话 */
        render(root);
        toast(`已保存 1 条运行记录(可在「我的运行记录」里回看)`);
      });
    });
    /* 保存口述草稿 */
    $$('[data-proj-save-speak]', root).forEach(btn => {
      if (btn.dataset.wired) return;
      btn.dataset.wired = '1';
      btn.addEventListener('click', () => {
        const pid = btn.dataset.projSaveSpeak;
        drafts[pid] = drafts[pid] || {};
        ['ask', 'plan', 'tradeoff', 'pain', 'verify', 'lack'].forEach(k => {
          drafts[pid]['speak_' + k] = drafts[pid]['speak_' + k] || '';
        });
        drafts[pid].speakSavedAt = Date.now();
        if (Store.saveNow() === false) {
          delete drafts[pid].speakSavedAt;
          toast('口述草稿保存失败:' + (Store.lastSaveError || ''), 'err');
          return;
        }
        window.rebuildIndex();
        render(root);
        toast('口述草稿已保存');
      });
    });
    /* 比较最近两次运行:把「上次与本次」并排,便于发现自己是否真的改进了 */
    $$('[data-proj-cmp]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const pid = btn.dataset.projCmp;
        const list = ((Store.data.ui.projectRuns || {})[pid] || []).slice()
          .sort((a, b) => Store.recTime(a) - Store.recTime(b));
        if (list.length < 2) { toast('需要至少两条运行记录', 'err'); return; }
        const a = list[list.length - 2], b = list[list.length - 1];
        const row = (label, va, vb) => `
          <div class="round-item">
            <div class="round-head"><b>${esc(label)}</b></div>
            <div class="round-self"><b>上次(${fmtTime(Store.recTime(a))}):</b>${esc(va || '(无)')}</div>
            <div class="round-self"><b>本次(${fmtTime(Store.recTime(b))}):</b>${esc(vb || '(无)')}</div>
          </div>`;
        modal('最近两次运行记录比较',
          row('运行输出', a.runOutput, b.runOutput) +
          row('问题→定位→验证', a.debug, b.debug) +
          row('未完成项', a.todo, b.todo) +
          '<p class="muted small">对照:上次卡住的地方这次解决了吗?遗留项真的减少了吗?</p>',
          [{ label: '关闭' }]);
      });
    });
  }

  /* 专项练习交互:草稿(全部字段)→ 提交(completed)→ 新尝试(draft 清空)→ 历史回看 */
    $$('.path-drill', root).forEach(box => {
      const drillId = box.dataset.drill;
      const d = (window.APP_DATA.paths.paths || []).flatMap(p => p.stages)
        .flatMap(s => s.drills || []).find(x => x.id === drillId);
      if (!d) return;
      const el = {
        ans: box.querySelector(`[data-drill-answer="${drillId}"]`),
        obs: box.querySelector(`[data-drill-obs="${drillId}"]`),
        review: box.querySelector(`[data-drill-review="${drillId}"]`),
      };
      /* 草稿同步:任一字段击键即写入内存 draft(全部字段完整保留),磁盘防抖 */
      function syncDraft() {
        let draft = draftOf(drillId);
        if (!draft) {
          draft = { attemptId: newAttemptId(), drillId, version: d.version || 1, status: Store.STATE.DRAFT, ts: Date.now() };
        }
        draft.myAnswer = el.ans.value;
        draft.observed = el.obs.value;
        draft.review = el.review.value;
        draft.updatedAt = Date.now();
        delete draft.saveError;         /* 用户继续编辑:上一次的失败提示不再挂在这里 */
        saveAttempt(draft);
        return draft;
      }
      [el.ans, el.obs, el.review].forEach(t => t.addEventListener('input', syncDraft));

      /* 提交:草稿 → completed。写盘失败时**回滚状态**并明确告知,
         绝不出现「界面说已保存、磁盘其实没写」的分叉。 */
      box.querySelector(`[data-drill-save="${drillId}"]`).addEventListener('click', () => {
        const draft = syncDraft();
        draft.status = Store.STATE.COMPLETED;
        draft.selfRating = (box.querySelector('[data-rate].btn-primary') || {}).dataset?.rate || '';
        draft.updatedAt = Date.now();
        const res = saveAttempt(draft);
        if (!res.ok) {
          draft.status = Store.STATE.DRAFT;   /* 回滚:内存不得比磁盘更「完成」 */
          render(root);
          toast('提交未落盘:' + res.error, 'err');
          return;
        }
        toast('已保存本次尝试(历史保留;开始新尝试将不显示旧答案)');
        render(root);
      });

      /* 开始新尝试。三种收尾语义必须**可区分**:
         提交后另开 → 当前草稿转 completed(计完成);
         放弃草稿   → 当前草稿转 abandoned(留痕,不计完成、不进待消化队列);
         空草稿     → 直接丢弃,不产生任何无内容的记录。 */
      box.querySelector(`[data-drill-new="${drillId}"]`).addEventListener('click', () => {
        const draft = draftOf(drillId);
        const canFinish = hasContent(draft);
        const startNew = (mode) => {       /* mode: 'abandon' | 'complete' | 'drop' */
          const cur = draftOf(drillId);
          if (cur) {
            if (mode === 'drop' || !canFinish) {
              if (mode === 'complete' && !canFinish) {
                /* 没有内容的「提交」没有意义:按丢弃处理,不留空记录 */
              }
              dropAttempt(drillId, cur.attemptId);
            } else {
              cur.status = mode === 'abandon' ? Store.STATE.ABANDONED : Store.STATE.COMPLETED;
              cur.selfRating = cur.selfRating || 'unsolved';
              if (mode === 'abandon') cur.abandonedAt = Date.now();
              cur.updatedAt = Date.now();
              const res = saveAttempt(cur);
              if (!res.ok) {
                cur.status = Store.STATE.DRAFT;
                delete cur.abandonedAt;
                render(root);
                toast('操作未落盘:' + res.error, 'err');
                return;
              }
            }
          }
          const fresh = { attemptId: newAttemptId(), drillId, version: d.version || 1,
                          status: Store.STATE.DRAFT, myAnswer: '', observed: '', review: '',
                          ts: Date.now(), updatedAt: Date.now() };
          const res2 = saveAttempt(fresh);
          render(root);
          if (!res2.ok) { toast('新尝试未落盘:' + res2.error, 'err'); return; }
          toast(mode === 'abandon' ? '已放弃这次草稿(留痕,不计入完成);新尝试开始'
              : mode === 'complete' ? '草稿已提交为完成记录;新尝试开始'
              : '已开始新尝试;旧答案已隐藏,历史保留');
        };
        if (canFinish) {
          modal('当前有未完成草稿',
            '<p><b>放弃</b>:草稿标记为「已放弃」保留痕迹,不计入完成次数,也不会出现在待消化的专项里。<br><b>提交后另开</b>:把当前草稿记为一次完成记录(计入完成次数),再开新的一次。</p>',
            [
              { label: '取消' },
              { label: '放弃草稿(留痕)', onClick: () => { startNew('abandon'); } },
              { label: '提交后另开', primary: true, onClick: () => { startNew('complete'); } },
            ]);
        } else {
          startNew('drop');
        }
      });

      /* 自评:点击立即写入当前草稿(selfRating 进 draft,刷新不丢) */
      $$('[data-rate]', box).forEach(btn => {
        btn.addEventListener('click', () => {
          $$('[data-rate]', box).forEach(b => b.classList.remove('btn-primary'));
          btn.classList.add('btn-primary');
          let draft = draftOf(drillId);
          if (!draft) {
            draft = { attemptId: newAttemptId(), drillId, version: d.version || 1, status: Store.STATE.DRAFT, ts: Date.now() };
          }
          draft.selfRating = btn.dataset.rate;
          draft.updatedAt = Date.now();
          saveAttempt(draft);
        });
      });

      /* 历史回看:按时间升序展示(可解释的时间轴),并区分「已完成 / 已放弃」 */
      const hist = box.querySelector(`[data-drill-history="${drillId}"]`);
      if (hist) hist.addEventListener('click', () => {
        const all = attemptsOf(drillId).filter(a => a.status !== Store.STATE.DRAFT);
        const done = all.filter(a => a.status === Store.STATE.COMPLETED);
        modal(`「${drillId}」历史尝试(${done.length} 次完成${all.length - done.length ? ` · ${all.length - done.length} 次放弃` : ''})`,
          all.length ? all.map((a, i) => `
            <div class="round-item">
              <div class="round-head"><b>#${i + 1}</b>
                <span class="badge ${a.status === 'completed' ? 'st-ok' : 'st-none'}">${Store.STATE_LABEL[a.status] || a.status}</span>
                <span class="muted small">${fmtTime(Store.recTime(a))} · v${a.version || 1}
                ${a.selfRating ? '· ' + ({ solved: '已解决', partial: '部分', unsolved: '未解决' }[a.selfRating] || a.selfRating) : ''}</span></div>
              <div class="round-title"><b>预测:</b>${esc(a.myAnswer || '(无)')}</div>
              ${a.observed ? `<div class="round-self"><b>观察:</b>${esc(a.observed)}</div>` : ''}
              ${a.review ? `<div class="round-self"><b>复盘:</b>${esc(a.review)}</div>` : ''}
            </div>`).join('') : '<p class="muted">暂无完成尝试</p>',
          [{ label: '关闭' }]);
      });

      /* 前后比较:取按时间排序的最后两次**完成**尝试(不看数组顺序) */
      const cmp = box.querySelector(`[data-drill-compare="${drillId}"]`);
      if (cmp) cmp.addEventListener('click', () => {
        const list = completedOf(drillId);
        if (list.length < 2) { toast('需要至少两次完成记录', 'err'); return; }
        const a = list[list.length - 2], b = list[list.length - 1];
        const rateName = v => ({ solved: '已解决', partial: '部分', unsolved: '未解决' }[v] || v || '未评');
        const row = (label, va, vb) => `
          <div class="round-item">
            <div class="round-head"><b>${esc(label)}</b></div>
            <div class="round-self"><b>上次(${fmtTime(Store.recTime(a))}):</b>${esc(va || '(无)')}</div>
            <div class="round-self"><b>本次(${fmtTime(Store.recTime(b))}):</b>${esc(vb || '(无)')}</div>
          </div>`;
        modal(`最近两次完成尝试比较`,
          row('预测', a.myAnswer, b.myAnswer) +
          row('实际观察', a.observed, b.observed) +
          row('自评', rateName(a.selfRating), rateName(b.selfRating)) +
          row('误解原因/复盘', a.review, b.review) +
          '<p class="muted small">对照:误解是否消除?还缺什么?</p>',
          [{ label: '关闭' }]);
      });
    });
    $$('.path-stage-actions [data-undone]', root).forEach(b => {
      b.addEventListener('click', () => { markStage(b.dataset.undone, false); render(root); });
    });
    /* 项目记录与口述草稿:整个页面只绑定一次(不随专项数增长) */
    wireProjectRecords(root);
  }



  /* 概念导航:18 个核心概念(30 秒定义 + 关联题直达),按主题分组 */
  function renderConceptMap() {
    const cs = (window.APP_DATA.concepts && window.APP_DATA.concepts.concepts) || [];
    if (!cs.length) return '';
    const byTopic = {};
    cs.forEach(c => { (byTopic[c.topic] = byTopic[c.topic] || []).push(c); });
    return `<details class="card" style="margin-bottom:14px">
      <summary style="cursor:pointer;font-weight:600">📚 概念地图(${cs.length} 个核心概念 · 30 秒版定义,点击跳到对应题目)</summary>
      <div style="margin-top:10px">
        ${Object.entries(byTopic).map(([topic, list]) => `
          <div style="margin-bottom:10px">
            <div class="muted small">${esc(Data.topicName(topic))}</div>
            ${list.map(c => `
              <details data-cid="${esc(c.id)}" style="margin:4px 0;border:1px solid var(--line);border-radius:6px;padding:4px 10px">
                <summary style="cursor:pointer;font-size:13.5px">${esc(c.name)}</summary>
                <div class="muted small" style="margin:4px 0">${esc(c.definition)}</div>
                <div>${(c.questions || []).map(qid => `<a class="rel-link" href="#/study/${qid}">${qid}</a>`).join(' ')}
                     ${(c.docs || []).map(d => `<a class="rel-link" href="#/docs/${d}">📖 章节</a>`).join(' ')}</div>
              </details>`).join('')}
          </div>`).join('')}
      </div>
    </details>`;
  }

  /* 动手项目(来自 data/projects.json):每个项目展示目标/前置/运行/预期/排查/扩展/交付标准 */
  function renderProjects() {
    const projs = (window.APP_DATA.projects && window.APP_DATA.projects.projects) || [];
    if (!projs.length) return '';
    return `<div style="margin-top:18px"><h2 style="font-size:17px;margin:0 0 10px">🛠 动手项目(本地可运行,无需 API)</h2>
      ${projs.map(pr => `
      <details class="path-exercise proj-card" data-proj="${pr.id}">
        <summary><b>${esc(pr.name)}</b> <span class="muted small">${esc((pr.questions || []).join(' · '))}</span></summary>
        <p><b>目标:</b>${esc(pr.goal)}</p>
        <p class="muted small"><b>前置:</b>${esc((pr.prereq || []).join('; '))}</p>
        <p class="muted small"><b>源码:</b>${(pr.files || []).map(f => `<code>${esc(f.path)}</code> ${esc(f.desc || '')}`).join('; ')}</p>
        <pre class="code"><code>${esc(pr.run)}</code></pre>
        <p class="muted small">预期输出是预先验证过的内容(见「排查案例」),网页不实时执行 Python;你本地运行后把实际输出粘贴到下面的记录里。</p>
        <p><b>预期输出:</b>${esc(pr.expected)}</p>
        <p><b>排查案例:</b>${esc(pr.debug_case)}</p>
        <p class="muted small"><b>扩展挑战:</b>${esc((pr.extensions || []).join('; '))}</p>
        <p><b>完成标准:</b>${esc(pr.deliverable)}</p>
        ${renderProjectRecord(pr)}
      </details>`).join('')}</div>`;
  }

  /* 项目个人记录:运行输出/定位/修改/验证/未完成项 + 口述草稿(30秒/2分钟)。
     草稿字段击键同步 Store(ui.projectDrafts);提交转 projectRuns(历史,幂等)。
     每次提交是一条**可回看、可比较、可检索**的证据记录(带 runId)。 */
  function renderProjectRecord(pr) {
    const draft = (Store.data.ui.projectDrafts || {})[pr.id] || {};
    const runs = (Store.data.ui.projectRuns && Store.data.ui.projectRuns[pr.id] || []).slice()
      .sort((a, b) => (Store.recTime(b)) - (Store.recTime(a)));
    const L = k => esc(draft[k] || '');
    const SPEAK_FIELDS = [['ask', '需求(一句话)'], ['plan', '方案(结构)'], ['tradeoff', '取舍'],
                          ['pain', '问题与定位'], ['verify', '验证证据'], ['lack', '不足与下一步']];
    const LEVELS = [['did', '我做过(跑通并调试过)'],
                    ['tried', '我在练手项目里验证过'],
                    ['design', '如果遇到我会这样设计']];
    return `
      <details class="path-variant-ref" data-proj-record="${pr.id}">
        <summary>我的实现记录(草稿自动保存)</summary>
        <div style="margin-top:8px">
          <label class="muted small">步骤状态</label>
          <div class="btn-row">
            ${[['none', '未开始'], ['trying', '尝试中'], ['verified', '已验证'], ['understood', '自评理解']].map(([v, l]) =>
              `<button class="btn btn-small ${draft.stepStatus === v ? 'btn-primary' : ''}" data-proj-step="${v}" data-proj="${pr.id}">${l}</button>`).join('')}
          </div>
          <label class="muted small" style="display:block;margin-top:6px">实际运行版本/命令输出摘录</label>
          <textarea class="input" data-proj-field="runOutput" data-proj="${pr.id}" style="min-height:60px">${L('runOutput')}</textarea>
          <label class="muted small" style="display:block;margin-top:6px">遇到的问题 → 定位 → 修改 → 验证证据</label>
          <textarea class="input" data-proj-field="debug" data-proj="${pr.id}" style="min-height:60px">${L('debug')}</textarea>
          <label class="muted small" style="display:block;margin-top:6px">未完成项</label>
          <textarea class="input" data-proj-field="todo" data-proj="${pr.id}" style="min-height:40px">${L('todo')}</textarea>
          <button class="btn btn-primary btn-small" style="margin-top:6px" data-proj-save="${pr.id}">保存为一条运行记录</button>
          <span class="muted small" style="margin-left:8px">${runs.length ? `已提交 ${runs.length} 次运行记录` : '还没有提交过运行记录'}</span>
          ${draft.saveError ? saveFailureHtml(draft.saveError) : ''}
        </div>
      </details>
      ${runs.length ? renderRunHistory(pr, runs) : ''}
      <details class="path-variant-ref" data-proj-speak="${pr.id}">
        <summary>面试口述草稿(30 秒 / 2 分钟)</summary>
        <div style="margin-top:8px">
          <div class="muted small" style="margin-bottom:6px">
            <b>怎么算准备好了:</b>30 秒能说清「要解决什么 + 用什么方案 + 结果如何」;
            2 分钟能把「取舍、踩坑、验证证据、不足」讲完整。先按下面的骨架写,再对着计时器念一遍。
          </div>
          <label class="muted small" style="display:block;margin-top:6px">诚实分级(选最贴近事实的一档)</label>
          <div class="btn-row">
            ${LEVELS.map(([v, l]) => `<button class="btn btn-small ${draft.speakLevel === v ? 'btn-primary' : ''}" data-proj-level="${v}" data-proj="${pr.id}">${l}</button>`).join('')}
          </div>
          ${draft.speakLevel === 'design' ? '<div class="notice warn" style="margin:6px 0">这一档只能在面试里讲方案设计,不能说「我做过」。有运行记录后再回到上面两档。</div>' : ''}
          ${(draft.speakLevel === 'did' || draft.speakLevel === 'tried') && !runs.length
            ? '<div class="notice warn" style="margin:6px 0">你选了「' + (draft.speakLevel === 'did' ? '我做过' : '我在练手项目里验证过') + '」,但还没有任何运行记录。先去跑一次、把输出粘进「我的实现记录」并保存,再回来讲——表达要和证据对得上。</div>'
            : ''}
          ${runs.length >= 2 && draft.speakLevel === 'design'
            ? '<div class="notice warn" style="margin:6px 0">你已经有 ' + runs.length + ' 条运行记录了,可以放心往「我跑通过/验证过」这两档走,不必自我压低。</div>'
            : ''}
          ${SPEAK_FIELDS.map(([k, label]) => `
            <label class="muted small" style="display:block;margin-top:6px">${label}</label>
            <textarea class="input" data-proj-speak-field="${k}" data-proj-speak="${pr.id}" style="min-height:40px">${L('speak_' + k)}</textarea>`).join('')}
          <div class="btn-row" style="margin-top:6px">
            <button class="btn btn-primary btn-small" data-proj-save-speak="${pr.id}">保存口述草稿</button>
            <button class="btn btn-small" data-proj-timer="30" data-proj="${pr.id}">⏱ 30 秒计时</button>
            <button class="btn btn-small" data-proj-timer="120" data-proj="${pr.id}">⏱ 2 分钟计时</button>
            <span class="muted small" data-proj-clock="${pr.id}"></span>
          </div>
          <div class="muted small" style="margin-top:6px">
            <b>证据对照:</b>下面列出你自己的运行记录,讲的时候尽量引用其中的真实输出与踩坑,
            而不是凭印象描述。
          </div>
          <div class="rel-row">
            ${runs.length ? runs.map((r, i) => `<a class="rel-link" href="#/path?p=${encodeURIComponent(pr.id)}&r=${encodeURIComponent(r.runId || '')}">第 ${runs.length - i} 次运行 · ${fmtTime(Store.recTime(r))}</a>`).join(' ')
              : '<span class="muted small">还没有运行记录——先跑一次并把输出粘到上面,再回来练口述。</span>'}
          </div>
        </div>
      </details>`;
  }

  /* 运行历史:每条记录独立可展开(带身份 runId),并给出与上一次的对照 */
  function renderRunHistory(pr, runs) {
    return `
      <details class="path-variant-ref" data-proj-history="${pr.id}">
        <summary>我的运行记录(${runs.length} 条 · 可回看与比较)</summary>
        <div style="margin-top:8px">
          ${runs.map((r, i) => `
            <details class="round-item" data-proj-runbox="${esc(r.runId || '')}" style="padding:6px 10px;margin:4px 0">
              <summary style="cursor:pointer">
                <b>第 ${runs.length - i} 次</b>
                <span class="muted small">${fmtTime(Store.recTime(r))}${r.stepStatus ? ' · 步骤:' + esc(r.stepStatus) : ''}${r._legacy ? ' · 旧版记录(已补齐 ID)' : ''}</span>
              </summary>
              <div class="round-self"><b>运行输出:</b>${esc(r.runOutput || '(无)')}</div>
              <div class="round-self"><b>问题→定位→验证:</b>${esc(r.debug || '(无)')}</div>
              <div class="round-self"><b>未完成项:</b>${esc(r.todo || '(无)')}</div>
              <div class="muted small">记录 ID:<code>${esc(r.runId || '')}</code></div>
            </details>`).join('')}
          ${runs.length >= 2 ? `<button class="btn btn-small" data-proj-cmp="${pr.id}">比较最近两次</button>` : ''}
        </div>
      </details>`;
  }

  /* 变式检查:问题直接可见;参考答案与原因默认折叠(先自己回答再展开) */
  function renderVariant(v) {
    const question = typeof v === 'string' ? v : v.question;
    return `
      <div class="path-variant">
        <div class="path-variant-q"><b>变式检查:</b>${esc(question)}</div>
        ${typeof v === 'object' && v.reference ? `
        <details class="path-variant-ref">
          <summary>展开参考答案(先自己回答)</summary>
          <div class="path-variant-body">${esc(v.reference)}</div>
          ${v.reason ? `<div class="path-variant-reason"><b>原因/反例:</b>${esc(v.reason)}</div>` : ''}
        </details>` : ''}`;
  }


  /* 专项练习:稳定 ID + attempt 记录(drillAttempts 顶层存储,归属只由 drillId 决定)
     状态语义见 Store.STATE:draft(编辑中)/ completed(提交成功)/ abandoned(明确放弃)。
     「最新一次」只走 Store.latestOf(按时间,不看数组顺序)。 */
  function attemptsOf(drillId) {
    return Store.sortedByTime(Store.data.drillAttempts[drillId] || []);
  }
  /* 参与「完成历史」的记录(放弃的不算完成) */
  function completedOf(drillId) {
    return attemptsOf(drillId).filter(a => a.status === 'completed');
  }
  function abandonedOf(drillId) {
    return attemptsOf(drillId).filter(a => a.status === 'abandoned');
  }
  function draftOf(drillId) {
    return Store.latestOf(Store.data.drillAttempts[drillId] || [], a => a.status === 'draft');
  }
  function hasContent(a) {
    return !!a && !!((a.myAnswer || '').trim() || (a.observed || '').trim() || (a.review || '').trim());
  }
  function newAttemptId() {
    return 'at-' + Date.now() + '-' + Math.random().toString(36).slice(2, 6);
  }
  /* 保存一条尝试。返回 {ok, error}——调用方必须据此给出真实反馈,
     绝不能出现「磁盘写失败但界面说已保存」。 */
  function saveAttempt(attempt) {
    const list = Store.data.drillAttempts[attempt.drillId] = Store.data.drillAttempts[attempt.drillId] || [];
    const idx = list.findIndex(x => x.attemptId === attempt.attemptId);
    if (idx >= 0) list[idx] = attempt; else list.push(attempt);
    const ok = Store.saveNow() !== false;
    if (ok) { delete attempt.saveError; window.rebuildIndex && window.rebuildIndex(); }
    else { attempt.saveError = Store.lastSaveError || '写入未成功'; }
    return { ok, error: attempt.saveError || null };
  }
  /* 删除一条尝试(仅用于「空草稿不留痕」) */
  function dropAttempt(drillId, attemptId) {
    const list = Store.data.drillAttempts[drillId] || [];
    const i = list.findIndex(x => x.attemptId === attemptId);
    if (i >= 0) list.splice(i, 1);
    Store.saveNow();
  }
  /* 保存失败时的就地反馈:说明原因 + 提供重试,不假装成功 */
  function saveFailureHtml(err) {
    return `<div class="notice warn" style="margin:4px 0">
      <b>本次提交未落盘</b>:${esc(err || '写入未成功')}。
      内容仍在下面,可修改后重试;若持续失败请到<a href="#/maintain">维护页</a>导出记录并腾出空间。
    </div>`;
  }
  function renderDrill(stageId, di, d) {
    const drillId = d.id || `drill-${stageId}-${di}`;
    const focusDrillId = (parseHash().query.d || '');
    const draft = draftOf(drillId);
    const completed = completedOf(drillId);
    const abandoned = abandonedOf(drillId);
    const focusAt = (parseHash().query.at || '');
    const last = draft || completed[completed.length - 1];
    return `
      <div class="path-drill ${focusDrillId === drillId ? 'drill-focus' : ''}" data-drill="${drillId}">
        <div class="path-drill-q">
          <span class="badge b-tag">${esc(d.type)}</span>
          <span class="qid">${drillId}</span>
          ${d.version ? `<span class="badge b-tag" title="内容版本">v${d.version}</span>` : ''}
          ${d.q.split(String.fromCharCode(10)).map(l => esc(l)).join('<br>')}
        </div>
        ${completed.length || abandoned.length ? `<div class="muted small" style="margin:4px 0">
          ${completed.length ? `已完成 ${completed.length} 次` : '还没有完成的尝试'}
          ${abandoned.length ? `<span class="muted">· 放弃 ${abandoned.length} 次</span>` : ''}
          ${completed.length ? `<a class="rel-link" data-drill-history="${drillId}" href="javascript:void(0)">查看历史</a>` : ''}
          ${completed.length >= 2 ? `<a class="rel-link" data-drill-compare="${drillId}" href="javascript:void(0)">比较最近两次</a>` : ''}
        </div>` : ''}
        ${draft ? '<div class="muted small" style="margin:2px 0">⏸ 有未完成草稿(已自动恢复,可继续编辑)</div>' : ''}
        ${draft && draft.saveError ? saveFailureHtml(draft.saveError) : ''}
        <textarea class="path-drill-answer" data-drill-answer="${drillId}"
          placeholder="先写下你的预测/找出的错/推演结果(自动保存,刷新不丢)……">${esc(draft?.myAnswer ?? '')}</textarea>
        <details class="path-variant-ref" data-drill-ref="${drillId}">
          <summary>展开参考要点(先自己作答)</summary>
          <div class="path-variant-body">${esc(d.reference)}</div>
          ${d.reason ? `<div class="path-variant-reason"><b>为什么:</b>${esc(d.reason)}</div>` : ''}
        </details>
        <details class="path-variant-ref" data-drill-record="${drillId}">
          <summary>记录复盘(实际观察/自评/误解原因)</summary>
          <div style="margin-top:6px">
            <label class="muted small">实际运行观察(对照你的预测;新尝试时为空,不继承旧答案)</label>
            <textarea class="path-drill-obs" data-drill-obs="${drillId}" placeholder="实际输出是什么?与预测差在哪?……">${esc(draft?.observed ?? '')}</textarea>
            <label class="muted small" style="display:block;margin-top:6px">自评</label>
            <div class="btn-row">
              ${[['solved', '已解决'], ['partial', '部分'], ['unsolved', '未解决']].map(([v, l]) =>
                `<button class="btn btn-small ${last?.selfRating === v ? 'btn-primary' : ''}" data-rate="${v}" data-drill-rate="${drillId}">${l}</button>`).join('')}
            </div>
            <label class="muted small" style="display:block;margin-top:6px">误解原因(自己的话,进入复习)</label>
            <textarea class="path-drill-review" data-drill-review="${drillId}" placeholder="我原来以为…现在知道…">${esc(draft?.review ?? '')}</textarea>
            <button class="btn btn-primary btn-small" style="margin-top:6px" data-drill-save="${drillId}">提交本次尝试</button>
            ${completed.length ? `<span class="muted small" style="margin-left:8px">已有 ${completed.length} 次完成</span>` : ''}
            <button class="btn btn-small" data-drill-new="${drillId}" title="不看旧答案,开始全新一次">开始新尝试</button>
          </div>
        </details>
      </div>`;
  }

  function renderStage(s, si, prog) {
    const st = stageStatus(prog[s.id]);
    const done = st.state === 'done';
    const cancelled = st.state === 'cancelled';
    const qs = (s.questions || []).map(id => {
      const q = Data.question(id);
      if (!q) return '';
      const st = Data.statusInfo(id);
      /* 整行就是一个真链接:单一焦点停靠点,Enter/Space 原生激活,无 role 伪装 */
      return `
        <a class="path-q ${st.cls}" href="#/study/${id}">
          <span class="qid">${id}</span>
          <span class="path-q-title">${esc(q.title)}</span>
          <span class="badge ${st.cls}">${st.label}</span>
        </a>`;
    }).join('');
    const ex = s.exercise || {};
    return `
      <div class="card path-stage ${done ? 'path-done' : ''}">
        <div class="path-stage-head">
          <h3>${done ? '✅' : cancelled ? '⭕' : '🔹'} ${esc(s.name)}</h3>
          ${done && st.ts ? `<span class="muted small">确认于 ${fmtTime(st.ts)}</span>` : ''}
          ${cancelled ? `<span class="muted small">已取消确认(${st.ts ? fmtTime(st.ts) : '时间未知'});完成记录保留,可随时重新确认</span>` : ''}
        </div>
        <p class="muted small">前置:${esc(s.prereq || '无')}</p>
        <ul class="path-goals">${(s.goals || []).map(g => `<li>${esc(g)}</li>`).join('')}</ul>
        <div class="path-qs">${qs}</div>
        ${ex.code ? `
        <details class="path-exercise">
          <summary>🛠 ${esc(ex.name || '迷你练习')}</summary>
          <pre class="code"><code>${esc(ex.code)}</code></pre>
          ${(ex.run) ? `<p class="muted small">运行:${esc(ex.run)}</p>` : ''}
          ${ex.variant ? renderVariant(ex.variant) : ''}
        </details>` : ''}
        ${(s.drills || []).map((d, di) => renderDrill(s.id, di, d)).join('')}
        <div class="path-stage-actions">
          ${(s.docs || []).map(did => Data.doc(did) ? `<a class="btn btn-small" href="#/docs/${did}">📖 章节阅读</a>` : '').join(' ')}
          <a class="btn btn-small" href="${esc(s.review || '#/review')}">📌 复盘薄弱点</a>
          <span class="flex1"></span>
          ${done
            ? `<button class="btn btn-small" data-undone="${s.id}">取消确认(留痕)</button>`
            : `<button class="btn btn-primary btn-small" data-done="${s.id}">✓ 此阶段已理解(自测通过)</button>`}
        </div>
      </div>`;
  }

  return { render };
})();

/* ---------- 首页 ---------- */
const HomeView = (() => {
  function render(root) {
    const qs = Data.allQuestions();
    const verified = qs.filter(q => q.verify && q.verify.status === 'verified').length;
    const byTopic = {};
    qs.forEach(q => { byTopic[q.topic] = (byTopic[q.topic] || 0) + 1; });
    const ui = Store.data.ui;
    const lastHash = ui.lastHash && ui.lastHash !== '#/home' ? ui.lastHash : '';
    const pos = ui.docPos || {};
    const randomQid = qs.length ? qs[Math.floor(Math.random() * qs.length)].id : '';

    /* 学习进度统计 */
    const recs = Store.data.questions;
    const studied = qs.filter(q => recs[q.id] && (recs[q.id].status || recs[q.id].viewedAt)).length;
    const mastered = qs.filter(q => recs[q.id] && recs[q.id].status === 'ok').length;
    const weakCt = qs.filter(q => recs[q.id] && recs[q.id].status === 'weak').length;
    const reviewCt = qs.filter(q => recs[q.id] && recs[q.id].status === 'review').length;
    const favCt = qs.filter(q => recs[q.id] && recs[q.id].fav).length;
    const noteCt = qs.filter(q => (recs[q.id] && recs[q.id].note || '').trim()).length;
    const progressPct = qs.length ? Math.round(studied / qs.length * 100) : 0;
    const mockRounds = (Store.data.mock.rounds || []).length;
    const todayCt = getTodayReviewCount();

    root.innerHTML = `
      <div class="home-hero">
        <h1>AI 应用开发与 Agent 面试学习</h1>
        <p>面向实习与校招的中文题库:每道题都有直接答案、大白话解释、原理拆解、例子、追问与误区,并标注核查状态与出处。支持练习、自测、文档阅读与全文检索,全部数据保存在本地。</p>
        <div class="hero-actions">
          ${lastHash ? `<a class="btn btn-primary" href="${esc(lastHash)}">继续上次位置</a>` : `<a class="btn btn-primary" href="#/docs/doc-guide-1">如何使用本站</a>`}
          ${todayCt ? `<a class="btn" href="#/review" style="border-color:var(--warn);color:var(--warn)">📌 今日复习 ${todayCt} 题</a>` : ''}
          <a class="btn" href="#/browse">浏览题库</a>
          <a class="btn" href="#/mock">自测/模拟面试</a>
          <button class="btn" id="h-random">随机一题</button>
        </div>
      </div>
      <div class="stat-cards">
        <div class="stat-card"><div class="stat-num">${qs.length}</div><div class="stat-label">题目总数</div></div>
        <div class="stat-card"><div class="stat-num">${studied}</div><div class="stat-label">已学习(${progressPct}%)</div>
          <div class="progress" style="margin-top:6px"><div class="progress-in" style="width:${progressPct}%"></div></div></div>
        <div class="stat-card"><div class="stat-num">${mastered}</div><div class="stat-label">基本掌握</div></div>
        <div class="stat-card"><div class="stat-num">${mockRounds}</div><div class="stat-label">模拟面试轮次</div></div>
      </div>
      ${studied > 0 ? `
      <div class="card" style="padding:12px 16px;margin-bottom:16px;display:flex;gap:16px;align-items:center;flex-wrap:wrap">
        <span style="font-weight:600">📊 学习状态</span>
        <span class="badge st-none">未练习 ${qs.length - studied}</span>
        <span class="badge st-weak">还不熟 ${weakCt}</span>
        <span class="badge st-ok">基本掌握 ${mastered}</span>
        <span class="badge st-review">待复习 ${reviewCt}</span>
        <span class="badge b-fav">★ 收藏 ${favCt}</span>
        <span class="badge b-tag">📝 笔记 ${noteCt}</span>
      </div>` : ''}
      <div class="home-cols">
        <div class="card">
          <h3>专题进度</h3>
          ${(window.APP_DATA.topics || []).map(t => {
            const total = byTopic[t.id] || 0;
            if (!total) return `<a class="topic-row" href="#/browse?t=${t.id}"><span>${esc(t.name)}</span><span class="muted">0 题</span></a>`;
            const topicQs = qs.filter(q => q.topic === t.id);
            const done = topicQs.filter(x => { const r = Store.rec(x.id); return r.status === 'ok' || r.status === 'review'; }).length;
            const pct = Math.round(done / total * 100);
            return `<a class="topic-row" href="#/browse?t=${t.id}">
              <span>${esc(t.name)}</span>
              <span style="display:flex;align-items:center;gap:8px">
                <span class="progress" style="width:60px"><div class="progress-in" style="width:${pct}%"></div></span>
                <span class="muted" style="font-size:12px">${done}/${total}</span>
              </span></a>`;
          }).join('')}
          <a class="topic-row muted" href="#/maintain">进阶专题与维护 →</a>
        </div>
        <div class="card">
          <h3>推荐用法</h3>
          <ol class="home-tips">
            <li>先读<a href="#/docs/doc-guide-1">使用指南</a>,了解两种学习方式;</li>
            <li>按<a href="#/docs/doc-path-1">备考路线</a>系统学习,章节里的知识点可直达题目;</li>
            <li>学习模式里先自己想再展开答案,做完"理解检查"小题;</li>
            <li>用状态按钮手动标记掌握程度,面试前只刷<a href="#/review">"今日复习"</a>;</li>
            <li>定期到<a href="#/maintain">维护页</a>导出个人记录做备份。</li>
          </ol>
        </div>
      </div>`;
    $('#h-random').addEventListener('click', () => { if (randomQid) go('#/study/' + randomQid); });
  }

  function getTodayReviewCount() {
    return Data.allQuestions().filter(q => {
      const r = Store.rec(q.id);
      return r.status === 'review' || r.status === 'weak';
    }).length;
  }

  return { render };
})();
