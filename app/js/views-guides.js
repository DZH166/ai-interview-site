/* 简历知识点口述训练与可核验的离线下载。 */
'use strict';
const GuidesView = (() => {
  let generation = 0;
  function cleanup() { generation++; }
  function render(root, parts = []) {
    const token = ++generation;
    root.innerHTML = '<div class="card" role="status">正在加载口述训练单元…</div>';
    Data.ensureGuides().then(data => {
      if (token !== generation) return;
      const guides = data.guides || [], id = parts[0];
      if (!id) {
        root.innerHTML = `<div class="page-head guide-index-head"><h1>简历核心口述训练</h1><p class="muted">按知识点练习：先自己回答，再对照原理、项目实现和失败场景。个人项目指标需要你自己的证据支持。</p></div>
          <div class="guide-grid">${guides.map(g => `<article class="card guide-card"><h2><a href="#/guides/${esc(g.id)}">${esc(g.title)}</a></h2>
          <p class="muted">${g.sourceQuestionIds.length} 道关联题 · ${g.followups.length} 个深入追问</p>
          <p>${esc(g.rubric.competent[0] || '')}</p><a class="btn" href="#/guides/${esc(g.id)}">进入训练单元</a></article>`).join('')}</div>`;
        return;
      }
      const g = guides.find(x => x.id === id);
      if (!g) { root.innerHTML = '<div class="empty">未找到训练单元。<a href="#/guides">返回列表</a></div>'; return; }
      root.innerHTML = `<div class="guide-detail"><a href="#/guides">← 全部训练单元</a>
        <div class="card"><h1>${esc(g.title)}</h1><p>先用 60 秒给出结论和关键机制，再用 3 分钟说明实现、边界与取舍。</p>
        <h2 class="guide-main-question">${esc(g.mainQuestion || g.title)}</h2>
        <button class="btn btn-primary" id="guide-start">开始回答与项目追问</button>
        <p class="muted">回答会保存到自测草稿，完成后可导出个人表达卡。</p></div>
        <details class="card guide-reference"><summary>参考学习资料 · 60 秒口述</summary>${QRender.mdHtml(g.answer60)}</details>
        <details class="card guide-reference"><summary>参考学习资料 · 3 分钟展开</summary>${QRender.mdHtml(g.answer180)}</details>
        <section class="card"><h2>项目追问</h2>${g.followups.map(f => `<details class="guide-followup"><summary>${esc(f.q)}</summary>${QRender.mdHtml(f.a)}</details>`).join('')}</section>
        <section class="card"><h2>自我检查标准</h2>${[['basic','基础'],['competent','合格'],['deep','深入']].map(([key,label]) => `<h3>${label}</h3><ul>${(g.rubric[key] || []).map(x => `<li>${esc(x)}</li>`).join('')}</ul>`).join('')}</section>
        <section class="card"><h2>准备你的项目证据</h2><p class="notice">${esc(g.projectEvidence.note)}</p><ul>${g.projectEvidence.prompts.map(x => `<li>${esc(x)}</li>`).join('')}</ul></section>
        <section class="card"><h2>关联题目</h2><div class="guide-links">${g.sourceQuestionIds.map(qid => `<a href="#/study/${encodeURIComponent(qid)}">${esc(qid)} · ${esc(Data.question(qid)?.title || '查看题目')}</a>`).join('')}</div></section>
        <section class="card"><h2>依据与适用版本</h2><ul>${g.sources.map(s => `<li><a href="${esc(safeHref(s.url))}" target="_blank" rel="noopener noreferrer">${esc(s.title)}</a> · ${esc(s.version)} · 核验 ${esc(s.checkedAt)}</li>`).join('')}</ul></section></div>`;
      $('#guide-start', root).addEventListener('click', () => MockView.startDirected([g.mainQuestionId], g.title, { guideId: g.id, guideSnapshot: g }));
    }).catch(error => {
      if (token !== generation) return;
      root.innerHTML = `<div class="card"><p>${navigator.onLine === false ? '当前离线，尚未下载训练资料。' : '训练资料加载失败。'} ${esc(error.message)}</p><button class="btn" id="guide-retry">重试</button></div>`;
      $('#guide-retry', root).onclick = () => render(root, parts);
    });
  }
  function safeHref(url) { return /^https?:\/\//i.test(url || '') ? url : '#'; }
  return { render, cleanup };
})();

const OfflineView = (() => {
  let generation = 0;
  function cleanup() { generation++; }
  async function render(root) {
    const token = ++generation;
    root.innerHTML = `<div class="card offline-panel"><h1>离线学习资料</h1><p>已打开的专题会自动缓存。下载完成并显示“可离线使用”后，可以断网阅读和练习。</p>
      <p class="muted">离线资料存放在本机浏览器；清除网站数据会删除缓存和个人记录，请定期导出备份。</p>
      <div class="offline-actions"><button class="btn btn-primary" data-download="core">下载简历核心</button><button class="btn" data-download="all">下载全部</button></div>
      <p id="offline-progress" role="status" aria-live="polite">正在检查已缓存资料…</p><progress id="offline-bar" max="1" value="0" aria-label="离线下载进度"></progress>
      <p id="offline-errors" class="muted"></p><a href="#/maintain">前往维护页导出个人记录</a></div>`;
    const update = (value, complete = false) => {
      if (token !== generation) return;
      $('#offline-bar', root).max = Math.max(1, value.total); $('#offline-bar', root).value = value.ready;
      $('#offline-progress', root).textContent = !value.supported ? '当前浏览器无法写入离线缓存。'
        : `${value.ready} / ${value.total} 份资料已缓存${complete && !value.missing.length ? ' · 可离线使用' : ''}`;
      $('#offline-errors', root).textContent = value.missing.length ? '尚未缓存：' + value.missing.map(x => Data.topicName(x)).join('、') + '。可以点击下载按钮重试。' : '';
    };
    try { update(await Data.offlineStatus('core')); }
    catch (e) { if (token === generation) $('#offline-progress', root).textContent = '缓存检查失败：' + e.message; }
    if (token !== generation) return;
    $$('[data-download]', root).forEach(button => button.addEventListener('click', async () => {
      const scope = button.dataset.download;
      $$('[data-download]', root).forEach(b => { b.disabled = true; });
      $('#offline-progress', root).textContent = '正在下载并核验缓存…';
      try {
        if (!navigator.serviceWorker) throw Error('请使用 HTTPS 或本地服务器打开本站');
        let timer;
        try {
          await Promise.race([navigator.serviceWorker.ready,
            new Promise((_, reject) => { timer = setTimeout(() => reject(Error('离线服务尚未就绪，请联网刷新后重试')), 8000); })]);
        } finally { clearTimeout(timer); }
        if (token !== generation) return;
        update(await Data.downloadOffline(scope, update), true);
      } catch (e) { if (token === generation) $('#offline-progress', root).textContent = '下载未完成：' + e.message; }
      finally { if (token === generation) $$('[data-download]', root).forEach(b => { b.disabled = false; }); }
    }));
  }
  return { render, cleanup };
})();
