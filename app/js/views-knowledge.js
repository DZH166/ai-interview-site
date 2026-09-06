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
       每次渲染先移除旧监听,路由切换不残留。 */
    if (DocsView._onScroll) window.removeEventListener('scroll', DocsView._onScroll);
    DocsView._onScroll = debounce(() => {
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
    Search.build({ questions: Data.allQuestions(), docs: Data.allDocs(), userDocs: Data.allUserDocs(), records: Store.data });
  }

  return { render, rebuildSearch };
})();

/* ---------- 全局搜索 ---------- */
const SearchView = (() => {
  function render(root, parts) {
    const q = parts && parts.length ? parts.join('/') : (Store.data.ui.search.q || '');
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
    const kindName = { q: '题目', note: '我的笔记', doc: '章节', udoc: '导入资料' };
    box.innerHTML = results.map(r => {
      const u = r.unit;
      let href, title;
      if (u.kind === 'q' || u.kind === 'note') {
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
      const fieldLabel = { title: '题名', tags: '标签', answer: '直接答案', plain: '大白话', deep: '原理', example: '例子', interview: '面试表达', followups: '追问', pitfalls: '误区', check: '理解检查', note: '笔记', section: '章节' }[u.field] || u.field;
      return `
        <a class="search-item" href="${esc(href)}">
          <div class="si-head">
            <span class="badge b-topic">${kindName[u.kind] || u.kind}</span>
            <span class="badge b-tag">${esc(fieldLabel)}</span>
            ${u.qid ? `<span class="qid">${esc(u.qid)}</span>` : ''}
            <span class="si-title">${esc(title)}</span>
          </div>
          <div class="si-snippet">${r.snippet}</div>
        </a>`;
    }).join('');
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
