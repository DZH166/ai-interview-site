/* Track A 浏览器验收:模拟面试计时 + 轮次趋势条。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/mock-timer.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9731', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
const check = (n, ok, d) => { assert(ok, n + (d ? ' :: ' + d : '')); passed++; console.log('  PASS', n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

/* 构造种子轮次:1 轮带 ms 数据(全 weak)+ 2 轮旧格式(无 durationMs/ms)。
   颜色断言依赖已知 weak 率:alpha = 0.15 + weakRate * 0.7。 */
function seedRounds(now) {
  const mk = (qid, mark, ms) => Object.assign({ qid, title: '题 ' + qid, self: '答', revealed: true, mark, followups: [] }, ms !== undefined ? { ms } : {});
  const withMs = {   /* 2/2 weak → alpha 0.85;平均每题 (4000+8000)/2/1000 = 6s */
    ts: now - 1000, sessionId: 'ms-test-a',
    durationMs: 12000,
    items: [mk('AG-001', 'weak', 4000), mk('AG-002', 'weak', 8000)]
  };
  const legacyHalf = {   /* 1/2 weak → alpha 0.5;无 ms → 平均每题 '—' */
    ts: now - 2000, sessionId: 'ms-test-b',
    items: [mk('DL-001', 'weak'), mk('DL-002', '')]
  };
  const legacyNone = {   /* 0 weak → alpha 0.15 */
    ts: now - 3000, sessionId: 'ms-test-c',
    items: [mk('PY-001', 'ok'), mk('PY-002', 'ok')]
  };
  return [withMs, legacyHalf, legacyNone];
}

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
    /* 每次「重新播种再打开」都从 __seed__ 中转:应用页 pagehide 会 flush 落盘,
       在应用页里直接改 localStorage 会被 saveNow 写回覆盖——必须经种子页绕开 */
    const reseed = async records => {
      await page.goto(BASE + '/__seed__');
      await page.evaluate(r => localStorage.setItem('aiiv:records', JSON.stringify(r)), records);
    };
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    };

    /* ---------- 场景 1:种子 3 轮(1 新 + 2 旧)→ 趋势条渲染与颜色/hover ---------- */
    await reseed({ v: 3, questions: {}, mock: { rounds: seedRounds(Date.now()), draft: null, ended: {} }, drillAttempts: {}, ui: {} });
    await open('#/review?t=rounds');
    check('模拟面试历史渲染 3 轮', await page.locator('.round-details').count() === 3);
    check('趋势条渲染 3 格(≥2 轮才显示)', await page.locator('.round-trend-cell').count() === 3);
    const cells = await page.$$eval('.round-trend-cell', els => els.map(e => ({
      bg: (e.getAttribute('style') || ''), title: e.getAttribute('title') || ''
    })));
    /* 左旧右新:旧→新 = legacyNone(0.15)→ legacyHalf(0.5)→ withMs(0.85) */
    check('趋势条从左到右按 weak 率着色', cells[0].bg.includes('0.15') && cells[1].bg.includes('0.5') && cells[2].bg.includes('0.85'),
      JSON.stringify(cells.map(c => c.bg)));
    check('带 ms 的轮次 hover 显示平均每题秒数', /平均每题 6\.0s/.test(cells[2].title), cells[2].title);
    check('hover 显示日期与题数与 weak 数', /题 · weak \d+/.test(cells[2].title) && /题/.test(cells[0].title), JSON.stringify(cells.map(c => c.title)));
    check('旧轮次(无 ms)hover 平均每题显示 —', cells[0].title.includes('平均每题 —') && cells[1].title.includes('平均每题 —'),
      JSON.stringify([cells[0].title, cells[1].title]));
    check('趋势条带图例说明', await page.locator('.round-trend-wrap .small').count() === 1
      && (await page.locator('.round-trend-wrap .small').textContent()).includes('颜色越红'));

    /* ---------- 场景 2:只有 1 轮 → 隐藏趋势条 ---------- */
    await reseed({ v: 3, questions: {}, mock: { rounds: [seedRounds(Date.now())[0]], draft: null, ended: {} }, drillAttempts: {}, ui: {} });
    await open('#/review?t=rounds');
    check('少于 2 轮不渲染趋势条', await page.locator('.round-trend').count() === 0
      && await page.locator('.round-details').count() === 1);

    /* ---------- 场景 3:真实 UI 走一轮 5 题会话,校验计时落盘 ---------- */
    await reseed({ v: 3, questions: {}, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} });
    await open('#/mock');
    await page.selectOption('#m-count', '5');
    await page.click('#m-start');
    await page.waitForSelector('.mock-run', { timeout: 60000 });
    for (let i = 0; i < 5; i++) {
      await page.waitForSelector('#m-self', { timeout: 60000 });
      await page.fill('#m-self', '第 ' + (i + 1) + ' 题我的回答要点');
      await sleep(120);   /* 留一点停留时间,让本题 ms > 0 可断言 */
      const nextBtn = await page.$('#m-next');
      if (nextBtn) { await nextBtn.click(); }
      else { await page.click('#m-finish'); break; }
    }
    await page.waitForFunction(() => location.hash.startsWith('#/mock/done'), null, { timeout: 60000 });
    const round = await page.evaluate(() => JSON.parse(JSON.stringify(Store.data.mock.rounds[0])));
    check('完成的轮次落盘且为最新一条', round && round.items && round.items.length === 5);
    check('轮次记录 durationMs > 0', typeof round.durationMs === 'number' && round.durationMs > 0, 'durationMs=' + round.durationMs);
    check('每题记录 ms 为非负数字且总时长为正', round.items.every(it => typeof it.ms === 'number' && it.ms >= 0)
      && round.items.some(it => it.ms > 0), JSON.stringify(round.items.map(i => i.ms)));
    check('轮次项作答内容已捕获', round.items.every(it => (it.self || '').includes('回答要点')));

    /* ---------- 场景 4:真实会话轮次 + 旧格式轮次 → 趋势条区分新旧数据 ---------- */
    /* 1 轮 < 2 轮趋势条仍隐藏(规格);补种 1 轮旧格式后出现,并验证新数据在条里 */
    await reseed({
      v: 3, questions: {},
      mock: { rounds: [round, { ts: Date.now() - 5000, sessionId: 'ms-test-legacy', items: [{ qid: 'AG-003', title: '旧', self: '', revealed: false, mark: '', followups: [] }] }], draft: null, ended: {} },
      drillAttempts: {}, ui: {}
    });
    await open('#/review?t=rounds');
    check('2 轮后趋势条出现', await page.locator('.round-trend-cell').count() === 2);
    const titles2 = await page.$$eval('.round-trend-cell', els => els.map(e => e.getAttribute('title')));
    check('真实会话轮次的平均每题出现在趋势条', /平均每题 \d+(\.\d+)?s/.test(titles2[1]), JSON.stringify(titles2));
    check('旧格式轮次平均每题显示 —', titles2[0].includes('平均每题 —'), JSON.stringify(titles2));

    check('全程无 JS 异常', errors.length === 0, errors.join('|'));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
