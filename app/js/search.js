/* 本地全文搜索:覆盖题干/答案/解析/例子/追问/误区/理解检查/个人笔记 + 文档章节 + 导入文档。
   纯前端子串匹配 + 加权评分,无任何在线依赖。 */
'use strict';

const Search = (() => {
  let units = [];

  function norm(s) { return String(s || '').toLowerCase(); }

  function build(ctx) {
    /* ctx: {questions, docs, userDocs, records} */
    units = [];
    const qs = ctx.questions || [];
    qs.forEach(q => {
      const add = (field, text, weight, anchor) => {
        if (text && String(text).trim()) {
          units.push({ kind: 'q', qid: q.id, field, anchor, text: norm(text), raw: String(text), weight, topic: q.topic });
        }
      };
      add('title', q.title, 3.0, 'top');
      add('tags', (q.tags || []).join(' '), 2.2, 'top');
      add('answer', q.answer, 1.6, 'answer');
      add('plain', q.plain, 1.0, 'plain');
      add('deep', q.deep, 1.0, 'deep');
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
        if (sec.buf.join('').trim()) {
          units.push({
            kind: 'doc', docId: d.id, field: 'section', anchor: sec.id, topic: d.topic,
            text: norm(sec.title + '\n' + sec.buf.join('\n')), raw: sec.title, weight: 1.2
          });
        }
      });
    });
    (ctx.userDocs || []).forEach(d => {
      units.push({ kind: 'udoc', docId: d.id, field: 'title', anchor: '', text: norm(d.title), raw: d.title, weight: 2.0, topic: '' });
      Markdown.sections(d.text || '').forEach(sec => {
        if (sec.buf.join('').trim()) {
          units.push({
            kind: 'udoc', docId: d.id, field: 'section', anchor: sec.id, topic: '',
            text: norm(sec.title + '\n' + sec.buf.join('\n')), raw: sec.title, weight: 1.2
          });
        }
      });
    });
  }

  function tokenize(q) {
    return norm(q).split(/[\s,，、;；]+/).filter(Boolean);
  }

  /* 返回 [{unit, score, snippetHtml}] */
  function query(q, opt) {
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
      results.push({ unit: u, score, snippet: makeSnippet(u.raw, u.field === 'title' ? u.raw : u.text, terms) });
    });
    results.sort((a, b) => b.score - a.score);
    return results.slice(0, 60);
  }

  function makeSnippet(rawText, normText, terms) {
    const raw = String(rawText || '');
    let start = -1;
    for (const t of terms) {
      const i = norm(normText).indexOf(norm(t));
      if (i >= 0 && (start < 0 || i < start)) start = i;
    }
    let snippet, window_;
    if (start < 0) { snippet = raw.slice(0, 120); window_ = [0, snippet.length]; }
    else {
      const from = Math.max(0, start - 40);
      const to = Math.min(raw.length, start + 110);
      snippet = (from > 0 ? '…' : '') + raw.slice(from, to) + (to < raw.length ? '…' : '');
      window_ = [from, to];
    }
    /* 高亮 */
    let html = esc(snippet);
    terms.forEach(t => {
      if (!t) return;
      const safe = t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      html = html.replace(new RegExp(safe, 'gi'), m => `<mark>${m}</mark>`);
    });
    return html;
  }

  function count() { return units.length; }

  return { build, query, tokenize, count };
})();
