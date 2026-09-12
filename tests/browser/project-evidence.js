/* Real input, downloads and restore in a second browser context. No user profile is used. */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const BASE = 'http://127.0.0.1:' + (process.env.PORT || '8948');
const PROJECT = 'proj-a-model-client';
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function check(name, value) { assert(value, name); passed++; console.log('  PASS', name); }
async function downloaded(download) {
  const stream = await download.createReadStream(), chunks = [];
  for await (const chunk of stream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(hash => typeof Store !== 'undefined' && location.hash === hash && Store.data.ui.lastHash === hash, hash);
  await page.locator('#view > *').first().waitFor();
  await page.locator('body').ariaSnapshot();
}
async function followLink(page, locator) {
  const hash = await locator.getAttribute('href');
  await locator.click();
  // Hash navigation can finish before the application's hashchange handler runs.
  await page.waitForFunction(hash => location.hash === hash && Store.data.ui.lastHash === hash, hash);
}
async function importFull(page, buffer) {
  await open(page, '#/maintain');
  const chooser = page.waitForEvent('filechooser');
  await page.locator('#f-import').click();
  await (await chooser).setFiles({ name: 'backup.json', mimeType: 'application/json', buffer });
  await page.getByRole('button', { name: '完整恢复', exact: true }).click();
  await page.getByRole('button', { name: '知道了', exact: true }).click();
  await page.waitForFunction(() => !document.querySelector('[role="dialog"]'));
}
(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), process.env.PORT || '8948'], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {}
      await sleep(100);
    }
    assert(ready, 'isolated server must start');
    const executablePath = process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined;
    browser = await chromium.launch({ headless: true, executablePath });
    const context = await browser.newContext({ viewport: { width: 1100, height: 850 }, acceptDownloads: true });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await open(page, '#/path?p=' + PROJECT + '&tab=draft');
    const output = page.locator(`[data-proj="${PROJECT}"][data-proj-field="runOutput"]`);
    await output.fill('第一次运行失败：超时，尚未验证成功');
    await page.locator(`[data-proj="${PROJECT}"][data-proj-field="debug"]`).fill('定位为超时配置；下一步验证重试上限');
    await page.locator(`[data-proj-save="${PROJECT}"]`).click();
    const first = await page.evaluate(p => Store.data.ui.projectRuns[p][0].runId, PROJECT);
    await output.fill('第二次运行仍失败：取消场景待验证');
    await page.locator(`[data-proj-save="${PROJECT}"]`).click();
    check('two deliberate saves produce two persisted runs', await page.evaluate(p => JSON.parse(localStorage.getItem('aiiv:records')).ui.projectRuns[p].length === 2, PROJECT));
    await open(page, '#/path?p=' + PROJECT + '&tab=speak');
    await page.locator(`[data-proj="${PROJECT}"][data-proj-level="design"]`).click();
    check('two failed records never encourage claiming successful experience', !(await page.locator('#view').innerText()).includes('可以放心'));
    await page.locator('#pitch-short-' + PROJECT).fill('简述独特词：我计划做有限重试；目前仅验证了失败路径。');
    await page.locator('#pitch-long-' + PROJECT).fill('详述独特词：需求是可靠调用。第一轮超时，定位后准备继续验证成功和取消路径。');
    await page.locator(`[data-proj-speak="${PROJECT}"][data-proj-speak-field="ask"]`).fill('原有六段提纲继续保留');
    await page.locator('#pitch-evidence-' + PROJECT).selectOption(first);
    await page.locator(`[data-proj-save-speak="${PROJECT}"]`).click();
    await page.reload(); await page.locator('#pitch-short-' + PROJECT).waitFor();
    check('short pitch survives reload', (await page.locator('#pitch-short-' + PROJECT).inputValue()).includes('简述独特词'));
    check('long pitch survives reload independently', (await page.locator('#pitch-long-' + PROJECT).inputValue()).includes('详述独特词'));
    check('selected evidence identity survives reload', await page.locator('#pitch-evidence-' + PROJECT).inputValue() === first);

    const exportButton = page.locator(`[data-proj-export="${PROJECT}"]:not([data-proj-export-run])`);
    await exportButton.click();
    let event = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载 Markdown', exact: true }).click();
    const md = (await downloaded(await event)).toString('utf8');
    check('download contains both personal pitches', md.includes('简述独特词') && md.includes('详述独特词'));
    check('download uses the chosen saved evidence', md.includes(first) && md.includes('第一次运行失败'));
    check('download does not mix in a different run snapshot', !md.includes('第二次运行仍失败'));
    check('legacy outline and honest level are preserved', md.includes('原有六段提纲') && md.includes('如果遇到我会这样设计'));
    await exportButton.click(); event = page.waitForEvent('download');
    await page.getByRole('button', { name: '下载打印版 HTML', exact: true }).click();
    const html = (await downloaded(await event)).toString('utf8');
    check('HTML carries the same evidence and both pitches', html.includes(first) && html.includes('简述独特词') && html.includes('详述独特词'));
    const printPage = await context.newPage(); await printPage.setContent(html);
    await printPage.setViewportSize({ width: 360, height: 800 });
    check('standalone printable card fits 360px', await printPage.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.AUDIT_ARTIFACTS) {
      fs.mkdirSync(process.env.AUDIT_ARTIFACTS, { recursive: true });
      await printPage.screenshot({ path: path.join(process.env.AUDIT_ARTIFACTS, 'project-card-360.png'), fullPage: true });
      fs.writeFileSync(path.join(process.env.AUDIT_ARTIFACTS, 'project-card.html'), html);
      fs.writeFileSync(path.join(process.env.AUDIT_ARTIFACTS, 'project-card.md'), md);
    }
    await printPage.close();

    await page.locator('#global-search-input').fill('详述独特词');
    await page.locator('#global-search-input').press('Enter'); await page.locator('body').ariaSnapshot();
    await followLink(page, page.locator('a[href*="tab=speak&field=long"]'));
    await page.locator('#pitch-long-' + PROJECT).waitFor({ state: 'visible' });
    check('search opens the exact long-pitch field', await page.locator('#pitch-long-' + PROJECT).isVisible());
    check('search target is visible below navigation', await page.locator('#pitch-long-' + PROJECT).evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.top < innerHeight; }));

    await open(page, '#/maintain'); event = page.waitForEvent('download');
    await page.locator('#f-export').click(); const backup = await downloaded(await event);
    const freshContext = await browser.newContext({ acceptDownloads: true });
    const fresh = await freshContext.newPage(); fresh.on('pageerror', e => errors.push(e.message));
    await fresh.goto(BASE + '/__seed__');
    check('restore target really has no records', await fresh.evaluate(() => localStorage.getItem('aiiv:records') === null));
    await open(fresh, '#/path'); // Regression: opening a path initializes empty project shells.
    await importFull(fresh, backup); await importFull(fresh, backup);
    await open(fresh, '#/path?p=' + PROJECT + '&tab=speak');
    check('fresh restore keeps short pitch', (await fresh.locator('#pitch-short-' + PROJECT).inputValue()).includes('简述独特词'));
    check('fresh restore keeps long pitch and evidence binding', (await fresh.locator('#pitch-long-' + PROJECT).inputValue()).includes('详述独特词') && await fresh.locator('#pitch-evidence-' + PROJECT).inputValue() === first);
    check('repeated restore does not duplicate project history', await fresh.evaluate(p => Store.data.ui.projectRuns[p].length === 2, PROJECT));
    await fresh.setViewportSize({ width: 360, height: 800 });
    check('project editor fits 360px', await fresh.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    // Import two concurrent drafts through the actual data API, then operate real controls.
    const did = 'drill-1pred01';
    await fresh.evaluate(did => {
      const make = (id, ts, myAnswer) => ({ attemptId: id, drillId: did, version: 1, status: 'draft', ts, updatedAt: ts, myAnswer });
      Store.importRecords(JSON.stringify({ records: { questions: {}, drillAttempts: { [did]: [make('draft-A', 100, '旧草稿A'), make('draft-B', 200, '新草稿B')] } } }));
    }, did);
    await open(fresh, '#/path?d=' + did);
    check('newest parallel draft is the initial editor', await fresh.locator(`[data-drill-answer="${did}"]`).inputValue() === '新草稿B');
    await fresh.locator(`[data-drill-record="${did}"] > summary`).click();
    await fresh.locator(`[data-drill-save="${did}"]`).click();
    check('submitting B never fills the editor with old A', await fresh.locator(`[data-drill-answer="${did}"]`).inputValue() === '');
    await followLink(fresh, fresh.locator('a[href="#/path?d=' + did + '&at=draft-A"]'));
    check('older draft remains available by explicit choice', await fresh.locator(`[data-drill-answer="${did}"]`).inputValue() === '旧草稿A');
    await fresh.locator('#global-search-input').fill('新草稿B');
    await fresh.locator('#global-search-input').press('Enter');
    await followLink(fresh, fresh.locator('a[href="#/path?d=' + did + '&at=draft-B"]'));
    check('completed-attempt search displays that exact historic answer', (await fresh.locator('[data-selected-attempt="draft-B"]').innerText()).includes('新草稿B'));
    check('reading a historic answer does not fill the new attempt', await fresh.locator(`[data-drill-answer="${did}"]`).inputValue() === '');
    await open(fresh, '#/review');
    const unrated = fresh.locator('.review-item').filter({ has: fresh.locator('a[href="#/path?d=' + did + '&at=draft-B"]') });
    check('review labels a completed record without a rating honestly', (await unrated.innerText()).includes('未自评') && !(await unrated.innerText()).includes('未解决'));
    await followLink(fresh, fresh.locator('a[href="#/path?d=' + did + '&at=draft-A"]'));
    check('review draft link resumes the specified older draft', await fresh.locator(`[data-drill-answer="${did}"]`).inputValue() === '旧草稿A');

    await fresh.evaluate(() => { Store.data.mock.rounds = [{ ts: Date.now() - 86400000, items: [{ qid: 'PY-001', self: '昨天的回答' }] }]; Store.saveNow(); });
    await open(fresh, '#/home');
    check('yesterday round does not mark today done', !await fresh.locator('[data-today-mock]').evaluate(el => el.classList.contains('is-done')));
    await fresh.evaluate(() => { Store.data.mock.rounds[0].ts = Date.now(); Store.saveNow(); });
    await fresh.reload();
    check('today with a real answer marks today done', await fresh.locator('[data-today-mock]').evaluate(el => el.classList.contains('is-done')));
    check('entire new workflow has no page errors', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally {
    if (browser) await browser.close();
    server.kill();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });
