/* 复习与备份:今日复习 / 错题本 / 收藏 / 待复习 / 笔记 / 练习记录 / 模拟面试历史 */
'use strict';

const ReviewView = (() => {
  let tab = 'today';

  /* ---- 今日复习队列 ---- */
  function getTodayQueue() {
    const qs = Data.allQuestions();
    return qs.filter(q => {
      const r = Store.rec(q.id);
      return r.status === 'review' || r.status === 'weak';
    }).sort((a, b) => {
      const ra = Store.rec(a.id), rb = Store.rec(b.id);
      // 待复习 > 还不熟;同级按最久未练优先
      if (ra.status !== rb.status) return ra.status === 'review' ? -1 : 1;
      return (ra.lastPracticedAt || 0) - (rb.lastPracticedAt || 0);
    });
  }

  /* ---- 错题本:模拟面试中标记"还不熟"的 ---- */
  function getMistakes() {
    const ids = new Set();
    (Store.data.mock.rounds || []).forEach(rd =>
      rd.items.forEach(it => { if (it.mark === 'weak') ids.add(it.qid); }));
    return Data.allQuestions().filter(q => ids.has(q.id));
  }

  function render(root) {
    const tq = getTodayQueue(), mk = getMistakes();
    root.innerHTML = `
      <div class="review-tabs">
        ${[
          ['today',   `📌 今日复习${tq.length ? ` (${tq.length})` : ''}`],
          ['mistakes',`❌ 错题本${mk.length ? ` (${mk.length})` : ''}`],
          ['fav',     '★ 收藏'],
          ['weak',    '还不熟'],
          ['review',  '待复习'],
          ['note',    '有笔记'],
          ['recent',  '最近练习'],
          ['rounds',  '模拟面试历史'],
        ].map(([id, label]) => `<button class="rtab ${tab === id ? 'active' : ''}" data-tab="${id}">${label}</button>`).join('')}
      </div>
      ${tab === 'today' ? renderTodayIntro(tq) : ''}
      <div id="review-body"></div>`;
    $$('.rtab', root).forEach(b => b.addEventListener('click', () => { tab = b.dataset.tab; render(root); }));
    renderBody(root);
  }

  function renderTodayIntro(tq) {
    if (!tq.length) return '';
    return `<div class="card" style="padding:12px 16px;margin-bottom:12px;">
      <b>📌 今日复习队列</b>
      <span style="margin-left:8px;color:var(--muted);font-size:13px">
        待复习 + 还不熟,按最久未练排序。做完后自动从队列消失。
      </span>
    </div>`;
  }

  function renderBody(root) {
    const box = $('#review-body', root);
    if (tab === 'today') { renderToday(box); return; }
    if (tab === 'mistakes') { renderMistakes(box); return; }
    if (tab === 'rounds') { renderRounds(box); return; }
    const qs = Data.allQuestions();
    let items = [];
    if (tab === 'fav') items = qs.filter(q => Store.rec(q.id).fav);
    else if (tab === 'weak') items = qs.filter(q => (Store.rec(q.id).status || '') === 'weak');
    else if (tab === 'review') items = qs.filter(q => (Store.rec(q.id).status || '') === 'review');
    else if (tab === 'note') items = qs.filter(q => (Store.rec(q.id).note || '').trim());
    else if (tab === 'recent') {
      items = qs.filter(q => Store.rec(q.id).viewedAt)
        .sort((a, b) => Store.rec(b.id).viewedAt - Store.rec(a.id).viewedAt).slice(0, 30);
    }
    if (!items.length) {
      box.innerHTML = `<div class="empty">这里还是空的。${tab === 'fav' ? '在学习页点「☆ 收藏」把重要题目加进来。' : tab === 'today' ? '太好了,今天没有待复习的题目!去学新题或做一轮自测吧。' : ''}</div>`;
      return;
    }
    box.innerHTML = `<div class="review-list">${items.map(q => {
      const r = Store.rec(q.id);
      const st = Data.statusInfo(q.id);
      return `
        <div class="review-item">
          <div class="ri-main" data-qid="${q.id}">
            <div class="q-item-title">${esc(q.title)}</div>
            <div class="q-item-meta">
              <span class="qid">${q.id}</span>
              ${QRender.badge(Data.topicShort(q.topic), 'b-topic')}
              ${QRender.badge(Data.diffLabel(q.difficulty), 'b-diff-' + q.difficulty)}
              ${QRender.badge(st.label, st.cls)}
              ${tab === 'today' && r.lastPracticedAt ? `<span class="muted" style="font-size:12px">上次练习 ${fmtTime(r.lastPracticedAt)}</span>` : ''}
              ${tab === 'note' && r.note ? `<div class="ri-note">${esc(r.note.slice(0, 120))}${r.note.length > 120 ? '…' : ''}</div>` : ''}
              ${tab === 'recent' && r.viewedAt ? `<span class="muted">${fmtTime(r.viewedAt)}</span>` : ''}
              ${tab === 'recent' && r.practiceCount ? `<span class="muted">练过 ${r.practiceCount} 次</span>` : ''}
            </div>
          </div>
          <button class="btn btn-small" data-toggle-status="${q.id}" title="标记待复习">→ 待复习</button>
        </div>`;
    }).join('')}</div>`;
    $$('.ri-main', box).forEach(el => el.addEventListener('click', () => go('#/study/' + el.dataset.qid)));
    $$('[data-toggle-status]', box).forEach(b => b.addEventListener('click', () => {
      Store.setStatus(b.dataset.toggleStatus, 'review');
      toast('已标记待复习');
      renderBody(root);
    }));
  }

  /* ---- 今日复习(智能排序) ---- */
  function renderToday(box) {
    const queue = getTodayQueue();
    if (!queue.length) {
      box.innerHTML = '<div class="empty">🎉 今日没有待复习的题目!<br><span class="muted">去学新题或做一轮自测吧。</span><br><br><a class="btn btn-primary" href="#/mock">开始自测</a></div>';
      return;
    }
    box.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <b>📌 今日复习</b>
        <span style="margin-left:8px;color:var(--muted);font-size:13px">
          ${queue.length} 题 · 按最久未练排序 · 做完自动移出
        </span>
        <div style="margin-top:8px">
          <button class="btn btn-primary btn-small" id="start-today">开始复习</button>
        </div>
      </div>
      <div class="review-list">${queue.map(q => {
        const r = Store.rec(q.id);
        const st = Data.statusInfo(q.id);
        return `
          <div class="review-item">
            <div class="ri-main" data-qid="${q.id}">
              <div class="q-item-title">${esc(q.title)}</div>
              <div class="q-item-meta">
                <span class="qid">${q.id}</span>
                ${QRender.badge(Data.topicShort(q.topic), 'b-topic')}
                ${QRender.badge(st.label, st.cls)}
                ${r.lastPracticedAt ? `<span class="muted" style="font-size:12px">上次 ${fmtTime(r.lastPracticedAt)}</span>` : ''}
              </div>
            </div>
          </div>`;
      }).join('')}</div>`;
    $('#start-today', box).addEventListener('click', () => {
      // 启动定向复习(复用 mock 的逻辑但只针对今日队列)
      MockView.startTodayReview(queue);
    });
    $$('.ri-main', box).forEach(el => el.addEventListener('click', () => go('#/study/' + el.dataset.qid)));
  }

  function renderMistakes(box) {
    const mistakes = getMistakes();
    if (!mistakes.length) {
      box.innerHTML = '<div class="empty">🎉 没有错题!做一轮模拟面试,做错的题会自动出现在这里。</div>';
      return;
    }
    box.innerHTML = `<div class="review-list">${mistakes.map(q => {
      const st = Data.statusInfo(q.id);
      return `
        <div class="review-item">
          <div class="ri-main" data-qid="${q.id}">
            <div class="q-item-title">${esc(q.title)}</div>
            <div class="q-item-meta">
              <span class="qid">${q.id}</span>
              ${QRender.badge(Data.topicShort(q.topic), 'b-topic')}
              ${QRender.badge(st.label, st.cls)}
            </div>
          </div>
          <button class="btn btn-small" data-redo="${q.id}">🔄 重做</button>
        </div>`;
    }).join('')}</div>`;
    $$('.ri-main', box).forEach(el => el.addEventListener('click', () => go('#/study/' + el.dataset.qid)));
    $$('[data-redo]', box).forEach(b => b.addEventListener('click', () => go('#/study/' + b.dataset.redo)));
  }

  function getMistakesList() { return getMistakes(); }
  function getTodayList() { return getTodayQueue(); }

  return { render, getTodayQueue, getMistakes };
})();


/* ---- 错题本视图(独立 tab 内容) ---- */
function renderMistakesView(box) {
  const mistakes = getMistakesList();
  if (!mistakes.length) {
    box.innerHTML = '<div class="empty">🎉 没有错题!做一轮模拟面试,做错的题会自动出现在这里。</div>';
    return;
  }
  box.innerHTML = `<div class="review-list">${mistakes.map(q => {
    const st = Data.statusInfo(q.id);
    return `
      <div class="review-item">
        <div class="ri-main" data-qid="${q.id}">
          <div class="q-item-title">${esc(q.title)}</div>
          <div class="q-item-meta">
            <span class="qid">${q.id}</span>
            ${QRender.badge(Data.topicShort(q.topic), 'b-topic')}
            ${QRender.badge(Data.diffLabel(q.difficulty), 'b-diff-' + q.difficulty)}
            ${QRender.badge(st.label, st.cls)}
          </div>
        </div>
        <button class="btn btn-small" data-redo="${q.id}">🔄 重做</button>
      </div>`;
  }).join('')}</div>`;
  $$('.ri-main', box).forEach(el => el.addEventListener('click', () => go('#/study/' + el.dataset.qid)));
  $$('[data-redo]', box).forEach(b => b.addEventListener('click', () => go('#/study/' + b.dataset.redo)));
}


/* ---- 题库维护 ---- */


/* ---- 题库维护 (MaintainView) ---- */
const MaintainView = (() => {
  const MOJI_RE = /\ufffd|锟斤拷|烫烫|Ã[^\x00-\x7F]/;

  function render(root) {
    const qs = Data.allQuestions();
    const extra = Store.extraBankLoad();
    const base = (window.APP_DATA.questions || []).length;
    const byStatus = { verified: 0, partial: 0, todo: 0 };
    qs.forEach(q => { byStatus[q.verify && q.verify.status || 'todo']++; });
    root.innerHTML = `
      <div class="maintain-grid">
        <div class="card">
          <h3>题库统计</h3>
          <div class="kv"><span>内置题目</span><b>${base}</b></div>
          <div class="kv"><span>导入追加</span><b>${extra.length}</b></div>
          <div class="kv"><span>当前合计</span><b>${qs.length}</b></div>
          <div class="kv"><span>已核查 / 部分 / 待核查</span><b>${byStatus.verified} / ${byStatus.partial} / ${byStatus.todo}</b></div>
          <div class="kv"><span>文档章节(内置/导入)</span><b>${Data.allDocs().length} / ${Data.allUserDocs().length}</b></div>
          <div class="kv"><span>来源 / 候选</span><b>${(window.APP_DATA.sources.sources||[]).length} / ${(window.APP_DATA.candidates.candidates||[]).length}</b></div>
          <p class="muted small">数据与界面分离:编辑 <code>data/</code> 后运行 <code>python tools/build.py</code> 重建。</p>
        </div>
        <div class="card">
          <h3>题库导入 / 导出</h3>
          <p class="muted small">导入格式:JSON 数组或 <code>{"questions":[...]}</code>。自动校验重复/字段/乱码。只追加,不改学习记录。</p>
          <div class="btn-row">
            <button class="btn btn-primary" id="b-import">导入题库 JSON</button>
            <button class="btn" id="b-export">导出当前题库</button>
          </div>
        </div>
        <div class="card">
          <h3>个人记录备份</h3>
          <p class="muted small">记录存于 localStorage(键前缀 <code>aiiv:</code>)。导出 JSON 备份,换设备导入合并。导入不清空已有记录。</p>
          <div class="btn-row">
            <button class="btn btn-primary" id="r-export">导出记录</button>
            <button class="btn" id="r-import">导入记录</button>
            <button class="btn btn-danger" id="r-clear">清空全部记录</button>
          </div>
        </div>
      </div>
      <div class="card full">
        <h3>候选题目索引(仅标题,不进入正式题库)</h3>
        <div class="table-wrap"><table class="md-table">
          <thead><tr><th>编号</th><th>标题</th><th>专题</th><th>来源</th></tr></thead>
          <tbody>${(window.APP_DATA.candidates.candidates||[]).map(c =>
            `<tr><td>${esc(c.id)}</td><td>${esc(c.title)}</td><td>${esc(Data.topicName(c.topic_guess))}</td><td>${esc(c.source_id||'')}</td></tr>`).join('')}
          </tbody></table></div>
      </div>
      <div class="card full">
        <h3>来源与许可</h3>
        <div class="table-wrap"><table class="md-table">
          <thead><tr><th>名称</th><th>类型</th><th>许可证</th><th>状态</th><th>说明</th></tr></thead>
          <tbody>${(window.APP_DATA.sources.sources||[]).map(s =>
            `<tr><td>${s.url?`<a href="${esc(s.url)}" target="_blank">${esc(s.name)}</a>`:esc(s.name)}</td><td>${esc(s.kind)}</td><td>${esc(s.license||'—')}</td><td>${esc(s.status)}</td><td class="src-cell">${esc(s.summary||'')}</td></tr>`).join('')}
          </tbody></table></div>
      </div>
      <div class="card full">
        <h3>关于本站</h3>
        <div class="about-list">
          <div><b>启动:</b>双击 <code>start.bat</code> 或直接打开 <code>app/index.html</code></div>
          <div><b>技术:</b>纯静态 HTML/CSS/JS,无框架,无外网请求</div>
          <div><b>数据:</b><code>data/questions/*.json</code> 题库、<code>data/docs/*.md</code> 章节、<code>data/sources.json</code> 来源</div>
          <div><b>质量:</b>独立撰写,标注核查状态与出处;示例数字为演示</div>
        </div>
      </div>`;
    $('#b-import').addEventListener('click', importBank);
    $('#b-export').addEventListener('click', () => {
      download('ai-interview-bank-' + dateStr() + '.json',
        JSON.stringify({type:'aiiv-bank',exported_at:new Date().toISOString(),questions:Data.allQuestions()},null,2));
    });
    $('#r-export').addEventListener('click', () => {
      download('aiiv-records-' + dateStr() + '.json', Store.exportRecords());
      toast('已导出');
    });
    $('#r-import').addEventListener('click', () => {
      openFileText('.json').then(({text}) => {
        try { const r = Store.importRecords(text); toast(`导入成功:合并 ${r.qMerged} 题、${r.roundsAdded} 轮`); }
        catch(e) { toast('导入失败: ' + e.message, 'err'); }
      }).catch(() => {});
    });
    $('#r-clear').addEventListener('click', () => {
      modal('确认清空全部记录?','<p>不可恢复,建议先导出备份。</p>',[
        {label:'取消'},
        {label:'确认清空',danger:true,onClick:()=>{Store.clearAll();toast('已清空,建议刷新');}}
      ]);
    });
  }

  function dateStr() { const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; }

  function validateQuestions(arr) {
    const errors = [], seen = new Set(Data.allQuestions().map(q=>q.id));
    const idRe = /^[A-Z]{2,4}-\d{3}$/;
    (arr||[]).forEach((q,i) => {
      const tag = q.id || '#'+i;
      if (!idRe.test(q.id||'')) errors.push(`${tag}: 题号不符合 XX-NNN`);
      if (seen.has(q.id)) errors.push(`${q.id}: 与现有重复`);
      ['id','topic','type','difficulty','title','answer','plain','deep','example','interview','followups','pitfalls','check','sources','verify'].forEach(k=>{
        if (!q[k] || (Array.isArray(q[k])&&!q[k].length)) errors.push(`${tag}: 缺字段 ${k}`);
      });
      if (/\ufffd|锟斤拷|烫烫/.test(JSON.stringify(q))) errors.push(`${tag}: 疑似乱码`);
    });
    return errors;
  }

  function importBank() {
    openFileText('.json').then(({name,text}) => {
      let arr;
      try { const o = JSON.parse(text); arr = Array.isArray(o)?o:(o.questions||null); if(!Array.isArray(arr)) throw new Error('无题目数组'); }
      catch(e) { toast('JSON 解析失败','err'); return; }
      const errors = validateQuestions(arr);
      const existing = new Set(Data.allQuestions().map(q=>q.id));
      const fresh = arr.filter(q=>q.id&&/^[A-Z]{2,4}-\d{3}$/.test(q.id)&&!existing.has(q.id));
      if (!fresh.length) { toast('无可新增题目'); return; }
      modal('确认导入?',`<p>可新增 <b>${fresh.length}</b> 题,校验问题 ${errors.length} 项。不会修改学习记录。</p>`,[
        {label:'取消'},
        {label:`导入 ${fresh.length} 题`,primary:true,onClick:()=>{
          const merged = Store.extraBankLoad().concat(fresh);
          Store.extraBankSave(merged);
          Data.init();
          Search.build({questions:Data.allQuestions(),docs:Data.allDocs(),userDocs:Data.allUserDocs(),records:Store.data});
          toast(`已导入 ${fresh.length} 题`); App.route();
        }}
      ]);
    }).catch(()=>{});
  }

  return { render };
})();
