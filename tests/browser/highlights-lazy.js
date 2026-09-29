/* 重点标注随专题按需加载:首页不下载、题面与标注同版本、首次缓存后离线可用。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/highlights-lazy.js */
'use strict';
const path = require('path'), assert = require('assert'), fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9479', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
const check = (n, ok, d) => { assert(ok, n + (d ? ' :: ' + d : '')); passed++; console.log('  PASS', n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  /* 从构建产物挑一道有标注的题(测试不写死题号,题库扩缩都不用改) */
  const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/manifest.json'), 'utf8'));
  const topic = Object.values(manifest.topics).map(entry => ({
    file: entry.file,
    payload: JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/topics', entry.file), 'utf8'))
  })).find(({ payload }) => Object.values(payload.highlights || {}).some(h => h.spans?.length));
  assert(topic, '专题构建产物中没有重点标注');
  const qid = Object.keys(topic.payload.highlights).find(id => topic.payload.highlights[id].spans?.length);
  assert(qid, '构建产物里没有任何重点标注');

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
    const contentRequests = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('request', req => {
      if (/\/data\/(topics\/|highlights\.json)/.test(new URL(req.url()).pathname)) contentRequests.push(req.url());
    });

    /* ---- 壳不携带 highlights(静态验证:本地 fetch 毫秒级,页面侧有装载竞态) ---- */
    check('同步壳不含 highlights(data.js 静态检查)', !/"highlights"\s*:/.test(fs.readFileSync(path.join(ROOT, 'app/data.js'), 'utf8')));
    await page.goto(BASE + '/index.html#/home');
    await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    await page.evaluate(() => navigator.serviceWorker.ready);
    check('首页不自动下载任何专题或全量标注', contentRequests.length === 0, contentRequests.join(', '));
    check('首页标注内存为空', await page.evaluate(() => Object.keys(window.APP_DATA.highlights || {}).length === 0));

    /* ---- 学习页只等待本专题，标注已在同一不可变资产中 ---- */
    await page.goto(BASE + '/index.html#/study/' + qid);
    await page.waitForSelector('.q-secs .hl-key, .q-secs .hl-term, .q-secs .hl-warn, .study-wrap .hl-key, .study-wrap .hl-term', { timeout: 60000 });
    const marks = await page.evaluate(() => document.querySelectorAll('.hl-key, .hl-term, .hl-warn').length);
    check('学习页正文有着色标记(≥1)', marks >= 1, 'marks=' + marks);
    check('只下载目标题所属专题', contentRequests.length === 1 && contentRequests[0].endsWith('/' + topic.file), contentRequests.join(', '));
    check('标注只来自已下载专题', await page.evaluate(n => Object.keys(window.APP_DATA.highlights || {}).length === n,
      Object.keys(topic.payload.highlights).length));
    await page.evaluate(id => Promise.all([Data.highlightsReady(id), Data.highlightsReady(id), Data.bankReady(id)]), qid);
    check('重复调用兼容入口不重复下载', contentRequests.length === 1);
    check('兼容入口就绪范围为当前题', await page.evaluate(id => Data.highlightsLoaded(id) && Data.bankLoaded(id) && !Data.questionsLoaded(), qid));

    /* ---- 首次阅读已落 CacheStorage，断网整页刷新仍着色 ---- */
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
    await context.setOffline(true);
    await page.reload();
    await page.waitForSelector('.hl-key, .hl-term, .hl-warn', { timeout: 60000 });
    check('离线学习页仍有着色', await page.evaluate(() => document.querySelectorAll('.hl-key, .hl-term, .hl-warn').length >= 1));
    check('离线正文完整(题干可读)', await page.evaluate(id => {
      const t = document.querySelector('#view').innerText || '';
      return t.length > 200;
    }, qid));
    await context.setOffline(false);

    check('全程无 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
