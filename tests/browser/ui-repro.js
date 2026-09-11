/* 浏览器回归:界面层行为(问题 A / D / E / F-2)
   这些断言写的是「期望行为」。在 e0adacb 基线上应当失败——失败即证据。
   运行:
     AIIV_PYTHON=<python 路径> node tests/browser/ui-repro.js
   可选环境变量:
     PW=<playwright 模块绝对路径>   CHROME=<chromium 绝对路径>   PORT=<端口>
   脚本自己起本地静态服务(隔离端口 + 独立浏览器上下文),结束后关闭。 */
'use strict';
const path = require('path');
const { spawn, execFileSync } = require('child_process');

const PW = process.env.PW || 'E:/WorkBuddyproject/溯知Rag-Agent项目/AI Knowledge OS Pro/frontend/node_modules/playwright';
const CHROME = process.env.CHROME || 'E:/PlaywrightBrowsers/chromium-1223/chrome-win64/chrome.exe';
const PY = process.env.AIIV_PYTHON || 'python';
const PORT = process.env.PORT || '8931';
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = require(PW);

let passed = 0, failed = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail === undefined ? '' : '\n    → ' + detail); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* ---- 故障注入:只拦「记录写盘」,不改动站内任何逻辑 ---- */
const INJECT = `
(() => {
  const raw = Storage.prototype.setItem;
  Storage.prototype.setItem = function (k, v) {
    if (window.__AIIV_FAIL_SAVE__ && String(k).indexOf('aiiv:records') === 0) {
      const e = new Error('QuotaExceededError'); e.name = 'QuotaExceededError'; throw e;
    }
    return raw.apply(this, arguments);
  };
})();`;

