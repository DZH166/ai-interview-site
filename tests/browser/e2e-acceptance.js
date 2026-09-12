/* 全链验收:从**空存储**开始,走一遍真实用户旅程,最后做导出→清空→导入的完整往返。
   与其它套件的区别:其它套件都是「种好数据再验界面」,这里证明
   **没有预置数据时应用也能正常用,且数据真的落盘、真的能恢复**。

   运行:
     AIIV_PYTHON=<python 路径> node tests/browser/e2e-acceptance.js
   可选环境变量同其它浏览器套件(PW / CHROME / PORT)。 */
'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');
const { spawn, execFileSync } = require('child_process');

/* 浏览器来源:本地默认用机器上已装好的 Playwright 与 Chromium;
   CI 里设 PW=playwright 让它用自己安装的一套,CHROME=default 走 Playwright 自带的浏览器。 */
const PW = process.env.PW || 'E:/WorkBuddyproject/溯知Rag-Agent项目/AI Knowledge OS Pro/frontend/node_modules/playwright';
const CHROME = process.env.CHROME !== undefined
  ? process.env.CHROME
  : (process.env.CI ? 'default' : 'E:/PlaywrightBrowsers/chromium-1223/chrome-win64/chrome.exe');
const LAUNCH = (CHROME && CHROME !== 'default') ? { headless: true, executablePath: CHROME } : { headless: true };
const PY = process.env.AIIV_PYTHON || 'python';
const PORT = process.env.PORT || '8934';
const ROOT = path.resolve(__dirname, '..', '..');
const BASE = `http://127.0.0.1:${PORT}`;
const { chromium } = require(PW);

let passed = 0, failed = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail === undefined ? '' : '\n    → ' + detail); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));
const TOKEN = '焦糖布丁' + Date.now().toString().slice(-6);   // 唯一词,用来验证检索真的能找回自己写的内容

