/* 延迟真实分片，验证加载播报、焦点与过期请求；不以源码正则代替用户行为。 */
'use strict';
const path = require('path'), assert = require('assert'), { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9496', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
const check = (name, result) => { assert(result, name); passed++; console.log('PASS ' + name); };
(async () => {
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const errors = [];
    async function delayed(hash, pattern, run, seed) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 850 } });
      const page = await context.newPage(); let release;
      const gate = new Promise(resolve => { release = resolve; });
      page.on('pageerror', e => errors.push(e.message));
      await page.route(pattern, async route => { await gate; await route.continue(); });
      try {
        if (seed) { await page.goto(BASE + '/__seed__'); await page.evaluate(d => localStorage.setItem('aiiv:records', JSON.stringify(d)), seed); }
        await page.goto(BASE + '/index.html' + hash, { waitUntil: 'domcontentloaded' });
        await run(page, release);
      } finally { release(); await context.close(); }
    }
    const topicPattern = '**/data/topics/*.json';
    await delayed('#/study/AG-001', topicPattern, async (page, release) => {
      await page.locator('#view .empty[role="status"]').waitFor();
      check('学习页真实延迟加载可播报', (await page.locator('#view [role="status"]').innerText()).includes('加载中'));
      release(); await page.waitForSelector('#note-area');
      check('学习页正文就绪后焦点落到主内容', await page.evaluate(() => document.activeElement.id === 'view'));
      check('加载焦点不要求下载全部专题', await page.evaluate(() => Data.loadProgress().ready === 1));
    });
    await delayed('#/browse?qid=AG-001', topicPattern, async (page, release) => {
      await page.locator('#q-detail .empty[role="status"]').waitFor();
      check('浏览详情真实延迟加载可播报', (await page.locator('#q-detail [role="status"]').innerText()).includes('加载中'));
      release(); await page.waitForSelector('#q-detail .q-secs');
      check('浏览详情就绪后焦点落到可聚焦详情', await page.evaluate(() => document.activeElement.id === 'q-detail' && document.activeElement.tabIndex === -1));
    });
    await delayed('#/browse?qid=AG-001', topicPattern, async (page, release) => {
      await page.locator('#q-detail .empty[role="status"]').waitFor();
      await page.locator('#f-kw').fill('AG-00');
      await page.waitForFunction(() => Store.data.ui.browse.kw === 'AG-00');
      release(); await page.waitForSelector('#q-detail .q-secs');
      check('浏览详情加载完成保留筛选输入焦点和值', await page.evaluate(() =>
        document.activeElement.id === 'f-kw' && document.getElementById('f-kw').value === 'AG-00'));
      await page.keyboard.type('1');
      check('加载完成后的后续键入仍进入原筛选框', await page.evaluate(() =>
        document.activeElement.id === 'f-kw' && document.getElementById('f-kw').value === 'AG-001'));
      await page.waitForFunction(() => Store.data.ui.browse.kw === 'AG-001');
      check('后续键入仍触发原有筛选保存', await page.locator('#q-list .q-item[data-qid="AG-001"]').count() === 1);
    });
    await delayed('#/browse?qid=AG-001', topicPattern, async (page, release) => {
      await page.locator('#q-detail .empty[role="status"]').waitFor();
      await page.locator('#f-topic').focus();
      release(); await page.waitForSelector('#q-detail .q-secs');
      check('浏览详情加载完成保留专题选择框焦点', await page.evaluate(() => document.activeElement.id === 'f-topic'));
    });
    await delayed('#/mock/run', topicPattern, async (page, release) => {
      await page.locator('#view .empty[role="status"]').waitFor();
      check('恢复草稿的加载状态可播报', (await page.locator('#view [role="status"]').innerText()).includes('加载本题'));
      release(); await page.waitForSelector('#m-self');
      check('恢复草稿就绪后焦点落到主内容', await page.evaluate(() => document.activeElement.id === 'view'));
    }, { v: 3, questions: {}, mock: { rounds: [], draft: { sessionId: 'a11y-loading', savedAt: 1, config: {}, items: [{ qid: 'AG-001' }], idx: 0, answers: {} } }, drillAttempts: {}, ui: {} });
    await delayed('#/docs/doc-path-1', '**/data/assets/docs.*.json', async (page, release) => {
      await page.locator('#doc-main .empty[role="status"]').waitFor();
      check('文档正文真实延迟加载可播报', (await page.locator('#doc-main [role="status"]').innerText()).includes('文档加载中'));
      release(); await page.waitForSelector('#doc-content');
      check('文档就绪后占位被真实正文替换', (await page.locator('#doc-content').innerText()).length > 100 && await page.locator('#doc-main .empty').count() === 0);
    });
    await delayed('#/study/AG-001', topicPattern, async (page, release) => {
      await page.locator('#view .empty[role="status"]').waitFor();
      await page.locator('#global-search-input').fill('保留正在输入的焦点');
      release(); await page.waitForSelector('#note-area');
      check('异步正文不能抢走搜索输入焦点', await page.evaluate(() => document.activeElement.id === 'global-search-input'));
    });
    await delayed('#/study/AG-001', topicPattern, async (page, release) => {
      await page.locator('#view .empty[role="status"]').waitFor();
      await page.locator('.nav-link[data-view="home"]').click(); await page.waitForSelector('.desk-head');
      release(); await page.waitForFunction(() => Data.topicState('agent').status === 'ready');
      check('离开页面后旧请求不能覆盖正文或抢焦点', await page.locator('.desk-head').count() === 1 && await page.locator('#note-area').count() === 0
        && await page.evaluate(() => document.activeElement.matches('.nav-link[data-view="home"]')));
    });
    check('全部加载流程无页面异常', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
