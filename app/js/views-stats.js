/* 统计可视化(Track C):专题×状态热力表 / SRS 到期预测 / 错题专题分布。
   纯 DOM+CSS 实现,零依赖零图片——PWA 离线可用是硬约束,引图表库会连网。
   所有聚合只读 Store.data 与 window.APP_DATA,不写任何状态;数据为空时
   各块独立给出友好空态(某块空不能吞掉另外两块)。 */
'use strict';

const StatsView = (() => {
  const DAY = 24 * 60 * 60 * 1000;

  const topics = () => ((window.APP_DATA && window.APP_DATA.topics) || []);

  /* 记录状态统一取这里:无记录/空串都归「未练习」,与 Store.STATUS 对齐 */
  function statusOf(qid) {
    const r = Store.data.questions[qid];
    return (r && r.status) || '';
  }

  /* ---- 块一:专题 × 状态热力表 ----
     每行一个专题(全部专题,含 0 记录的——统计页消失的行比 0 更难解读),
     4 个状态列。色阶用 rgba 透明度映射 count/max:不引色板变量是刻意的,
     亮暗两套主题下同一 alpha 都落在可读区间(≤.5),文字色仍由主题控制。 */
  const HEAT = {
    '':       { label: '未练习',   rgb: '107,114,128' },   /* 灰 */
    'weak':   { label: '还不熟',   rgb: '220,38,38' },     /* 红 */
    'ok':     { label: '基本掌握', rgb: '37,99,235' },     /* 蓝 */
    'review': { label: '待复习',   rgb: '37,99,235' }      /* 蓝 */
  };
  const STATUS_ORDER = ['', 'weak', 'ok', 'review'];

  function heatData() {
    const qs = Data.allQuestions();
    const perTopic = {};                     /* topic -> {status -> count} */
    topics().forEach(t => { perTopic[t.id] = {}; STATUS_ORDER.forEach(s => perTopic[t.id][s] = 0); });
    const maxPer = {};                       /* 每个状态列自己的 max,alpha 按列归一 */
    qs.forEach(q => {
      if (!(q.topic in perTopic)) return;    /* 导入题库的未知专题不进表 */
      const s = statusOf(q.id);
      if (!HEAT[s]) return;
      perTopic[q.topic][s]++;
      maxPer[s] = Math.max(maxPer[s] || 0, perTopic[q.topic][s]);
    });
    return { perTopic, maxPer };
  }

  function renderHeat() {
    const { perTopic, maxPer } = heatData();
    const ts = topics();
    if (!ts.length) return `<div class="empty">题库尚未加载,暂无专题统计。</div>`;
    return `
      <div class="stats-scroll">
        <table class="stats-heat" data-test="stats-heat">
          <thead>
            <tr>
              <th class="sh-topic" scope="col">专题</th>
              ${STATUS_ORDER.map(s => `<th scope="col" class="sh-col">${HEAT[s].label}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${ts.map(t => `
              <tr data-topic="${esc(t.id)}">
                <th scope="row" class="sh-topic"><a href="#/browse?t=${encodeURIComponent(t.id)}">${esc(t.name)}</a></th>
                ${STATUS_ORDER.map(s => {
                  const n = perTopic[t.id][s];
                  const max = maxPer[s] || 0;
                  /* 有数才上色;alpha 上限 .5 保证前景文字在两套主题下都可读 */
                  const a = n && max ? Math.max(0.08, 0.5 * n / max) : 0;
                  return `<td class="sh-cell" data-status="${s}" data-count="${n}" title="${HEAT[s].label} ${n} 题"
                            ${a ? `style="background:rgba(${HEAT[s].rgb},${a.toFixed(3)})"` : ''}>${n}</td>`;
                }).join('')}
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  /* ---- 块二:SRS 到期预测(未来 30 天) ----
     桶按「本地日历日」切(与用户对「今天/明天」的直觉一致,不做 24h 滚动窗);
     起点 = 今天零点,due < 起点即逾期(不计入任何桶)。无 srs 的题目不计。 */
  function forecastData() {
    const start = new Date(); start.setHours(0, 0, 0, 0);
    const t0 = start.getTime();
    const buckets = new Array(30).fill(0);
    let overdue = 0, total = 0;
    Data.allQuestions().forEach(q => {
      const r = Store.data.questions[q.id];
      const due = r && r.srs && typeof r.srs.due === 'number' && isFinite(r.srs.due) ? r.srs.due : null;
      if (due === null) return;
      total++;
      if (due < t0) { overdue++; return; }
      const day = Math.floor((due - t0) / DAY);
      if (day < 30) buckets[day]++;
    });
    return { buckets, overdue, total, t0 };
  }

  function fmtDay(ts) {
    const d = new Date(ts);
    return (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function renderForecast() {
    const { buckets, overdue, t0 } = forecastData();
    if (!overdue && !buckets.some(n => n > 0)) {
      return `<div class="empty">还没有任何间隔重复排期。标记题目状态后会自动生成到期计划。</div>`;
    }
    const max = Math.max(...buckets, 1);
    const sum = (a, b) => buckets.slice(a, b + 1).reduce((x, y) => x + y, 0);
    const bars = buckets.map((n, i) => {
      const ts = t0 + i * DAY;
      /* 非零桶保底 3px 高:0 题的「贴地」与 1 题的「矮柱」在视觉上必须可区分 */
      const h = n ? Math.max(3, Math.round(n / max * 64)) : 1;
      return `<div class="sf-col${i === 0 ? ' sf-today' : ''}">
        <div class="sf-bar" style="height:${h}px" title="${fmtDay(ts)}${i === 0 ? '(今天)' : ''} · ${n} 题${n ? '' : '(无)'}"></div>
        <div class="sf-tick${i % 7 === 0 ? ' sf-tick-lbl' : ''}">${i % 7 === 0 ? (i === 0 ? '今' : i + '天') : ''}</div>
      </div>`;
    }).join('');
    return `
      <div class="sf-summary muted" data-test="stats-forecast-summary">
        今天到期 ${buckets[0]} · 明天 ${buckets[1]} · 7天内 ${sum(0, 6)} · 30天内 ${sum(0, 29)} · 逾期 ${overdue}
      </div>
      <div class="stats-forecast" data-test="stats-forecast">${bars}</div>
      <div class="muted small" style="margin-top:4px">柱高 = 当日到期题数(悬停看日期与数量);深色柱为今天。</div>`;
  }

  /* ---- 块三:错题专题分布 ----
     聚合模拟面试轮次里 mark==='weak' 的题,按题目所属专题计数。
     qid→topic 优先查题库;查不到(题被下架/导入轮次)回退快照里的 topic。 */
  function weakData() {
    const byTopic = {};
    (Store.data.mock.rounds || []).forEach(rd =>
      (rd.items || []).forEach(it => {
        if (!it || it.mark !== 'weak' || !it.qid) return;
        const q = Data.question(it.qid);
        const topic = (q && q.topic) || (it.questionSnapshot && it.questionSnapshot.topic) || '';
        if (!topic) return;
        byTopic[topic] = (byTopic[topic] || 0) + 1;
      }));
    return Object.keys(byTopic)
      .map(id => ({ id, name: Data.topicName(id), n: byTopic[id] }))
      .sort((a, b) => b.n - a.n || a.id.localeCompare(b.id))   /* 同数按 ID 稳定排序 */
      .slice(0, 10);
  }

  function renderWeak() {
    const rows = weakData();
    if (!rows.length) {
      return `<div class="empty">还没有错题记录。做一轮模拟面试并把没答上来的题标「还不熟」,这里就会长出来。</div>`;
    }
    const max = rows[0].n;
    return `
      <div class="stats-dist" data-test="stats-weak">
        ${rows.map(r => `
          <div class="sd-row" data-topic="${esc(r.id)}">
            <a class="sd-label" href="#/browse?t=${encodeURIComponent(r.id)}">${esc(r.name)}</a>
            <div class="sd-track"><div class="sd-fill" style="width:${Math.max(4, Math.round(r.n / max * 100))}%"></div></div>
            <span class="sd-count" data-count="${r.n}">${r.n}</span>
          </div>`).join('')}
      </div>
      <div class="muted small" style="margin-top:4px">按标记次数降序,最多 10 个专题;点击专题名可去刷对应的题。</div>`;
  }

  function render(root) {
    root.innerHTML = `
      <div class="card stats-block">
        <b>📊 专题 × 状态热力表</b>
        <span class="muted small" style="margin-left:8px">每个专题四档状态的题目数;颜色越深越多,点专题名去刷题。</span>
        ${renderHeat()}
      </div>
      <div class="card stats-block">
        <b>📅 SRS 到期预测(未来 30 天)</b>
        <span class="muted small" style="margin-left:8px">间隔重复排期的到期分布,逾期不计入柱子。</span>
        ${renderForecast()}
      </div>
      <div class="card stats-block">
        <b>🎯 错题专题分布</b>
        <span class="muted small" style="margin-left:8px">模拟面试中标记「还不熟」的题,按专题汇总。</span>
        ${renderWeak()}
      </div>`;
  }

  return { render };
})();

if (typeof window !== 'undefined') window.StatsView = StatsView;
