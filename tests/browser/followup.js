/* 追问二跳的浏览器验收:对照参考后出现追问、先写后看、
   草稿刷新可恢复、完成轮次带追问记录、表达卡含追问练习。 */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8958', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok, detail) { assert(ok, name + (detail ? ' :: ' + detail : '')); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
}

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));

    /* 开始一轮自测 */
    await open(page, '#/mock');
    await page.locator('#m-start').click();
    await page.waitForFunction(() => document.querySelector('#m-self'));
    const firstQid = await page.evaluate(() => Store.data.mock.draft.items[0].qid);
    const fuCount = await page.evaluate(qid => Data.question(qid).followups.length, firstQid);
    check('题目有追问可用(题库校验保证非空)', fuCount >= 1, String(fuCount));

    /* 对照参考要点后,追问二跳出现;未对照前不出现 */
    check('未对照前没有追问区', await page.locator('#mock-fu-list').count() === 0);
    await page.locator('#m-reveal').click();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list'));
    check('对照后出现追问二跳区', (await page.locator('#mock-fu-list .fu').count()) === fuCount);

    /* 先写后看:追问参考默认不显示;写回答 → 对照 → 参考出现 */
    check('追问参考默认不显示', await page.locator('#mock-fu-list .fu-a').count() === 0);
    await page.locator('[data-fu-self="0"]').fill('我的追问回答:先说结论');
    await page.locator('[data-fu-reveal="0"]').click();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list .fu-a'));
    check('对照后该追问参考显示', await page.locator('#mock-fu-list .fu-a').count() === 1);
    check('回答进入会话草稿', await page.evaluate(() => {
      const qid = Store.data.mock.draft.items[Store.data.mock.draft.idx].qid;
      return ((Store.data.mock.draft.answers[qid].fu || {})[0] || {}).self === '我的追问回答:先说结论';
    }));

    /* 刷新:#/mock/run 上的草稿自动恢复进 run 视图,追问回答与揭示状态都在 */
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#m-self'));
    check('刷新后追问回答保留', await page.locator('[data-fu-self="0"]').inputValue() === '我的追问回答:先说结论');
    check('刷新后已对照的追问保持揭示', await page.locator('#mock-fu-list .fu-a').count() === 1);

    /* 完成本轮(第 1 题就结束:结束本轮同样收尾入历史);轮次记录带追问;表达卡含追问练习 */
    await page.locator('#m-self').fill('我的主回答');
    await page.locator('#m-quit').click();
    await page.waitForFunction(() => document.querySelector('.round-list'));
    const roundHasFu = await page.evaluate(() => {
      const rd = Store.data.mock.rounds[0];
      const it = (rd.items || []).find(x => x.followups && x.followups.length);
      return it && it.qid === Store.data.mock.rounds[0].items[0].qid;
    });
    check('完成轮次的题目记录带追问(只留真实写过的)', roundHasFu);
    const card = await page.evaluate(() => {
      const r = buildExpressCard('round', 0);
      return r && r.ok ? r.markdown : ('ERR:' + (r && r.error));
    });
    check('表达卡含「追问练习」一节', card.includes('### 追问练习'), card.slice(0, 200));
    check('表达卡带追问原文', card.includes('我的追问回答:先说结论'));

    /* 复习中心历史:轮次详情能看到追问 */
    await open(page, '#/review');
    await page.locator('[data-tab="rounds"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.round-details').length > 0);

    check('全程无页面 JS 异常', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
