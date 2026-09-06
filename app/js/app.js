/* 应用入口:路由 / 导航 / 初始化 / 暗色模式 */
'use strict';

const App = (() => {
  const routes = {
    home: HomeView, browse: BrowseView, study: StudyView,
    mock: MockView, review: ReviewView, docs: DocsView,
    search: SearchView, maintain: MaintainView
  };
  let pendingAnchor = '';

  function route() {
    const { view, parts, query } = parseHash();
    const root = $('#view');
    if (StudyView.cleanup) StudyView.cleanup(); /* 离开旧视图时清理全局键盘监听 */
    const fn = routes[view] || HomeView;
    try {
      if (view === 'study') {
        /* 不清 NavCtx:保留浏览页筛选上下文,上一题/下一题仍按当前筛选走;
           直接打开学习页时由 NavCtx.neighbors 回退全量 */
        fn.render(root, parts[0], query.a);
      } else if (view === 'docs') {
        fn.render(root, parts);
      } else if (view === 'search') {
        fn.render(root, parts);
      } else if (view === 'mock') {
        fn.render(root, parts);
      } else {
        fn.render(root);
      }
    } catch (e) {
      console.error(e);
      root.innerHTML = `<div class="empty">页面渲染出错:${esc(e.message)}<br><span class="muted">请刷新重试;若持续出现,请到维护页导出记录后反馈。</span></div>`;
    }
    Store.data.ui.lastHash = location.hash || '#/home';
    Store.save();
    $$('.nav-link').forEach(a => {
      a.classList.toggle('active', a.dataset.view === view);
    });
    const anchor = query.a || pendingAnchor;
    pendingAnchor = '';
    if (anchor && view !== 'study') { /* study 的锚点在 StudyView 内展开定位 */
      setTimeout(() => {
        const el = document.getElementById(anchor);
        if (el) {
          const y = Math.max(0, el.getBoundingClientRect().top + window.scrollY - 80);
          window.scrollTo({ top: y, behavior: 'instant' });
          el.classList.add('flash');
          setTimeout(() => el.classList.remove('flash'), 1600);
        }
      }, 80);
    } else if (view !== 'docs' && !(view === 'study' && query.a)) {
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    document.title = 'AI 面试学习站';
  }

  function goToAnchor(anchor) { pendingAnchor = anchor; }

  function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btn = $('#theme-toggle');
    if (btn) btn.textContent = isDark ? '☀️' : '🌙';
  }

  function init() {
    Store.load();
    Data.init();
    Search.build({ questions: Data.allQuestions(), docs: Data.allDocs(), userDocs: Data.allUserDocs(), records: Store.data });

    /* 暗色模式 */
    const saved = localStorage.getItem('aiiv:theme');
    if (saved === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
    const tBtn = $('#theme-toggle');
    if (tBtn) {
      updateThemeIcon();
      tBtn.addEventListener('click', () => {
        const cur = document.documentElement.getAttribute('data-theme');
        const next = cur === 'dark' ? 'light' : 'dark';
        document.documentElement.setAttribute('data-theme', next);
        localStorage.setItem('aiiv:theme', next);
        updateThemeIcon();
      });
    }

    /* 顶部搜索框 */
    const form = $('#global-search');
    form.addEventListener('submit', e => {
      e.preventDefault();
      const v = $('#global-search-input').value.trim();
      if (v) go('#/search/' + encodeURIComponent(v));
    });

    window.addEventListener('hashchange', route);

    /* 页面隐藏/关闭兜底:输入框未过防抖的内容(笔记/自测草稿)与记录状态立刻落盘 */
    const flush = () => {
      try { if (StudyView.flushNote) StudyView.flushNote(); } catch (e) {}
      try { if (MockView.flushDraft) MockView.flushDraft(); } catch (e) {}
      if (Store.saveNow) Store.saveNow();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', () => { if (document.hidden) flush(); });

    if (!location.hash && Store.data.ui.lastHash) {
      location.replace(Store.data.ui.lastHash);
      route();
      return;
    }
    route();
  }

  return { init, route, goToAnchor };
})();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => App.init());
} else {
  App.init();
}
