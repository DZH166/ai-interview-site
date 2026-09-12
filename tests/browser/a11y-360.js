/* 窄屏(360px)与键盘可达性回归。
   断言写的是「期望行为」:窄屏不该横向溢出,纯键盘应当能完成主要操作。

   运行:
     AIIV_PYTHON=<python 路径> node tests/browser/a11y-360.js
   可选环境变量同 ui-repro.js(PW / CHROME / PORT)。 */
'use strict';
const path = require('path');
const { spawn, execFileSync } = require('child_process');

/* 浏览器来源:本地默认用机器上已装好的 Playwright 与 Chromium;
   CI 里设 PW=playwright 让它用自己安装的一套,CHROME=default 走 Playwright 自带的浏览器。 */
const PW = process.env.PW || 'E:/WorkBuddyproject/溯知Rag-Agent项目/AI Knowledge OS Pro/frontend/node_modules/playwright';
const CHROME = process.env.CHROME !== undefined
  ? process.env.CHROME
  : (process.env.CI ? 'default' : 'E:/PlaywrightBrowsers/chromium-1223/chrome-win64/chrome.exe');
const LAUNCH = (CHROME && CHROME !== 'default') ? { headless: true, executablePath: CHROME } : { headless: true };
const PY = process.env.AIIV_PYTHON || 'python';
const PORT = process.env.PORT || '8933';
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = require(PW);

