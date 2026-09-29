/* Released null-snapshot records: load, real history/export, preview/import and new practice. */
'use strict';
const assert = require('assert'), path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9530', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
function check(name, value) { assert(value, name); passed++; console.log('PASS ' + name); }
const missing = '未保存历史题面；下面如有参考来自当前题库。';
const legacy = { v: 3, questions: { 'AGQ-0166': { note: 'LEGACY_NOTE' } }, resetEpoch: 0, resetTs: 0,
  mock: { rounds: [{ id: 'legacy-null-round', sessionId: 'legacy-null-session', ts: 100,
    items: [{ qid: 'AGQ-0166', title: 'AGQ-0166', self: 'LEGACY_PERSONAL_ANSWER', mark: '',
      revealed: false, qRev: '', ms: 0, questionSnapshot: null, snapshotCapturedLate: false,
      followups: [{ id: 'old', q: '原追问', self: 'LEGACY_FOLLOWUP', revealed: false, legacy: false }] }] }],
    draft: null, ended: { 'legacy-null-session': { status: 'completed', ts: 100 } } }, drillAttempts: {}, ui: {} };

(async () => {
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const errors = [];
    async function fresh() {
      const context = await browser.newContext({ serviceWorkers: 'block' }), page = await context.newPage();
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(BASE + '/index.html#/mock'); await page.waitForSelector('#m-start');
      return page;
    }
    const page = await fresh();
    await page.evaluate(records => localStorage.setItem('aiiv:records', JSON.stringify(records)), legacy);
    await page.reload(); await page.waitForSelector('#m-start');
    check('local startup preserves old answers and normalizes only the historical null field', await page.evaluate(() => {
      const item = Store.data.mock.rounds[0].items[0];
      return !Object.hasOwn(item, 'questionSnapshot') && item.self === 'LEGACY_PERSONAL_ANSWER'
        && item.followups[0].self === 'LEGACY_FOLLOWUP' && Store.rec('AGQ-0166').note === 'LEGACY_NOTE';
    }));
    await page.evaluate(() => { location.hash = '#/review?t=rounds'; });
    await page.waitForSelector('.round-details');
    const history = await page.locator('.round-details').first().innerText();
    check('history explicitly reports the missing historical question while retaining personal text',
      [missing, 'LEGACY_PERSONAL_ANSWER', 'LEGACY_FOLLOWUP'].every(text => history.includes(text)));
    await page.locator('[data-card-round="0"]').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 Markdown', exact: true }).click()]);
    let downloaded = ''; for await (const chunk of await download.createReadStream()) downloaded += chunk.toString('utf8');
    check('real expression-card download keeps the missing-snapshot notice and both personal answers',
      [missing, 'LEGACY_PERSONAL_ANSWER', 'LEGACY_FOLLOWUP'].every(text => downloaded.includes(text)));
    const imported = await fresh();
    const preview = await imported.evaluate(records => {
      const text = JSON.stringify({ type: 'aiiv-records', v: 2, records });
      const before = localStorage.getItem('aiiv:records'), memory = JSON.stringify(Store.data);
      const result = Store.previewRecordsMerge(text);
      return { ok: result.ok, rounds: result.summary.roundsAdded,
        unchanged: before === localStorage.getItem('aiiv:records') && memory === JSON.stringify(Store.data) };
    }, legacy);
    check('browser restore preview accepts the released sentinel without modifying disk or memory', preview.ok && preview.rounds === 1 && preview.unchanged);
    await imported.evaluate(records => Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records })), legacy);
    await imported.reload(); await imported.waitForSelector('#m-start');
    check('imported record survives refresh without an invented snapshot', await imported.evaluate(() => Store.data.mock.rounds.length === 1
      && !Object.hasOwn(Store.data.mock.rounds[0].items[0], 'questionSnapshot') && Store.validateRecordsObj(Store.data).length === 0));
    await imported.evaluate(() => MockView.startDirected(['AG-001'], '旧记录兼容后继续练习'));
    await imported.waitForSelector('#m-self');
    await imported.locator('#m-self').fill('NEW_PRACTICE_AFTER_LEGACY_IMPORT');
    await imported.locator('#m-finish').click(); await imported.waitForSelector('.round-list');
    const afterPractice = await imported.evaluate(() => Store.data.mock.rounds);
    assert.strictEqual(afterPractice.length, 2, JSON.stringify(afterPractice));
    assert.strictEqual(afterPractice[0].items[0].self, 'NEW_PRACTICE_AFTER_LEGACY_IMPORT', JSON.stringify(afterPractice));
    check('a historical null no longer blocks starting and finishing new practice', afterPractice.some(round => round.sessionId === 'legacy-null-session'
      && round.items[0].self === 'LEGACY_PERSONAL_ANSWER'));
    check('compatibility flow has no page exceptions', errors.length === 0);
    await imported.context().close(); await page.context().close();
  } finally { if (browser) await browser.close(); server.kill(); }
  console.log(`\n结果: ${passed} 通过, 0 失败`);
})().catch(error => { console.error(error); process.exitCode = 1; });
