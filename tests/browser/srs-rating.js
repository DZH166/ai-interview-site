/* SRS 四档评分 + 顽固弱点(Stage3)浏览器验收。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/srs-rating.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9475', BASE = 'http://127.0.0.1:' + PORT;
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
    const now = Date.now();
    const reseed = async () => {
      await page.goto(BASE + '/__seed__');
      await page.evaluate(ts => {
        /* PY-001:已到期的基本掌握;LP-001:手动队列;RG-001:顽固弱点(lapses 5) */
        localStorage.setItem('aiiv:records', JSON.stringify({
          v: 3,
          questions: {
            'PY-001': { status: 'ok', srs: { due: ts - 3600000, ivl: 1, ease: 2.5, streak: 1, lapses: 0, lastAt: ts - 86400000, lastRating: 'good' } },
            'LP-001': { status: 'weak' },
            'RG-001': { status: 'weak', srs: { due: ts - 7200000, ivl: 0, ease: 1.3, streak: 0, lapses: 5, lastAt: ts - 3600000, lastRating: 'again' } }
          },
          mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {}
        }));
      }, now);
    };
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
      // Review uses the complete metadata index; it must not eagerly fetch every topic.
      await page.waitForFunction(() => typeof Data !== 'undefined' && Data.allQuestions().length > 0, null, { timeout: 60000 });
    };

    /* ---- 到期建议卡四档按钮 ---- */
    await reseed();
    await open('#/review');
    await page.waitForSelector('[data-due-ok="PY-001"]', { timeout: 30000 });
    check('到期卡出现四档按钮', await page.evaluate(() => {
      const item = document.querySelector('[data-due-ok="PY-001"]').closest('.review-item');
      return !!item.querySelector('[data-due-again]') && !!item.querySelector('[data-due-hard]') && !!item.querySelector('[data-due-ok]') && !!item.querySelector('[data-due-easy]');
    }));
    check('顽固弱点题带 ⚠ 徽标', await page.evaluate(() => {
      const badges = [...document.querySelectorAll('.review-item')].some(el => el.textContent.includes('顽固弱点'));
      return badges;
    }));

    /* 很熟练:状态保持 ok,lastRating=easy,due 大幅后移,且仍可被建议(ok+easy 合法) */
    const dueBefore = await page.evaluate(() => Store.rec('PY-001').srs.due);
    await page.locator('[data-due-easy="PY-001"]').click();
    await page.waitForFunction(() => Store.rec('PY-001').srs && Store.rec('PY-001').srs.lastRating === 'easy');
    const easy = await page.evaluate(() => ({ status: Store.rec('PY-001').status, srs: Store.rec('PY-001').srs }));
    check('很熟练:状态保持「基本掌握」', easy.status === 'ok');
    check('很熟练:排期记 easy 且到期大幅后移', easy.srs.due > dueBefore && easy.srs.due > Date.now());
    check('很熟练:ok+easy 组合仍是合法建议(suggestable)', await page.evaluate(ts =>
      SRS.suggestable(Store.rec('PY-001'), ts + 10 * 86400000) === true, now));

    /* 需巩固:状态转 review */
    await reseed();
    await open('#/review');
    await page.waitForSelector('[data-due-hard="PY-001"]', { timeout: 30000 });
    await page.locator('[data-due-hard="PY-001"]').click();
    await page.waitForFunction(() => Store.rec('PY-001').status === 'review');
    check('需巩固:状态转「待复习」+ lastRating=hard', await page.evaluate(() =>
      Store.rec('PY-001').srs.lastRating === 'hard'));

    /* 顽固弱点拆解重练:定向会话 */
    await reseed();
    await open('#/review');
    await page.waitForSelector('[data-leech-drill="RG-001"]', { timeout: 30000 });
    await page.locator('[data-leech-drill="RG-001"]').click();
    await page.waitForFunction(() => /^#\/mock\/run/.test(location.hash), null, { timeout: 30000 });
    await page.waitForFunction(() => document.querySelector('.mock-run') && document.querySelector('#m-self'), null, { timeout: 60000 });
    check('拆解重练:开成「顽固弱点重练」定向会话', await page.evaluate(() =>
      (Store.data.mock.draft || {}).label === '顽固弱点重练' && Store.data.mock.draft.items.length === 1));

    /* 学习页顽固弱点提示 */
    await reseed();
    await open('#/study/RG-001');
    await page.waitForSelector('#leech-drill', { timeout: 30000 });
    check('学习页:顽固弱点提示卡出现', await page.evaluate(() => document.querySelector('#view').innerText.includes('顽固弱点')));
    check('学习页:提示含遗忘次数', await page.evaluate(() => document.querySelector('#view').innerText.includes('5')));

    /* 错题本:leech 徽标 + 拆解按钮;错题本数据源是 mock 轮次的 weak 标记,补一轮 */
    await reseed();
    await page.evaluate(ts => {
      const rec = JSON.parse(localStorage.getItem('aiiv:records'));
      rec.mock.rounds = [{ id: 'r-leech-1', ts, sessionId: 'ms-leech', config: { topics: [], diffs: [], count: 1 },
        items: [{ qid: 'RG-001', title: '顽固弱点题', self: '答了一半', revealed: true, mark: 'weak', followups: [] }] }];
      localStorage.setItem('aiiv:records', JSON.stringify(rec));
    }, now);
    await open('#/review?t=mistakes');
    await page.waitForSelector('.review-item', { timeout: 30000 });
    check('错题本:顽固弱点题有徽标与拆解按钮', await page.evaluate(() => {
      const items = [...document.querySelectorAll('.review-item')];
      const leechItem = items.find(el => el.textContent.includes('RG-001'));
      return !!leechItem && leechItem.textContent.includes('顽固弱点') && !!leechItem.querySelector('[data-leech-drill]');
    }));

    check('全程无 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
