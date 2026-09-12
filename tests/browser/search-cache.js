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

    const first = await page.evaluate(() => Search.stats());
    check('真数据完成首次构建(349 题)', first.staticUnits > 300 && first.staticBuilds === 1, JSON.stringify(first));

    /* 连续个人写入:静态层构建次数不变 */
    for (let i = 0; i < 3; i++) {
      await page.evaluate(i2 => { Store.setNote('PY-001', '第' + i2 + '次写的笔记'); window.rebuildIndex(); }, i);
    }
    const after = await page.evaluate(() => Search.stats());
    check('三次个人写入后静态层仍只构建一次', after.staticBuilds === 1, JSON.stringify(after));
    check('新笔记可检索', await page.evaluate(() => Search.query('第2次写的笔记').length > 0));

    /* 搜索页面交互仍正常 */
    await page.locator('#s-input').fill('第2次写的笔记');
    await page.locator('#s-go').click();
    await page.waitForFunction(() => document.querySelectorAll('.search-item').length > 0);
    check('搜索页 UI 命中个人笔记', (await page.locator('.search-item').first().innerText()).includes('笔记'));

    check('全程无页面 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
