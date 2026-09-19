/* 简历针对性练习:按简历项目/技能分组展示匹配的题目,追踪练习进度。
   数据来源: data/resume-profile.json → build.py → window.APP_DATA.resume */
'use strict';

const ResumeView = (() => {
  let showAll = false;   /* false=只看必知, true=全部 */

  function data() { return (window.APP_DATA && window.APP_DATA.resume) || {}; }

  function questionIds(groups) {
    return [...new Set(groups.flatMap(g => g.questionIds || []))].filter(id => Data.question(id));
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
    const items = questionIds([g]).map(qid => {
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
    return `
      <details class="resume-group" open>
        <summary style="cursor:pointer;font-weight:600;margin:10px 0 4px">
          ${mustTag} ${esc(g.name)}
          <span class="muted small" style="margin-left:6px">${questionIds([g]).length} 题</span>
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
