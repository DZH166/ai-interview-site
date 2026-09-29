/* Real cross-tab completion and real downloads; retention/import fixtures stay in isolated contexts. */
'use strict';
const assert = require('assert'), path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9554';
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
const check = (name, value) => { assert(value, name); passed++; console.log('PASS ' + name); };

(async () => {
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {}
      await sleep(100);
    }
    assert(ready, 'test server ready');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    const errors = [];
    async function newPage(ctx = context) {
      const page = await ctx.newPage(); page.on('pageerror', e => errors.push(e.message)); return page;
    }
    async function finishRound(page, qid, answer) {
      await page.goto(BASE + '/index.html#/mock'); await page.waitForSelector('#m-start');
      await page.evaluate(id => MockView.startDirected([id], '导出身份回归'), qid);
      await page.waitForSelector('#m-self'); await page.locator('#m-self').fill(answer);
      await page.locator('#m-finish').click(); await page.waitForSelector('#m-card');
      return page.evaluate(() => Store.data.mock.rounds[0]);
    }
    async function downloadCard(page, button) {
      await button.click();
      const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 Markdown', exact: true }).click()]);
      let body = ''; for await (const chunk of await download.createReadStream()) body += chunk.toString('utf8');
      return body;
    }
    async function openHistoryRound(page, id) {
      const round = page.locator('.round-details[data-round-id="' + id + '"]');
      await round.waitFor({ state: 'attached' });
      if (await round.getAttribute('open') === null) await round.locator(':scope > summary').click();
      const button = round.locator('[data-card-round-id="' + id + '"]');
      await button.waitFor({ state: 'visible' });
      return button;
    }
    const A = await newPage(), B = await newPage();
    const first = await finishRound(A, 'AG-001', 'ROUND_A_UNIQUE_ANSWER');
    const second = await finishRound(B, 'PY-001', 'ROUND_B_UNIQUE_ANSWER');
    await A.waitForFunction(id => Store.data.mock.rounds[0].id === id, second.id);
    check('另一页完成后，A 仍显示原完成轮次', (await A.locator('.round-list').textContent()).includes('ROUND_A_UNIQUE_ANSWER')
      && !(await A.locator('.round-list').textContent()).includes('ROUND_B_UNIQUE_ANSWER'));
    const fromDone = await downloadCard(A, A.locator('#m-card'));
    check('完成页实际下载绑定 A 的题面和回答，不串到 B', fromDone.includes(first.items[0].questionSnapshot.title)
      && fromDone.includes('ROUND_A_UNIQUE_ANSWER') && !fromDone.includes('ROUND_B_UNIQUE_ANSWER'));

    const H = await newPage();
    await H.goto(BASE + '/index.html#/review?t=rounds');
    const historyButton = await openHistoryRound(H, first.id);
    const oldPosition = await historyButton.getAttribute('data-card-round');
    await H.locator('#global-search-input').focus();
    const third = await finishRound(B, 'RG-001', 'ROUND_C_UNIQUE_ANSWER');
    await H.waitForFunction(id => Store.data.mock.rounds[0].id === id, third.id);
    check('输入焦点期间历史 DOM 保持旧顺序，内存已收到新轮次', await historyButton.getAttribute('data-card-round') === oldPosition
      && await H.evaluate(() => document.activeElement.id === 'global-search-input'));
    const fromHistory = await downloadCard(H, historyButton);
    check('历史页实际下载也按轮次身份，不按过时下标', fromHistory.includes('ROUND_A_UNIQUE_ANSWER')
      && !fromHistory.includes('ROUND_B_UNIQUE_ANSWER') && !fromHistory.includes('ROUND_C_UNIQUE_ANSWER'));
    check('旧数字索引 API 仍支持“导出最近一轮”', await H.evaluate(() => buildExpressCard('round', 0).markdown.includes('ROUND_C_UNIQUE_ANSWER')));

    // A 保持旧完成页，B 导入合法的新轮次触发真实 MAX_ROUNDS 保留上限。
    await B.evaluate(() => {
      const now = Date.now();
      const rounds = Array.from({ length: Store.MAX_ROUNDS }, (_, i) => ({ id: 'retention-fixture-' + i, ts: now + i,
        items: [{ qid: 'PY-001', title: '保留上限回归', self: 'RETENTION_NEWEST_' + i }] }));
      Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { v: 3, questions: {}, mock: { rounds }, ui: {} } }));
    });
    await A.waitForFunction(id => Store.data.mock.rounds.length > 0 && !Store.data.mock.rounds.some(r => (r.id || Store.roundId(r)) === id), first.id);
    let unexpectedDownload = false; A.on('download', () => { unexpectedDownload = true; });
    await A.locator('#m-card').click();
    await A.waitForFunction(() => [...document.querySelectorAll('.toast')].some(t => t.textContent.includes('这一轮记录已被清理或不存在')));
    check('原轮次被保留上限清理后明确失败，不兜底导出别轮', !unexpectedDownload
      && await A.getByRole('button', { name: '下载 Markdown', exact: true }).count() === 0);

    // 无 id / sessionId 的真实旧形状：从本地旧记录启动，按派生 ID 导出。
    const legacyContext = await browser.newContext({ serviceWorkers: 'block' });
    const L = await newPage(legacyContext);
    await L.goto(BASE + '/__seed__');
    await L.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, ui: {}, drillAttempts: {},
      mock: { rounds: [{ ts: Date.now() - 60000, items: [{ qid: 'AG-001', title: '旧轮次无身份字段', self: 'LEGACY_NO_ID_ANSWER' }] }], draft: null } })));
    await L.goto(BASE + '/index.html#/review?t=rounds'); await L.waitForSelector('[data-card-round-id]', { state: 'attached' });
    const legacyState = await L.evaluate(() => { const r = Store.data.mock.rounds[0]; return { noId: !r.id && !r.sessionId, id: Store.roundId(r) }; });
    check('旧轮次在渲染时未伪造新增身份字段', legacyState.noId);
    const legacyDownload = await downloadCard(L, await openHistoryRound(L, legacyState.id));
    check('缺 id 的旧轮次通过 Store.roundId 派生身份正常下载', legacyDownload.includes('LEGACY_NO_ID_ANSWER'));
    check('全程没有 JS 异常', errors.length === 0);
    await legacyContext.close(); await context.close();
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
