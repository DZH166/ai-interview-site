/* 面试表达卡 —— 工作台的「出口」。
   ------------------------------------------------------------------
   在此之前,本站能导出的只有**给电脑恢复数据用的备份**(JSON)。
   人拿着它没用:读不了、念不了、发不了。
   表达卡补的就是这一环:把我自己写过的回答,连同题目的参考要点与口述版,
   整理成能直接念、能打印、能复制进笔记的东西。

   两条来源:
     1. 某一轮模拟面试(有「我的回答」——最值钱的部分)
     2. 我标记为「还不熟 / 待复习」的题(没有我的回答,但给口述版与误区)

   本模块自包含:不依赖 DOM、不依赖 util.js,Node 里可直接加载断言。
   产出:Markdown(复制/存档) + 打印版 HTML(浏览器打印成 PDF,真正能带走)。
   ------------------------------------------------------------------
   诚实原则(与本项目其它部分一致):
     - 没有回答的题,写「(未作答)」,不用参考要点冒充我的回答;
     - 一轮里一题都没答,直接报错说我还没写东西,不产出空壳文件。 */
'use strict';

const ExpressCard = (() => {
  const MAX_SELF = 4000;        /* 单题回答上限:防止一份导出把浏览器写崩 */
  const MAX_LINE = 160;         /* 单行摘要上限 */

  const STATUS_LABEL = { '': '未练习', weak: '还不熟', ok: '基本掌握', review: '待复习' };

  function pad2(n) { return String(n).padStart(2, '0'); }

  function dayStamp(ts) {
    const d = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now());
    return d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  }

  function timeLabel(ts) {
    const d = new Date(typeof ts === 'number' && isFinite(ts) ? ts : Date.now());
    return dayStamp(ts) + ' ' + pad2(d.getHours()) + ':' + pad2(d.getMinutes());
  }

  /* HTML 转义:导出的是可独立打开的文件,不能带出脚本 */
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  /* 整段文本进 Markdown 引用块:天然免疫 #、|、- 等语法,
     用户写的任何字符都不会破坏卡片结构。 */
  function quote(text) {
    const t = String(text == null ? '' : text).replace(/\r\n/g, '\n').trim();
    if (!t) return '';
    return t.split('\n').map(l => (l ? '> ' + l : '>')).join('\n');
  }

  /* 个人项目材料按原文展示,不激活 HTML、图片或链接语法。 */
  function literalQuote(text) {
    const escaped = String(text == null ? '' : text).replace(/\\/g, '\\\\').replace(/([`*_{}\[\]()!#|~])/g, '\\$1');
    return quote(esc(escaped));
  }

  /* 压成一行,供标题/元信息使用 */
  function oneLine(text, max) {
    const t = String(text == null ? '' : text).replace(/\s+/g, ' ').trim();
    const lim = max || MAX_LINE;
    return t.length > lim ? t.slice(0, lim) + '…' : t;
  }

  function clip(text, max) {
    const t = String(text == null ? '' : text).trim();
    return t.length > max ? t.slice(0, max) + '…' : t;
  }

  function statusLabel(id) {
    return STATUS_LABEL[String(id == null ? '' : id)] || '未练习';
  }

  /* ---- 组装中间模型(两个来源在这里合流,后面两种输出共用) ----
     返回 {ok, error, title, source, ts, items:[...]} */
  function itemsFromRound(round, lookup) {
    const items = [];
    (round.items || []).forEach(it => {
      const qid = it.qid || it.id;
      const q = lookup ? lookup(qid) : null;
      items.push({
        qid: qid,
        title: (q && q.title) || it.title || qid,
        prompt: q ? String(q.prompt || '') : '',
        fusion_notes: q ? String(q.fusion_notes || '') : '',
        topic: q ? q.topic : '',
        difficulty: q ? q.difficulty : '',
        status: it.mark || '',
        self: String(it.self == null ? '' : it.self),
        /* 模拟面试里写的是「我的回答」 */
        selfKind: 'answer',
        revealed: !!it.revealed,
        /* 参考要点只在题目存在时给出;题目缺失就如实留白,不编 */
        answer: q ? String(q.answer || '') : '',
        interview: q ? String(q.interview || '') : '',
        pitfalls: (q && Array.isArray(q.pitfalls)) ? q.pitfalls.slice(0, 3) : []
      });
    });
    return items;
  }

  function itemsFromMarks(marks, lookup) {
    const items = [];
    (marks || []).forEach(m => {
      const q = lookup ? lookup(m.qid) : null;
      if (!q) return;                       /* 题目在当前题库里找不到:跳过,不放占位题 */
      items.push({
        qid: m.qid,
        title: q.title || m.qid,
        prompt: String(q.prompt || ''),
        fusion_notes: String(q.fusion_notes || ''),
        topic: q.topic, difficulty: q.difficulty,
        status: m.status || 'weak',
        self: String(m.note || ''),
        /* 这里没有模拟面试的回答,只有我自己写的笔记 —— 标签必须如实,
           不能把笔记冒充成「我的回答」 */
        selfKind: 'note',
        revealed: false,
        answer: String(q.answer || ''),
        interview: String(q.interview || ''),
        pitfalls: Array.isArray(q.pitfalls) ? q.pitfalls.slice(0, 3) : []
      });
    });
    return items;
  }

  /* ---- Markdown ---- */
  function toMarkdown(model) {
    const L = [];
    if (model.kind === 'project') {
      L.push('# ' + model.title, '', '- 来源:' + model.source, '- 生成时间:' + timeLabel(model.ts), '');
      (model.notes || []).forEach(n => L.push(literalQuote(n), ''));
      model.items.forEach((it, i) => {
        L.push('---', '', '## ' + (i + 1) + '. ' + it.title, '', literalQuote(it.meta || ''), '');
        it.sections.forEach(s => L.push('### ' + s.label, '', literalQuote(s.text), ''));
      });
      return L.join('\n');
    }
    const word = model.selfKind === 'note' ? '笔记' : '回答';
    L.push('# ' + model.title);
    L.push('');
    L.push('- 来源:' + model.source);
    L.push('- 生成时间:' + timeLabel(model.ts));
    L.push('- 共 ' + model.items.length + ' 题');
    const weak = model.items.filter(i => i.status === 'weak').length;
    if (weak) L.push('- 其中标记「还不熟」' + weak + ' 题');
    const answered = model.items.filter(i => i.self.trim()).length;
    L.push('- 我写了' + word + '的:' + answered + ' 题');
    L.push('');
    L.push('> 本文件由「面试加油工作台」生成,内容来自我本机浏览器的学习记录。');
    L.push('');

    model.items.forEach((it, i) => {
      L.push('---');
      L.push('');
      L.push('## ' + (i + 1) + '. ' + oneLine(it.title, 120));
      L.push('');
      const meta = [];
      meta.push('`' + it.qid + '`');
      if (it.topic) meta.push(it.topic);
      if (it.difficulty) meta.push(it.difficulty);
      meta.push('状态:' + statusLabel(it.status));
      L.push(meta.join(' · '));
      L.push('');
      if (it.prompt) L.push('### 完整题干', '', quote(it.prompt), '');
      const selfHead = it.selfKind === 'note' ? '我的笔记' : '我的回答';
      if (it.self.trim()) {
        L.push('### ' + selfHead);
        L.push('');
        L.push(quote(clip(it.self, MAX_SELF)));
        L.push('');
      } else if (it.selfKind === 'answer') {
        /* 只有"模拟面试"这一路才谈得上"没作答";笔记来源本来就是空的,不写占位 */
        L.push('### ' + selfHead);
        L.push('');
        L.push('_（这一题当时没有作答）_');
        L.push('');
      }
      if (it.interview) {
        L.push('### 面试口述版');
        L.push('');
        L.push(quote(clip(it.interview, MAX_SELF)));
        L.push('');
      }
      if (it.answer) {
        L.push('### 参考要点');
        L.push('');
        L.push(quote(clip(it.answer, MAX_SELF)));
        L.push('');
      }
      if (it.fusion_notes) L.push('### 场景与边界补充', '', quote(clip(it.fusion_notes, MAX_SELF)), '');
      if (it.pitfalls.length) {
        L.push('### 常见误区');
        L.push('');
        it.pitfalls.forEach(p => L.push('- ' + oneLine(p, 200)));
        L.push('');
      }
    });
    return L.join('\n');
  }

  /* ---- 打印版 HTML:浏览器直接「打印 → 另存为 PDF」就是一份能带走的材料 ---- */
  function toHtml(model) {
    const rows = model.items.map((it, i) => it.sections ? `
    <section class="card">
      <h2><span class="num">${i + 1}</span>${esc(it.title)}</h2>
      <p class="meta">${esc(it.meta || '')}</p>
      ${it.sections.map(s => '<h3>' + esc(s.label) + '</h3><pre class="self">' + esc(s.text) + '</pre>').join('')}
    </section>` : `
    <section class="card">
      <h2><span class="num">${i + 1}</span>${esc(oneLine(it.title, 200))}</h2>
      <p class="meta">${esc(it.qid)}${it.topic ? ' · ' + esc(it.topic) : ''}${it.difficulty ? ' · ' + esc(it.difficulty) : ''} · 状态:${esc(statusLabel(it.status))}</p>
      ${it.prompt ? '<h3>完整题干</h3><pre>' + esc(it.prompt) + '</pre>' : ''}
      ${it.self.trim() ? '<h3>' + (it.selfKind === 'note' ? '我的笔记' : '我的回答') + '</h3><pre class="self">' + esc(clip(it.self, MAX_SELF)) + '</pre>' : ''}
      ${(!it.self.trim() && it.selfKind === 'answer') ? '<h3>我的回答</h3><p class="empty">（这一题当时没有作答）</p>' : ''}
      ${it.interview ? '<h3>面试口述版</h3><pre>' + esc(clip(it.interview, MAX_SELF)) + '</pre>' : ''}
      ${it.answer ? '<h3>参考要点</h3><pre>' + esc(clip(it.answer, MAX_SELF)) + '</pre>' : ''}
      ${it.fusion_notes ? '<h3>场景与边界补充</h3><pre>' + esc(clip(it.fusion_notes, MAX_SELF)) + '</pre>' : ''}
      ${it.pitfalls.length ? '<h3>常见误区</h3><ul>' + it.pitfalls.map(p => '<li>' + esc(oneLine(p, 240)) + '</li>').join('') + '</ul>' : ''}
    </section>`).join('');
    const word = model.selfKind === 'note' ? '笔记' : '回答';

    return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(model.title)}</title>
<style>
  :root { color-scheme: light; }
  body { font-family: system-ui, -apple-system, "Microsoft YaHei", sans-serif;
         line-height: 1.7; color: #1f2937; background: #fff;
         max-width: 820px; margin: 0 auto; padding: 32px 20px; }
  h1 { font-size: 22px; margin: 0 0 8px; }
  .head { border-bottom: 2px solid #2563eb; padding-bottom: 12px; margin-bottom: 20px; }
  .head p { margin: 2px 0; color: #6b7280; font-size: 13px; }
  .card { border: 1px solid #e5e7eb; border-radius: 8px; padding: 16px 18px; margin-bottom: 16px;
          break-inside: avoid; page-break-inside: avoid; }
  h2 { font-size: 16px; margin: 0 0 4px; display: flex; gap: 8px; align-items: baseline; }
  .num { color: #2563eb; font-variant-numeric: tabular-nums; }
  .meta { color: #6b7280; font-size: 12px; margin: 0 0 12px; }
  h3 { font-size: 13px; color: #374151; margin: 14px 0 6px;
       border-left: 3px solid #cbd5e1; padding-left: 8px; }
  pre { white-space: pre-wrap; word-break: break-word; font-family: inherit;
        margin: 0; font-size: 14px; background: #f9fafb; border-radius: 6px; padding: 10px 12px; }
  pre.self { background: #eff6ff; border: 1px solid #bfdbfe; }
  .empty { color: #9ca3af; font-size: 13px; margin: 0; }
  ul { margin: 0; padding-left: 20px; font-size: 14px; }
  footer { margin-top: 24px; color: #9ca3af; font-size: 12px; text-align: center; }
  @media print {
    body { padding: 0; max-width: none; }
    .card { border-color: #d1d5db; }
    pre { background: #fff; border: 1px solid #e5e7eb; }
    pre.self { background: #fff; }
  }
</style>
</head>
<body>
  <div class="head">
    <h1>${esc(model.title)}</h1>
    <p>来源:${esc(model.source)}</p>
    <p>生成时间:${esc(timeLabel(model.ts))} · ${model.kind === 'project' ? esc(model.summary) : `共 ${model.items.length} 题 · 我写了${word}的 ${model.items.filter(i => i.self.trim()).length} 题`}</p>
    ${(model.notes || []).map(n => '<p>' + esc(n) + '</p>').join('')}
  </div>
  ${rows}
  <footer>由「面试加油工作台」生成 · 内容来自本机浏览器记录,未上传任何服务器</footer>
</body>
</html>`;
  }

  function fileName(title, ts, ext) {
    const safe = String(title || '面试表达卡').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '');
    return safe + '-' + dayStamp(ts) + '.' + ext;
  }

  /* ---- 对外的两个入口 ---- */

  /* 一轮模拟面试 → 表达卡。index 为该轮在 rounds 里的序号(0 = 最近一轮) */
  function buildFromRound(rounds, index, lookup) {
    const list = Array.isArray(rounds) ? rounds : [];
    const i = typeof index === 'number' ? index : 0;
    const round = list[i];
    if (!round) return { ok: false, error: '找不到这一轮模拟面试记录。' };
    const items = itemsFromRound(round, lookup);
    if (!items.length) return { ok: false, error: '这一轮没有题目记录,没什么可导出的。' };
    /* 诚实:一题都没写回答,不产出看着像材料其实空空如也的文件 */
    if (!items.some(it => it.self.trim())) {
      return { ok: false, error: '这一轮你没有写下任何回答,先答几题再导出吧。' };
    }
    const model = {
      title: '面试表达卡 · 模拟面试',
      source: '模拟面试第 ' + (i + 1) + ' 轮（' + timeLabel(round.ts) + '）',
      selfKind: 'answer',
      ts: Date.now(),
      items: items
    };
    return finish(model, 'md');
  }

  /* 我标记「还不熟 / 待复习」的题 → 表达卡(没有我的回答,给口述版与误区) */
  function buildFromMarks(marks, lookup) {
    const items = itemsFromMarks(marks, lookup);
    if (!items.length) return { ok: false, error: '当前没有标记为「还不熟 / 待复习」的题。' };
    const model = {
      title: '面试表达卡 · 待攻克清单',
      source: '标记为「还不熟 / 待复习」的题（' + items.length + ' 题）',
      selfKind: 'note',
      ts: Date.now(),
      items: items
    };
    return finish(model, 'md');
  }

  /* 当前口述与已保存运行分开标注;选定 runId 时绝不回退到另一条证据。
     纯生成操作不写 Store,不把材料导出当成验证成功或记录提交。 */
  function buildFromProject(project, draft, runs, runId) {
    if (!project || !project.id) return { ok: false, error: '找不到这个项目。' };
    draft = draft || {};
    const list = (Array.isArray(runs) ? runs : []).filter(r => r && r.runId)
      .slice().sort((a, b) => (a.updatedAt || a.ts || 0) - (b.updatedAt || b.ts || 0) || String(a.runId).localeCompare(String(b.runId)));
    const selectedId = runId === undefined ? (draft.evidenceRunId || '') : runId;
    const selected = selectedId ? list.filter(r => r.runId === selectedId) : list;
    if (selectedId && !selected.length) return { ok: false, error: '所选证据记录已不存在,请重新选择后导出。' };
    const fields = [
      ['speak_short', '30 秒口述(当前草稿)'], ['speak_long', '2 分钟口述(当前草稿)'],
      ['speak_ask', '提纲 · 需求'], ['speak_plan', '提纲 · 方案'], ['speak_tradeoff', '提纲 · 取舍'],
      ['speak_pain', '提纲 · 问题与定位'], ['speak_verify', '提纲 · 验证证据'], ['speak_lack', '提纲 · 不足与下一步'],
      ['runOutput', '当前实现草稿 · 输出(未作为新运行提交)'], ['debug', '当前实现草稿 · 排查'], ['todo', '当前实现草稿 · 未完成项']
    ];
    const sections = fields.filter(([key]) => !(selectedId && ['runOutput', 'debug', 'todo'].includes(key))
      && typeof draft[key] === 'string' && draft[key].trim())
      .map(([key, label]) => ({ label, text: draft[key] }));
    const hasRuns = selected.some(r => [r.runOutput, r.debug, r.todo].some(t => typeof t === 'string' && t.trim()));
    if (!sections.length && !hasRuns) return { ok: false, error: '先写下口述或保存一条有内容的运行记录,再导出项目材料。' };
    const level = { did: '我做过(用户自评)', tried: '我在练手项目里验证过(用户自评)', design: '如果遇到我会这样设计' }[draft.speakLevel] || '尚未选择经历等级';
    const notes = ['材料来自用户自填记录,未独立验证项目是否成功;当前口述草稿不等于历史运行时的说法。'];
    if (!list.length) notes.push('无运行记录:目前只能据此准备方案表达,不能作为已完成项目的证明。');
    else if (selectedId) notes.push('本次使用选定运行快照与当前口述草稿。');
    else if (!selectedId) notes.push('未指定口述依据,下方列出已保存运行记录供核对。');
    if (runId && draft.evidenceRunId && runId !== draft.evidenceRunId) notes.push('本次导出的运行与当前口述绑定的证据不同,请核对表达。');
    const items = [];
    if (sections.length) items.push({ title: selectedId ? '当前口述草稿' : '当前口述草稿与实现草稿', meta: project.id + ' · ' + level + (draft.updatedAt ? ' · 编辑于 ' + timeLabel(draft.updatedAt) : ''), sections });
    selected.forEach(r => items.push({
      title: '已保存运行 · ' + timeLabel(r.updatedAt || r.ts),
      meta: '记录:' + r.runId + ' · 状态:' + ({ none: '未开始', trying: '尝试中', verified: '已验证(自评)', understood: '自评理解' }[r.stepStatus] || '未标记') + (r._legacy ? ' · 旧版迁移记录' : ''),
      sections: [
        { label: '实际运行输出', text: String(r.runOutput || '(未填写)') },
        { label: '问题 → 定位 → 修改 → 验证', text: String(r.debug || '(未填写)') },
        { label: '未完成项', text: String(r.todo || '(未填写)') }
      ]
    }));
    return finish({ kind: 'project', title: '项目复盘与口述卡 · ' + oneLine(project.name || project.id, 100),
      source: project.id + (selectedId ? ' · 选定证据:' + selectedId : ' · 项目个人记录'),
      summary: selected.length + ' 条运行记录' + (sections.length ? ' + 当前草稿' : ''),
      ts: Date.now(), items, notes }, 'md');
  }

  function finish(model, ext) {
    const md = toMarkdown(model);
    return {
      ok: true, error: null,
      count: model.items.length,
      summary: model.summary || '',
      notes: model.notes || [],
      title: model.title,
      markdown: md,
      html: toHtml(model),
      mdName: fileName(model.title, model.ts, 'md'),
      htmlName: fileName(model.title, model.ts, 'html')
    };
  }

  return {
    buildFromRound, buildFromMarks, buildFromProject,
    toMarkdown, toHtml, fileName, esc, quote, oneLine, clip, statusLabel,
    MAX_SELF, MAX_LINE
  };
})();

if (typeof window !== 'undefined') window.ExpressCard = ExpressCard;
