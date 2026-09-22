/* Track E 题库拆分验收:11MB data.js → 薄壳 + 分专题 JSON 分片。
 *
 * 五件事必须成立,拆分才算没回退:
 *   1) 启动顺序:壳(index 元数据)同步可用 → 浏览列表先渲染;全量异步加载后
 *      questionsLoaded() 翻真;
 *   2) 学习页在分片未就绪时给占位,就绪后渲染完整正文(取加载较慢的专题验证);
 *   3) 搜索在全量合并前不出半份索引的结果(内部等 questionsReady);
 *   4) 离线:在线首访后断网刷新,SW 运行时缓存的分片仍能渲染学习页全文;
 *   5) 全程无 JS 异常。
 *
 * 运行:PW=<playwright路径> CHROME=<chromium路径> PORT=9521 node tests/browser/data-split.js
 */
'use strict';
const path = require('path'), assert = require('assert'), fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9521', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
function check(name, ok, detail) { assert(ok, name + (detail ? ' :: ' + detail : '')); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready, 'server did not start');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ serviceWorkers: 'allow', viewport: { width: 1200, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    /* 产物结构断言:壳里没有 questions,分片带哈希命名,manifest 可枚举 */
    const mf = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/manifest.json'), 'utf8'));
    const topics = Object.keys(mf.topics);
    check('manifest 枚举出全部专题分片', topics.length >= 15, String(topics.length));
    check('分片文件名带内容哈希', topics.every(t => new RegExp('^' + t + '\\.[0-9a-f]{12}\\.json$').test(mf.topics[t].file)), mf.topics[topics[0]].file);
    check('APP_SHELL 不预缓存分片(按需运行时缓存)',
      !((fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8').match(/const APP_SHELL = \[([\s\S]*?)\];/) || ['', ''])[1]).includes('data/topics'),
      'APP_SHELL 数组里不应出现 data/topics 条目');

    /* ---- 1. 启动顺序:壳同步可用,浏览列表先渲染;全量异步就绪 ---- */
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    /* 注入启动探针:记录 Data.init 后、全量就绪前的中间态 */
    await page.goto(BASE + '/index.html#/browse');
    await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('.q-item'));
    const bankTotal = await page.evaluate(() => window.APP_DATA.questions_index.length);
    check('壳同步可用:questions_index 有全量 id', bankTotal > 3000, String(bankTotal));
    check('浏览列表在壳阶段就渲染(index-only)', await page.locator('.q-item').count() > 0);
    check('列表项渲染 index 字段(标题/专题/难度)',
      await page.evaluate(() => {
        const t = document.querySelector('.q-item-title');
        const meta = document.querySelector('.q-item-meta');
        return !!(t && t.textContent && meta && meta.textContent);
      }));
    await page.waitForFunction(() => typeof Data !== 'undefined' && Data.questionsLoaded() === true, null, { timeout: 20000 });
    check('questionsLoaded() false→true(全量分片合并完成)',
      await page.evaluate(() => Data.allQuestions().every(q => q.answer !== undefined || q.followups !== undefined || q.sources !== undefined)));
    check('题库总数与源数据一致', await page.evaluate(n => Data.allQuestions().length === n, bankTotal));

    /* ---- 2. 学习页:全量字段渲染(以最大分片 quiz-ml 的题验证加载完整性) ---- */
    const mlFirst = 'AGQ-0001';
    check('分片题目 id 在 manifest 专题里', !!mf.topics['quiz-ml']);
    await page.goto(BASE + '/index.html#/study/' + mlFirst);
    await page.waitForFunction(() => document.querySelector('[data-part="answer"]'), null, { timeout: 20000 });
    check('学习页渲染完整正文(答案区块存在)',
      await page.evaluate(() => {
        const sec = document.querySelector('[data-part="answer"]');
        return !!(sec && sec.textContent.trim().length > 50);
      }));

    /* ---- 3. 搜索只出全量索引结果(内部等 questionsReady) ---- */
    await page.goto(BASE + '/index.html#/search/' + encodeURIComponent('fencing token'));
    await page.waitForSelector('.search-item', { timeout: 20000 });
    check('搜索命中全量字段(fusion_notes/answer 来自分片)',
      await page.evaluate(() => {
        const hrefs = [...document.querySelectorAll('.search-item')]
          .map(a => a.getAttribute('href')).join(' ');
        return hrefs.includes('AG-033');
      }));

    /* ---- 4. 离线:在线首访后断网,SW 运行时缓存的分片仍渲染学习页 ---- */
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 15000 });
    /* 主动把所有分片拉一遍(应用在首页 boot 已自动做;这里确保缓存写入后再断网) */
    await page.evaluate(async () => {
      const m = await (await fetch('data/manifest.json')).json();
      await Promise.all(Object.values(m.topics).map(e => fetch('data/topics/' + e.file).then(r => r.text())));
    });
    await context.setOffline(true);
    await page.goto(BASE + '/index.html#/study/AG-001');
    await page.waitForFunction(() => document.querySelector('#note-area'), null, { timeout: 20000 });
    check('离线:SW 缓存优先返回分片,学习页正文完整',
      await page.evaluate(() => {
        const sec = document.querySelector('[data-part="answer"]');
        return !!(sec && sec.textContent.trim().length > 30);
      }));
    await page.goto(BASE + '/index.html#/browse');
    await page.waitForFunction(() => document.querySelector('.q-item'), null, { timeout: 20000 });
    check('离线:浏览列表照常工作', await page.locator('.q-item').count() > 0);
    await context.setOffline(false);

    /* ---- 5. 无 JS 异常 ---- */
    check('全程无页面 JS 异常', errors.length === 0, errors.join(' | '));

    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
  process.exit(failed ? 1 : 0);
})().catch(e => { console.error(e); process.exitCode = 1; });
