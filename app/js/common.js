/* 数据访问与共享渲染(题目卡片、徽章、记录栏) */
'use strict';

const Data = (() => {
  let questions = [];   /* 壳 questions_index + 分片全量 + 导入合并 */
  let docs = [];
  let userDocs = [];
  let byId = new Map();

  /* ---- 分片加载状态(Track E) ----
     壳(questions_index)同步可用 → 列表/计数立即可渲染;
     全量字段(prompt/answer/followups…)来自 app/data/topics/ 分片,异步合并。
     needs-full 的功能(搜索索引/学习页/自测抽题)必须 questionsReady() 之后再读。 */
  let fullReady = false;        /* 分片全部合并完成(或判定无需加载) */
  let fullPromise = null;       /* 进行中的合并 Promise(幂等) */
  let mergedBank = null;        /* 分片合并出的全量内置题(id -> q),重入 init 时复用 */

  /* 兼容探测:壳里若已带非空全量 questions(Node 测试桩 / 未来回退形态),
     直接视为已就绪,跳过分片加载 —— detect-and-skip,不是特判某个调用方。 */
  function shellHasFullQuestions() {
    const d = window.APP_DATA;
    return !!(d && Array.isArray(d.questions) && d.questions.length);
  }
  /* 该题是否已带全量字段(至少有答案类字段):index-only 的题不含 answer */
  function isFullQuestion(q) {
    return q && (q.answer !== undefined || q.followups !== undefined || q.sources !== undefined);
  }

  function init() {
    const base = shellHasFullQuestions()
      ? window.APP_DATA.questions
      : ((window.APP_DATA && window.APP_DATA.questions_index) || []);
    /* 启动隔离:坏扩展数据移入隔离键(原始保留,维护页可导出),合法数据才进内存 */
    if (Store.resetLoadIssues) Store.resetLoadIssues();
    const extra = Store.loadExtraBankSafe();
    /* 重入防线(Track E):init 会被远端合并/导入等场景反复调用。
       若直接从 questions_index 重建,已异步合并进来的全量字段会被冲掉 ——
       全量题目只从 mergedBank(分片合并结果)取,shell 的 index 只在
       mergedBank 尚未就绪时充当首屏占位。 */
    let mergedFull = null;
    if (!shellHasFullQuestions()) {
      if (mergedBank) mergedFull = mergedBank.slice();
      else if (fullReady) { mergedBank = []; mergedFull = mergedBank.slice(); }
    }
    questions = mergedFull !== null ? mergedFull : base.slice();
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
    /* 分片合并只做一次;init 可重入(远端变更/导入后重建内存),
       已就绪或已在加载就直接沿用,不重复发请求。 */
    if (!fullPromise) fullPromise = loadTopicFiles();
    contentVersion = computeContentVersion();
  }

  /* ---- 分片异步合并 ----
     manifest(SW 预缓存,网络优先)→ 全部专题文件 Promise.allSettled。
     单片失败不炸全局:该专题题目缺失时,依赖全量字段的功能按「题目不存在」空态降级;
     失败的分片重试一次(老 SW 缓存未含分片时的自愈),再失败才认输并进 loadIssues。 */
  function loadTopicFiles() {
    /* Node 测试桩 / 已含全量的壳:无需加载,立即就绪 */
    if (shellHasFullQuestions()) { fullReady = true; return Promise.resolve(); }
    if (typeof fetch !== 'function') { fullReady = true; return Promise.resolve(); }
    const issues = [];
    return fetch('data/manifest.json')
      .then(r => { if (!r.ok) throw new Error('manifest ' + r.status); return r.json(); })
      .then(mf => {
        const entries = Object.values((mf && mf.topics) || {});
        return Promise.allSettled(entries.map(e =>
          fetchJsonRetry('data/topics/' + e.file)));
      })
      .then(results => {
        results.forEach((res, i) => {
          if (res.status === 'fulfilled') mergeTopic(res.value);
          else issues.push(String((res.reason && res.reason.message) || res.reason));
        });
        if (issues.length) {
          console.warn('题库分片加载失败 ' + issues.length + ' 个(对应专题题目不可用):', issues);
          if (Store.loadIssues) Store.loadIssues.topicFiles = issues;
        }
        fullReady = true;
      })
      .catch(err => {
        /* manifest 都拿不到:全量字段整体缺失,列表仍可用(index),详情降级空态 */
        console.warn('题库分片 manifest 加载失败,仅索引可用:', err);
        issues.push('manifest: ' + ((err && err.message) || err));
        if (Store.loadIssues) Store.loadIssues.topicFiles = issues;
        fullReady = true;
      });
  }

  function fetchJsonRetry(url) {
    return fetchJson(url).catch(first => fetchJson(url).catch(second => {
      throw new Error(url + ' :: ' + ((second && second.message) || second));
    }));
  }
  function fetchJson(url) {
    return fetch(url).then(r => {
      if (!r.ok) throw new Error(r.status);
      return r.json();
    });
  }

  /* 单片合并:就地扩充 questions/byId,并同步进 mergedBank(重入 init 时复用)。
     分片题目以题库校验的唯一 id 为准,与 index 里的同名条目按 id 对齐替换
     (浅合并:index 提供的元数据字段保留)。 */
  function mergeTopic(payload) {
    const qs = (payload && payload.questions) || [];
    if (!mergedBank) mergedBank = [];
    const bankSeen = new Set(mergedBank.map(q => q.id));
    qs.forEach(q => {
      if (!q || !q.id || !isFullQuestion(q)) return;
      if (!bankSeen.has(q.id)) { mergedBank.push(q); bankSeen.add(q.id); }
      const existing = byId.get(q.id);
      if (existing) Object.assign(existing, q);
      else { questions.push(q); byId.set(q.id, q); }
    });
  }

  /* 全量题目就绪门控:needs-full 的功能(搜索索引/学习页正文/自测抽题)等这个。
     已就绪立即 resolve;同一 Promise 复用,多调用方并发等待不重复加载。 */
  function questionsReady() {
    if (!fullPromise) fullPromise = loadTopicFiles();
    return fullPromise;
  }
  function questionsLoaded() { return fullReady; }

  /* 静态内容版本(搜索分层缓存的失效依据,阶段7):
     build.py 的内容哈希 + 题库规模。等长内容替换 → 哈希变 → 静态层重建;
     个人笔记编辑 → 不影响 → 静态层不重建。
     Track E:追加就绪标记 —— 分片合并前后题库长度相同(3900|3900),仅凭长度
     搜静态层签名不会失效,搜索会一直用 index-only 的半份索引;ready 标记翻转
     强制合并后重建一次静态层。 */
  let contentVersion = '';
  function computeContentVersion() {
    const base = (window.APP_DATA && window.APP_DATA.content_hash) || '';
    return base + '|' + questions.length + '|' + (fullReady ? 'full' : 'idx') + '|' + docs.map(d => d.id).join(',');
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

  return { init, allQuestions, question, questionsReady, questionsLoaded, allDocs, doc, allUserDocs, reloadUserDocs, contentVersionOf, topicMainDoc, topic, topicName, topicShort, typeLabel, diffLabel, statusInfo, TYPES, DIFFS, VERIFY };
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

  /* 元数据只留「判断这道题该怎么答」需要的四个维度:专题 / 难度 / 题型 / 当前状态。
     核查状态原本也在这里,但它与「出处与核查状态」区块说的是同一件事;
     标签同理 —— 两者都已挪到那个区块,首屏省下的空间留给题干与答案。 */
  function metaLine(q) {
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
        ${(q.tags || []).length ? `<div class="verify-tags"><span class="rel-label">标签:</span>${(q.tags || []).map(t => badge(t, 'b-tag')).join('')}</div>` : ''}
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

  /* 按字段渲染:套上人工精读挑出的重点标注(见 app/js/highlight.js)。
     标注单独存放,不改题库原文,所以内容审计与融合适配器的哈希都不受影响。 */
  function mdField(q, field) {
    return Highlight.renderField(q.id, field, Markdown.render((q && q[field]) || ''));
  }

  /* Optional full scenario prompt stays visible before any reference answer is opened. */
  function promptHtml(q) {
    return q.prompt ? `<div class="q-prompt" data-question-prompt="${esc(q.id)}">${mdHtml(q.prompt)}</div>` : '';
  }
  function deepHtml(q) {
    return mdField(q, 'deep') + (q.fusion_notes ? Markdown.render('\n\n## 融合补充：场景与边界\n\n' + q.fusion_notes) : '');
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

  /* 关联信息默认收进一个折叠区。
     六行链接(先懂概念 / 前置题 / 相关题 / 原理章节 / 本专题章节 / 涉及概念)
     对「读这道题」本身都是旁支,全部铺在正文前面会把题面与答案挤出首屏 ——
     移动端实测正文起点在 531px,占掉 844 视口的 84%。
     收起来不等于藏起来:summary 里直接报出有什么、各多少,一眼就能判断值不值得展开。 */
  function relLinks(q) {
    const pre = (q.prerequisites || []).filter(id => Data.question(id));
    const rel = (q.related || []).filter(id => Data.question(id));
    const docs = (q.doc_refs || []).filter(d => Data.doc(d));
    const tdoc = Data.topicMainDoc(q.topic);
    const pc = prereqConcepts(q);
    const myConcepts = conceptsOf(q.id);
    const rows = [
      pc.length ? `<div class="rel-row"><span class="rel-label">先懂这些概念:</span>${pc.map(c => `<a class="rel-link" href="#/study/${(c.questions || [])[0]}" title="${esc(c.definition)}">${esc(c.name)}</a>`).join(' · ')}</div>` : '',
      pre.length ? `<div class="rel-row"><span class="rel-label">前置题目:</span>${pre.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : '',
      rel.length ? `<div class="rel-row"><span class="rel-label">相关题目:</span>${rel.map(id => `<a class="rel-link" href="#/study/${id}">${id}</a>`).join(' ')}</div>` : '',
      docs.length ? `<div class="rel-row"><span class="rel-label">原理章节:</span>${docs.map(id => `<a class="rel-link" href="#/docs/${id}">${esc(Data.doc(id) ? Data.doc(id).title : id)}</a>`).join(' ')}</div>` : '',
      tdoc ? `<div class="rel-row"><span class="rel-label">本专题章节:</span><a class="rel-link" href="#/docs/${tdoc.id}">${esc(Data.topicName(q.topic))}</a></div>` : '',
      myConcepts.length ? `<div class="rel-row"><span class="rel-label">本题涉及概念:</span>${myConcepts.map(c => `<a class="rel-link" href="#/study/${(c.questions || [])[0]}" title="${esc(c.definition)}">${esc(c.name)}</a>`).join(' · ')}</div>` : ''
    ].filter(Boolean);
    if (!rows.length) return '';
    const nDocs = docs.length + (tdoc ? 1 : 0);
    const bits = [];
    if (pc.length) bits.push(pc.length + ' 个前置概念');
    if (pre.length) bits.push(pre.length + ' 道前置题');
    if (rel.length) bits.push(rel.length + ' 道相关题');
    if (nDocs) bits.push(nDocs + ' 个原理章节');
    if (myConcepts.length) bits.push(myConcepts.length + ' 个涉及概念');
    return `
      <details class="rel-box">
        <summary><span class="rel-label">关联内容</span> <span class="muted">${esc(bits.join(' · '))}</span></summary>
        <div class="rel-box-body">${rows.join('')}</div>
      </details>`;
  }

  /* ---- 选择题(quiz)分支:牛客题库选择题的渲染 ----
     与 10 要素叙述题共用外壳(metaLine/promptHtml/记录栏/笔记),内容区按 format 分支:
     题干+选项卡(正确项高亮可切换隐藏)+官方解析。不自造 followups/check 等字段。

     显隐机制(Fix2):答案始终在 DOM 中,用 CSS class 控制显隐——
     按钮点击只切换 class,不重渲页面,响应即时(旧实现重渲整页导致按钮"无响应")。 */
  function quizOptionsHtml(q) {
    const hide = Store.rec(q.id).quizHide !== false;   /* 默认隐藏正确项,自测先选 */
    const multi = q.qtype === 'multi';
    const revealCls = hide ? '' : ' quiz-revealed';
    return `
      <div class="quiz-options${revealCls}" data-quiz-options="${esc(q.id)}">
        ${(q.options || []).map(o => `
          <div class="quiz-opt ${o.right ? 'quiz-is-right' : ''}">
            <span class="quiz-lab">${esc(o.label)}</span>
            <span class="quiz-txt">${mdHtml(o.text)}</span>
            <span class="quiz-mark">✓</span>
          </div>`).join('')}
      </div>
      <div class="quiz-toolbar">
        <button class="btn btn-small" data-quiz-reveal="${esc(q.id)}">${hide ? '显示正确答案' : '隐藏正确答案'}</button>
        ${multi ? '<span class="badge b-tag">多选</span>' : '<span class="badge b-tag">单选</span>'}
      </div>`;
  }

  function quizBody(q) {
    const hide = Store.rec(q.id).quizHide !== false;
    const ansCls = hide ? ' quiz-answer-hidden' : '';
    return `
      <div class="qf-part" data-part="options">
        <div class="qf-label">选项(先自己选,再对答案)</div>
        <div class="qf-body">${quizOptionsHtml(q)}</div>
      </div>
      <div class="qf-part quiz-answer-block${ansCls}" data-part="answer">
        <div class="qf-label">正确答案与官方解析</div>
        <div class="qf-body">${mdField(q, 'answer')}</div>
      </div>`;
  }

  /* ---- 问答题(qa)分支:牛客面经开放题的渲染 ----
     题干 + 参考答案卡(默认收起,自测先答)。无选项、无十要素区块。 */
  function qaBody(q) {
    const hide = Store.rec(q.id).quizHide !== false;
    const ansCls = hide ? ' quiz-answer-hidden' : '';
    return `
      <div class="qf-part quiz-answer-block${ansCls}" data-part="qa">
        <div class="qf-label">参考答案(先自己口述一遍,再对照)</div>
        <div class="qf-body">${mdField(q, 'answer')}</div>
      </div>
      <div class="quiz-toolbar" style="margin-top:8px">
        <button class="btn btn-small" data-quiz-reveal="${esc(q.id)}">${hide ? '显示参考答案' : '隐藏参考答案'}</button>
      </div>`;
  }

  function wireQuizToggle(root) {
    $$('[data-quiz-reveal]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        const qid = btn.dataset.quizReveal;
        const r = Store.rec(qid);
        const nowHidden = r.quizHide !== false;
        const newHidden = !nowHidden;
        r.quizHide = newHidden ? undefined : false;
        /* 就地 CSS 切换:不重渲页面,响应即时(Fix2) */
        const host = btn.closest('.study-wrap, #q-detail, #view') || document;
        const opts = host.querySelector(`[data-quiz-options="${qid}"]`);
        if (opts) opts.classList.toggle('quiz-revealed', !newHidden);
        $$(`.quiz-answer-block`, host).forEach(blk => {
          blk.classList.toggle('quiz-answer-hidden', newHidden);
        });
        btn.textContent = newHidden
          ? (btn.closest('.qf-part')?.querySelector('.qf-label')?.textContent.includes('参考') ? '显示参考答案' : '显示正确答案')
          : (btn.closest('.qf-part')?.querySelector('.qf-label')?.textContent.includes('参考') ? '隐藏参考答案' : '隐藏正确答案');
      });
    });
  }

  /* 答案与面试表达的融合卡:先给一版能直接用的说法。
     两段各留小标题,不把书面答案和口述表达揉成一段——否则读者分不清哪句能直接说出口。 */
  function answerFusionBody(q) {
    if (q.format === 'quiz') return quizBody(q);
    return `
      <div class="qf-part" data-part="answer">
        <div class="qf-label">直接答案</div>
        <div class="qf-body">${mdField(q, 'answer')}</div>
      </div>
      <div class="qf-part" data-part="interview">
        <div class="qf-label">面试表达 · 口述版</div>
        <div class="qf-body">${mdField(q, 'interview')}</div>
      </div>`;
  }

  /* 区块清单只有一份,学习页与浏览详情共用,避免两处漂移。
     顺序按「面试时用得上的先后」排:先给能直接说出口的,再给支撑材料。
     最长的「原理拆解」放到最后 —— 它独占全文 26% 的字符量,是选读而非必读,
     原来排在第 3 位,导致进来先读到最不该先读的那一块。
     默认全部展开:进来一次性看全,要自测时用「只看题干」整体收起。 */
  function standardSections(q, open) {
    const o = open !== false;
    if (q.format === 'qa') {
      return `
        ${section('answer', '参考答案', qaBody(q), o)}
        ${section('sources', '出处与核查状态', verifyBlock(q), o)}`;
    }
    if (q.format === 'quiz') {
      return `
        ${section('answer', '选项与答案', answerFusionBody(q), o)}
        ${section('plain', '官方解析', mdField(q, 'plain'), o)}
        ${section('sources', '出处与核查状态', verifyBlock(q), o)}`;
    }
    return `
      ${section('answer', '答案与面试表达', answerFusionBody(q), o)}
      ${section('plain', '大白话解释', mdField(q, 'plain'), o)}
      ${section('example', '具体例子', mdField(q, 'example'), o)}
      ${section('pitfalls', '常见误区', pitfallsHtml(q), o)}
      ${section('followups', '常见追问', followupsHtml(q), o)}
      ${section('check', '理解检查', checkHtml(q), o)}
      ${section('deep', '原理拆解', deepHtml(q), o)}
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

  return { badge, metaLine, studyBody, recordBar, syncRecordBar, verifyBlock, relLinks, mdHtml, mdField, promptHtml, deepHtml, section, wireQuizToggle,
           answerFusionBody, standardSections, focusToggle, wireFocusToggle };
})();
