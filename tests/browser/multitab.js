/* 多标签页并发验收:同一上下文开两个标签页,一页写、另一页按合并规则收敛,
   互不整份覆盖;维护页显示存储健康度。 */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8959', BASE = 'http://127.0.0.1:' + PORT;
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
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    /* 同一 context 的两个 page 共享 localStorage(相当于同源的两个标签页) */
    const pageA = await context.newPage(), pageB = await context.newPage();
    const errors = [];
    pageA.on('pageerror', e => errors.push('A:' + e.message));
    pageB.on('pageerror', e => errors.push('B:' + e.message));

    await pageA.goto(BASE + '/index.html#/home');
    await pageA.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
    await pageB.goto(BASE + '/index.html#/home');
    await pageB.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));

    /* A 页写笔记 → B 页自动合并(不等刷新) */
    await pageA.evaluate(() => { Store.setNote('PY-001', 'A 页写的笔记'); Store.saveNow(); });
    await pageB.waitForFunction(() => typeof Store !== 'undefined' && Store.rec('PY-001').note === 'A 页写的笔记', null, { timeout: 8000 })
      .catch(() => {});
    check('A 页写入后,B 页内存自动合并', await pageB.evaluate(() => Store.rec('PY-001').note === 'A 页写的笔记'));
    check('B 页弹出「已合并另一个标签页的修改」提示',
      await pageB.evaluate(() => (document.querySelector('#toast-box') || {}).textContent !== undefined
        && document.querySelector('#toast-box').textContent.includes('已合并另一个标签页的修改')));

    /* B 页写另一题 → A 页自动合并 */
    await pageB.evaluate(() => { Store.setNote('RG-001', 'B 页写的笔记'); Store.saveNow(); });
    await pageA.waitForFunction(() => Store.rec('RG-001').note === 'B 页写的笔记', null, { timeout: 8000 }).catch(() => {});
    check('B 页写入后,A 页内存自动合并', await pageA.evaluate(() => Store.rec('RG-001').note === 'B 页写的笔记'));

    /* 同一题双写冲突:逐记录 _updatedAt 新者胜,两页收敛到同一值 */
    await pageA.evaluate(() => { Store.setNote('LP-001', 'A 先写'); Store.saveNow(); });
    await pageB.waitForFunction(() => Store.rec('LP-001').note === 'A 先写', null, { timeout: 8000 }).catch(() => {});
    await pageB.evaluate(() => { Store.setNote('LP-001', 'B 后写'); Store.saveNow(); });
    await pageA.waitForFunction(() => Store.rec('LP-001').note === 'B 后写', null, { timeout: 8000 }).catch(() => {});
    check('冲突收敛:B 后写,两页都是 B 的值',
      await pageA.evaluate(() => Store.rec('LP-001').note) === 'B 后写'
      && await pageB.evaluate(() => Store.rec('LP-001').note) === 'B 后写');
    await pageA.evaluate(() => { Store.setNote('LP-001', 'A 再写'); Store.saveNow(); });
    await pageB.waitForFunction(() => Store.rec('LP-001').note === 'A 再写', null, { timeout: 8000 }).catch(() => {});
    check('冲突收敛:A 再写,两页都是 A 的值',
      await pageA.evaluate(() => Store.rec('LP-001').note) === 'A 再写'
      && await pageB.evaluate(() => Store.rec('LP-001').note) === 'A 再写');

    /* 磁盘与两页内存一致 */
    check('三份数据(磁盘/A/B)最终一致', await pageA.evaluate(() => {
      const disk = JSON.parse(localStorage.getItem('aiiv:records'));
      return disk.questions['LP-001'].note === Store.rec('LP-001').note;
    }));

    /* 维护页显示存储健康度 */
    await pageA.goto(BASE + '/index.html#/maintain');
    await pageA.waitForFunction(() => document.querySelector('#st-size'));
    const sizeText = await pageA.evaluate(() => document.querySelector('#st-size').textContent);
    check('维护页显示个人记录占用', /KB/.test(sizeText), sizeText);

    check('全程无页面 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
