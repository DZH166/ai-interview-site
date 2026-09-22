/* 牛客选择题融合浏览器验收:quiz 渲染/答案显隐/新专题/360px。 */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9840', BASE = 'http://127.0.0.1:' + PORT;
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

    await open('#/study/LBQ-0001');
    /* Track E:选项卡来自全量题字段,等分片合并完成、学习页重渲染后再断言 */
    await page.waitForFunction(() => typeof Data !== 'undefined' && Data.questionsLoaded() === true && document.querySelector('.quiz-options .quiz-opt'), null, { timeout: 20000 });
    check('选择题:选项卡渲染', await page.locator('.quiz-options .quiz-opt').count() >= 2);
    check('默认隐藏正确项(自测先选)', await page.locator('.quiz-options.quiz-revealed').count() === 0);
    await page.locator('[data-quiz-reveal]').first().click();
    await page.waitForFunction(() => document.querySelector('.quiz-options.quiz-revealed'));
    check('显示正确答案:高亮+解析展开', await page.evaluate(() => {
      const t = document.querySelector('#view').textContent;
      return document.querySelector('.quiz-options.quiz-revealed .quiz-is-right') !== null
        && !document.querySelector('.quiz-answer-block.quiz-answer-hidden')
        && t.includes('官方解析');
    }));
    await page.locator('[data-quiz-reveal]').first().click();
    check('隐藏切换:就地恢复隐藏', await page.evaluate(() => document.querySelectorAll('.quiz-options.quiz-revealed').length === 0
      && document.querySelectorAll('.quiz-answer-block.quiz-answer-hidden').length > 0));

    await open('#/browse?t=quiz-ml');
    await page.waitForFunction(() => document.querySelector('#f-topic')?.value === 'quiz-ml');
    check('新专题 quiz-ml 在浏览页可选且有题', await page.locator('.q-item[data-qid]').count() >= 100);
    check('分批渲染:首屏恰好一批(100 条)', await page.evaluate(() => document.querySelectorAll('.q-item[data-qid]').length === 100));
    const more = page.locator('#q-list > button.btn');
    if (await more.count()) {
      await more.click();
      await page.waitForFunction(() => document.querySelectorAll('.q-item[data-qid]').length > 100, null, { timeout: 30000 });
    }
    check('加载更多:分批追加后超过一批', await page.evaluate(() => document.querySelectorAll('.q-item[data-qid]').length > 100));

    await open('#/home');
    check('首页专题进度列出 17 专题(含新 8 个)', await page.evaluate(() => document.querySelectorAll('.topic-row').length >= 17));

    await page.setViewportSize({ width: 360, height: 800 });
    await open('#/study/LBQ-0001');
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    check('360px 选择题页无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    check('全程无 JS 异常', errors.length === 0, errors.join('|'));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
