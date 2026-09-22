/* 简历针对性练习:按简历项目/技能分组展示匹配的题目,追踪练习进度。
   数据来源: data/resume-profile.json → build.py → window.APP_DATA.resume */
'use strict';

const ResumeView = (() => {
  let showAll = false;   /* false=只看必知, true=全部 */
  /* 本次渲染的分组索引:gid -> { name, ids(有效且去重) }。
     render() 每次重建,handler 只查这份表,不依赖 DOM 里藏数据 */
  const rvIds = new Map();
  let rvSeq = 0;
  let mustIds = [];      /* 全部必知组的有效去重题号(顶层定向自测按钮用) */

  function data() { return (window.APP_DATA && window.APP_DATA.resume) || {}; }

  /* 多组合并取有效题号:去重 + Data.question 过滤(题库可能没跟上简历配置)。
     进度统计跨组去重(codex 契约),组内展示保序用 validIds */
  function questionIds(groups) {
    return [...new Set(groups.flatMap(g => g.questionIds || []))].filter(id => Data.question(id));
  }

  /* 组内有效题号:保持原序去重(定向自测/导出按组内顺序走) */
  function validIds(g) {
    const seen = new Set();
    return (g.questionIds || []).filter(id => {
      if (seen.has(id) || !Data.question(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function progress() {
    const groups = (data().sections || []).flatMap(s => s.groups || []);
    const ids = questionIds(groups);
    const rec = Store.data.questions;
    return {
      total: ids.length,
      links: groups.reduce((n, g) => n + (g.questionIds || []).length, 0),
      done: ids.filter(id => rec[id]?.status === 'ok').length,
      review: ids.filter(id => rec[id]?.status === 'review').length,
      practiced: ids.filter(id => (rec[id]?.practiceCount || 0) > 0).length
    };
  }

  function render(root) {
    const d = data();
    if (!d.sections || !d.sections.length) {
      root.innerHTML = '<div class="empty">简历数据未加载,请确认 data/resume-profile.json 已构建。</div>';
      return;
    }
    const pg = progress();
    const pct = pg.total ? Math.round(pg.done / pg.total * 100) : 0;
    rvIds.clear();
    rvSeq = 0;
    mustIds = [];
    (d.sections || []).forEach(s => (s.groups || []).forEach(g => {
      if (g.mustKnow) mustIds.push(...validIds(g));
    }));
    mustIds = [...new Set(mustIds)];   /* 跨组可能有同题,保序去重 */

    root.innerHTML = `
      <div class="resume-head">
        <h1>简历针对性练习</h1>
        <p class="muted">${esc(d.role)} · ${esc(d.name)} · 题库匹配 ${pg.total} 道独立题目 · ${pg.links} 条关联</p>
        <div class="resume-progress">
          <div class="progress" style="max-width:400px"><div class="progress-in" style="width:${pct}%"></div></div>
          <span class="muted small">已掌握 ${pg.done} / ${pg.total} 题(${pct}%) · 已练习 ${pg.practiced} · 待复习 ${pg.review}</span>
        </div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn-small ${!showAll ? 'btn-primary' : ''}" data-rv-filter="must">必知题</button>
          <button class="btn btn-small ${showAll ? 'btn-primary' : ''}" data-rv-filter="all">全部(${pg.total})</button>
          ${mustIds.length >= 3 ? `<button class="btn btn-small" data-rv-must-mock>必知题定向自测(${mustIds.length}题)</button>` : ''}
        </div>
      </div>
      ${d.sections.map(s => renderSection(s)).join('')}
    `;
    wire(root);
  }

  function renderSection(s) {
    const groups = (s.groups || []).filter(g => showAll || g.mustKnow);
    if (!groups.length) return '';
    const totalQ = questionIds(groups).length;
    return `
      <div class="card resume-section" style="margin-top:14px">
        <h2 style="margin-top:0">${esc(s.name)}
          <span class="badge b-topic" style="margin-left:8px">${esc(s.subtitle || s.type)}</span>
          <span class="muted small" style="margin-left:8px">${totalQ} 题</span>
        </h2>
        <p class="muted small">${esc(s.description || '')}</p>
        ${(s.techTags || []).map(t => `<span class="badge b-tag">${esc(t)}</span>`).join(' ')}
        ${groups.map(g => renderGroup(g)).join('')}
      </div>`;
  }

  function renderGroup(g) {
    const mustTag = g.mustKnow ? '<span class="badge st-weak">必知</span>' : '<span class="badge b-tag">加分</span>';
    const ids = validIds(g);
    const items = ids.map(qid => {
      const q = Data.question(qid);
      if (!q) return '';
      const st = Data.statusInfo(qid);
      const done = st.id === 'ok';
      return `
        <a class="resume-q-item ${done ? 'resume-q-done' : ''}" href="#/study/${esc(qid)}">
          <span class="qid">${esc(qid)}</span>
          <span class="resume-q-title">${esc(q.title)}</span>
          <span class="badge ${esc(st.cls)}">${done ? '✓ ' : ''}${esc(st.label)}</span>
        </a>`;
    }).filter(Boolean).join('');
    if (!items) return '';
    /* 无有效题就不给按钮(空会话没有意义);按钮放 summary 行内,
       点击不能触发 <details> 折叠——处理时 preventDefault+stopPropagation */
    const gid = 'g' + (++rvSeq);
    rvIds.set(gid, { name: g.name || '', ids });
    return `
      <details class="resume-group" open>
        <summary style="cursor:pointer;font-weight:600;margin:10px 0 4px">
          ${mustTag} ${esc(g.name)}
          <span class="muted small" style="margin-left:6px">${ids.length} 题</span>
          <span class="btn-row rv-summary-btns">
            <button type="button" class="btn btn-small" data-rv-mock="${gid}">定向自测(${ids.length}题)</button>
            <button type="button" class="btn btn-small" data-rv-export="${gid}">导出表达卡</button>
          </span>
        </summary>
        ${g.resumePoint ? `<p class="muted small" style="margin:4px 0 6px">简历对应: ${esc(g.resumePoint)}</p>` : ''}
        <div class="resume-q-list">${items}</div>
      </details>`;
  }

  /* summary 里的按钮如果让 click 冒泡/产生默认行为,<details> 会跟着开合。
     统一在 source 处掐断:这里拦的是「按钮自身」,过滤按钮在外面不在 summary 里,不受影响 */
  function stopToggle(e) { e.preventDefault(); e.stopPropagation(); }

  /* 表达卡纯文本:题号/标题/题面/参考要点,一行一句能直接念。
     答案按 format 取:quiz 给「正确选项 + 解析」(answer 字段本身就带,格式恰好如此),
     narrative/qa 直接用 answer 要点。Markdown 标记剥掉,导出的是纯文本。 */
  function stripMd(s) {
    return String(s == null ? '' : s)
      .replace(/```[\s\S]*?```/g, '')
      .replace(/^#{1,6}\s+/gm, '')
      .replace(/^\s*[-*+]\s+/gm, '· ')
      .replace(/^\s*>\s?/gm, '')
      .replace(/\*\*([^*]+)\*\*/g, '$1')
      .replace(/`([^`]+)`/g, '$1')
      .replace(/\[([^\]]+)\]\([^)\s]+\)/g, '$1')
      .trim();
  }

  function questionPrompt(q) { return stripMd(q.prompt || q.q || q.title || ''); }

  function questionAnswer(q) {
    if (q.format === 'quiz') {
      const right = (q.options || []).filter(o => o.right).map(o => o.label).join('、');
      const head = right ? `正确答案:${right}\n` : '';
      return head + stripMd(q.answer || q.plain || '');
    }
    return stripMd(q.answer || '');   /* narrative / qa 都落在 answer 字段 */
  }

  function buildGroupCardText(gid) {
    const entry = rvIds.get(gid);
    if (!entry) return null;
    const lines = [`简历表达卡 · ${entry.name}`, ''];
    entry.ids.forEach(id => {
      const q = Data.question(id);
      if (!q) return;
      lines.push(`【${id}】${q.title || id}`);
      lines.push(`问：${questionPrompt(q) || '(无题面)'}`);
      lines.push(`答（要点）：${questionAnswer(q) || '(无参考要点)'}`);
      lines.push('');
    });
    return lines.join('\n');
  }

  /* 直接走 util.download(Blob + a[download])——Anki CSV 用的同一套真实下载,
     测试里等 'download' 事件就能落盘。文件名禁掉文件系统非法字符。 */
  function exportGroupCard(gid) {
    const entry = rvIds.get(gid);
    const text = buildGroupCardText(gid);
    if (!entry || !text) { toast('没有可导出的题目', 'err'); return; }
    const safe = String(entry.name).replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '');
    download(`简历表达卡-${safe}.txt`, text, 'text/plain');
    toast('已下载 简历表达卡-' + safe + '.txt');
  }

  function wire(root) {
    $$('[data-rv-filter]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        showAll = btn.dataset.rvFilter === 'all';
        render(root);
      });
    });
    /* wire 在每次 render 后重跑,旧节点已随 innerHTML 一起销毁,直接重绑不会叠加 */
    $$('[data-rv-mock]', root).forEach(btn => {
      btn.addEventListener('click', e => {
        stopToggle(e);
        const entry = rvIds.get(btn.dataset.rvMock);
        if (entry && entry.ids.length) MockView.startDirected(entry.ids, '简历·' + entry.name);
      });
    });
    $$('[data-rv-export]', root).forEach(btn => {
      btn.addEventListener('click', e => {
        stopToggle(e);
        exportGroupCard(btn.dataset.rvExport);
      });
    });
    const mustBtn = $('[data-rv-must-mock]', root);
    if (mustBtn) mustBtn.addEventListener('click', () => {
      if (mustIds.length) MockView.startDirected(mustIds, '简历·必知题');
    });
  }

  return { render };
})();

if (typeof window !== 'undefined') window.ResumeView = ResumeView;
