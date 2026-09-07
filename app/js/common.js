/* 数据访问与共享渲染(题目卡片、徽章、记录栏) */
'use strict';

const Data = (() => {
  let questions = [];   /* 内置 + 导入合并 */
  let docs = [];
  let userDocs = [];
  let byId = new Map();

  function init() {
    const base = (window.APP_DATA && window.APP_DATA.questions) || [];
    /* 启动隔离:坏扩展数据移入隔离键(原始保留,维护页可导出),合法数据才进内存 */
    if (Store.resetLoadIssues) Store.resetLoadIssues();
    const extra = Store.loadExtraBankSafe();
    questions = base.slice();
    /* 用本轮新建的 seen 判重:不能用上一轮的 byId,否则重复 init 会把
       已导入的扩展题误判为冲突而丢弃(init 必须可重入) */
    const seen = new Set(questions.map(q => q.id));
    extra.forEach(q => {
      if (!q || !q.id || seen.has(q.id)) {
        console.warn('导入题库题号缺失或与现有冲突,已跳过:', q && q.id);
        return;
      }
      questions.push(q);
      seen.add(q.id);
    });
    byId = new Map(questions.map(q => [q.id, q]));
    docs = ((window.APP_DATA && window.APP_DATA.docs) || []).slice();
    userDocs = Store.loadUserDocsSafe();
  }

  function allQuestions() { return questions; }
  function question(id) { return byId.get(id); }
  function allDocs() { return docs; }
  function doc(id) { return docs.find(d => d.id === id) || userDocs.find(d => d.id === id); }
  function allUserDocs() { return userDocs; }
  /* 删除/导入资料后调用:重建闭包内的集合,目录与索引立即同步 */
  function reloadUserDocs() { userDocs = Store.userDocsLoad(); return userDocs; }
  /* 某专题的主章节:按 order 取最小(与文档目录排序一致);无则返回 null */
  function topicMainDoc(topicId) {
    const list = docs.filter(d => d.topic === topicId);
    return list.length ? list.reduce((a, b) => ((a.order || 99) <= (b.order || 99) ? a : b)) : null;
  }

  function topic(id) { return ((window.APP_DATA && window.APP_DATA.topics) || []).find(t => t.id === id); }
  function topicName(id) { const t = topic(id); return t ? t.name : (id || '通用'); }
  function topicShort(id) { const t = topic(id); return t ? t.short : '??'; }

  const TYPES = { concept: '概念理解', principle: '原理解释', comparison: '方案比较', code: '代码阅读', debug: '故障排查', scenario: '项目情境' };
  const DIFFS = { basic: '基础', intermediate: '进阶', advanced: '高级' };
  const VERIFY = {
    verified: { label: '已内容核查', cls: 'vf-verified' },
    partial: { label: '部分核查/版本相关', cls: 'vf-partial' },
    todo: { label: '待核查', cls: 'vf-todo' }
  };

  function typeLabel(t) { return TYPES[t] || t; }
  function diffLabel(d) { return DIFFS[d] || d; }

  function statusInfo(id) {
    const s = Store.rec(id).status || '';
    return Store.STATUS.find(x => x.id === s) || Store.STATUS[0];
  }

  return { init, allQuestions, question, allDocs, doc, allUserDocs, reloadUserDocs, topicMainDoc, topic, topicName, topicShort, typeLabel, diffLabel, statusInfo, TYPES, DIFFS, VERIFY };
})();

/* 浏览上下文:记录上一题/下一题列表(来自浏览页筛选) */
const NavCtx = {
  ids: null,   /* 数组或 null(全部) */
  set(ids) { this.ids = ids; },
  neighbors(qid) {
    /* 当前集合包含该题时按集合导航;否则回退全量(直接打开学习页的场景) */
    const list = (this.ids && this.ids.length && this.ids.includes(qid))
      ? this.ids
      : Data.allQuestions().map(q => q.id);
    const idx = list.indexOf(qid);
    return {
      prev: idx > 0 ? list[idx - 1] : null,
      next: idx >= 0 && idx < list.length - 1 ? list[idx + 1] : null,
      pos: idx + 1, total: list.length
    };
  }
};

