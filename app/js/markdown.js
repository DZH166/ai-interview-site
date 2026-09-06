/* 极简 Markdown 渲染(离线可用,无外部依赖)
   支持:标题(带锚点 id)、代码块、列表、引用、表格、行内样式、链接。
   标题编号规则与 tools/build.py 的 md_sections 保持一致:先剥离代码块,
   再按出现顺序为每个标题行编号 sec-N。 */
'use strict';

const Markdown = (() => {
  function stripFences(text) {
    return text.replace(/^```[\s\S]*?^```/gm, '');
  }

  function inline(s) {
    s = esc(s);
    s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
    s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
    s = s.replace(/(^|[^*])\*([^*\n]+)\*(?!\*)/g, '$1<em>$2</em>');
    s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, href) => {
      if (href.startsWith('#/')) return `<a href="${href}">${t}</a>`;
      return `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    });
    return s;
  }

  /* 渲染 markdown -> html;opt.anchorPrefix 存在时,标题附加 id=anchorPrefix+sec-N */
  function render(text, opt) {
    opt = opt || {};
    const anchorPrefix = opt.anchorPrefix || '';
    const src = String(text || '').replace(/\r\n/g, '\n');
    const lines = src.split('\n');
    let html = [], i = 0, headingNo = 0;

    /* 先计算标题编号:按剥离代码块后的行序 */
    const stripped = stripFences(src).split('\n');
    const secIds = [];
    stripped.forEach(l => {
      const m = l.match(/^(#{1,6})\s+(.*)$/);
      if (m) secIds.push(true); else secIds.push(false);
    });
    let secCursor = 0;

    /* 从 lines[i] 起解析一个列表块,返回 HTML 并推进 i。
       规则:同缩进的列表行是同级项;更深缩进的连续列表行是上一项的子列表;
       缩进 ≥2 的非列表行是续行(并入当前项);空行/标题/代码/引用结束列表。 */
    function renderListBlock() {
      const items = [];
      while (i < lines.length) {
        const l = lines[i];
        if (!l.trim()) break;
        if (/^(#{1,6}\s|```|>)/.test(l)) break;
        const m = l.match(/^(\s*)([-*+]|\d+[.)])\s+(.*)$/);
        if (m) {
          items.push({ indent: m[1].length, ordered: /^\d/.test(m[2]), content: [m[3]] });
          i++;
          continue;
        }
        if (items.length && /^\s{2,}\S/.test(l)) {
          items[items.length - 1].content.push(l.trim());
          i++;
          continue;
        }
        break;
      }
      function renderRange(start, end) {
        const tag = items[start].ordered ? 'ol' : 'ul';
        let out = `<${tag}>`;
        let k = start;
        while (k < end) {
          const it = items[k];
          let j = k + 1;
          while (j < end && items[j].indent > it.indent) j++;
          const childHtml = j > k + 1 ? renderRange(k + 1, j) : '';
          out += `<li>${it.content.map(c => inline(c)).join('<br>')}${childHtml}</li>`;
          k = j;
        }
        return out + `</${tag}>`;
      }
      return items.length ? renderRange(0, items.length) : '';
    }

    while (i < lines.length) {
      const line = lines[i];
      /* 代码块 */
      if (/^```/.test(line)) {
        const lang = line.replace(/^```/, '').trim();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        i++; /* 跳过结束 ``` */
        html.push(`<pre class="code${lang ? ' lang-' + esc(lang) : ''}"><code>${esc(buf.join('\n'))}</code></pre>`);
        continue;
      }
      /* 标题 */
      const hm = line.match(/^(#{1,6})\s+(.*)$/);
      if (hm) {
        const level = hm[1].length;
        /* 编号:跳过代码块内的标题行 */
        while (secCursor < secIds.length && !secIds[secCursor]) secCursor++;
        secCursor++;
        headingNo++;
        const id = anchorPrefix + 'sec-' + headingNo;
        html.push(`<h${level} id="${id}">${inline(hm[2])}</h${level}>`);
        i++;
        continue;
      }
      /* 表格 */
      if (/\|/.test(line) && i + 1 < lines.length && /^\s*\|?[\s:|-]+\|?\s*$/.test(lines[i + 1]) && /-/.test(lines[i + 1])) {
        const parseRow = l => l.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim());
        const head = parseRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && /\|/.test(lines[i]) && lines[i].trim()) { rows.push(parseRow(lines[i])); i++; }
        html.push('<table class="md-table"><thead><tr>' +
          head.map(c => `<th>${inline(c)}</th>`).join('') + '</tr></thead><tbody>' +
          rows.map(r => '<tr>' + r.map(c => `<td>${inline(c)}</td>`).join('') + '</tr>').join('') +
          '</tbody></table>');
        continue;
      }
      /* 引用 */
      if (/^>\s?/.test(line)) {
        const buf = [];
        while (i < lines.length && /^>\s?/.test(lines[i])) { buf.push(lines[i].replace(/^>\s?/, '')); i++; }
        html.push(`<blockquote>${render(buf.join('\n'))}</blockquote>`);
        continue;
      }
      /* 列表:支持有序/无序、多层嵌套与续行;同级各项各自成 <li> */
      if (/^(\s*)([-*+]|\d+[.)])\s+/.test(line)) {
        html.push(renderListBlock());
        continue;
      }
      /* 分隔线 */
      if (/^\s*(---+|\*\*\*+)\s*$/.test(line)) { html.push('<hr>'); i++; continue; }
      /* 空行 */
      if (!line.trim()) { i++; continue; }
      /* 段落 */
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !/^(#{1,6}\s|```|>|\s*([-*]|\d+\.)\s)/.test(lines[i])) {
        buf.push(lines[i]); i++;
      }
      html.push(`<p>${inline(buf.join('\n')).replace(/\n/g, '<br>')}</p>`);
    }
    return html.join('\n');
  }

  /* 供搜索用的章节切分:返回 [{id:'sec-N', level, text, title}] */
  function sections(text) {
    const src = String(text || '').replace(/\r\n/g, '\n');
    const stripped = stripFences(src).split('\n');
    let no = 0;
    const ids = stripped.map(l => {
      const m = l.match(/^(#{1,6})\s+(.*)$/);
      if (m) { no++; return { n: no, level: m[1].length, title: m[2].trim() }; }
      return null;
    });
    const out = [];
    let cur = { id: 'sec-0', level: 1, title: '正文', buf: [] };
    let cursor = 0;
    const lines = src.split('\n');
    /* 重新遍历原始行:代码块内的标题行也要被跳过 */
    let inFence = false, seen = 0;
    lines.forEach(l => {
      if (/^```/.test(l)) { inFence = !inFence; return; }
      if (!inFence && /^(#{1,6})\s+/.test(l)) {
        while (cursor < ids.length && !ids[cursor]) cursor++;
        const meta = ids[cursor] || { n: ++no, level: 1, title: l.replace(/^#+\s*/, '') };
        cursor++;
        if (cur.buf.length) out.push(cur);
        cur = { id: 'sec-' + meta.n, level: meta.level, title: meta.title, buf: [] };
        seen++;
        return;
      }
      cur.buf.push(l);
    });
    if (cur.buf.join('').trim()) out.push(cur);
    return out;
  }

  return { render, sections };
})();
