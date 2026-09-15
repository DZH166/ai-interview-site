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
    contentVersion = computeContentVersion();
  }

  /* 静态内容版本(搜索分层缓存的失效依据,阶段7):
     build.py 的内容哈希 + 题库规模。等长内容替换 → 哈希变 → 静态层重建;
     个人笔记编辑 → 不影响 → 静态层不重建。 */
  let contentVersion = '';
  function computeContentVersion() {
    const base = (window.APP_DATA && window.APP_DATA.content_hash) || '';
    return base + '|' + questions.length + '|' + docs.map(d => d.id).join(',');
  }
  function contentVersionOf() { return contentVersion; }

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

  return { init, allQuestions, question, allDocs, doc, allUserDocs, reloadUserDocs, contentVersionOf, topicMainDoc, topic, topicName, topicShort, typeLabel, diffLabel, statusInfo, TYPES, DIFFS, VERIFY };
})();

/* 追问稳定身份(SP-02):qid + 题面内容哈希——
   重排/新增/删除不影响其它追问的身份;题面被改写则身份变化,旧回答按「待核对」处理,
   绝不按数组下标把回答绑到另一道追问上 */
function fuId(qid, qText) {
  return qid + '-fu-' + Store.contentHash(String(qText || ''));
}

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

  /* Optional full scenario prompt stays visible before any reference answer is opened. */
  function promptHtml(q) {
    return q.prompt ? `<div class="q-prompt" data-question-prompt="${esc(q.id)}">${mdHtml(q.prompt)}</div>` : '';
  }
  function deepHtml(q) {
    return mdHtml(q.deep + (q.fusion_notes ? '\n\n## 融合补充：场景与边界\n\n' + q.fusion_notes : ''));
  }

  /* 概念(来自 data/concepts.json):题目→概念的正查与反查 */
  function conceptsOf(qid) {
    const cs = (window.APP_DATA.concepts && window.APP_DATA.concepts.concepts) || [];
    return cs.filter(c => (c.questions || []).includes(qid));
  }
  /* 本题前置概念的通俗名与定义(不只给题号) */
  function prereqConcepts(q) {
    const cs = (window.APP_DATA.concepts && window.APP_DATA.concepts.concepts) || [];
    const byId = new Map(cs.map(c => [c.id, c]));
    const out = [];
    const seen = new Set();
    (q.prerequisites || []).forEach(pid => {
      conceptsOf(pid).forEach(c => {
        if (!seen.has(c.id)) { seen.add(c.id); out.push(c); }
      });
    });
    return out;
  }

  function relLinks(q) {
    const pre = (q.prerequisites || []).filter(id => Data.question(id));
    const rel = (q.related || []).filter(id => Data.question(id));
    const docs = (q.doc_refs || []).filter(d => Data.doc(d));
    const tdoc = Data.topicMainDoc(q.topic);
    const pc = prereqConcepts(q);
    const myConcepts = conceptsOf(q.id);
    return `
      ${pc.length ? `<div class="rel-row"><span class="rel-label">先懂这些概念:</span>${pc.map(c => `<a class="rel-link" href="#/study/${(c.questions || [])[0]}" title="${esc(c.definition)}">${esc(c.name)}</a>`).join(' · ')}</div>` : ''}
      ${pre.length ? `<div class="rel-row"><span class="rel-label">前置题目:</span>${pre.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : ''}
      ${rel.length ? `<div class="rel-row"><span class="rel-label">相关题目:</span>${rel.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : ''}
      ${docs.length ? `<div class="rel-row"><span class="rel-label">原理章节:</span>${docs.map(id => `<a class="rel-link" href="#/docs/${id}">${esc(Data.doc(id) ? Data.doc(id).title : id)}</a>`).join(' ')}</div>` : ''}
      ${tdoc ? `<div class="rel-row"><span class="rel-label">本专题章节:</span><a class="rel-link" href="#/docs/${tdoc.id}">${esc(Data.topicName(q.topic))}</a></div>` : ''}
      ${myConcepts.length ? `<div class="rel-row"><span class="rel-label">本题涉及概念:</span>${myConcepts.map(c => `<a class="rel-link" href="#/study/${(c.questions || [])[0]}" title="${esc(c.definition)}">${esc(c.name)}</a>`).join(' · ')}</div>` : ''}`;
  }

  /* 答案与面试表达的融合卡:先给一版能直接用的说法。
     两段各留小标题,不把书面答案和口述表达揉成一段——否则读者分不清哪句能直接说出口。 */
  function answerFusionBody(q) {
    return `
      <div class="qf-part" data-part="answer">
        <div class="qf-label">直接答案</div>
        <div class="qf-body">${mdHtml(q.answer)}</div>
      </div>
      <div class="qf-part" data-part="interview">
        <div class="qf-label">面试表达 · 口述版</div>
        <div class="qf-body">${mdHtml(q.interview)}</div>
      </div>`;
  }

  /* 区块清单只有一份,学习页与浏览详情共用,避免两处漂移。
     默认全部展开:进来一次性看全;要自测时用「只看题干」整体收起,不必逐个点开。 */
  function standardSections(q, open) {
    const o = open !== false;
    return `
      ${section('answer', '答案与面试表达', answerFusionBody(q), o)}
      ${section('plain', '大白话解释', mdHtml(q.plain), o)}
      ${section('deep', '原理拆解', deepHtml(q), o)}
      ${section('example', '具体例子', mdHtml(q.example), o)}
      ${section('followups', '常见追问', followupsHtml(q), o)}
      ${section('pitfalls', '常见误区', pitfallsHtml(q), o)}
      ${section('check', '理解检查', checkHtml(q), o)}
      ${section('sources', '出处与核查状态', verifyBlock(q), o)}`;
  }

  /* 「只看题干」开关:默认全展开的配套出口,保住「先自己答一遍」的自测用法 */
  function focusToggle() {
    return '<button class="btn btn-small" data-focus-toggle aria-pressed="false">只看题干</button>';
  }

  function wireFocusToggle(root) {
    $$('[data-focus-toggle]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const host = btn.closest('.study-wrap, #q-detail') || root;
        const on = host.classList.toggle('focus-mode');
        btn.setAttribute('aria-pressed', on ? 'true' : 'false');
        btn.textContent = on ? '显示答案与解析' : '只看题干';
      });
    });
  }

  /* 学习页主体 */
  function studyBody(q) {
    return `
      ${metaLine(q)}
      <h1 class="q-title">${esc(q.title)}</h1>
      ${promptHtml(q)}
      ${relLinks(q)}
      <div class="q-secs">${standardSections(q)}</div>
      <div class="q-note-box">
        <label class="note-label">我的笔记(会参与全文搜索)</label>
        <textarea id="note-area" placeholder="写下你的理解、易错点或自己的例子……">${esc(Store.rec(q.id).note || '')}</textarea>
      </div>`;
  }

  /* 就地同步记录工具条(远端合并后):只改状态按钮激活态/收藏标签/到期提示,
     不重建 DOM——保留焦点与展开状态(ST-01f/ST-02 配套) */
  function syncRecordBar(scope, qid) {
    if (!scope) return;
    const r = Store.rec(qid);
    $$('.status-btn[data-status]', scope).forEach(b => {
      b.classList.toggle('active', b.dataset.status === (r.status || ''));
    });
    const fav = $('[data-fav]', scope);
    if (fav) {
      fav.classList.toggle('faved', !!r.fav);
      fav.textContent = r.fav ? '★ 已收藏' : '☆ 收藏';
    }
    const due = (r.srs && typeof r.srs.due === 'number') ? SRS.dueLabel(r.srs.due) : '';
    const hint = $('.rb-srs-due', scope);
    if (hint) {
      hint.textContent = due ? '🔁 建议:' + due : '';
      hint.hidden = !due;
    }
  }

  /* 记录工具条 */
  function recordBar(qid) {
    const r = Store.rec(qid);
    const cur = r.status || '';
    /* 间隔重复建议的到期日(只读提示,不参与手动状态判定) */
    const due = (r.srs && typeof r.srs.due === 'number') ? SRS.dueLabel(r.srs.due) : '';
    return `
      <div class="record-bar">
        <div class="rb-status">
          ${Store.STATUS.map(s => `
            <button class="status-btn ${s.cls} ${cur === s.id ? 'active' : ''}" data-status="${s.id}">${s.label}</button>`).join('')}
        </div>
        ${due ? `<span class="rb-srs-due muted" style="font-size:12px" title="间隔重复建议的下一次复习时间;手动状态永远优先">🔁 建议:${esc(due)}</span>` : '<span class="rb-srs-due muted" style="font-size:12px" hidden></span>'}
        <button class="btn btn-small ${r.fav ? 'faved' : ''}" data-fav>${r.fav ? '★ 已收藏' : '☆ 收藏'}</button>
      </div>`;
  }

  return { badge, metaLine, studyBody, recordBar, syncRecordBar, verifyBlock, relLinks, mdHtml, promptHtml, deepHtml, section,
           answerFusionBody, standardSections, focusToggle, wireFocusToggle };
})();
