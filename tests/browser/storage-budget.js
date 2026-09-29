/* 存储预算条(Stage11)浏览器验收:占比回填/阈值配色/预警文案。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/storage-budget.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9499', BASE = 'http://127.0.0.1:' + PORT;
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
    };

    /* 小数据:低占比,绿色,无预警 */
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    await open('#/maintain');
    await page.waitForSelector('#st-budget-fill', { timeout: 30000 });
    check('预算条渲染且低占比', await page.evaluate(() => {
      const w = parseFloat(document.getElementById('st-budget-fill').style.width);
      return w >= 1.5 && w < 20;
    }));
    check('低占比无红色预警', await page.evaluate(() =>
      !document.getElementById('st-budget-fill').classList.contains('st-budget-danger')));
    check('低占比文案无预警词', await page.evaluate(() =>
      !(document.getElementById('st-budget-text').textContent || '').includes('接近上限')));
    check('明确参考字符预算不等于浏览器实际配额', await page.evaluate(() =>
      document.getElementById('st-budget-text').textContent.includes('不是浏览器配额')
      && document.getElementById('st-size').textContent.includes('不是字节数')));

    /* 大数据:构造 ~85% 预算的记录,转红 + 预警文案 */
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => {
      const note = 'X'.repeat(60000);   /* 6 万 UTF-16 单元/题 × 75 题；不称为 4.4MB。 */
      const questions = {};
      for (let i = 1; i <= 75; i++) {
        const id = 'PY-' + String(i).padStart(3, '0');
        questions[id] = { status: 'ok', note };
      }
      localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} }));
    });
    await open('#/maintain');
    await page.waitForSelector('#st-budget-fill', { timeout: 30000 });
    check('高占比正确回填(≥80%)', await page.evaluate(() =>
      parseFloat(document.getElementById('st-budget-fill').style.width) >= 80));
    check('高占比转红', await page.evaluate(() =>
      document.getElementById('st-budget-fill').classList.contains('st-budget-danger')));
    check('预警文案给行动建议(先备份再清理)', await page.evaluate(() =>
      (document.getElementById('st-budget-text').textContent || '').includes('导出个人记录')));

    check('全程无 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
