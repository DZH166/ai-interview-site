/* 本地全文搜索:覆盖题干/答案/解析/例子/追问/误区/理解检查/个人笔记 + 文档章节 + 导入文档
   + 概念 + 专项题面 + 个人专项尝试 + 项目定义 + 个人项目运行/草稿记录。
   纯前端子串匹配 + 加权评分,无任何在线依赖。

   索引新鲜度:索引记录构建时的 Store.rev(数据版本号,任何写入都会自增),
   查询时若发现数据已变,自动用上下文提供者重建。这样「忘记重建索引」不再是一类
   可能的 bug(清空记录后还能搜到旧数据、导入了新笔记搜不到等)。 */
'use strict';

const Search = (() => {
  let units = [];
  let builtRev = -1;
  let ctxProvider = null;

  function norm(s) { return String(s || '').toLowerCase(); }

  /* 由 App.init 注入:返回最新检索上下文(题库/文档/资料/记录/概念/专项/项目) */
  function setContextProvider(fn) { ctxProvider = typeof fn === 'function' ? fn : null; }
  function curRev() { return (typeof Store !== 'undefined' && Store.rev !== undefined) ? Store.rev : builtRev; }
  /* 数据一变就作废旧索引。宁可空着等下一次重建,也不返回已经不存在的内容
     (清空记录后还能搜到已删笔记,就是这么来的)。 */
  function invalidate() { units = []; builtRev = -1; }
  function ensureFresh() {
    if (curRev() === builtRev) return;
    const ctx = ctxProvider ? ctxProvider() : null;
    if (ctx) build(ctx);   /* 没有上下文提供者时保持空索引:安全优于陈旧 */
  }
  if (typeof Store !== 'undefined' && Store.onInvalidate) Store.onInvalidate(invalidate);

  function build(ctx) {
    /* ctx: {questions, docs, userDocs, records, concepts, drills, projects, drillAttempts} */
    units = [];
    const qs = ctx.questions || [];
    qs.forEach(q => {
      const add = (field, text, weight, anchor) => {
        if (text && String(text).trim()) {
          units.push({ kind: 'q', qid: q.id, field, anchor, text: norm(text), raw: String(text), weight, topic: q.topic });
        }
      };
      add('title', q.title, 3.0, 'top');
      add('prompt', q.prompt, 2.5, 'top');
      add('tags', (q.tags || []).join(' '), 2.2, 'top');
      add('answer', q.answer, 1.6, 'answer');
      add('plain', q.plain, 1.0, 'plain');
      add('deep', q.deep + (q.fusion_notes ? '\n' + q.fusion_notes : ''), 1.0, 'deep');
      add('example', q.example, 0.8, 'example');
      add('interview', q.interview, 0.8, 'interview');
      (q.pitfalls || []).forEach(p => add('pitfalls', p, 0.8, 'pitfalls'));
      (q.followups || []).forEach(f => { add('followups', f.q, 0.9, 'followups'); add('followups', f.a, 0.7, 'followups'); });
      if (q.check) { add('check', q.check.q, 0.8, 'check'); add('check', q.check.a, 0.7, 'check'); }
      const note = ctx.records && ctx.records.questions && ctx.records.questions[q.id] && ctx.records.questions[q.id].note;
      if (note) units.push({ kind: 'note', qid: q.id, field: 'note', anchor: 'note', text: norm(note), raw: note, weight: 2.5, topic: q.topic });
    });
    (ctx.docs || []).forEach(d => {
      units.push({ kind: 'doc', docId: d.id, field: 'title', anchor: '', text: norm(d.title + ' ' + (d.summary || '')), raw: d.title, weight: 2.0, topic: d.topic });
      Markdown.sections(d.md).forEach(sec => {
        const body = sec.buf.join('\n');
        if (body.trim()) {
          units.push({
            kind: 'doc', docId: d.id, field: 'section', anchor: sec.id, topic: d.topic,
            text: norm(sec.title + '\n' + body), raw: sec.title + '\n' + body, weight: 1.2
          });
        }
      });
    });
    /* 专项练习与动手项目进入索引(任务书阶段7:统一检索) */
    ((ctx.concepts || [])).forEach(c => {
      if (!c.name) return;
      units.push({
        kind: 'concept', cid: c.id, field: 'concept', anchor: '',
        text: norm(c.name + ' ' + (c.definition || '')),
        raw: c.name + ':' + (c.definition || ''),
        weight: 2.0, topic: c.topic || ''
      });
    });
    /* 专项练习(题面+参考)与个人尝试记录进索引 */
    ((ctx.drills || [])).forEach(d => {
      if (!d || !d.id) return;
      const body = [d.q, d.reference, d.reason].filter(Boolean).join('\n');
      units.push({
        kind: 'drill', drillId: d.id, stage: d.stage || '', field: 'drill', anchor: '',
        text: norm(d.type + ' ' + body), raw: d.type + ' | ' + body,
        weight: 1.6, topic: ''
      });
    });
    /* 个人专项尝试记录(myAnswer/observed/review)进索引:
       主来源=顶层 drillAttempts(新模型);兼容旧题目记录 drillTries。
       每条尝试带 attemptId 身份与状态标签——搜索命中的是「哪一次尝试」,
       而不是只能跳到专项页顶部。 */
    const NL = String.fromCharCode(10);
    const STATE_LABEL = { draft: '草稿', completed: '已完成', abandoned: '已放弃' };
    const seenTries = new Set();
    const pushTry = (t) => {
      if (!t || !t.drillId) return;
      const parts = [t.myAnswer && '我的回答:' + t.myAnswer,
                     t.observed && '观察:' + t.observed,
                     t.review && '复盘:' + t.review].filter(Boolean);
      const body = parts.join(NL);
      if (!body.trim()) return;
      seenTries.add(t.drillId + '|' + (t.myAnswer || '') + '|' + (t.observed || '') + '|' + (t.review || ''));
      const stName = STATE_LABEL[t.status] || t.status || '';
      units.push({
        kind: 'try', drillId: t.drillId, attemptId: t.attemptId || '', status: t.status || '',
        qid: null, field: 'try', anchor: '',
        text: norm('专项尝试 ' + stName + ' ' + body),
        raw: '专项尝试(' + t.drillId + (stName ? ' · ' + stName : '') + ')' + NL + body,
        weight: 2.4, topic: ''
      });
    };
    Object.values(ctx.drillAttempts || {}).forEach(list => { (list || []).forEach(pushTry); });
    Object.values(ctx.records && ctx.records.questions || {}).forEach(r => {
      (r.drillTries || []).forEach(t => {
        if (!t.drillId) return;
        const key = t.drillId + '|' + (t.myAnswer || '') + '|' + (t.observed || '') + '|' + (t.review || '');
        if (seenTries.has(key)) return;   /* 已由顶层 drillAttempts 索引 */
        pushTry(t);
      });
    });
    ((ctx.projects || [])).forEach(pr => {
      if (!pr || !pr.name) return;
      const body = [pr.goal, pr.expected, pr.debug_case, pr.deliverable, (pr.extensions || []).join('; ')]
        .filter(Boolean).join('\n');
      units.push({
        kind: 'project', pid: pr.id, field: 'project', anchor: '',
        text: norm(pr.name + ' ' + body), raw: pr.name + '\n' + body,
        weight: 1.8, topic: ''
      });
    });
    /* 个人项目运行记录与草稿:用户自己写下的证据必须能被检索到,
       并且要能定位到「哪一次运行」而不只是项目说明。 */
    const ui = (ctx.records && ctx.records.ui) || {};
    Object.keys(ui.projectRuns || {}).forEach(pid => {
      (ui.projectRuns[pid] || []).forEach(r => {
        if (!r || typeof r !== 'object') return;
        const parts = [r.runOutput && '输出:' + r.runOutput,
                       r.debug && '定位:' + r.debug,
                       r.todo && '未完成:' + r.todo,
                       r.stepStatus && '步骤:' + r.stepStatus].filter(Boolean);
        if (!parts.length) return;
        const body = parts.join(NL);
        units.push({
          kind: 'run', pid, runId: r.runId || '', field: 'run', anchor: '', topic: '',
          text: norm('项目运行记录 ' + body),
          raw: '项目运行记录 ' + NL + body,
          weight: 2.4
        });
      });
    });
    Object.keys(ui.projectDrafts || {}).forEach(pid => {
      const d = ui.projectDrafts[pid];
      if (!d || typeof d !== 'object') return;
      [['short', '30 秒口述'], ['long', '2 分钟口述']].forEach(([key, label]) => {
        const text = d['speak_' + key];
        if (typeof text !== 'string' || !text.trim()) return;
        units.push({ kind: 'draft', pid, field: 'speak_' + key, anchor: '', topic: '',
          text: norm(label + ' ' + text), raw: label + NL + text, weight: 2.4 });
      });
      const parts = [d.runOutput && '输出:' + d.runOutput,
                     d.debug && '定位:' + d.debug,
                     d.todo && '未完成:' + d.todo,
                     d.speak_ask && '需求:' + d.speak_ask,
                     d.speak_plan && '方案:' + d.speak_plan,
                     d.speak_tradeoff && '取舍:' + d.speak_tradeoff,
                     d.speak_pain && '问题:' + d.speak_pain,
                     d.speak_verify && '验证:' + d.speak_verify,
                     d.speak_lack && '不足:' + d.speak_lack].filter(Boolean);
      if (!parts.length) return;
      const body = parts.join(NL);
      units.push({
        kind: 'draft', pid, field: 'draft', anchor: '', topic: '',
        text: norm('项目草稿 ' + body),
        raw: '项目草稿 ' + NL + body,
        weight: 2.0
      });
    });
    (ctx.userDocs || []).forEach(d => {
      units.push({ kind: 'udoc', docId: d.id, field: 'title', anchor: '', text: norm(d.title), raw: d.title, weight: 2.0, topic: '' });
      Markdown.sections(d.text || '').forEach(sec => {
        const body = sec.buf.join('\n');
        if (body.trim()) {
          units.push({
            kind: 'udoc', docId: d.id, field: 'section', anchor: sec.id, topic: '',
            text: norm(sec.title + '\n' + body), raw: sec.title + '\n' + body, weight: 1.2
          });
        }
      });
    });
    /* 索引构建完成:记下数据版本,后续任何写入都会让它过期并按需自动重建 */
    builtRev = curRev();
  }

  function tokenize(q) {
    return norm(q).split(/[\s,，、;；]+/).filter(Boolean);
  }

  /* 返回 [{unit, score, snippetHtml}] */
  function query(q, opt) {
    ensureFresh();   /* 数据已变则先重建,避免返回陈旧内容 */
    opt = opt || {};
    const terms = tokenize(q);
    if (!terms.length) return [];
    const results = [];
    units.forEach(u => {
      if (opt.scope === 'q' && !(u.kind === 'q' || u.kind === 'note')) return;
      if (opt.scope === 'doc' && !(u.kind === 'doc' || u.kind === 'udoc')) return;
      if (opt.scope === 'note' && u.kind !== 'note') return;
      if (opt.topic && u.topic && u.topic !== opt.topic) return;
      if (opt.topic && !u.topic && opt.topic !== '__all__') { /* 无专题的文档:仅"全部"时保留 */ }
      let score = 0, ok = true;
      for (const t of terms) {
        const idx = u.text.indexOf(t);
        if (idx < 0) { ok = false; break; }
        const count = u.text.split(t).length - 1;
        score += Math.min(count, 6) * u.weight * (u.field === 'title' ? 2 : 1);
      }
      if (!ok) return;
      /* 题号直查加权 */
      if (terms.length === 1 && /^([a-z]{2,4}-\d{3})$/i.test(q.trim()) && u.field === 'title') score += 50;
      results.push({ unit: u, score, snippet: makeSnippet(u.raw, terms) });
    });
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 60);
  }

  /* 在原文中定位最早命中处,取前后窗口生成片段并高亮 */
  function makeSnippet(raw, terms) {
    const text = String(raw || '');
    let start = -1;
    for (const t of terms) {
      if (!t) continue;
      const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const i = text.search(new RegExp(safe, 'i'));
      if (i >= 0 && (start < 0 || i < start)) start = i;
    }
    let from, to;
    if (start < 0) { from = 0; to = Math.min(text.length, 120); }
    else {
      from = Math.max(0, start - 40);
      to = Math.min(text.length, start + 110);
    }
    /* 避免截断在代理对中间 */
    while (from > 0 && /[\uD800-\uDFFF]/.test(text[from])) from--;
    const snippet = (from > 0 ? '…' : '') + text.slice(from, to) + (to < text.length ? '…' : '');
    let html = esc(snippet);
    terms.forEach(t => {
      if (!t) return;
      const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(safe, 'gi'), m => `<mark>${m}</mark>`);
    });
    return html;
  }

  function count() { ensureFresh(); return units.length; }

  return { build, query, tokenize, count, setContextProvider, ensureFresh, invalidate };
})();
