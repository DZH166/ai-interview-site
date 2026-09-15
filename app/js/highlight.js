/* 重点标注渲染:把人工精读后挑出的重点短语,在**渲染完的正文**里包成 <mark>。
 *
 * 为什么不动题库原文:题库有内容哈希、融合适配器守卫和内容审计阈值,
 * 直接往正文里插标记会同时惊动这三套东西,而且没法单独审阅「哪些是重点」。
 * 标注单独存 data/highlights/*.json,原文一改、短语对不上,tools/highlight_audit.py 会报出来。
 *
 * 跨节点匹配:markdown 会把 `**粗体**`、`` `代码` `` 拆成多个文本节点(甚至插入 <strong>),
 * 所以不能按单个文本节点找,要先把整棵子树拼成一个字符串定位,再按区间回切、分段包裹。
 */
'use strict';

const Highlight = (() => {
  const LEVELS = { key: 'hl-key', term: 'hl-term', warn: 'hl-warn' };

  function all() {
    return (window.APP_DATA && window.APP_DATA.highlights) || {};
  }

  /* field 省略则返回该题全部标注 */
  function spansFor(qid, field) {
    const rec = all()[qid];
    const spans = (rec && rec.spans) || [];
    return field ? spans.filter(s => s.field === field) : spans.slice();
  }

  function countFor(qid) { return spansFor(qid).length; }

  /* 拼出子树文本 + 每个文本节点的起始偏移 */
  function flatten(root) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    const nodes = [];
    let text = '', n;
    while ((n = walker.nextNode())) {
      nodes.push({ node: n, start: text.length });
      text += n.nodeValue;
    }
    return { nodes, text };
  }

  /* 找一个未被占用的出现位置,避免两条标注重叠互抢 */
  function findFree(text, phrase, taken) {
    let from = 0;
    for (;;) {
      const at = text.indexOf(phrase, from);
      if (at < 0) return null;
      const end = at + phrase.length;
      const clash = taken.some(r => at < r.end && end > r.start);
      if (!clash) return { start: at, end, level: null };
      from = at + 1;
    }
  }

  /* 把 [range.start, range.end) 这一段包进 mark;跨节点时逐段包,不移动其它内容 */
  function wrapRange(nodes, range, level) {
    const cls = LEVELS[level] || LEVELS.key;
    for (let i = nodes.length - 1; i >= 0; i--) {
      const { node, start } = nodes[i];
      const stop = start + node.nodeValue.length;
      if (stop <= range.start || start >= range.end) continue;
      const from = Math.max(range.start, start) - start;
      const to = Math.min(range.end, stop) - start;
      if (to <= from) continue;
      const parent = node.parentNode;
      if (!parent) continue;
      node.splitText(to);
      const mid = node.splitText(from);
      const mark = document.createElement('mark');
      mark.className = cls;
      mark.textContent = mid.nodeValue;
      parent.replaceChild(mark, mid);
    }
  }

  /* 在已渲染的容器里就地标注。返回 {applied, missing} —— missing 非空说明标注对不上原文 */
  function decorate(root, spans) {
    const out = { applied: 0, missing: [] };
    if (!root || !spans || !spans.length) return out;
    const { nodes, text } = flatten(root);
    const taken = [];
    spans.forEach(s => {
      const phrase = s.text || '';
      const hit = phrase ? findFree(text, phrase, taken) : null;
      if (!hit) { out.missing.push(s); return; }
      hit.level = s.level;
      taken.push(hit);
      out.applied++;
    });
    taken.sort((a, b) => b.start - a.start);
    taken.forEach(r => wrapRange(nodes, r, r.level));
    return out;
  }

  /* 字段级入口:给一段已渲染的 HTML 套上该字段的标注。
     走一次游离容器,避免在真实 DOM 上插入后再重排。 */
  function renderField(qid, field, html) {
    const spans = spansFor(qid, field);
    if (!spans.length || !html) return html;
    const box = document.createElement('div');
    box.innerHTML = html;
    decorate(box, spans);
    return box.innerHTML;
  }

  /* 自查用:返回全库标注的命中情况(浏览器测试直接调它) */
  function auditAll(questions, render) {
    const rows = [];
    (questions || []).forEach(q => {
      const spans = spansFor(q.id);
      if (!spans.length) return;
      const fields = {};
      spans.forEach(s => { fields[s.field] = Markdown.render(q[s.field] || ''); });
      Object.keys(fields).forEach(field => {
        const box = document.createElement('div');
        box.innerHTML = fields[field];
        const mine = spans.filter(s => s.field === field);
        const r = decorate(box, mine);
        rows.push({ id: q.id, field, expected: mine.length, applied: r.applied,
                    missing: r.missing.map(m => m.text) });
      });
      void render;
    });
    return rows;
  }

  return { LEVELS, spansFor, countFor, decorate, renderField, auditAll };
})();
