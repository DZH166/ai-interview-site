/* 搜索分层缓存的真数据验收:349 题全量索引下,个人写入只重建动态层,
   静态层构建次数不变,搜索行为不变。 */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8960', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok, detail) { assert(ok, name + (detail ? ' :: ' + detail : '')); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const page = await (await browser.newContext()).newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    await page.goto(BASE + '/index.html#/search');
    await page.waitForFunction(() => typeof Search !== 'undefined' && Search.count() > 0);
    /* data.js 拆分后 rebuildIndex 双阶段构建:①index 元数据阶段(动态层即刻生效)
       ②全量分片合并后再建一次(补齐题干/答案/追问)。机器慢时首渲染落在①阶段,
       两次构建都会被观察到 —— 计数基线必须在「就绪后」重新校准,后面断言的才是
       真正要保护的契约:「就绪之后,个人写入只重建动态层,静态层不再重建」。 */
    await page.waitForFunction(() => typeof Data !== 'undefined' && Data.questionsLoaded(), null, { timeout: 60000 });
    await page.evaluate(() => { Data.init(); Search.build(StudyView.currentCtx()); });

    const first = await page.evaluate(() => Search.stats());
    check('就绪基线:静态层已建且题量达标', first.staticUnits > 300 && first.staticBuilds >= 1, JSON.stringify(first));

    /* 连续个人写入:静态层构建次数不变 */
    for (let i = 0; i < 3; i++) {
      await page.evaluate(i2 => { Store.setNote('PY-001', '第' + i2 + '次写的笔记'); window.rebuildIndex(); }, i);
    }
    const after = await page.evaluate(() => Search.stats());
    check('三次个人写入后静态层不再重建', after.staticBuilds === first.staticBuilds, JSON.stringify({ before: first.staticBuilds, after: after.staticBuilds }));
    check('新笔记可检索', await page.evaluate(() => Search.query('第2次写的笔记').length > 0));

    /* 搜索页面交互仍正常 */
    await page.locator('#s-input').fill('第2次写的笔记');
    await page.locator('#s-go').click();
    await page.waitForFunction(() => document.querySelectorAll('.search-item').length > 0);
    check('搜索页 UI 命中个人笔记', (await page.locator('.search-item').first().innerText()).includes('笔记'));

    /* ---- 我的追问回答:进索引 + 深链落到那一轮(阶段7.4) ---- */
    await page.evaluate(() => {
      Store.data.mock.rounds = [{ id: 'r-deeplink-1', ts: Date.now(), items: [{ qid: 'PY-001', title: 'PY-001 题', self: '', revealed: true, mark: '', followups: [{ id: 'f1', q: '追问深链测试?', self: '深链定位用的独特回答内容XYZ', revealed: true }] }] }];
      Store.saveNow(); window.rebuildIndex();
    });
    await page.locator('#s-input').fill('深链定位用的独特回答内容XYZ');
    await page.locator('#s-go').click();
    await page.waitForFunction(() => [...document.querySelectorAll('.search-item')].some(el => el.textContent.includes('我的追问回答')));
    check('搜索命中「我的追问回答」', true);
    await page.locator('.search-item').first().click();
    await page.waitForFunction(() => location.hash.indexOf('t=rounds') >= 0 && !!document.querySelector('.round-details[data-round-id="r-deeplink-1"]'));
    check('深链展开具体那一轮', await page.evaluate(() => document.querySelector('.round-details[data-round-id="r-deeplink-1"]').open));

    /* ---- 性能测量(记录分布,不拿单次最好当结论) ---- */
    const perf = await page.evaluate(() => {
      /* 全量重建 = 构造内容版本变化触发静态层重建(动态重建另有 dynMs) */
      const t0 = performance.now();
      const ctxFull = StudyView.currentCtx(); ctxFull.contentVersion = 'perf-' + Math.random();
      Search.build(ctxFull); const tBuild = performance.now() - t0;
      const times = [];
      for (let i = 0; i < 5; i++) { const t = performance.now(); Search.query('向量检索 嵌入'); times.push(performance.now() - t); }
      times.sort((a, b) => a - b);
      const t1 = performance.now(); Store.setNote('RG-001', '性能测量笔记'); window.rebuildIndex(); const tDyn = performance.now() - t1;
      return { buildMs: Math.round(tBuild * 100) / 100, dynMs: Math.round(tDyn * 100) / 100,
               qMedianMs: Math.round(times[2] * 100) / 100, qMin: Math.round(times[0] * 100) / 100, qMax: Math.round(times[4] * 100) / 100 };
    });
    console.log(`  PERF(349题,本机Chromium):静态重建 ${perf.buildMs}ms · 动态重建 ${perf.dynMs}ms · 查询中位 ${perf.qMedianMs}ms(${perf.qMin}~${perf.qMax})`);
    check('性能量级安全(查询中位 < 50ms,重建 < 500ms)', perf.qMedianMs < 50 && perf.buildMs < 500, JSON.stringify(perf));

    check('全程无页面 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
