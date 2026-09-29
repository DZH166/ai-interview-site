/* 学习路径多路径(Stage6)浏览器验收:切换/进度隔离/深链兼容。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/path-multi.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9492', BASE = 'http://127.0.0.1:' + PORT;
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
      await page.waitForFunction(expected => Store.data.ui.lastHash === expected && document.querySelector('.path-head h1'), hash, { timeout: 60000 });
    };

    /* 默认路径 = 第一条(旧行为兼容),切换器可见且两枚 */
    await open('#/path');
    check('默认渲染第一条路径(AI 应用开发主线)', await page.evaluate(() =>
      document.querySelector('.path-head h1').textContent.includes('AI 应用开发主线')));
    check('路径切换器出现且有两枚', await page.evaluate(() =>
      document.querySelectorAll('.path-switcher a').length === 2));
    check('路径页面只使用索引，不触发专题下载', await page.evaluate(() => Data.loadProgress().ready === 0 && Data.loadProgress().loading === 0));

    /* 切到算法路径:标题/阶段/题目链接正确 */
    await open('#/path?path=path-algo-1');
    check('深链切换到算法路径', await page.evaluate(() =>
      document.querySelector('.path-head h1').textContent.includes('算法工程师方向')));
    check('算法路径渲染 4 个阶段', await page.evaluate(() =>
      document.querySelectorAll('.path-stage').length === 4));
    const qLinks = await page.evaluate(() => document.querySelectorAll('.path-q').length);
    check('阶段题目链接就位(题号真实)', qLinks >= 60, 'links=' + qLinks);
    check('可选区(CV)渲染', await page.evaluate(() =>
      document.querySelector('#view').innerText.includes('选学')));

    /* 进度隔离:在算法路径确认一个阶段,主路径进度不受影响 */
    await page.locator('.path-stage-actions [data-done]').first().click();
    await page.waitForFunction(() => document.querySelectorAll('.path-done').length === 1);
    check('算法路径:阶段确认成功(1/4)', await page.evaluate(() =>
      document.querySelector('.path-head .muted.small').textContent.includes('1 / 4')));
    await open('#/path');
    check('主路径:进度仍为 0/6(互不串扰)', await page.evaluate(() =>
      document.querySelector('.path-head .muted.small').textContent.includes('0 / 6')));
    await open('#/path?path=path-algo-1');
    check('切回算法路径:完成态保留(进度存 stage id)', await page.evaluate(() =>
      document.querySelector('.path-head .muted.small').textContent.includes('1 / 4')));

    /* 深锚点参数兼容:既有 ?p=(项目)深链仍落到默认路径不炸 */
    await open('#/path?path=path-algo-1&p=nonexistent');
    check('未知深锚点:页面照常渲染', await page.evaluate(() =>
      document.querySelector('.path-head h1').textContent.includes('算法工程师方向')));

    check('全程无 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
