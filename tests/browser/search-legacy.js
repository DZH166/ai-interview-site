/* Progressive search, document isolation, and archived personal-record access. */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || '9512', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
const check = (name, condition) => { assert(condition, name); passed++; console.log('  PASS', name); };

(async () => {
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore', windowsHide: true });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready, 'server unavailable');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const ctx = await browser.newContext({ serviceWorkers: 'block' });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    const legacy = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/legacy-questions.json'), 'utf8')).questions[0];
    const needle = '历史专属笔记唯一检索词XYZ';
    await page.goto(BASE + '/__seed__');
    await page.evaluate(({ legacy, needle }) => {
      localStorage.setItem('aiiv:records', JSON.stringify({ v: 3,
        questions: { [legacy.id]: { note: needle, fav: true, status: 'weak', _updatedAt: Date.now() } },
        mock: { draft: null, rounds: [{ id: 'legacy-round', ts: Date.now(), items: [{ qid: legacy.id, title: legacy.title, self: '我的旧题回答仍在', mark: 'weak' }] }] },
        drillAttempts: {}, ui: {} }));
    }, { legacy, needle });
    await page.goto(BASE + '/index.html#/review?t=fav');
    await page.waitForSelector(`.ri-main[data-qid="${legacy.id}"]`);
    const activeCount = await page.evaluate(() => Data.allQuestions().length);
    check('archived favourite appears without rejoining active question count',
      activeCount === 3646 && await page.evaluate(id => !Data.allQuestions().some(q => q.id === id), legacy.id));
    await page.locator(`.ri-main[data-qid="${legacy.id}"]`).click();
    await page.waitForFunction(id => Data.question(id) && Data.question(id).answer !== undefined && document.querySelector('#note-area'), legacy.id);
    check('old ID opens original archived body and personal note',
      await page.evaluate(({ id, answer, needle }) => Data.question(id).answer === answer && document.querySelector('#note-area').value === needle,
        { id: legacy.id, answer: legacy.answer, needle }));
    await page.evaluate(() => location.hash = '#/review?t=mistakes');
    await page.waitForSelector(`.ri-main[data-qid="${legacy.id}"]`);
    check('archived weak history remains accessible from mistakes', await page.locator(`.ri-main[data-qid="${legacy.id}"]`).count() === 1);
    await page.evaluate(() => location.hash = '#/review?t=rounds');
    await page.waitForSelector('.round-self');
    check('archived history retains original user answer and old-ID link',
      (await page.locator('#view').innerText()).includes('我的旧题回答仍在') && await page.locator(`a[href="#/study/${legacy.id}"]`).count() > 0);

    let release;
    const gate = new Promise(resolve => { release = resolve; });
    await page.route('**/data/topics/**', async route => { await gate; await route.continue(); });
    await page.evaluate(q => location.hash = '#/search/' + encodeURIComponent(q), needle);
    await page.waitForSelector('.search-item');
    check('legacy note results appear while unrelated topic downloads are blocked',
      await page.evaluate(id => !Data.questionsLoaded() && [...document.querySelectorAll('.search-item')].some(a => a.getAttribute('href').includes(id)), legacy.id));
    await page.locator('#s-scope').selectOption('note');
    await page.locator('#s-topic').selectOption('pi-agent');
    check('partial-match fallback respects both note scope and topic filter', await page.locator('.search-item').count() === 0);
    await page.locator('#s-topic').selectOption('');
    await page.locator('#s-input').fill('历史专属笔记唯一检索词XYZ impossibleSuffix');
    await page.locator('#s-go').click();
    await page.waitForSelector('.search-partial');
    check('partial match within allowed scope still finds the note', await page.locator('.search-item').count() === 1);
    await page.evaluate(() => location.hash = '#/home');
    await page.waitForFunction(() => !document.querySelector('#s-input'));
    release();
    await page.evaluate(async () => { await Data.questionsReady(); await Search.whenIdle(); });
    await sleep(150);
    check('late search/index completion cannot replace a newer route',
      await page.evaluate(() => location.hash === '#/home' && !document.querySelector('#s-input') && !document.querySelector('#s-results')));

    const docsCtx = await browser.newContext({ serviceWorkers: 'block' });
    const docPage = await docsCtx.newPage();
    docPage.on('pageerror', error => errors.push(error.message));
    await docPage.route('**/data/topics/**', route => route.abort());
    const docId = await page.evaluate(() => Data.allDocs()[0].id);
    await docPage.goto(BASE + '/index.html#/docs/' + docId);
    await docPage.waitForFunction(() => document.querySelector('#doc-content')?.innerText.length > 200);
    check('document reader loads without waiting for question shards', await docPage.evaluate(() => !Data.questionsLoaded()));
    check('no browser exceptions', errors.length === 0);
    await docsCtx.close(); await ctx.close();
    console.log(`\n${passed} passed`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
