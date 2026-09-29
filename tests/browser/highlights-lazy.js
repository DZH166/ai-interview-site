/* 重点标注拆出同步壳(Stage4)浏览器验收:惰性装载/学习页着色/离线可用。
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
  const hl = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/highlights.json'), 'utf8'));
  const qid = Object.keys(hl.highlights)[0];
  assert(qid, '构建产物里没有任何重点标注');
  const spanCount = hl.highlights[qid].spans.length;

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

    /* ---- 壳不携带 highlights(静态验证:本地 fetch 毫秒级,页面侧有装载竞态) ---- */
    check('同步壳不含 highlights(data.js 静态检查)', !/"highlights"\s*:/.test(fs.readFileSync(path.join(ROOT, 'app/data.js'), 'utf8')));
    await page.goto(BASE + '/index.html#/home');
    await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    await page.waitForFunction(() => typeof Data !== 'undefined' && Data.highlightsLoaded(), null, { timeout: 60000 });
    check('惰性装载完成且题量达标', await page.evaluate(n => {
      const h = window.APP_DATA.highlights || {};
      return Object.keys(h).length >= n;
    }, 300));
    check('装载入口幂等(highlightsReady 复用同一 Promise)', await page.evaluate(() =>
      Data.highlightsReady() === Data.highlightsReady()));

    /* ---- 学习页正文着色(等 bankReady 的门控生效) ---- */
    await page.goto(BASE + '/index.html#/study/' + qid);
    await page.waitForSelector('.q-secs .hl-key, .q-secs .hl-term, .q-secs .hl-warn, .study-wrap .hl-key, .study-wrap .hl-term', { timeout: 60000 });
    const marks = await page.evaluate(() => document.querySelectorAll('.hl-key, .hl-term, .hl-warn').length);
    check('学习页正文有着色标记(≥1)', marks >= 1, 'marks=' + marks);

    /* ---- 离线:SW 预缓存兜住 highlights.json,学习页仍着色 ---- */
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 }).catch(() => {});
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
    await context.setOffline(true);
    await page.goto(BASE + '/index.html#/study/' + qid);
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
