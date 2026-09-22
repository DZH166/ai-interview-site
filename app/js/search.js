/* 本地全文搜索:覆盖题干/答案/解析/例子/追问/误区/理解检查/个人笔记 + 文档章节 + 导入文档
   + 概念 + 专项题面 + 个人专项尝试 + 项目定义 + 个人项目运行/草稿记录。
   纯前端子串匹配 + 加权评分,无任何在线依赖。

   索引新鲜度:索引记录构建时的 Store.rev(数据版本号,任何写入都会自增),
   查询时若发现数据已变,自动用上下文提供者重建。这样「忘记重建索引」不再是一类
   可能的 bug(清空记录后还能搜到旧数据、导入了新笔记搜不到等)。

   分层缓存(2026-09-13):重建开销的大头是静态内容(题库字段 + Markdown 章节解析),
   而触发重建的却往往是个人写入(记笔记/存尝试)。所以索引分两层:
     - 静态层:题库/文档/概念/专项/项目,按题库规模签名缓存,基本只建一次;
     - 动态层:笔记/尝试/运行/草稿/导入资料,随 Store.rev 重建。
   查询时两层拼接,行为与单层完全一致(见 tests/search-cache-test.js)。 */
'use strict';

const Search = (() => {
  let units = [];
  let builtRev = -1;
  let ctxProvider = null;

  /* 静态层缓存:签名 = 题库规模 + 文档数(导入题库会改长度,触发重建) */
  const staticCache = { sig: '', units: [], staticBuilds: 0, dynamicBuilds: 0 };

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

  /* ---- 静态层:题库字段 + 内置文档章节(不含任何个人数据) ---- */
  function buildStatic(ctx) {
    const out = [];
    (ctx.questions || []).forEach(q => {
      const add = (field, text, weight, anchor) => {
        if (text && String(text).trim()) {
          out.push({ kind: 'q', qid: q.id, field, anchor, text: norm(text), raw: String(text), weight, topic: q.topic });
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
    });
    (ctx.docs || []).forEach(d => {
      out.push({ kind: 'doc', docId: d.id, field: 'title', anchor: '', text: norm(d.title + ' ' + (d.summary || '')), raw: d.title, weight: 2.0, topic: d.topic });
      Markdown.sections(d.md).forEach(sec => {
        const body = sec.buf.join('\n');
        if (body.trim()) {
          out.push({
            kind: 'doc', docId: d.id, field: 'section', anchor: sec.id, topic: d.topic,
            text: norm(sec.title + '\n' + body), raw: sec.title + '\n' + body, weight: 1.2
          });
        }
      });
    });
    /* 概念、专项题面、项目定义(均为静态数据) */
    ((ctx.concepts || [])).forEach(c => {
      if (!c.name) return;
      out.push({
        kind: 'concept', cid: c.id, field: 'concept', anchor: '',
        text: norm(c.name + ' ' + (c.definition || '')),
        raw: c.name + ':' + (c.definition || ''),
        weight: 2.0, topic: c.topic || ''
      });
    });
    ((ctx.drills || [])).forEach(d => {
      if (!d || !d.id) return;
      const body = [d.q, d.reference, d.reason].filter(Boolean).join('\n');
      out.push({
        kind: 'drill', drillId: d.id, stage: d.stage || '', field: 'drill', anchor: '',
        text: norm(d.type + ' ' + body), raw: d.type + ' | ' + body,
        weight: 1.6, topic: ''
      });
    });
    ((ctx.projects || [])).forEach(pr => {
      if (!pr || !pr.name) return;
      const body = [pr.goal, pr.expected, pr.debug_case, pr.deliverable, (pr.extensions || []).join('; ')]
        .filter(Boolean).join('\n');
      out.push({
        kind: 'project', pid: pr.id, field: 'project', anchor: '',
        text: norm(pr.name + ' ' + body), raw: pr.name + '\n' + body,
        weight: 1.8, topic: ''
      });
    });
    return out;
  }

  /* ---- 动态层:个人内容(随 Store.rev 重建) ---- */
  function buildDynamic(ctx) {
    const out = [];
    const NL = String.fromCharCode(10);
    const qs = ctx.questions || [];
    const records = ctx.records || {};
    qs.forEach(q => {
      const note = records.questions && records.questions[q.id] && records.questions[q.id].note;
      if (note) out.push({ kind: 'note', qid: q.id, field: 'note', anchor: 'note', text: norm(note), raw: note, weight: 2.5, topic: q.topic });
    });
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
      out.push({
        kind: 'try', drillId: t.drillId, attemptId: t.attemptId || '', status: t.status || '',
        qid: null, field: 'try', anchor: '',
        text: norm('专项尝试 ' + stName + ' ' + body),
        raw: '专项尝试(' + t.drillId + (stName ? ' · ' + stName : '') + ')' + NL + body,
        weight: 2.4, topic: ''
      });
    };
    Object.values(ctx.drillAttempts || {}).forEach(list => { (list || []).forEach(pushTry); });
    Object.values(records.questions || {}).forEach(r => {
      (r.drillTries || []).forEach(t => {
        if (!t.drillId) return;
        const key = t.drillId + '|' + (t.myAnswer || '') + '|' + (t.observed || '') + '|' + (t.review || '');
        if (seenTries.has(key)) return;   /* 已由顶层 drillAttempts 索引 */
        pushTry(t);
      });
    });
    const ui = records.ui || {};
    Object.keys(ui.projectRuns || {}).forEach(pid => {
      (ui.projectRuns[pid] || []).forEach(r => {
        if (!r || typeof r !== 'object') return;
        const parts = [r.runOutput && '输出:' + r.runOutput,
                       r.debug && '定位:' + r.debug,
                       r.todo && '未完成:' + r.todo,
                       r.stepStatus && '步骤:' + r.stepStatus].filter(Boolean);
        if (!parts.length) return;
        const body = parts.join(NL);
        out.push({
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
        out.push({ kind: 'draft', pid, field: 'speak_' + key, anchor: '', topic: '',
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
      out.push({
        kind: 'draft', pid, field: 'draft', anchor: '', topic: '',
        text: norm('项目草稿 ' + body),
        raw: '项目草稿 ' + NL + body,
        weight: 2.0
      });
    });
    /* 我的追问回答(已完成轮次):带题目与轮次身份,点击落到那一轮(SP 阶段7.4) */
    ((records.mock && records.mock.rounds) || []).forEach(rd => {
      const rid = rd.id || (typeof Store !== 'undefined' && Store.roundId ? Store.roundId(rd) : '');
      (rd.items || []).forEach(it => {
        (it.followups || []).forEach((f, index) => {
          if (!(f.self || '').trim()) return;
          out.push({
            kind: 'fu', qid: it.qid, roundId: rid, fuId: f.id || 'legacy-' + index, field: 'fu', anchor: '', topic: '',
            text: norm('追问 ' + (f.q || '') + ' ' + f.self),
            raw: '追问(' + (f.q || '') + '):' + f.self,
            weight: 2.2
          });
        });
      });
    });
    (ctx.userDocs || []).forEach(d => {
      out.push({ kind: 'udoc', docId: d.id, field: 'title', anchor: '', text: norm(d.title), raw: d.title, weight: 2.0, topic: '' });
      Markdown.sections(d.text || '').forEach(sec => {
        const body = sec.buf.join('\n');
        if (body.trim()) {
          out.push({
            kind: 'udoc', docId: d.id, field: 'section', anchor: sec.id, topic: '',
            text: norm(sec.title + '\n' + body), raw: sec.title + '\n' + body, weight: 1.2
          });
        }
      });
    });
    return out;
  }

  function build(ctx) {
    /* ctx: {contentVersion?, questions, docs, userDocs, records, concepts, drills, projects, drillAttempts} */
    /* 静态层签名:优先内容版本(Data.contentVersionOf:build.py 哈希+题库规模+文档集);
       旧调用方未提供时回退规模签名(仅追加场景仍正确) */
    const sig = typeof ctx.contentVersion === 'string' && ctx.contentVersion
      ? ctx.contentVersion
      : (ctx.questions || []).length + '|' + (ctx.docs || []).length;
    if (staticCache.sig !== sig) {
      staticCache.units = buildStatic(ctx);
      staticCache.sig = sig;
      staticCache.staticBuilds++;
    }
    units = staticCache.units.concat(buildDynamic(ctx));
    staticCache.dynamicBuilds++;
    /* 索引构建完成:记下数据版本,后续任何写入都会让它过期并按需自动重建 */
    builtRev = curRev();
  }
  if (typeof Store !== 'undefined' && Store.onInvalidate) Store.onInvalidate(invalidate);

  function tokenize(q) {
    return norm(q).split(/[\s,，、;；]+/).filter(Boolean);
  }

  /* ---- 别名/同义词表(查询期展开,不进索引) ----
     用户口中的词与题库/文档里的写法经常对不上:搜「rag」打不出「检索增强」,
     搜「微调」找不到只写「fine-tune」的题。这里把常见对应关系收成一张小表,
     查询时把每个词展开成一组「任一命中即算该词命中」的候选(键一律小写,
     匹配发生在 norm 之后的 token 上)。只动查询层,索引/静态层签名不受影响。 */
  const ALIASES = {
    'rag': ['检索增强', '检索增强生成'],
    '检索增强': ['rag'],
    'agent': ['智能体'],
    '智能体': ['agent'],
    '微调': ['fine-tune', 'finetune', 'sft'],
    'fine-tune': ['微调', 'finetune', 'sft'],
    'finetune': ['微调', 'fine-tune', 'sft'],
    'prompt': ['提示词'],
    '提示词': ['prompt'],
    'langgraph': ['lang graph'],
    '向量': ['embedding', '嵌入'],
    '嵌入': ['embedding', '向量'],
    'embedding': ['嵌入', '向量'],
    'mcp': ['模型上下文协议'],
    '模型上下文协议': ['mcp'],
    'a2a': ['agent-to-agent'],
    'function calling': ['函数调用', '工具调用'],
    '函数调用': ['function calling', '工具调用'],
    '工具调用': ['function calling', '函数调用'],
    'rlhf': ['人类反馈强化学习'],
    '人类反馈强化学习': ['rlhf'],
    'cot': ['思维链', 'chain of thought'],
    '思维链': ['cot', 'chain of thought'],
    'chain of thought': ['思维链', 'cot']
  };
  /* 每个用户词 → [原词 + 别名候选]。只展开一层,避免环上互相展开导致候选爆炸;
     多词别名(function calling / chain of thought / lang graph)在分词后已经散掉、
     查不到,这里按查询原文(小写)整串兜一次底。 */
  function expandTerms(terms, raw) {
    const whole = norm(raw);
    return terms.map(t => {
      const alt = [t];
      (ALIASES[t] || []).forEach(a => { if (alt.indexOf(a) < 0) alt.push(a); });
      Object.keys(ALIASES).forEach(key => {
        if (key.indexOf(' ') >= 0 && whole.indexOf(key) >= 0 && alt.indexOf(key) < 0) alt.push(key);
      });
      return alt;
    });
  }

  function matchUnit(u, opt, altGroups) {
    if (opt.scope === 'q' && !(u.kind === 'q' || u.kind === 'note')) return -1;
    if (opt.scope === 'doc' && !(u.kind === 'doc' || u.kind === 'udoc')) return -1;
    if (opt.scope === 'note' && u.kind !== 'note') return -1;
    if (opt.topic && u.topic && u.topic !== opt.topic) return -1;
    let score = 0;
    for (const alt of altGroups) {
      /* 任一候选命中即算该词命中;分数只按实际命中的候选累计 */
      let best = -1;
      for (const t of alt) {
        const idx = u.text.indexOf(t);
        if (idx >= 0) {
          const count = u.text.split(t).length - 1;
          const s = Math.min(count, 6) * u.weight * (u.field === 'title' ? 2 : 1);
          if (s > best) best = s;
        }
      }
      if (best < 0) return -1;
      score += best;
    }
    return score;
  }

  /* 返回 [{unit, score, snippet, hits, fields}] —— 同一目标已聚合为一条 */
  function query(q, opt) {
    ensureFresh();   /* 数据已变则先重建,避免返回陈旧内容 */
    opt = opt || {};
    const terms = tokenize(q);
    if (!terms.length) return [];
    const altGroups = expandTerms(terms, q);
    const strict = /^([a-z]{2,4}-\d{3})$/i.test(q.trim());
    const results = [];
    units.forEach(u => {
      const score = matchUnit(u, opt, altGroups);
      if (score < 0) return;
      /* 题号直查加权 */
      if (terms.length === 1 && strict && u.field === 'title') score += 50;
      results.push({ unit: u, score, snippet: makeSnippet(u.raw, altGroups.flat()), partial: false });
    });
    /* 零结果降级:严格 AND(含别名)一无所获时,退一步按 OR(任一候选命中)
       再扫一遍并打上 partial 标记——界面据此提示「部分匹配」。
       注意不做词内切分:内容删改后旧关键词必须保持搜不到(分层缓存测试的
       既有断言),切成子块会把残留字撞成假命中。
       别名展开在查询期做,静态层缓存签名与这道降级完全无关。 */
    if (!results.length) {
      units.forEach(u => {
        for (const alt of altGroups) {
          for (const t of alt) {
            const idx = u.text.indexOf(t);
            if (idx >= 0) {
              const s = Math.min(u.text.split(t).length - 1, 6) * u.weight * (u.field === 'title' ? 2 : 1);
              results.push({ unit: u, score: s, snippet: makeSnippet(u.raw, [t]), partial: true });
              return;   /* 同一条目只收一次:按用户词顺序取第一个命中的候选 */
            }
          }
        }
      });
    }
    results.sort((a, b) => b.score - a.score);
    /* 同一目标只留一条。一道题的 answer / deep / plain 各自命中一次,过去会刷出
       5~8 张卡片,标题与摘要还完全相同(摘要取该字段原文,标题统一取题名)。
       截断必须放在聚合之后,否则 60 条可能全是同一道题的各个字段。 */
    return groupHits(results).slice(0, 60);
  }

  /* 聚合键:题目字段与个人笔记算作同一道题的正文;同一文档的多个章节算一份文档 */
  function groupKey(u) {
    switch (u.kind) {
      case 'q':
      case 'note':    return 'q:' + u.qid;
      case 'doc':
      case 'udoc':    return 'doc:' + u.docId;
      case 'fu':      return 'fu:' + u.roundId + ':' + u.qid + ':' + u.fuId;
      case 'try':     return 'try:' + u.drillId + ':' + (u.attemptId || '');
      case 'run':     return 'run:' + u.pid + ':' + (u.runId || '');
      case 'drill':   return 'drill:' + u.drillId;
      case 'project': return 'project:' + u.pid;
      case 'concept': return 'concept:' + u.cid;
      default:        return String(u.kind) + ':' + (u.qid || u.docId || u.pid || u.cid || '');
    }
  }

  /* 把同一目标的多次命中并成一条:代表项取分数最高的那条(决定链接与摘要),
     另附 fields(全部命中字段)与 hits(命中次数),交给渲染层显示「命中位置」。 */
  function groupHits(results) {
    const map = new Map();
    results.forEach(r => {
      const k = groupKey(r.unit);
      const g = map.get(k);
      if (!g) {
        map.set(k, { unit: r.unit, score: r.score, snippet: r.snippet, hits: 1,
                     fields: r.unit.field ? [r.unit.field] : [], partial: !!r.partial });
        return;
      }
      g.hits++;
      if (r.unit.field && g.fields.indexOf(r.unit.field) < 0) g.fields.push(r.unit.field);
      if (r.score > g.score) { g.unit = r.unit; g.score = r.score; g.snippet = r.snippet; }
      /* 部分匹配是整组结果级别的属性:组内任一命中来自降级扫描,该组就要提示 */
      if (r.partial) g.partial = true;
    });
    /* results 已按分数降序,插入顺序天然就是「各组最高分」的降序,无需再排一次
       (重排会打乱同分项的相对次序,徒增不确定性) */
    return [...map.values()];
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
    /* 合成单个 alternation 正则只扫一遍。逐词 replace 会让「rag」先变成
       <mark>rag</mark>,再被「r」二次包裹成 <mark><mark>r</mark>ag</mark>,视觉发糊。
       长词排前面:JS 正则的 alternation 是最左优先而非最长匹配,短的排前面会截断长词。 */
    const pats = terms
      .filter(Boolean)
      .map(t => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .sort((a, b) => b.length - a.length);
    if (pats.length) {
      try {
        html = html.replace(new RegExp('(' + pats.join('|') + ')', 'gi'), '<mark>$1</mark>');
      } catch (e) { /* 极端输入导致正则合成失败时退化为不高亮,不影响搜索结果本身 */ }
    }
    return html;
  }

  function count() { ensureFresh(); return units.length; }

  /* 分层缓存观测(测试与维护页用):静态层构建次数应恒为 1(题库规模不变时) */
  function stats() {
    return {
      staticUnits: staticCache.units.length,
      dynamicUnits: units.length - staticCache.units.length,
      units: units.length,
      staticBuilds: staticCache.staticBuilds,
      dynamicBuilds: staticCache.dynamicBuilds
    };
  }

  return { build, query, tokenize, count, stats, setContextProvider, ensureFresh, invalidate };
})();
