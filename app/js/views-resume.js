/* 简历针对性练习:按简历项目/技能分组展示匹配的题目,追踪练习进度。
   数据来源: data/resume-profile.json → build.py → window.APP_DATA.resume */
'use strict';

const ResumeView = (() => {
  let showAll = false;   /* false=只看必知, true=全部 */

  function data() { return (window.APP_DATA && window.APP_DATA.resume) || {}; }

  function progress() {
    const d = data();
    /* store.js 顶层 const 不会挂到 window 上,必须用全局绑定访问(typeof 守住脚本未加载) */
    const rec = (typeof Store !== 'undefined' && Store.data) ? Store.data.questions : null;
    if (!rec) return { total: 0, done: 0 };
    let total = 0, done = 0;
    for (const s of d.sections || []) {
      for (const g of s.groups || []) {
        for (const qid of g.questionIds || []) {
          total++;
          const r = rec[qid];
          if (r && (r.status === 'ok' || r.status === 'review')) done++;
        }
      }
    }
    return { total, done };
  }

  function render(root) {
    const d = data();
    if (!d.sections || !d.sections.length) {
      root.innerHTML = '<div class="empty">简历数据未加载,请确认 data/resume-profile.json 已构建。</div>';
      return;
    }
    const pg = progress();
    const pct = pg.total ? Math.round(pg.done / pg.total * 100) : 0;

    root.innerHTML = `
      <div class="resume-head">
        <h1>简历针对性练习</h1>
        <p class="muted">${esc(d.role)} · ${esc(d.name)} · 题库匹配 ${pg.total} 题</p>
        <div class="resume-progress">
          <div class="progress" style="max-width:400px"><div class="progress-in" style="width:${pct}%"></div></div>
          <span class="muted small">${pg.done} / ${pg.total} 题(${pct}%)</span>
        </div>
        <div class="btn-row" style="margin-top:8px">
          <button class="btn btn-small ${!showAll ? 'btn-primary' : ''}" data-rv-filter="must">必知题</button>
          <button class="btn btn-small ${showAll ? 'btn-primary' : ''}" data-rv-filter="all">全部(${pg.total})</button>
        </div>
      </div>
      ${d.sections.map(s => renderSection(s)).join('')}
    `;
    wire(root);
  }

  function renderSection(s) {
    const groups = (s.groups || []).filter(g => showAll || g.mustKnow);
    if (!groups.length) return '';
    const totalQ = groups.reduce((n, g) => n + (g.questionIds || []).length, 0);
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
    const items = (g.questionIds || []).map(qid => {
      const q = Data.question(qid);
      if (!q) return '';
      const st = Data.statusInfo(qid);
      const done = st.id === 'ok' || st.id === 'review';
      return `
        <a class="resume-q-item ${done ? 'resume-q-done' : ''}" href="#/study/${esc(qid)}">
          <span class="qid">${esc(qid)}</span>
          <span class="resume-q-title">${esc(q.title)}</span>
          ${done ? '<span class="quiz-mark">✓</span>' : ''}
        </a>`;
    }).filter(Boolean).join('');
    if (!items) return '';
    return `
      <details class="resume-group" open>
        <summary style="cursor:pointer;font-weight:600;margin:10px 0 4px">
          ${mustTag} ${esc(g.name)}
          <span class="muted small" style="margin-left:6px">${(g.questionIds || []).length} 题</span>
        </summary>
        ${g.resumePoint ? `<p class="muted small" style="margin:4px 0 6px">简历对应: ${esc(g.resumePoint)}</p>` : ''}
        <div class="resume-q-list">${items}</div>
      </details>`;
  }

  function wire(root) {
    $$('[data-rv-filter]', root).forEach(btn => {
      btn.addEventListener('click', () => {
        showAll = btn.dataset.rvFilter === 'all';
        render(root);
      });
    });
  }

  return { render };
})();

if (typeof window !== 'undefined') window.ResumeView = ResumeView;