let passed = 0, failed = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail === undefined ? '' : '\n    → ' + detail); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function startServer() {
  const p = spawn(PY, [path.join(ROOT, 'tools', 'serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { execFileSync(PY, ['-c', `import urllib.request;urllib.request.urlopen("${BASE}/index.html",timeout=1)`], { stdio: 'ignore' }); return p; }
    catch (e) { await sleep(200); }
  }
  throw new Error('本地服务启动超时');
}

/* 种子:一条完整记录,让各视图都有真实内容可排 */
const DRILL = 'drill-1pred01';
function seedRecords(over) {
  return Object.assign({
    v: 3,
    questions: {
      'RG-001': {
        attempts: [{ attemptId: 'a1', status: 'completed', ts: Date.now() - 3600e3, updatedAt: Date.now() - 3600e3, self: '答对', note: '笔记内容' }],
        note: '这是笔记', updatedAt: Date.now() - 3600e3
      }
    },
    mock: { rounds: [{ id: 'r1', ts: Date.now() - 7200e3, score: 3, total: 5, items: [] }], draft: null },
    /* 有内容的草稿:点「开始新尝试」才会出现确认对话框(这是弹窗的唯一入口) */
    drillAttempts: {
      [DRILL]: [{
        attemptId: 'dr-1', drillId: DRILL, version: 1, status: 'draft',
        myAnswer: '我先预测会抛异常,并且 print 不会执行。', observed: '', review: '',
        ts: Date.now() - 600e3, updatedAt: Date.now() - 600e3
      }]
    },
    ui: { lastHash: '#/home', browse: {}, docPos: {}, search: {} }
  }, over || {});
}

async function seed(page, over) {
  await page.goto(`${BASE}/__seed__`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(rec => {
    localStorage.clear();
    localStorage.setItem('aiiv:records', JSON.stringify(rec));
  }, seedRecords(over));
}

async function open(page, hash) {
  await page.goto(`${BASE}/index.html${hash || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(
    () => (typeof Store !== 'undefined') && document.querySelector('#view') && document.querySelector('#view').children.length > 0,
    null, { timeout: 8000 });
  await sleep(180);
}

/* 找出横向溢出的具体元素,便于定位而不是只报「溢出了」 */
const OVERFLOW_PROBE = () => {
  const vw = document.documentElement.clientWidth;
  const out = [];
  document.querySelectorAll('body *').forEach(el => {
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) return;
    if (r.right > vw + 1 || r.left < -1) {
      const cs = getComputedStyle(el);
      if (cs.position === 'fixed' || cs.visibility === 'hidden' || cs.display === 'none') return;
      out.push({
        tag: el.tagName.toLowerCase(),
        cls: (el.className || '').toString().slice(0, 40),
        left: Math.round(r.left), right: Math.round(r.right),
        text: (el.textContent || '').trim().slice(0, 30)
      });
    }
  });
  return { docScroll: document.documentElement.scrollWidth, vw, out: out.slice(0, 6) };
};

(async () => {
  const server = await startServer();
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 360, height: 640 } });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));
  await seed(page);

  /* ================= A. 360px 不横向溢出 ================= */
  console.log('== A. 360px 窄屏不横向溢出 ==');
  const ROUTES = [
    ['#/home', '工作台'], ['#/path', '学习路径'], ['#/browse', '练习'],
    ['#/docs', '文档阅读'], ['#/mock', '自测'], ['#/review', '复习'],
    ['#/maintain', '维护'], ['#/search?q=RAG', '搜索'],
    ['#/study/RG-001', '学习页']
  ];
  for (const [hash, name] of ROUTES) {
    await open(page, hash);
    const r = await page.evaluate(OVERFLOW_PROBE);
    ok(`${name} 无横向溢出 (scrollWidth ${r.docScroll} ≤ ${r.vw})`,
      r.docScroll <= r.vw + 1,
      r.out.length ? '溢出元素:' + JSON.stringify(r.out.slice(0, 3)) : 'scrollWidth 超出');
  }

  /* ================= B. 全局骨架的可访问性 ================= */
  console.log('\n== B. 全局骨架 ==');
  await open(page, '#/home');
  const skeleton = await page.evaluate(() => {
    const main = document.querySelector('main');
    const nav = document.querySelector('nav.site-nav');
    const toggle = document.querySelector('#theme-toggle');
    const search = document.querySelector('#global-search-input');
    const live = document.querySelector('#toast-box');
    const firstFocusable = (() => {
      const all = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'));
      return all.find(el => el.offsetParent !== null || el === document.activeElement) || null;
    })();
    return {
      mainExists: !!main,
      mainTabindex: main ? main.getAttribute('tabindex') : null,
      navLabel: nav ? (nav.getAttribute('aria-label') || '') : 'NO_NAV',
      currentMarked: (() => {
        const a = document.querySelector('.nav-link[data-view="home"]');
        return a ? (a.getAttribute('aria-current') || '') : 'NO_LINK';
      })(),
      toggleLabel: toggle ? (toggle.getAttribute('aria-label') || toggle.getAttribute('title') || '') : 'NO_TOGGLE',
      togglePressed: toggle ? (toggle.getAttribute('aria-pressed') || '') : '',
      searchLabel: search ? (search.getAttribute('aria-label') || '') : 'NO_SEARCH',
      toastLive: live ? (live.getAttribute('aria-live') || '') : 'NO_TOASTBOX',
      toastRole: live ? (live.getAttribute('role') || '') : '',
      firstIsSkip: firstFocusable ? /跳过|跳到主内容|skip/i.test(firstFocusable.textContent || '') : false,
      langAttr: document.documentElement.getAttribute('lang') || ''
    };
  });
  ok('存在 main 容器', skeleton.mainExists);
  ok('lang 已声明', skeleton.langAttr === 'zh-CN', 'lang=' + skeleton.langAttr);
  ok('main 是程序化跳转的落点(tabindex=-1)', skeleton.mainTabindex === '-1',
    'tabindex=' + skeleton.mainTabindex);
  ok('有「跳到主内容」的跳过导航链接,且是第一个可聚焦元素',
    skeleton.firstIsSkip, '第一个可聚焦元素不是跳过链接');
  ok('主导航有 aria-label', !!skeleton.navLabel && skeleton.navLabel !== 'NO_NAV', 'nav=' + skeleton.navLabel);
  ok('当前页在导航里标了 aria-current(高亮读屏读得到)',
    skeleton.currentMarked === 'page', 'aria-current=' + skeleton.currentMarked);
  ok('主题切换按钮有可读名称', !!skeleton.toggleLabel && skeleton.toggleLabel !== 'NO_TOGGLE');
  ok('主题切换按钮报告开合状态(aria-pressed)', skeleton.togglePressed === 'true' || skeleton.togglePressed === 'false',
    'aria-pressed=' + skeleton.togglePressed);
  ok('全局搜索输入有可读名称(aria-label)', !!skeleton.searchLabel && skeleton.searchLabel !== 'NO_SEARCH');
  ok('提示条容器是 live region(读屏能播报保存结果)',
    !!skeleton.toastLive && skeleton.toastLive !== 'NO_TOASTBOX' && skeleton.toastLive !== 'off',
    'aria-live=' + skeleton.toastLive);

  /* 跳过链接点下去:焦点应落到 main,且不能把 hash 路由带跑偏 */
  const skipEffect = await page.evaluate(async () => {
    const link = document.querySelector('#skip-to-main');
    const before = location.hash;
    if (!link) return { before, after: before, focusedId: 'NO_SKIP_LINK' };
    link.click();
    await new Promise(r => setTimeout(r, 120));
    return { before, after: location.hash, focusedId: document.activeElement ? document.activeElement.id : '' };
  });
  ok('点「跳到主内容」后焦点落在 main 上', skipEffect.focusedId === 'view', JSON.stringify(skipEffect));
  ok('跳过链接不会破坏 hash 路由(不会跳到 #view)', skipEffect.after === skipEffect.before,
    JSON.stringify(skipEffect));

  /* ================= C. 焦点可见 ================= */
  console.log('\n== C. 键盘焦点可见 ==');
  await open(page, '#/browse');
  const focusReport = await page.evaluate(async () => {
    const all = Array.from(document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])'))
      .filter(el => el.offsetParent !== null);
    const bad = [];
    for (const el of all.slice(0, 40)) {
      el.focus();
      const cs = getComputedStyle(el);
      const hasOutline = cs.outlineStyle !== 'none' && parseFloat(cs.outlineWidth || '0') > 0;
      const hasShadow = cs.boxShadow && cs.boxShadow !== 'none';
      if (!hasOutline && !hasShadow && document.activeElement !== el) {
        bad.push({ tag: el.tagName.toLowerCase(), cls: (el.className || '').toString().slice(0, 30) });
      }
      if (document.activeElement !== el && !el.hasAttribute('disabled')) {
        bad.push({ tag: el.tagName.toLowerCase(), cls: 'not-focusable', text: (el.textContent || '').slice(0, 20) });
      }
    }
    return { total: all.length, bad: bad.slice(0, 6) };
  });
  ok(`可聚焦元素都能拿到焦点且样式可见(共 ${focusReport.total} 个)`,
    focusReport.bad.length === 0, JSON.stringify(focusReport.bad));

  /* ================= D. 纯键盘操作对话框 ================= */
  console.log('\n== D. 纯键盘操作对话框 ==');
  await open(page, '#/path?d=' + DRILL);
  const modalFlow = await page.evaluate(async (drillId) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const det = document.querySelector('.path-drill [data-drill-record]');
    if (det && !det.open) { det.open = true; await sleep(60); }
    const btn = document.querySelector(`[data-drill-new="${drillId}"]`);
    if (!btn) return { err: '找不到「开始新尝试」按钮' };
    btn.focus();
    const gotFocus = document.activeElement === btn;
    btn.click();
    await sleep(150);
    const modal = document.querySelector('[role="dialog"]');
    if (!modal) return { err: '有草稿时点击应弹出确认对话框', gotFocus };
    const active0 = document.activeElement;
    return {
      gotFocus,
      insideOnOpen: modal.contains(active0),
      role: modal.getAttribute('role'),
      ariaModal: modal.getAttribute('aria-modal'),
      labelled: !!document.querySelector('#' + (modal.getAttribute('aria-labelledby') || '__none__')),
      activeTag: active0 ? active0.tagName.toLowerCase() : 'none'
    };
  }, DRILL);
  ok('「开始新尝试」按钮可被键盘聚焦', modalFlow.gotFocus === true, JSON.stringify(modalFlow));
  ok('有草稿时弹出确认对话框,且焦点进入对话框内', modalFlow.insideOnOpen === true, JSON.stringify(modalFlow));
  ok('对话框 role=dialog 且 aria-modal=true',
    modalFlow.role === 'dialog' && modalFlow.ariaModal === 'true', JSON.stringify(modalFlow));
  ok('对话框有可访问名称(aria-labelledby 指向真实标题)', modalFlow.labelled === true, JSON.stringify(modalFlow));

  /* Tab 圈定测试必须用**真实按键**:合成的 KeyboardEvent 不会触发浏览器默认的
     Tab 移动,于是「焦点跑没跑出去」根本不会被检验到,那种断言是恒真的。 */
  let escapedAt = -1, escapedTo = '';
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    const inside = await page.evaluate(() => {
      const m = document.querySelector('[role="dialog"]');
      const a = document.activeElement;
      return { inside: !!(m && a && m.contains(a)), where: a ? a.tagName.toLowerCase() + '.' + (a.className || '').toString().slice(0, 20) : 'none' };
    });
    if (!inside.inside) { escapedAt = i + 1; escapedTo = inside.where; break; }
  }
  ok('连按 12 次 Tab 焦点始终留在对话框内(有焦点圈定)', escapedAt === -1,
    '第 ' + escapedAt + ' 次 Tab 跑到了 ' + escapedTo);

  await page.keyboard.press('Escape');
  await sleep(150);
  const afterEsc = await page.evaluate((drillId) => {
    const btn = document.querySelector(`[data-drill-new="${drillId}"]`);
    return {
      stillOpen: !!document.querySelector('[role="dialog"]'),
      restored: document.activeElement === btn,
      backTag: document.activeElement ? document.activeElement.tagName.toLowerCase() + '.' +
        (document.activeElement.className || '').toString().slice(0, 24) : 'none'
    };
  }, DRILL);
  ok('Esc 能关闭对话框', afterEsc.stillOpen === false, JSON.stringify(afterEsc));
  ok('关闭后焦点回到触发按钮', afterEsc.restored === true, '焦点在 ' + afterEsc.backTag);

  /* D2. 没有草稿内容时:不该弹对话框,也不该留下一堆空记录 */
  console.log('\n== D2. 空草稿时的行为 ==');
  await seed(page, { drillAttempts: {} });
  await open(page, '#/path?d=' + DRILL);
  const emptyFlow = await page.evaluate(async (drillId) => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const det = document.querySelector('.path-drill [data-drill-record]');
    if (det && !det.open) { det.open = true; await sleep(60); }
    const btn = document.querySelector(`[data-drill-new="${drillId}"]`);
    if (!btn) return { err: '找不到按钮' };
    btn.click(); await sleep(150);
    const modalShown = !!document.querySelector('[role="dialog"]');
    if (modalShown) {
      const cancel = Array.from(document.querySelectorAll('[role="dialog"] .modal-foot button'))
        .find(b => /取消/.test(b.textContent));
      if (cancel) cancel.click();
      await sleep(120);
    }
    const list = (Store.data.drillAttempts[drillId] || []);
    return { modalShown, count: list.length,
             drafts: list.filter(a => a.status === 'draft').length,
             withContent: list.filter(a => (a.myAnswer || '').trim()).length };
  }, DRILL);
  ok('没有草稿内容时不弹确认对话框(直接开始)', emptyFlow.modalShown === false, JSON.stringify(emptyFlow));
  ok('确实产生了 1 条新的草稿记录', emptyFlow.count === 1 && emptyFlow.drafts === 1, JSON.stringify(emptyFlow));
  ok('新草稿是空的,没有伪造内容', emptyFlow.withContent === 0, JSON.stringify(emptyFlow));

  /* ================= E. 学习页方向键导航 ================= */
  console.log('\n== E. 学习页键盘导航 ==');
  await open(page, '#/study/RG-001');
  const nav = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const before = (location.hash || '').trim();
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
    await sleep(200);
    return { before, after: (location.hash || '').trim() };
  });
  ok('方向键可切换题目', nav.before !== nav.after, JSON.stringify(nav));

  /* ================= F. 页面无 JS 异常 ================= */
  const realErrors = pageErrors.filter(m => !/Failed to load resource/.test(m));
  ok('整轮 360px 巡检无 JS 异常', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)));

  await browser.close();
  server.kill();
  console.log('\n结果: %d 通过, %d 失败', passed, failed);
  if (failed) { console.log('失败项:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
})().catch(e => { console.error('运行失败:', e); process.exit(2); });
