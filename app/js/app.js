/* 应用入口:路由 / 导航 / 初始化 / 暗色模式 */
'use strict';

const App = (() => {
  const routes = {
    home: HomeView, browse: BrowseView, study: StudyView,
    mock: MockView, review: ReviewView, docs: DocsView,
    search: SearchView, maintain: MaintainView, path: PathView
  };
  let pendingAnchor = '';

  function route() {
    const { view, parts, query } = parseHash();
    const root = $('#view');
    /* 视图退出统一清理(必须在新内容渲染前——输入框/滚动位置还属于旧视图):
       笔记与自测草稿同步落盘;文档阅读位置按真实滚动保存并注销监听;
       学习页全局键盘监听注销。 */
    try { if (MockView.flushDraft) MockView.flushDraft(); } catch (e) {}
    try { if (StudyView.flushNote) StudyView.flushNote(); } catch (e) {}
    try { if (DocsView.cleanup) DocsView.cleanup(); } catch (e) {}
    try { if (StudyView.cleanup) StudyView.cleanup(); } catch (e) {}
    if (PathView.cleanup) PathView.cleanup();
    const fn = routes[view] || HomeView;
    try {
      if (view === 'study') {
        /* 不清 NavCtx:保留浏览页筛选上下文,上一题/下一题仍按当前筛选走;
           直接打开学习页时由 NavCtx.neighbors 回退全量 */
        fn.render(root, parts[0], query.a);
      } else if (view === 'docs') {
        fn.render(root, parts);
      } else if (view === 'search') {
        /* 搜索的正式深链是 #/search/<关键词>;同时兼容 #/search?q=<关键词>
           ——本站其它深链都用 ?x= 形式,手抄/改写链接时很容易写成这种。 */
        fn.render(root, parts, query);
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
      const on = a.dataset.view === view;
      a.classList.toggle('active', on);
      /* 视觉上的高亮读屏读不到,必须同时标 aria-current */
      if (on) a.setAttribute('aria-current', 'page');
      else a.removeAttribute('aria-current');
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
    } else if (view !== 'docs' && !(view === 'study' && query.a)
               && !(view === 'path' && (query.d || query.p || query.c))) {
      /* 路径页带深锚点(d 专项 / p 项目 / c 概念)时不回顶,交给 PathView.applyFocus 定位 */
      window.scrollTo({ top: 0, behavior: 'instant' });
    }
    document.title = '面试加油工作台';
  }

  /* 统一索引变更入口:任何数据变更(题库导入/资料增删/尝试保存/备份恢复/清空)都走这里。
     重建 Data 内存(扩展题库/资料)并全量重建索引;失败抛错由调用方反馈真实结果。
     另外把上下文提供者交给 Search:数据版本变化时索引会按需自动重建,
     这样「某个调用点忘了重建索引」不再是一类可能的 bug。 */
  function rebuildIndex() {
    Data.init();
    Search.build(StudyView.currentCtx());
  }
  window.rebuildIndex = rebuildIndex;
  Search.setContextProvider(() => {
    Data.init();                     /* 保证题库/资料内存与存储一致 */
    return StudyView.currentCtx();
  });

  function goToAnchor(anchor) { pendingAnchor = anchor; }

  function updateThemeIcon() {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const btn = $('#theme-toggle');
    if (!btn) return;
    btn.textContent = isDark ? '☀️' : '🌙';
    /* emoji 图标本身没有语义,读屏需要一句能听懂的状态描述 */
    btn.setAttribute('aria-label', isDark ? '切换到亮色模式' : '切换到暗色模式');
    btn.setAttribute('aria-pressed', isDark ? 'true' : 'false');
  }

  function init() {
    Store.load();
    rebuildIndex();

    /* 跳过导航。href="#view" 只是语义上的落点,必须阻止默认行为:
       本站用 hash 路由,#view 会被 parseHash 当成一个视图名,
       跟着默认跳转会把用户带到首页。 */
    const skip = $('#skip-to-main');
    if (skip) {
      skip.addEventListener('click', e => {
        e.preventDefault();
        const main = $('#view');
        if (main) { main.focus(); if (main.scrollIntoView) main.scrollIntoView({ block: 'start' }); }
      });
    }

    /* 提示条容器提前建好:live region 必须在内容插入前就在 DOM 里,读屏才会播报 */
    ensureToastBox();

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
