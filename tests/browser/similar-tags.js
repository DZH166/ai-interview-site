/* 同标签相似题(Stage7)浏览器验收:关联区出现同标签行、交集判定正确、无标签不出行。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/similar-tags.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9493', BASE = 'http://127.0.0.1:' + PORT;
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
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
      await page.waitForFunction(expected => Store.data.ui.lastHash === expected, hash, { timeout: 60000 });
      if (hash.startsWith('#/study/')) {
        const id = hash.slice('#/study/'.length);
        await page.waitForFunction(qid => Data.isFullQuestion(Data.question(qid)) && document.querySelector('.q-title, .q-title-sm'), id, { timeout: 60000 });
      }
    };

    /* 前置:在页面上下文算出「有同标签候选」的题(测试不写死题号) */
    await open('#/browse');
    check('浏览列表可用且至多加载自动选中详情的一个专题', await page.evaluate(() => {
      const progress = Data.loadProgress();
      return document.querySelectorAll('.q-item[data-qid]').length > 0
        && progress.ready + progress.loading <= 1 && !Data.questionsLoaded();
    }));
    const target = await page.evaluate(() => {
      const qs = Data.allQuestions();
      for (const q of qs) {
        if (!(q.tags || []).length) continue;
        const myTags = new Set((q.tags || []).map(t => String(t).toLowerCase()));
        const exclude = new Set([q.id, ...(q.prerequisites || []), ...(q.related || [])]);
        const hits = qs.filter(c => c && c.id !== q.id && c.topic === q.topic && !exclude.has(c.id)
          && (c.tags || []).some(t => myTags.has(String(t).toLowerCase())));
        if (hits.length >= 3) return { qid: q.id, expect: hits.length };
      }
      return null;
    });
    assert(target, '找不到可验证同标签推荐的目标题');

    await open('#/study/' + target.qid);
    await page.waitForSelector('.rel-box', { timeout: 30000 });
    const sim = await page.evaluate(qid => {
      const row = [...document.querySelectorAll('.rel-row')].find(r => r.textContent.includes('同标签题'));
      if (!row) return null;
      const ids = [...row.querySelectorAll('a.rel-link')].map(a => a.textContent.trim());
      const q = Data.question(qid);
      const myTags = new Set((q.tags || []).map(t => String(t).toLowerCase()));
      const exclude = new Set([q.id, ...(q.prerequisites || []), ...(q.related || [])]);
      const expected = Data.allQuestions().filter(c => c.topic === q.topic && !exclude.has(c.id))
        .map(c => ({ id: c.id, hit: (c.tags || []).filter(t => myTags.has(String(t).toLowerCase())).length }))
        .filter(c => c.hit).sort((a, b) => b.hit - a.hit || (a.id < b.id ? -1 : 1)).slice(0, 3).map(c => c.id);
      return { ids, expected, valid: ids.every(id => {
        const c = Data.question(id);
        return c && c.topic === q.topic && (c.tags || []).some(t => myTags.has(String(t).toLowerCase()));
      }) };
    }, target.qid);
    check('关联区出现「同标签题」行', !!sim);
    check('推荐数量与实际题面排除规则一致且不超过 3 道', sim && sim.ids.length >= 1 && sim.ids.length <= 3
      && JSON.stringify(sim.ids) === JSON.stringify(sim.expected), String(sim && sim.ids.length));
    check('每道推荐与本题同专题且标签有交集', sim && sim.valid);
    check('推荐只使用本专题和完整元数据索引', await page.evaluate(() => Data.loadProgress().ready === 1 && Data.loadProgress().loading === 0));
    check('摘要行含「同标签题」计数', await page.evaluate(() =>
      (document.querySelector('.rel-box summary') || {}).textContent.includes('同标签题')));

    /* 打开推荐第一道:它自己的关联区也能继续链下去(簇状学习可用) */
    await open('#/study/' + sim.ids[0]);
    check('推荐题的学习页正常渲染', await page.evaluate(id =>
      document.querySelector('.q-title, .q-title-sm') && location.hash.endsWith(id), sim.ids[0]));

    /* 无标签题不出「同标签题」行；全题库都有标签时使用当前题的内存夹具。 */
    const noTag = await page.evaluate(() => Data.allQuestions().find(q => !(q.tags || []).length));
    if (noTag) {
      await open('#/study/' + noTag.id);
      const hasRow = await page.evaluate(() =>
        [...document.querySelectorAll('.rel-row')].some(r => r.textContent.includes('同标签题')));
      check('无标签题不出现同标签行', !hasRow);
    } else {
      const hasRow = await page.evaluate(id => {
        Data.question(id).tags = [];
        App.route();
        return [...document.querySelectorAll('.rel-row')].some(r => r.textContent.includes('同标签题'));
      }, sim.ids[0]);
      check('无标签题不出现同标签行(内存夹具)', !hasRow);
    }

    check('全程无 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
