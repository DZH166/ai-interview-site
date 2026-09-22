/* 简历针对性练习浏览器验收:路由/分区渲染/必知过滤/进度/跳转。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/resume-view.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9844', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
const check = (n, ok, d) => { assert(ok, n + (d ? ' :: ' + d : '')); passed++; console.log('  PASS', n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      try {
        await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
      } catch (e) {
        const st = await page.evaluate(() => ({
          store: typeof Store !== 'undefined',
          children: document.querySelector('#view') ? document.querySelector('#view').children.length : -1,
          empty: (document.querySelector('#view .empty') || {}).textContent || null,
          url: location.href
        })).catch(e2 => ({ evalfail: e2.message.slice(0, 80) }));
        console.log('  DEBUG open fail:', JSON.stringify(st));
        throw e;
      }
    };

    /* 导航入口与路由 */
    await open('#/home');
    check('导航栏含简历入口', await page.locator('.nav-link[data-view="resume"]').count() === 1);

    await open('#/resume');
    const dataOk = await page.evaluate(() => {
      const r = window.APP_DATA && window.APP_DATA.resume;
      return !!(r && r.sections && r.sections.length);
    });
    check('APP_DATA.resume 已构建(有分区)', dataOk);
    check('简历页渲染出分区卡片', await page.locator('.resume-section').count() >= 1);
    check('题目项指向真实题库', await page.evaluate(() => {
      const items = [...document.querySelectorAll('.resume-q-item .qid')].map(e => e.textContent);
      return items.length > 0 && items.every(id => !!Data.question(id));
    }));
    check('进度条总数与去重后的题号总数一致', await page.evaluate(() => {
      const r = window.APP_DATA.resume;
      const total = new Set(r.sections.flatMap(s => s.groups.flatMap(g => g.questionIds))).size;
      const txt = (document.querySelector('.resume-progress')?.textContent || '').replace(/\s+/g, ' ');
      return txt.includes(`0 / ${total} 题`);
    }));

    /* 必知过滤切换:showAll 默认 false,分组数应不多于全部模式 */
    const mustGroups = await page.locator('.resume-group').count();
    await page.locator('[data-rv-filter="all"]').first().click();
    await page.waitForFunction(n => document.querySelectorAll('.resume-group').length >= n, mustGroups);
    const allGroups = await page.locator('.resume-group').count();
    check('全部模式分组数不少于必知模式', allGroups >= mustGroups && allGroups > 0);
    await page.locator('[data-rv-filter="must"]').first().click();
    await page.waitForFunction(n => document.querySelectorAll('.resume-group').length === n, mustGroups);
    check('切回必知模式分组数还原', await page.locator('.resume-group').count() === mustGroups);

    /* 状态联动:走真实路径——简历页点题 → 学习页点「基本掌握」→ 导航回简历页。
       (不能 goto 相同 URL:同文档导航不触发 hashchange,视图不会重渲) */
    const firstQid = await page.locator('.resume-q-item .qid').first().textContent();
    await page.locator('.resume-q-item').first().click();
    await page.waitForFunction(() => /^#\/study\//.test(location.hash), null, { timeout: 15000 });
    await page.waitForFunction(qid => location.hash.endsWith('/' + qid), firstQid, { timeout: 15000 });
    await page.locator(`.status-btn[data-status="ok"]`).first().click();
    check('学习页状态按钮标记基本掌握', await page.evaluate(id => Store.rec(id).status === 'ok', firstQid));
    await page.locator('.nav-link[data-view="resume"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.resume-q-done').length > 0, null, { timeout: 15000 });
    check('已掌握题在简历页显示完成态', await page.evaluate(id => {
      return [...document.querySelectorAll('.resume-q-done .qid')].some(e => e.textContent === id);
    }, firstQid));

    /* 点击题目跳转学习页 */
    await page.locator('.resume-q-item').first().click();
    await page.waitForFunction(() => location.hash.startsWith('#/study/'), null, { timeout: 15000 });
    await page.waitForFunction(() => document.querySelector('.study-wrap'), null, { timeout: 60000 });
    check('点击简历题目跳到学习页', await page.evaluate(() => /^#\/study\//.test(location.hash)));

    /* 360px 无横向溢出 */
    await page.setViewportSize({ width: 360, height: 800 });
    await open('#/resume');
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    check('360px 简历页无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    check('全程无 JS 异常', errors.length === 0, errors.join('|'));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