async function startServer() {
  const p = spawn(PY, [path.join(ROOT, 'tools', 'serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  for (let i = 0; i < 60; i++) {
    try { execFileSync(PY, ['-c', `import urllib.request;urllib.request.urlopen("${BASE}/index.html",timeout=1)`], { stdio: 'ignore' }); return p; }
    catch (e) { await sleep(200); }
  }
  throw new Error('本地服务启动超时');
}
async function open(page, hash) {
  await page.goto(`${BASE}/index.html${hash || ''}`, { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view')
    && document.querySelector('#view').children.length > 0, null, { timeout: 8000 });
  await sleep(200);
}
const diskRec = page => page.evaluate(() => {
  try { return JSON.parse(localStorage.getItem('aiiv:records') || '{}'); } catch (e) { return { __parseError: String(e) }; }
});

(async () => {
  const server = await startServer();
  const browser = await chromium.launch(LAUNCH);
  const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 }, acceptDownloads: true });
  const page = await ctx.newPage();
  const pageErrors = [];
  page.on('pageerror', e => pageErrors.push(String(e && e.message || e)));

  /* ---------- 0. 从零开始 ---------- */
  console.log('== 0. 空存储启动 ==');
  await page.goto(`${BASE}/index.html#/home`, { waitUntil: 'domcontentloaded' });
  await page.evaluate(() => localStorage.clear());
  await open(page, '#/home');
  const homeOk = await page.evaluate(() => document.querySelector('#view').textContent.trim().length > 20);
  ok('空存储时首页正常渲染(不依赖任何预置数据)', homeOk);

  /* ---------- 1. 练习一题:写笔记 + 标状态 ---------- */
  console.log('\n== 1. 答题并落盘 ==');
  await open(page, '#/browse');
  const firstQid = await page.evaluate(() => {
    const el = document.querySelector('.q-item[data-qid]');
    return el ? el.dataset.qid : null;
  });
  ok('练习页能列出题目', !!firstQid, 'qid=' + firstQid);
  await open(page, '#/study/' + firstQid);
  await page.evaluate(t => {
    const ta = document.querySelector('#note-area');
    ta.focus(); ta.value = '我的理解:' + t;
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  }, TOKEN);
  // 标一个状态。注意第一个按钮是 data-status=""(未练习),那不是「标记」而是「清除」,
  // 所以要挑一个非空状态,否则测的是「清空状态」而不是「记录状态」。
  const statusLabel = await page.evaluate(async () => {
    const btns = Array.from(document.querySelectorAll('#q-detail [data-status], [data-status]'));
    const b = btns.find(x => x.dataset.status) || btns[0];
    if (!b) return null;
    b.click();
    await new Promise(r => setTimeout(r, 300));
    return b.dataset.status;
  });
  ok('存在可用的状态按钮', !!statusLabel, 'data-status=' + statusLabel);
  await sleep(500);   // 笔记写盘有 250ms 防抖
  const rec1 = await diskRec(page);
  const q1 = (rec1.questions || {})[firstQid] || {};
  const noteSaved = String(q1.note || '').includes(TOKEN);
  ok('笔记真的写进了 localStorage(不是只在界面上)', noteSaved, JSON.stringify(q1).slice(0, 160));
  ok('状态确实被记录', !!statusLabel && q1.status === statusLabel,
    'statusLabel=' + statusLabel + ' 记录=' + JSON.stringify(q1).slice(0, 160));

  /* ---------- 2. 刷新后记录还在 ---------- */
  console.log('\n== 2. 真实恢复(刷新)==');
  await open(page, '#/study/' + firstQid);
  const noteAfter = await page.evaluate(() => (document.querySelector('#note-area') || {}).value || '');
  ok('刷新后笔记内容还在输入框里', noteAfter.includes(TOKEN), JSON.stringify(noteAfter.slice(0, 80)));
  const statusAfter = await page.evaluate(() => {
    const b = document.querySelector('#q-detail [data-status].active') || document.querySelector('[data-status].active');
    return b ? b.dataset.status : 'NONE';
  });
  ok('刷新后状态高亮还在', statusAfter === statusLabel, '刷新后=' + statusAfter + ' 期望=' + statusLabel);

  /* ---------- 3. 用自己的笔记搜回自己 ---------- */
  console.log('\n== 3. 个人内容检索 ==');

  // 3a. 应用自己生成的正式深链格式:#/search/<关键词>
  await open(page, '#/search/' + encodeURIComponent(TOKEN));
  const hit = await page.evaluate(() => {
    const items = Array.from(document.querySelectorAll('.search-item'));
    const mine = items.find(el => (el.textContent || '').includes('我的理解') ||
      (el.getAttribute('href') || '').includes('note'));
    return { total: items.length, hasSelf: !!mine, href: mine ? mine.getAttribute('href') : '' };
  });
  ok('搜自己写的笔记能搜到(正式深链 #/search/<词>)', hit.total > 0 && hit.hasSelf, JSON.stringify(hit));
  ok('搜索命中落点带笔记锚点(能定位到笔记区)',
    hit.href.includes('note') || hit.href.includes(firstQid), 'href=' + hit.href);

  // 3b. 兼容写法:#/search?q=<关键词>(手抄/改写链接很容易写成这样)。
  // 必须先把上次搜索词从记录里清掉,否则视图会退回读「上次搜的词」而误判为支持 ?q=,
  // 那样这条断言在没修之前也是绿的 —— 等于没查。
  await page.evaluate(() => {
    Store.data.ui.search = {};
    Store.save();
  });
  await open(page, '#/search?q=' + encodeURIComponent(TOKEN));
  const compat = await page.evaluate(() => ({
    input: (document.querySelector('#s-input') || {}).value || '',
    hits: document.querySelectorAll('.search-item').length
  }));
  ok('兼容写法 #/search?q=<词> 的输入框会带上关键词',
    compat.input === TOKEN, JSON.stringify(compat));
  ok('兼容写法 #/search?q=<词> 也能搜到结果', compat.hits > 0, JSON.stringify(compat));

  /* ---------- 4. 专项练习:新尝试 → 提交 → 进历史 ---------- */
  console.log('\n== 4. 专项练习全流程 ==');
  await open(page, '#/path?d=drill-1pred01');
  const drillFlow = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const det = document.querySelector('.path-drill [data-drill-record]');
    if (det && !det.open) { det.open = true; await sleep(80); }
    const box = document.querySelector('[data-drill-answer]') || document.querySelector('.path-drill textarea');
    if (!box) return { err: '找不到作答框' };
    box.focus(); box.value = '我的作答:先预测再运行,注意原地修改的副作用。';
    box.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(400);
    const save = document.querySelector('[data-drill-save]');
    if (save) { save.click(); await sleep(400); }
    return { typed: true, hasSave: !!save };
  });
  await sleep(600);
  const drillRec = await diskRec(page);
  const attempts = ((drillRec.drillAttempts || {})['drill-1pred01']) || [];
  const withText = attempts.filter(a => String(a.myAnswer || '').includes('先预测再运行'));
  ok('专项作答真的落到 drillAttempts', withText.length >= 1,
    JSON.stringify(attempts).slice(0, 200));
  ok('该次尝试被记为 completed 而不是停在草稿',
    withText.some(a => a.status === 'completed'),
    '状态集合=' + JSON.stringify(attempts.map(a => a.status)));

  /* ---------- 5. 项目:写运行记录 → 刷新后作为证据还在 ---------- */
  console.log('\n== 5. 项目运行记录(证据)持久化 ==');
  await open(page, '#/path');
  const proj = await page.evaluate(async () => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const card = document.querySelector('.proj-card[data-proj]');
    if (!card) return { err: '路径页没有项目卡片' };
    const pid = card.dataset.proj;
    if (!card.open) { card.open = true; await sleep(80); }
    const ta = card.querySelector(`textarea[data-proj-field="runOutput"][data-proj="${pid}"]`);
    if (!ta) return { err: '找不到运行输出输入框', pid };
    ta.focus();
    ta.value = '实测输出:QPS 提升到 320,三层结构里失败模式写在第②层。';
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    await sleep(300);
    const save = card.querySelector(`[data-proj-save="${pid}"]`);
    if (!save) return { err: '找不到保存按钮', pid };
    save.click();
    return { pid, saved: true };
  });
  await sleep(600);
  const rec5 = await diskRec(page);
  const runs = ((rec5.ui || {}).projectRuns || {})[proj.pid] || [];
  ok('项目页能找到项目卡片', !proj.err, JSON.stringify(proj));
  ok('保存后产生 1 条运行记录', runs.length === 1, JSON.stringify(runs).slice(0, 200));
  ok('运行记录带 runId(恢复时不会被静默丢弃)',
    runs.length === 1 && !!runs[0].runId, JSON.stringify(runs[0] || {}).slice(0, 160));
  ok('运行记录内容与录入一致', runs.length === 1 && String(runs[0].runOutput || '').includes('QPS 提升到 320'),
    JSON.stringify(runs[0] || {}).slice(0, 160));

  await open(page, '#/path');
  const historyVisible = await page.evaluate(async pid => {
    const sleep = ms => new Promise(r => setTimeout(r, ms));
    const card = document.querySelector(`.proj-card[data-proj="${pid}"]`);
    if (!card) return { err: '刷新后找不到项目卡片' };
    if (!card.open) { card.open = true; await sleep(80); }
    const box = card.querySelector('[data-proj-record]');
    if (box && !box.open) { box.open = true; await sleep(80); }
    return { text: (card.textContent || '') };
  }, proj.pid);
  ok('刷新后运行记录在「我的运行记录」里可见',
    !historyVisible.err && historyVisible.text.includes('QPS 提升到 320'),
    JSON.stringify(historyVisible).slice(0, 180));

  /* ---------- 6. 导出 → 清空 → 导入,完整往返 ---------- */
  console.log('\n== 6. 导出/清空/导入往返 ==');
  await open(page, '#/maintain');
  const [dl] = await Promise.all([
    page.waitForEvent('download', { timeout: 8000 }).catch(() => null),
    page.click('#r-export')
  ]);
  let exported = '';
  if (dl) {
    const p = path.join(os.tmpdir(), 'aiiv-e2e-' + Date.now() + '.json');
    await dl.saveAs(p);
    exported = fs.readFileSync(p, 'utf8');
  }
  ok('导出个人记录能拿到文件且内容包含刚写的数据',
    !!dl && exported.includes(TOKEN), '下载=' + !!dl + ' 长度=' + exported.length);

  await page.click('#r-clear');
  await page.waitForSelector('[role="dialog"]', { timeout: 5000 });
  await page.evaluate(() => {
    const b = Array.from(document.querySelectorAll('[role="dialog"] .modal-foot button'))
      .find(x => /确认清空/.test(x.textContent));
    if (b) b.click();
  });
  await sleep(500);
  const cleared = await diskRec(page);
  ok('清空后本地记录里不再有笔记',
    !JSON.stringify(cleared).includes(TOKEN), JSON.stringify(cleared).slice(0, 140));

  const tmpFile = path.join(os.tmpdir(), 'aiiv-e2e-import-' + Date.now() + '.json');
  fs.writeFileSync(tmpFile, exported, 'utf8');
  const chooserPromise = page.waitForEvent('filechooser', { timeout: 8000 }).catch(() => null);
  await page.click('#r-import');
  const chooser = await chooserPromise;
  ok('点「导入记录」会打开文件选择器', !!chooser);
  if (chooser) {
    await chooser.setFiles(tmpFile);
    await sleep(800);
    const restored = await diskRec(page);
    const q = (restored.questions || {})[firstQid] || {};
    ok('导入后笔记被完整还原', String(q.note || '').includes(TOKEN),
      JSON.stringify(q).slice(0, 160));
    const dr = ((restored.drillAttempts || {})['drill-1pred01']) || [];
    ok('导入后专项尝试也被还原(不是只还原题目记录)',
      dr.some(a => String(a.myAnswer || '').includes('先预测再运行')),
      JSON.stringify(dr).slice(0, 180));
  }
  try { fs.unlinkSync(tmpFile); } catch (e) {}

  /* ---------- 7. 导入后仍然可检索(索引没被清空卡住) ---------- */
  await open(page, '#/search?q=' + encodeURIComponent(TOKEN));
  const afterImport = await page.evaluate(() => document.querySelectorAll('.search-item').length);
  ok('导入后检索索引已重建,能重新搜到笔记', afterImport > 0, '命中数=' + afterImport);

  /* ---------- 8. 全程无 JS 异常 ---------- */
  const realErrors = pageErrors.filter(m => !/Failed to load resource/.test(m));
  ok('整条链路无 JS 异常', realErrors.length === 0, JSON.stringify(realErrors.slice(0, 3)));

  await browser.close();
  server.kill();
  console.log('\n结果: %d 通过, %d 失败', passed, failed);
  if (failed) { console.log('失败项:'); failures.forEach(f => console.log('  -', f)); process.exit(1); }
})().catch(e => { console.error('运行失败:', e); process.exit(2); });
