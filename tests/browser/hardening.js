/* 阶段6 加固验收:CSP 生效且无违规、SW 注册仍工作(脚本已移出内联)、
   Anki CSV 从首页真实下载。 */
'use strict';
const path = require('path'), assert = require('assert'), fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8962', BASE = 'http://127.0.0.1:' + PORT;
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
    const page = await context.newPage();
    const errors = [], cspViolations = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && /Content Security Policy|CSP/i.test(m.text())) cspViolations.push(m.text()); });

    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => {
      localStorage.setItem('aiiv:records', JSON.stringify({
        v: 3,
        questions: { 'PY-001': { status: 'weak' }, 'RG-001': { status: 'review' } },
        mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {}
      }));
    });

    await page.goto(BASE + '/index.html#/home');
    await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
    check('index.html 带 CSP meta', await page.evaluate(() => !!document.querySelector('meta[http-equiv="Content-Security-Policy"]')));
    check('待攻克卡出现 Anki 出口按钮', await page.locator('#d-card-anki').count() === 1);

    /* 真实下载:Anki CSV(先弹契约 modal,再点「下载 CSV」) */
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 15000 }),
      (async () => {
        await page.locator('#d-card-anki').click();
        await page.waitForFunction(() => document.querySelector('.modal'));
        check('契约 modal 含字段映射与更新说明',
          (await page.evaluate(() => document.querySelector('.modal-body').textContent))
            .includes('首字段题号匹配'));
        await page.locator('.modal .btn-primary').click();
      })()
    ]);
    check('Anki CSV 触发真实下载', download.suggestedFilename().endsWith('.csv'), download.suggestedFilename());
    const tmp = path.join(require('os').tmpdir(), download.suggestedFilename());
    await download.saveAs(tmp);
    const csv = fs.readFileSync(tmp, 'utf8');
    check('CSV 含指令头(首字段更新映射)与两道题',
      csv.includes('#separator:Comma') && !csv.includes('#guid') && csv.includes('#columns:题号,正面,背面')
      && csv.includes('"PY-001","<b>') && csv.includes('"RG-001","<b>'), csv.slice(0, 160));

    /* 内联 SW 注册脚本移除后,app.js 的注册逻辑仍要在 https/localhost 生效 */
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload();
    await page.waitForFunction(() => !!navigator.serviceWorker.controller);
    await context.setOffline(true);
    await page.goto(BASE + '/index.html#/study/LC-003');
    await page.waitForFunction(() => typeof Data !== 'undefined' && document.querySelector('[data-question-prompt="LC-003"]'));
    check('SW 实际控制页面并在断网后加载题库与学习页', await page.evaluate(() => Data.allQuestions().length === 3646 && typeof SRS !== 'undefined'));
    await context.setOffline(false);
    check('index.html 不再含内联脚本', !fs.readFileSync(path.join(ROOT, 'app/index.html'), 'utf8').match(/<script>(?!\s*<\/)/));

    check('全程无 CSP 违规', cspViolations.length === 0, cspViolations.join(' | '));
    check('全程无页面 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
