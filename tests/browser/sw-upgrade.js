/* Real released main worker -> current app, on one origin under a Pages-style subdirectory.
   Requires the fixed Git baseline (CI checkout fetch-depth: 0); never patches production files. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), http = require('http');
const { execFileSync } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), OLD = '8c2db0c';
const PORT = Number(process.env.PORT || 9558), PREFIX = '/workbench/', BASE = 'http://127.0.0.1:' + PORT + PREFIX;
let passed = 0;
const check = (name, value) => { assert(value, name); passed++; console.log('PASS ' + name); };
const contentType = file => ({ '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.png': 'image/png' })[path.extname(file)] || 'application/octet-stream';

(async () => {
  // Validate the historical fixture before starting any browser/server work.
  execFileSync('git', ['cat-file', '-e', OLD + ':app/sw.js'], { cwd: ROOT, stdio: 'pipe' });
  const historic = new Map(), requests = [];
  let candidate = false, releaseWorker = false, newerData = false, browser;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, BASE);
    let relative = decodeURIComponent(url.pathname.slice(PREFIX.length)) || 'index.html';
    if (!url.pathname.startsWith(PREFIX) || relative.includes('..')) { res.writeHead(404); res.end(); return; }
    const old = !candidate || (relative === 'sw.js' && !releaseWorker);
    let body;
    try {
      if (old) {
        if (!historic.has(relative)) historic.set(relative, execFileSync('git', ['show', OLD + ':app/' + relative], { cwd: ROOT, maxBuffer: 32 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }));
        body = historic.get(relative);
      } else body = newerData && relative === 'data.js' ? Buffer.from('window.APP_DATA = { future: true };') : fs.readFileSync(path.join(ROOT, 'app', relative));
    } catch (_) {
      requests.push({ candidate, relative, status: 404 }); res.writeHead(404); res.end('missing'); return;
    }
    requests.push({ candidate, relative, status: 200, old, search: url.search });
    res.writeHead(200, { 'Content-Type': contentType(relative), 'Cache-Control': 'no-store' }); res.end(body);
  });
  try {
    await new Promise(resolve => server.listen(PORT, '127.0.0.1', resolve));
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext(), page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE + 'index.html#/docs/doc-path-1');
    await page.waitForFunction(() => document.querySelector('#doc-content')?.textContent.length > 100);
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
    check('真实旧main页面与旧worker已安装', await page.evaluate(() => typeof Data.ensureDocs === 'undefined'));
    await page.evaluate(() => {
      Store.setNote('AG-001', 'SW_UPGRADE_PERSONAL_NOTE');
      Store.rec('AG-001').fav = true;
      Store.data.mock.draft = { sessionId: 'upgrade-draft', savedAt: Date.now(), config: {}, items: [{ qid: 'AG-001' }], idx: 0,
        answers: { 'AG-001': { self: 'SW_UPGRADE_DRAFT_ANSWER' } } };
      Store.save();
    });
    const oldCache = await page.evaluate(async () => (await caches.keys()).find(key => key.startsWith('shell-')));
    check('旧worker确实预缓存未版本化的脚本', await page.evaluate(async key => !!(await (await caches.open(key)).match(new URL('js/views-knowledge.js', location.href).href)), oldCache));

    // Keep serving the actual old worker until after first refresh assertions. This models
    // a slow update check and prevents a fast activation from hiding incompatible cached JS.
    candidate = true;
    await page.reload({ waitUntil: 'load' });
    await page.waitForSelector('#doc-content', { state: 'attached' });
    const first = await page.evaluate(() => ({ body: document.querySelector('#doc-content').textContent,
      loader: typeof Data.ensureDocs, manifest: !!APP_DATA.manifest?.assets?.docs }));
    console.log('First refresh:', JSON.stringify({ textLength: first.body.length, docsLoader: first.loader, docsAsset: first.manifest }));
    check('旧worker控制下首次刷新即可读新版文档正文', first.body.length > 100 && first.loader === 'function' && first.manifest);
    check('首刷新没有请求已删除的全量highlights资产', !requests.some(r => r.candidate && r.relative === 'data/highlights.json'));
    check('个人笔记收藏与未完成回答跨升级保留', await page.evaluate(() => Store.rec('AG-001').note === 'SW_UPGRADE_PERSONAL_NOTE'
      && Store.rec('AG-001').fav && Store.data.mock.draft.answers['AG-001'].self === 'SW_UPGRADE_DRAFT_ANSWER'));
    await page.goto(BASE + 'index.html#/study/AG-001'); await page.waitForSelector('#note-area');
    check('升级后只加载打开题目所属专题', await page.evaluate(() => Data.loadProgress().ready === 1));
    check('题目正文与个人笔记可用', await page.locator('#note-area').inputValue() === 'SW_UPGRADE_PERSONAL_NOTE');

    releaseWorker = true;
    const shell = fs.readFileSync(path.join(ROOT, 'app/sw.js'), 'utf8').match(/const CACHE_VERSION = '([^']+)'/)[1];
    await page.evaluate(async () => {
      const registration = await navigator.serviceWorker.getRegistration();
      const changed = new Promise(resolve => navigator.serviceWorker.addEventListener('controllerchange', resolve, { once: true }));
      await registration.update(); await changed;
    });
    // controllerchange can fire while the new worker is still activating.
    await page.waitForFunction(() => navigator.serviceWorker.controller?.state === 'activated');
    const installed = await page.evaluate(async () => ({ keys: await caches.keys(), controller: navigator.serviceWorker.controller.state }));
    console.log('Worker upgrade:', JSON.stringify({ ...installed, shell, oldCache }));
    check('新版worker成功接管并清理旧shell缓存', installed.keys.includes(shell) && !installed.keys.includes(oldCache));
    newerData = true;
    const cachedData = await page.evaluate(async () => {
      const url = [...document.scripts].find(script => new URL(script.src).pathname.endsWith('/data.js')).src;
      return fetch(url).then(response => response.text());
    });
    newerData = false;
    check('已缓存版本化data不会被后续发布内容替换', cachedData === fs.readFileSync(path.join(ROOT, 'app/data.js'), 'utf8'));
    await context.setOffline(true);
    await page.reload(); await page.waitForSelector('#note-area');
    check('升级后断网刷新仍能打开已访问题目和笔记', await page.locator('#note-area').inputValue() === 'SW_UPGRADE_PERSONAL_NOTE');
    await page.goto(BASE + 'index.html#/docs/doc-path-1');
    await page.waitForFunction(() => document.querySelector('#doc-content')?.textContent.length > 100);
    check('升级后断网打开已访问文档完整可读', (await page.locator('#doc-content').innerText()).length > 100);
    check('离线升级没有清除个人草稿', await page.evaluate(() => Store.data.mock.draft.answers['AG-001'].self === 'SW_UPGRADE_DRAFT_ANSWER'));
    await context.close();

    // Also exercise first installation, where the first topic fetch can precede SW control.
    const fresh = await browser.newContext(), firstPage = await fresh.newPage();
    firstPage.on('pageerror', error => errors.push(error.message));
    await firstPage.goto(BASE + 'index.html#/study/AG-001'); await firstPage.waitForSelector('#note-area');
    await firstPage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 60000 });
    await fresh.setOffline(true); await firstPage.reload(); await firstPage.waitForSelector('#note-area');
    check('新版首次访问后直接断网刷新可作答', await firstPage.locator('#note-area').count() === 1 && await firstPage.locator('.q-secs').count() > 0);
    check('升级与新安装全过程无页面异常', errors.length === 0);
    await fresh.close();
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally {
    if (browser) await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
