/* 复习与备份:今日复习 / 错题本 / 收藏 / 待复习 / 笔记 / 练习记录 / 模拟面试历史 */
'use strict';

const ReviewView = (() => {
  let tab = 'today';

  /* ---- 今日复习队列 ----
     规则(可解释):①状态「待复习」或「还不熟」入队;②有复盘原因的题加「未消化」标记排前;
     ③标「基本掌握」自然移出,「还不熟/待复习」保留——不自动假定掌握。
     (间隔安排是启发式提示,不覆盖手动状态。) */
  function getTodayQueue() {
    const qs = Data.allQuestions();
    return qs.filter(q => {
      const r = Store.rec(q.id);
      return r.status === 'review' || r.status === 'weak';
    }).sort((a, b) => {
      const ra = Store.rec(a.id), rb = Store.rec(b.id);
      const pa = (ra.reviewReasons || []).length > 0 ? 0 : 1;
      const pb = (rb.reviewReasons || []).length > 0 ? 0 : 1;
      if (pa !== pb) return pa - pb;                       // 有复盘原因的排前
      if (ra.status !== rb.status) return ra.status === 'review' ? -1 : 1;
      return (ra.lastPracticedAt || 0) - (rb.lastPracticedAt || 0);
    });
  }

  /* 专项未解决/部分解决的尝试(最新一次)→ 复习提醒列表(带依据) */
  function getUnsolvedDrills() {
    const out = [];
    Object.keys(Store.data.drillAttempts || {}).forEach(drillId => {
      const done = (Store.data.drillAttempts[drillId] || []).filter(a => a.status === 'completed');
      if (!done.length) return;
      const last = done[done.length - 1];
      if (last.selfRating === 'solved') return;   /* 已解决的不进队列 */
      const paths = (window.APP_DATA.paths && window.APP_DATA.paths.paths) || [];
      const d = paths.flatMap(p => p.stages).flatMap(s => s.drills || []).find(x => x.id === drillId);
      out.push({ drillId, selfRating: last.selfRating, review: last.review || '',
                 q: d ? d.q.slice(0, 60) : drillId, updatedAt: last.updatedAt || last.ts || 0 });
    });
    return out.sort((a, b) => a.updatedAt - b.updatedAt);
  }

  /* ---- 错题本:模拟面试中标记"还不熟"的 ---- */
  function getMistakes() {
    const ids = new Set();
    (Store.data.mock.rounds || []).forEach(rd =>
      (rd.items || []).forEach(it => { if (it.mark === 'weak') ids.add(it.qid); }));
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
        待复习 + 还不熟,按最久未练排序。复习中标记「基本掌握」才移出队列;标「还不熟/待复习」保留,不会自动消失。
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
          <div class="ri-main" data-qid="${q.id}" role="button" tabindex="0" aria-label="打开 ${esc(q.title)}">
            <div class="q-item-title">${esc(q.title)}</div>
            <div class="q-item-meta">
              <span class="qid">${q.id}</span>
              ${QRender.badge(Data.topicShort(q.topic), 'b-topic')}
              ${QRender.badge(Data.diffLabel(q.difficulty), 'b-diff-' + q.difficulty)}
              ${QRender.badge(st.label, st.cls)}
              ${tab === 'today' && (r.reviewReasons || []).length ? `<span class="badge b-tag">未消化 ${r.reviewReasons.length}</span>` : ''}
              ${tab === 'today' && r.lastPracticedAt ? `<span class="muted" style="font-size:12px">上次练习 ${fmtTime(r.lastPracticedAt)}</span>` : ''}
              ${tab === 'note' && r.note ? `<div class="ri-note">${esc(r.note.slice(0, 120))}${r.note.length > 120 ? '…' : ''}</div>` : ''}
              ${tab === 'recent' && r.viewedAt ? `<span class="muted">${fmtTime(r.viewedAt)}</span>` : ''}
              ${tab === 'recent' && r.practiceCount ? `<span class="muted">练过 ${r.practiceCount} 次</span>` : ''}
            </div>
          </div>
          <button class="btn btn-small" data-toggle-status="${q.id}" title="标记待复习">→ 待复习</button>
        </div>`;
    }).join('')}</div>`;
    wireItems(box);
    $$('[data-toggle-status]', box).forEach(b => b.addEventListener('click', () => {
      Store.setStatus(b.dataset.toggleStatus, 'review');
      toast('已标记待复习');
      renderBody(root);
    }));
  }

  /* 列表项:点击 / Enter / Space 打开题目(键盘可达) */
  function wireItems(box) {
    $$('.ri-main', box).forEach(el => {
      const open = () => go('#/study/' + el.dataset.qid);
      el.addEventListener('click', open);
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter' || (e.key === ' ' && !/^(button|input|textarea|select)$/i.test(e.target.tagName))) {
          e.preventDefault(); open();
        }
      });
    });
  }

  /* ---- 今日复习(定向会话入口) ---- */
  function renderToday(box) {
    const queue = getTodayQueue();
    const unsolved = getUnsolvedDrills();
    if (!queue.length && unsolved.length) {
      box.innerHTML = `<div class="card" style="margin-bottom:12px">
        <b>🧩 专项练习待消化</b>
        <div class="review-list" style="margin-top:8px">${unsolved.map(u => `
          <div class="review-item">
            <div class="ri-main" role="button" tabindex="0">
              <div class="q-item-title">${esc(u.q)}…</div>
              <div class="q-item-meta">
                <span class="badge b-tag">${u.selfRating === 'partial' ? '部分解决' : '未解决'}</span>
                ${u.review ? `<span class="muted" style="font-size:12px">${esc(u.review.slice(0, 40))}</span>` : ''}
              </div>
            </div>
          </div>`).join('')}</div>
        <p class="muted small">依据:最近一次专项自评为未解决/部分解决。重新练习并自评「已解决」后自动移出。</p>
      </div>`;
      return;
    }
    if (!queue.length) {
      box.innerHTML = '<div class="empty">🎉 今日没有待复习的题目!<br><span class="muted">去学新题或做一轮自测吧。</span><br><br><a class="btn btn-primary" href="#/mock">开始自测</a></div>';
      return;
    }
    box.innerHTML = `
      <div class="card" style="margin-bottom:12px">
        <b>📌 今日复习</b>
        <span style="margin-left:8px;color:var(--muted);font-size:13px">
          ${queue.length} 题 · 按最久未练排序 · 复习中标记「基本掌握」移出,「还不熟/待复习」保留
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
            <div class="ri-main" data-qid="${q.id}" role="button" tabindex="0" aria-label="打开 ${esc(q.title)}">
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
      MockView.startDirected(queue.map(q => q.id), '今日复习');
    });
    wireItems(box);
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
          <div class="ri-main" data-qid="${q.id}" role="button" tabindex="0" aria-label="打开 ${esc(q.title)}">
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
    wireItems(box);
    $$('[data-redo]', box).forEach(b => b.addEventListener('click', () => go('#/study/' + b.dataset.redo)));
  }

  /* ---- 模拟面试历史:轮次列表 + 可展开详情(兼容旧格式) ---- */
  function renderRounds(box) {
    const rounds = (Store.data.mock.rounds || []).slice();
    if (!rounds.length) {
      box.innerHTML = '<div class="empty">还没有模拟面试记录。完成一轮<a href="#/mock">自测</a>后,这里会显示题目、你的回答与复盘状态。</div>';
      return;
    }
    box.innerHTML = rounds.map((rd, ri) => {
      const items = rd.items || [];
      const revealed = items.filter(it => it.revealed).length;
      const label = rd.config && rd.config.label ? esc(rd.config.label) : '';
      const marked = items.filter(it => it.mark === 'weak').length;
      return `
        <details class="round-details" ${ri === 0 ? 'open' : ''}>
          <summary class="round-summary">
            <b>${fmtTime(rd.ts)}</b> · ${items.length} 题 · 对照参考 ${revealed} 题
            ${marked ? `<span class="badge st-weak">还不熟 ${marked}</span>` : ''}
            ${label ? `<span class="badge b-tag">${label}</span>` : ''}
          </summary>
          <div class="round-list">
            ${items.map((it, i) => {
              const q = Data.question(it.qid);
              const st = it.mark ? (Store.STATUS.find(s => s.id === it.mark) || { label: it.mark }) : null;
              return `
                <div class="round-item">
                  <div class="round-head">
                    <a class="qid" href="#/study/${esc(it.qid)}">${i + 1}. ${esc(it.qid)}</a>
                    ${st ? QRender.badge(st.label, 'st-' + it.mark) : '<span class="muted">未复盘</span>'}
                    <span class="muted" style="font-size:12px">${it.revealed ? '已对照参考' : '未对照参考'}</span>
                  </div>
                  <div class="round-title">${esc(it.title || (q ? q.title : it.qid))}</div>
                  ${it.self ? `<div class="round-self"><b>我的回答:</b>${esc(it.self)}</div>` : '<div class="round-self muted">(未作答)</div>'}
                </div>`;
            }).join('')}
          </div>
        </details>`;
    }).join('');
  }

  function getMistakesList() { return getMistakes(); }
  function getTodayList() { return getTodayQueue(); }

  return { render, getTodayQueue, getMistakes, getUnsolvedDrills };
})();


/* ---- 题库维护 (MaintainView) ---- */
const MaintainView = (() => {

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
          <p class="muted small">导入格式:JSON 数组或 <code>{"questions":[...]}</code>(也接受完整备份)。逐题完整校验(字段/类型/枚举/重复/引用/乱码),<b>只导入零问题的题目</b>;保存失败不会提示成功。</p>
          <div class="btn-row">
            <button class="btn btn-primary" id="b-import">导入题库 JSON</button>
            <button class="btn" id="b-export">导出当前题库</button>
          </div>
        </div>
        <div class="card">
          <h3>个人记录备份</h3>
          <p class="muted small">备份范围:「个人记录」= 状态/收藏/笔记/轮次;「题库与资料」= 你导入的题目和文档;「完整备份」= 两者。恢复规则:整体校验后原子写入;记录字段按更新时间合并——<b>更新的备份可以恢复被清空的笔记/状态</b>,旧备份只补空不覆盖;重复导入幂等。</p>
          <div class="btn-row">
            <button class="btn btn-primary" id="r-export">导出个人记录</button>
            <button class="btn" id="l-export">导出题库与资料</button>
            <button class="btn" id="f-export">导出完整备份</button>
          </div>
          <div class="btn-row" style="margin-top:8px">
            <button class="btn btn-primary" id="r-import">导入记录</button>
            <button class="btn" id="l-import">导入题库与资料</button>
            <button class="btn btn-primary" id="f-import">导入完整备份</button>
            <button class="btn btn-danger" id="r-clear">清空全部记录</button>
          </div>
          ${(() => {
            const qc = Store.quarantineCount();
            const failed = Store.loadIssues && Store.loadIssues.quarantineFailed > 0;
            let html = '';
            if (qc) html += `<div class="notice warn" style="margin-top:10px">检测到 ${qc} 条历史坏数据已被启动隔离(原始内容已保留,未影响你的记录)。<button class="btn btn-small" id="q-export" style="margin-left:8px">导出隔离数据</button></div>`;
            if (failed) html += `<div class="notice warn" style="margin-top:10px"><b>隔离写入失败</b>:本地存储空间不足,坏数据保留在原位未被修改、站点已跳过。可导出原始内容留底,或释放空间后重试。<button class="btn btn-small" id="q-export-raw" style="margin-left:8px">导出原始内容</button><button class="btn btn-small" id="q-retry" style="margin-left:8px">重试</button></div>`;
            return html;
          })()}
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
      toast('已导出个人记录');
    });
    $('#l-export').addEventListener('click', () => {
      download('aiiv-library-' + dateStr() + '.json', Store.exportLibrary());
      toast('已导出题库与资料');
    });
    $('#f-export').addEventListener('click', () => {
      download('aiiv-full-' + dateStr() + '.json', Store.exportFull());
      toast('已导出完整备份');
    });
    $('#r-import').addEventListener('click', () => {
      openFileText('.json').then(({text}) => {
        try {
          const t = JSON.parse(text);
          if (t && t.type === 'aiiv-full') { toast('这是完整备份:已改走「导入完整备份」入口,本次未做任何修改', 'err'); return; }
          const r = Store.importRecords(text);
          window.rebuildIndex();
          toast(`导入成功:合并 ${r.qMerged} 题记录、新增 ${r.roundsAdded} 轮${r.notesUpdated ? `、更新 ${r.notesUpdated} 条笔记` : ''}`);
          App.route();
        }
        catch(e) { toast('导入失败(记录未变动): ' + e.message, 'err'); }
      }).catch(() => {});
    });
    $('#l-import').addEventListener('click', () => {
      openFileText('.json').then(({text}) => {
        try {
          const t = JSON.parse(text);
          if (t && t.type === 'aiiv-full') { toast('这是完整备份:已改走「导入完整备份」入口,本次未做任何修改', 'err'); return; }
          const r = Store.importLibrary(text);
          window.rebuildIndex();
          toast(`导入成功:新增 ${r.questionsAdded} 题、${r.docsAdded} 篇资料(重复项自动跳过)`);
          App.route();
        }
        catch(e) { toast('导入失败(未生效): ' + e.message, 'err'); }
      }).catch(() => {});
    });
    $('#f-import').addEventListener('click', () => {
      openFileText('.json').then(({text}) => {
        try {
          const t = JSON.parse(text);
          if (!t || t.type !== 'aiiv-full') { toast('这不是完整备份(aiiv-full):请用对应的「导入记录」或「导入题库与资料」入口', 'err'); return; }
          /* 预览:记录/轮次/草稿/扩展题/资料的数量与冲突规则 */
          const rec = t.records || {};
          const preview = `
            <p>将一次完整恢复以下内容(整体校验通过、原子写入):</p>
            <div class="kv"><span>题目记录</span><b>${Object.keys(rec.questions || {}).length} 条</b></div>
            <div class="kv"><span>模拟面试轮次</span><b>${(rec.mock && rec.mock.rounds || []).length} 轮</b></div>
            <div class="kv"><span>未完成草稿</span><b>${rec.mock && rec.mock.draft ? '1 份' : '无'}</b></div>
            <div class="kv"><span>导入题库</span><b>${(t.questions || []).length} 题</b></div>
            <div class="kv"><span>导入资料</span><b>${(t.docs || []).length} 篇</b></div>
            <p class="muted small">合并规则:笔记/状态/收藏按更新时间采用(更新的备份可恢复清空);轮次按内容去重;已存在的导入题/资料跳过。校验不通过或写盘失败则全部不生效。</p>`;
          modal('确认完整恢复?', preview, [
            { label: '取消' },
            { label: '完整恢复', primary: true, onClick: () => {
                try {
                  const r = Store.importFull(text);
                  window.rebuildIndex();
                  toast(`完整恢复成功:${r.qMerged} 条记录、${r.roundsAdded} 轮、${r.questionsAdded} 题、${r.docsAdded} 篇资料`);
                  App.route();
                }
                catch(e) { toast('完整恢复失败(全部未生效): ' + e.message, 'err'); return false; }
              } }
          ]);
        }
        catch(e) { toast('导入失败(未生效): ' + e.message, 'err'); }
      }).catch(() => {});
    });
    const qBtn = $('#q-export', root);
    if (qBtn) qBtn.addEventListener('click', () => {
      download('aiiv-quarantine-' + dateStr() + '.json', Store.quarantineExport());
      toast('已导出隔离数据(原始内容)');
    });
    const rawBtn = $('#q-export-raw', root);
    if (rawBtn) rawBtn.addEventListener('click', () => {
      download('aiiv-raw-extras-' + dateStr() + '.json', Store.rawExtrasExport());
      toast('已导出原始字节内容');
    });
    const retryBtn = $('#q-retry', root);
    if (retryBtn) retryBtn.addEventListener('click', () => {
      window.rebuildIndex();
      render(root);
      toast(Store.loadIssues.quarantineFailed > 0 ? '仍有隔离失败,原数据未动' : '重试成功');
    });
    $('#r-clear').addEventListener('click', () => {
      modal('确认清空全部记录?','<p>不可恢复,建议先导出备份。导入的题库与资料不受影响。</p>',[
        {label:'取消'},
        {label:'确认清空',danger:true,onClick:()=>{Store.clearAll();toast('已清空,建议刷新');}}
      ]);
    });
  }

  function dateStr() { const d=new Date(),p=n=>String(n).padStart(2,'0'); return `${d.getFullYear()}${p(d.getMonth()+1)}${p(d.getDate())}`; }

  /* 题库 schema 校验:统一委托数据层 Store.validateQuestions(与资料/完整备份/启动隔离共用同一份规则) */
  function validateQuestions(arr, allExisting) {
    return Store.validateQuestions(arr, allExisting);
  }

  function importBank() {
    openFileText('.json').then(({name, text}) => {
      let arr;
      try {
        const o = JSON.parse(text);
        if (o && o.type === 'aiiv-full' && Array.isArray(o.questions)) arr = o.questions;
        else if (o && o.type === 'aiiv-library' && Array.isArray(o.questions)) arr = o.questions;
        else arr = Array.isArray(o) ? o : (o.questions || null);
        if (!Array.isArray(arr)) throw new Error('无题目数组');
      }
      catch(e) { toast('JSON 解析失败:' + e.message, 'err'); return; }
      const existing = new Set(Data.allQuestions().map(q => q.id));
      const seen = new Set();
      const errors = [], warnings = [], fresh = [];
      arr.forEach(q => {
        const r = Store.validateQuestion(q, seen, existing);
        r.errs.forEach(e => errors.push(e));
        r.warns.forEach(w => warnings.push(w));
        const tag = (q && typeof q.id === 'string') ? q.id : null;
        const bad = tag ? r.errs.some(e => e.startsWith(tag + ':')) : true;
        if (!bad && tag) fresh.push(q);
      });
      if (!fresh.length) {
        modal('没有可导入的题目',
          `<p>共 ${arr.length} 题,全部存在校验问题,已整体拒绝(未写入任何数据)。前 10 项问题:</p>
           <div class="err-list">${esc(errors.slice(0, 10).join('\n'))}</div>`,
          [{ label: '知道了' }]);
        return;
      }
      const errListHtml = errors.length
        ? `<div class="err-list" style="margin-top:8px">${esc(errors.slice(0, 8).join('\n'))}${errors.length > 8 ? '\n… 共 ' + errors.length + ' 项' : ''}</div>`
        : '<p class="muted">全部通过校验。</p>';
      modal('确认导入?',
        `<p>可新增 <b>${fresh.length}</b> 题(仅导入零问题的题目;另有 ${arr.length - fresh.length} 题被拒绝)。</p>
         ${errListHtml}
         <p class="muted small">不会修改学习记录;保存失败会明确报错。</p>`,
        [
          { label: '取消' },
          { label: `导入 ${fresh.length} 题`, primary: true, onClick: () => {
              const merged = Store.extraBankLoad().concat(fresh);
              if (!Store.extraBankSave(merged)) { toast('保存失败:本地存储空间不足,导入未生效', 'err'); return false; }
              window.rebuildIndex();
              toast(`已导入 ${fresh.length} 题`);
              App.route();
            } }
        ]);
    }).catch(()=>{});
  }

  /* 供测试使用 */
  const __test = { validateQuestions, renderRoundsRef: () => renderRounds };

  return { render, __test };
})();