/* 共享题目渲染 */
const QRender = (() => {
  function badge(text, cls) { return `<span class="badge ${cls || ''}">${esc(text)}</span>`; }

  function metaLine(q) {
    const v = Data.VERIFY[(q.verify && q.verify.status) || 'todo'];
    const st = Data.statusInfo(q.id);
    const r = Store.rec(q.id);
    const revised = q.content_version && r.contentRev !== q.content_version.rev;
    return `
      <div class="q-meta">
        ${badge(Data.topicName(q.topic), 'b-topic')}
        ${badge(Data.diffLabel(q.difficulty), 'b-diff-' + q.difficulty)}
        ${badge(Data.typeLabel(q.type), 'b-type')}
        ${badge(st.label, st.cls)}
        ${revised ? '<a class="badge vf-partial" href="#/study/' + esc(q.id) + '" title="内容有更新,建议重做">♻ 有更新</a>' : ''}
        ${r.fav ? badge('★ 已收藏', 'b-fav') : ''}
        ${badge(v.label, v.cls)}
        ${(q.tags || []).map(t => badge(t, 'b-tag')).join('')}
      </div>`;
  }

  function verifyBlock(q) {
    const v = q.verify || {};
    const src = (q.sources || []).map(s => `
      <li>
        <span class="src-kind">${esc(({ 'official': '官方', 'official-docs': '官方文档', 'official-blog': '官方博客', 'paper': '论文', 'repo': '开源库', 'independent': '独立整理', 'web': '网页', 'website': '网页' })[s.kind] || s.kind)}</span>
        ${s.url ? `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.name)}</a>` : `<span>${esc(s.name)}</span>`}
        ${s.note ? `<div class="src-note">${esc(s.note)}</div>` : ''}
      </li>`).join('');
    return `
      <div class="verify-block">
        <div class="verify-line">核查状态:<b>${esc(Data.VERIFY[v.status || 'todo'].label)}</b> · 核查日期:${esc(v.checked_date || '—')}</div>
        ${v.note ? `<div class="verify-note">${esc(v.note)}</div>` : ''}
        <ul class="src-list">${src || '<li class="muted">无来源记录</li>'}</ul>
      </div>`;
  }

  /* 折叠卡片。id 前缀保证唯一 */
  function section(id, title, bodyHtml, open, badge) {
    return `
      <div class="q-sec ${open ? 'open' : ''}" data-sec="${id}">
        <button class="q-sec-head" data-toggle="${id}">
          <span class="q-sec-title">${esc(title)} ${badge ? `<span class="q-sec-badge">${esc(badge)}</span>` : ''}</span>
          <span class="q-sec-arrow">${open ? '−' : '+'}</span>
        </button>
        <div class="q-sec-body">${bodyHtml}</div>
      </div>`;
  }

  function followupsHtml(q) {
    return (q.followups || []).map((f, i) => `
      <div class="fu">
        <div class="fu-q">追问 ${i + 1}:${esc(f.q)}</div>
        <div class="fu-a">${mdHtml(f.a)}</div>
      </div>`).join('');
  }

  function pitfallsHtml(q) {
    return `<ul class="pf-list">${(q.pitfalls || []).map(p => `<li>${mdHtml(p)}</li>`).join('')}</ul>`;
  }

  function checkHtml(q) {
    const c = q.check || {};
    return `
      <div class="chk-q">${mdHtml(c.q || '')}</div>
      <button class="btn btn-small" data-reveal-check>查看答案</button>
      <div class="chk-a hidden"><div class="chk-answer">${mdHtml(c.a || '')}</div>
      ${c.explain ? `<div class="chk-explain">检验点:${mdHtml(c.explain)}</div>` : ''}</div>`;
  }

  function mdHtml(text) {
    return Markdown.render(text || '');
  }

  function relLinks(q) {
    const pre = (q.prerequisites || []).filter(id => Data.question(id));
    const rel = (q.related || []).filter(id => Data.question(id));
    const docs = (q.doc_refs || []).filter(d => Data.doc(d));
    const tdoc = Data.topicMainDoc(q.topic);
    return `
      ${pre.length ? `<div class="rel-row"><span class="rel-label">前置知识:</span>${pre.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : ''}
      ${rel.length ? `<div class="rel-row"><span class="rel-label">相关题目:</span>${rel.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : ''}
      ${docs.length ? `<div class="rel-row"><span class="rel-label">原理章节:</span>${docs.map(id => `<a class="rel-link" href="#/docs/${id}">${esc(Data.doc(id) ? Data.doc(id).title : id)}</a>`).join(' ')}</div>` : ''}
      ${tdoc ? `<div class="rel-row"><span class="rel-label">本专题章节:</span><a class="rel-link" href="#/docs/${tdoc.id}">${esc(Data.topicName(q.topic))}</a></div>` : ''}`;
  }

  /* 学习页主体(完整展开结构) */
  function studyBody(q) {
    return `
      ${metaLine(q)}
      <h1 class="q-title">${esc(q.title)}</h1>
      ${relLinks(q)}
      <div class="q-secs">
        ${section('answer', '直接答案', mdHtml(q.answer), false)}
        ${section('plain', '大白话解释', mdHtml(q.plain), false)}
        ${section('deep', '原理拆解', mdHtml(q.deep), false)}
        ${section('example', '具体例子', mdHtml(q.example), false)}
        ${section('interview', '面试表达', mdHtml(q.interview), false)}
        ${section('followups', '常见追问', followupsHtml(q), false)}
        ${section('pitfalls', '常见误区', pitfallsHtml(q), false)}
        ${section('check', '理解检查', checkHtml(q), false)}
        ${section('sources', '出处与核查状态', verifyBlock(q), false)}
      </div>
      <div class="q-note-box">
        <label class="note-label">我的笔记(会参与全文搜索)</label>
        <textarea id="note-area" placeholder="写下你的理解、易错点或自己的例子……">${esc(Store.rec(q.id).note || '')}</textarea>
      </div>`;
  }

  /* 记录工具条 */
  function recordBar(qid) {
    const r = Store.rec(qid);
    const cur = r.status || '';
    return `
      <div class="record-bar">
        <div class="rb-status">
          ${Store.STATUS.map(s => `
            <button class="status-btn ${s.cls} ${cur === s.id ? 'active' : ''}" data-status="${s.id}">${s.label}</button>`).join('')}
        </div>
        <button class="btn btn-small ${r.fav ? 'faved' : ''}" data-fav>${r.fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </div>`;
  }

  return { badge, metaLine, studyBody, recordBar, verifyBlock, relLinks, mdHtml, section };
})();