async function startServer() {
  const p = spawn(PY, [path.join(ROOT, 'tools', 'serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { execFileSync(PY, ['-c', `import urllib.request,os;urllib.request.urlopen("${BASE}/index.html",timeout=1)`], { stdio: 'ignore' }); return p; }
    catch (e) { await sleep(200); }
  }
  throw new Error('本地服务启动超时');
}

/* 用同源 404 页写种子:应用页的 pagehide 冲刷会覆盖本地写入,必须走独立页面 */
async function seed(page, records, extra) {
  await page.goto(`${BASE}/__seed__`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(([rec, ex]) => {
    localStorage.clear();
    localStorage.setItem('aiiv:records', JSON.stringify(rec));
    Object.keys(ex || {}).forEach(k => localStorage.setItem(k, ex[k]));
  }, [records, extra || {}]);
}
async function open(page, hash) {
  await page.goto(`${BASE}/index.html${hash || ''}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForFunction(
      () => (typeof Store !== 'undefined') && document.querySelector('#view') && document.querySelector('#view').children.length > 0,
      null, { timeout: 8000 });
  } catch (e) {
    const diag = await page.evaluate(() => ({
      hasStore: typeof Store !== 'undefined',
      viewChildren: (document.querySelector('#view') || {}).children ? document.querySelector('#view').children.length : -1,
      viewHtml: (document.querySelector('#view') || {}).innerHTML ? document.querySelector('#view').innerHTML.slice(0, 160) : '',
      hash: location.hash
    })).catch(() => ({}));
    throw new Error('页面未就绪 ' + JSON.stringify(diag) + ' 异常=' + JSON.stringify(page.__errors || []));
  }
  await sleep(150);
}
const blankRec = (over) => Object.assign({
  v: 2, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {},
  ui: { lastHash: '', browse: {}, docPos: {}, search: {} }
}, over || {});
function toastTexts(page) {
  return page.evaluate(() => Array.from(document.querySelectorAll('#toast-box .toast')).map(t => t.textContent));
}
/* 视图重渲染会收起 <details>,每次操作前重新展开 */
async function expandRecord(page, drillId) {
  const det = page.locator(`.path-drill[data-drill="${drillId}"] [data-drill-record="${drillId}"]`);
  const isOpen = await det.evaluate(el => !!el.open).catch(() => false);
  if (!isOpen) { await det.locator('summary').click(); await sleep(120); }
}

(async () => {
  const server = await startServer();
  const browser = await chromium.launch({ headless: true, executablePath: CHROME });
  const ctx = await browser.newContext({ viewport: { width: 420, height: 900 } });
  const page = await ctx.newPage();
  await page.addInitScript(INJECT);
  const pageErrors = [];
  page.__errors = pageErrors;
  page.on('pageerror', e => pageErrors.push(String(e.message)));
  page.on('console', m => { if (m.type() === 'error') pageErrors.push('console: ' + m.text()); });
  const DRILL = 'drill-1pred01';

  try {
    /* ================= A:保存失败仍提示「已保存」 ================= */
    console.log('\n== 问题 A:提交尝试时写盘失败,却提示已保存 ==');
    {
      await seed(page, blankRec());
      await open(page, '#/path');
      /* 展开专项的「记录复盘」折叠区 */
      const box = page.locator(`.path-drill[data-drill="${DRILL}"]`);
      await box.locator(`[data-drill-record="${DRILL}"] > summary`).click();
      await box.locator(`[data-drill-answer="${DRILL}"]`).fill('我的预测:会抛异常');
      await sleep(300);                     /* 等防抖落盘一次 */
      const before = await page.evaluate(d => (Store.data.drillAttempts[d] || []).map(a => a.status), DRILL);
      console.log('    [观测] 写盘失败前 attempts 状态 =', JSON.stringify(before));

      /* 从此刻起所有 aiiv:records 写盘都失败 */
      await page.evaluate(() => { window.__AIIV_FAIL_SAVE__ = true; });
      await box.locator(`[data-drill-save="${DRILL}"]`).click();
      await sleep(500);
      const toasts = await toastTexts(page);
      const bad = toasts.filter(t => t.includes('已保存'));
      const good = toasts.filter(t => /保存失败|未保存|无法保存/.test(t));
      console.log('    [观测] 提交后提示 =', JSON.stringify(toasts));
      ok('A 写盘失败时必须提示保存失败', good.length >= 1, '未出现失败提示,实际提示:' + JSON.stringify(toasts));
      ok('A 写盘失败时不得提示「已保存」', bad.length === 0, '仍提示:' + JSON.stringify(bad));
      const state = await page.evaluate(d => ({
        attempts: (Store.data.drillAttempts[d] || []).map(a => a.status),
        persisted: (() => { try { return JSON.parse(localStorage.getItem('aiiv:records')); } catch (e) { return null; } })()
      }), DRILL);
      const persistedCompleted = state.persisted && ((state.persisted.drillAttempts || {})[DRILL] || []).some(a => a.status === 'completed');
      ok('A 写盘失败时不得把内存记录推进为 completed(界面与磁盘不能分叉)',
        persistedCompleted === true ? true : state.attempts.filter(s => s === 'completed').length === 0,
        '内存=' + JSON.stringify(state.attempts) + ' 磁盘已完成=' + persistedCompleted);
      await page.evaluate(() => { window.__AIIV_FAIL_SAVE__ = false; });
    }

    /* ================= D:放弃草稿 ≡ 提交后另开 ================= */
    console.log('\n== 问题 D:「放弃草稿」被写成一条 completed 记录 ==');
    {
      await seed(page, blankRec());
      await open(page, '#/path');
      const box = page.locator(`.path-drill[data-drill="${DRILL}"]`);
      await box.locator(`[data-drill-record="${DRILL}"] > summary`).click();
      await box.locator(`[data-drill-answer="${DRILL}"]`).fill('写了一半就想放弃的内容');
      await sleep(300);
      await box.locator(`[data-drill-new="${DRILL}"]`).click();
      await page.waitForSelector('.modal, .modal-box, [data-modal]', { timeout: 3000 }).catch(() => {});
      await sleep(200);
      const btns = await page.locator('button').allTextContents();
      console.log('    [观测] 弹窗按钮 =', JSON.stringify(btns.filter(t => /放弃|提交|取消/.test(t))));
      await page.getByRole('button', { name: /放弃草稿/ }).first().click();
      await sleep(400);
      const attempts = await page.evaluate(d => (Store.data.drillAttempts[d] || []).map(a => ({ status: a.status, rating: a.selfRating, ans: a.myAnswer })), DRILL);
      console.log('    [观测] 放弃后 attempts =', JSON.stringify(attempts));
      ok('D 「放弃草稿」不得产生一条 completed 记录',
        !attempts.some(a => a.status === 'completed'),
        '产生 completed:' + JSON.stringify(attempts.filter(a => a.status === 'completed')));
      ok('D 放弃必须留下可区分的痕迹(abandoned 或直接丢弃)',
        attempts.some(a => a.status === 'abandoned') || attempts.filter(a => a.status === 'completed').length === 0,
        '状态集合=' + JSON.stringify(attempts.map(a => a.status)));

      /* D-2:空草稿点「开始新尝试」不得留下空的 completed 记录 */
      await expandRecord(page, DRILL);
      await box.locator(`[data-drill-new="${DRILL}"]`).click();
      await sleep(400);
      const afterEmpty = await page.evaluate(d => (Store.data.drillAttempts[d] || []).map(a => ({ status: a.status, ans: a.myAnswer })), DRILL);
      console.log('    [观测] 空草稿开始新尝试后 attempts =', JSON.stringify(afterEmpty));
      ok('D 空草稿「开始新尝试」不得留下无内容的 completed 记录',
        !afterEmpty.some(a => a.status === 'completed' && !String(a.ans || '').trim()),
        '出现空 completed:' + JSON.stringify(afterEmpty.filter(a => a.status === 'completed' && !String(a.ans || '').trim())));
    }

    /* ================= E-1 / E-3:复习页的专项入口 ================= */
    console.log('\n== 问题 E:复习页「今日复习」的专项聚合与进入方式 ==');
    {
      /* E-1:没有任何待复习题目,但有未解决专项 → 专项清单必须仍然出现 */
      await seed(page, blankRec({
        drillAttempts: { [DRILL]: [{ attemptId: 'at-1', drillId: DRILL, version: 1, status: 'completed', selfRating: 'unsolved', review: '还没弄懂', myAnswer: 'x', ts: 100, updatedAt: 100 }] }
      }));
      await open(page, '#/review');
      await sleep(300);
      const bodyText = await page.locator('#review-body').innerText().catch(() => '');
      console.log('    [观测] 今日复习正文 =', JSON.stringify(bodyText.slice(0, 90)));
      ok('E-1 没有待复习题目但有未解决专项时,专项清单仍须显示',
        bodyText.includes('专项'), '正文中找不到专项区块,实际:' + JSON.stringify(bodyText.slice(0, 90)));

      /* E-3:专项链接的键盘可达性(Enter 必须进入该专项页) */
      await seed(page, blankRec({
        questions: { 'PY-001': { status: 'review', fav: false, note: '', viewedAt: 1, practiceCount: 1, lastPracticedAt: 1 } },
        drillAttempts: { [DRILL]: [{ attemptId: 'at-1', drillId: DRILL, version: 1, status: 'completed', selfRating: 'unsolved', review: '还没弄懂', myAnswer: 'x', ts: 100, updatedAt: 100 }] }
      }));
      await open(page, '#/review');
      await sleep(400);
      const drillLink = page.locator(`#review-body a[href*="${DRILL}"]`).first();
      const hasDrillLink = await drillLink.count() > 0;
      ok('E-3 前置:复习页出现专项链接', hasDrillLink, '未渲染专项链接');
      if (hasDrillLink) {
        await drillLink.focus();
        await page.keyboard.press('Enter');
        await sleep(400);
        const hash = await page.evaluate(() => location.hash);
        console.log('    [观测] 键盘 Enter 后 location.hash =', hash);
        ok('E-3 键盘 Enter 必须进入该专项页(不得跳到 #/study/undefined)',
          hash.includes(DRILL) && !hash.includes('undefined'), 'hash=' + hash);
      }
    }

    /* ================= F-2:检索落点必须有身份锚点 ================= */
    console.log('\n== 问题 F-2:项目/概念的检索落点无身份锚点 ==');
    {
      await seed(page, blankRec());
      await open(page, '#/search/' + encodeURIComponent('项目C'));
      await sleep(400);
      const href = await page.evaluate(() => {
        const a = Array.from(document.querySelectorAll('#s-results a.search-item'))
          .find(x => /项目C|proj-c-mini-rag/.test(x.textContent));
        return a ? a.getAttribute('href') : null;
      });
      console.log('    [观测] 项目检索结果 href =', href);
      ok('F-2 项目检索落点必须带项目身份(点击后能定位到该项目)',
        !!href && /proj-c-mini-rag/.test(href), 'href=' + href + ' → 只落到路径页顶部,四个项目全折叠');
    }

    /* ================= 阶段5/6:深锚点必须真的落到那条记录 ================= */
    console.log('\n== 深锚点落点:项目运行记录 / 概念 / 项目草稿 ==');
    {
      const RUN_TEXT = '深锚点唯一标记_召回排序踩坑';
      const RUN_ID = 'run-anchor-1';
      await seed(page, blankRec({
        drillAttempts: {},
        ui: {
          lastHash: '', browse: {}, docPos: {}, search: {},
          projectRuns: { 'proj-c-mini-rag': [{ runId: RUN_ID, ts: 1000, updatedAt: 1000,
            runOutput: RUN_TEXT, debug: '定位过程唯一标记', todo: '未完成项唯一标记', stepStatus: 'trying' }] },
          projectDrafts: { 'proj-c-mini-rag': { runOutput: '草稿唯一标记内容', updatedAt: 1000 } }
        }
      }));
      /* 直接访问带锚点的地址(等价于搜索结果被点击) */
      await open(page, `#/path?p=proj-c-mini-rag&r=${RUN_ID}`);
      await sleep(400);
      const land = await page.evaluate(() => {
        const proj = document.querySelector('details[data-proj="proj-c-mini-rag"]');
        const run = document.querySelector('[data-proj-runbox="run-anchor-1"]');
        return {
          projOpen: !!(proj && proj.open),
          runExists: !!run,
          runOpen: !!(run && run.open),
          runVisible: !!(run && run.innerText.includes('深锚点唯一标记')),
          scrolled: window.scrollY > 0
        };
      });
      console.log('    [观测]', JSON.stringify(land));
      ok('锚点:项目卡片被展开', land.projOpen, '项目仍是折叠的 → 等于只是跳到路径页顶部');
      ok('锚点:目标运行记录存在且被展开', land.runExists && land.runOpen,
        'runExists=' + land.runExists + ' runOpen=' + land.runOpen);
      ok('锚点:页面确实滚到了该记录(不是停在顶部)', land.scrolled && land.runVisible,
        'scrolled=' + land.scrolled + ' runVisible=' + land.runVisible);

      /* 概念锚点 */
      const cid = await page.evaluate(() => {
        const cs = (window.APP_DATA.concepts && window.APP_DATA.concepts.concepts) || [];
        return cs.length ? cs[0].id : '';
      });
      if (cid) {
        await open(page, `#/path?c=${encodeURIComponent(cid)}`);
        await sleep(400);
        const cOpen = await page.evaluate(id => {
          const el = document.querySelector(`details[data-cid="${id}"]`);
          return !!(el && el.open);
        }, cid);
        ok('锚点:概念条目被展开而不是跳到某道题冒充命中', cOpen, 'data-cid=' + cid + ' 未展开');
      } else {
        ok('锚点:概念条目被展开而不是跳到某道题冒充命中', false, '题库没有概念数据,无法验证');
      }

      /* 草稿锚点 */
      await open(page, '#/path?p=proj-c-mini-rag&tab=draft');
      await sleep(400);
      const draftOpen = await page.evaluate(() => {
        const el = document.querySelector('[data-proj="proj-c-mini-rag"] [data-proj-record]');
        return !!(el && el.open);
      });
      ok('锚点:带 tab=draft 时项目实现记录区被展开', draftOpen, '记录区仍是折叠的');
    }

    /* ================= H-2 端到端:清空记录后搜索不再返回已删数据 ================= */
    console.log('\n== 清空记录后检索(真实应用接线)==');
    {
      await seed(page, blankRec({
        questions: { 'PY-001': { status: 'review', fav: false, note: '清空前笔记唯一标记', viewedAt: 1, practiceCount: 1, lastPracticedAt: 1 } }
      }));
      await open(page, '#/maintain');
      await sleep(300);
      const before = await page.evaluate(() => Search.query('清空前笔记唯一标记').length);
      await page.evaluate(() => Store.clearAll());
      await sleep(600);
      const after = await page.evaluate(() => Search.query('清空前笔记唯一标记').length);
      console.log('    [观测] 清空前命中', before, '清空后命中', after);
      ok('H-2 端到端:清空后搜索不再返回已清空的笔记', before >= 1 && after === 0,
        `清空前=${before} 清空后=${after}`);
    }

    const realErrors = pageErrors.filter(m => !/Failed to load resource/.test(m)); /* /__seed__ 与 favicon 的 404 属预期 */
    if (realErrors.length) console.log('\n    [观测] 页面异常 =', JSON.stringify(realErrors.slice(0, 3)));
    ok('页面无 JS 异常', realErrors.length === 0, realErrors.slice(0, 3).join(' | '));
  } finally {
    await browser.close();
    server.kill();
  }

  console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  if (failed) console.log('失败项(基线缺陷证据):\n  - ' + failures.join('\n  - '));
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error('脚本异常:', e); process.exit(2); });
