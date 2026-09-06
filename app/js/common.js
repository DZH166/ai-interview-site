/* 数据访问与共享渲染(题目卡片、徽章、记录栏) */
'use strict';

const Data = (() => {
  let questions = [];   /* 内置 + 导入合并 */
  let docs = [];
  let userDocs = [];
  let byId = new Map();

  function init() {
    const base = (window.APP_DATA && window.APP_DATA.questions) || [];
    const extra = Store.extraBankLoad();
    const baseIds = new Set(base.map(q => q.id));
    questions = base.slice();
    extra.forEach(q => {
      if (baseIds.has(q.id) || byId.has(q.id)) {
        console.warn('导入题库与内置题号冲突,已跳过:', q.id);
        return;
      }
      questions.push(q);
    });
    byId = new Map(questions.map(q => [q.id, q]));
    docs = ((window.APP_DATA && window.APP_DATA.docs) || []).slice();
    userDocs = Store.userDocsLoad();
  }

  function allQuestions() { return questions; }
  function question(id) { return byId.get(id); }
  function allDocs() { return docs; }
  function doc(id) { return docs.find(d => d.id === id) || userDocs.find(d => d.id === id); }
  function allUserDocs() { return userDocs; }

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

  return { init, allQuestions, question, allDocs, doc, allUserDocs, topic, topicName, topicShort, typeLabel, diffLabel, statusInfo, TYPES, DIFFS, VERIFY };
})();

/* 浏览上下文:记录上一题/下一题列表(来自浏览页筛选) */
const NavCtx = {
  ids: null,   /* 数组或 null(全部) */
  set(ids) { this.ids = ids; },
  neighbors(qid) {
    const list = (this.ids && this.ids.length ? this.ids : Data.allQuestions().map(q => q.id));
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
    return `
      <div class="q-meta">
        ${badge(Data.topicName(q.topic), 'b-topic')}
        ${badge(Data.diffLabel(q.difficulty), 'b-diff-' + q.difficulty)}
        ${badge(Data.typeLabel(q.type), 'b-type')}
        ${badge(st.label, st.cls)}
        ${r.fav ? badge('★ 已收藏', 'b-fav') : ''}
        ${badge(v.label, v.cls)}
        ${(q.tags || []).map(t => badge(t, 'b-tag')).join('')}
      </div>`;
  }

  function verifyBlock(q) {
    const v = q.verify || {};
    const src = (q.sources || []).map(s => `
      <li>
        <span class="src-kind">${esc(s.kind === 'official' ? '官方' : s.kind === 'paper' ? '论文' : s.kind === 'repo' ? '开源库' : s.kind === 'independent' ? '独立整理' : '网页')}</span>
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
    return `
      ${pre.length ? `<div class="rel-row"><span class="rel-label">前置知识:</span>${pre.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : ''}
      ${rel.length ? `<div class="rel-row"><span class="rel-label">相关题目:</span>${rel.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : ''}
      ${docs.length ? `<div class="rel-row"><span class="rel-label">原理章节:</span>${docs.map(id => `<a class="rel-link" href="#/docs/${id}">${esc(Data.doc(id) ? Data.doc(id).title : id)}</a>`).join(' ')}</div>` : ''}
      <div class="rel-row"><span class="rel-label">本专题章节:</span><a class="rel-link" href="#/docs/doc-${esc(q.topic)}-1">${esc(Data.topicName(q.topic))}</a></div>`;
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
