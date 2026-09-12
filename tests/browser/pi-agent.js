/* Real category, full scenario prompts, long answers and mock selection in an isolated profile. */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/imports/pi-agent/questions.json'), 'utf8'));
const sourceTotal = fs.readdirSync(path.join(ROOT, 'data/questions')).filter(f => f.endsWith('.json'))
  .reduce((n, f) => n + JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions', f), 'utf8')).length, 0);
const PORT = process.env.PORT || '8950', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function check(name, ok) { assert(ok, name); passed++; console.log('  PASS', name); }
async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data.ui.lastHash === location.hash && document.querySelector('#view > *'));
  await page.locator('body').ariaSnapshot();
}
(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for(let i = 0; i < 50; i++) { try { if((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch(_) {} await sleep(100); }
    assert(ready, 'isolated server did not start');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const ctx = await browser.newContext({ viewport: { width: 1200, height: 850 }, acceptDownloads: true });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const oldRecord = { note: '已有笔记需要完整保留', status: 'weak', fav: true, practiceCount: 4, _updatedAt: 200 };
    await page.goto(BASE + '/__seed__');
    await page.evaluate(record => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'PY-001': record }, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })), oldRecord);
    await open(page, '#/home');
    check('home lists the independent Pi Agent category', await page.locator('a[href="#/browse?t=pi-agent"]').count() === 1);
    check('built application reads back the complete bank and 30 Pi IDs', await page.evaluate(total => Data.allQuestions().length === total && Data.allQuestions().filter(q => q.topic === 'pi-agent').length === 30, sourceTotal));
    check('import creates no Pi answers, scores or mastery records', await page.evaluate(() => Object.entries(Store.data.questions).filter(([id]) => id.startsWith('PI-')).every(([, r]) => !r.status && !r.practiceCount) && Store.data.mock.rounds.length === 0));
    await open(page, '#/browse?t=pi-agent');
    await page.waitForFunction(() => document.querySelector('#f-topic')?.value === 'pi-agent');
    check('category filter displays exactly thirty questions', await page.locator('.q-item[data-qid]').count() === 30 && (await page.locator('#f-count').innerText()).includes('30'));
    check('the full question is visible before revealing an answer', await page.locator('[data-question-prompt="PI-001"]').isVisible() && !await page.locator('[data-sec="answer"] .q-sec-body').isVisible());
    for(const id of ['PI-004', 'PI-013', 'PI-024', 'PI-029']) {
      const original = source.questions.find(q => q.id === id);
      await open(page, '#/study/' + id);
      check(id + ' retains its full scenario prompt', (await page.locator('[data-question-prompt="' + id + '"]').innerText()).replace(/\s/g, '') === original.question.replace(/\s/g, ''));
      await page.locator('[data-toggle="deep"]').click();
      const complete = await page.evaluate(bodies => {
        const body = document.querySelector('[data-sec="deep"] .q-sec-body').textContent.replace(/\s/g, '');
        return bodies.every(text => { const el = document.createElement('div'); el.innerHTML = Markdown.render(text); return body.includes(el.textContent.replace(/\s/g, '')); });
      }, original.explanation.map(e => e.body));
      check(id + ' displays every full explanation paragraph', complete);
      await page.locator('[data-toggle="followups"]').click();
      check(id + ' has three nested follow-ups', await page.locator('[data-sec="followups"] .fu').count() === 3);
      await page.locator('[data-toggle="interview"]').click();
      const spoken = await page.locator('[data-sec="interview"]').innerText();
      check(id + ' keeps all five rubric criteria', original.rubric.every(r => spoken.includes(r.criterion)));
      await page.locator('[data-toggle="sources"]').click();
      check(id + ' retains the exact pinned source URL', await page.locator('[data-sec="sources"] a').first().getAttribute('href') === original.sources[0].url);
    }
    await page.setViewportSize({ width: 360, height: 800 });
    check('long Pi question fits 360px without page overflow', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if(process.env.AUDIT_ARTIFACTS) { fs.mkdirSync(process.env.AUDIT_ARTIFACTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.AUDIT_ARTIFACTS, 'pi-agent-360.png'), fullPage: true }); }
    await open(page, '#/docs/doc-pi-agent-1');
    check('Pi glossary is available as a document, not extra questions', (await page.locator('#view').innerText()).includes('Pi 面试术语速查'));
    check('prerequisite links use real Pi question IDs', await page.locator('a[href="#/study/PI-001"]').count() > 0);
    await page.locator('#global-search-input').fill('Durable'); await page.locator('#global-search-input').press('Enter');
    await page.locator('#s-topic').selectOption('pi-agent');
    check('English terminology finds Pi content', await page.locator('#s-results a[href*="PI-"]').count() > 0);
    await page.locator('#s-input').fill('工具已经扣款'); await page.locator('#s-go').click();
    check('Chinese question text is searchable', await page.locator('#s-results a[href*="PI-029"]').count() > 0);
    await open(page, '#/mock');
    for(const checkbox of await page.locator('#m-topics input').all()) await checkbox.uncheck();
    await page.locator('#m-topics input[value="pi-agent"]').check();
    await page.locator('#m-count').selectOption('5'); await page.locator('#m-start').click();
    await page.locator('#m-self').waitFor();
    const mockId = await page.locator('[data-question-prompt]').getAttribute('data-question-prompt');
    check('mock mode selects Pi questions and shows the full scenario', mockId.startsWith('PI-') && await page.locator('[data-question-prompt]').isVisible());
    await page.locator('#m-self').fill('这是隔离浏览器里的测试回答，不是真实用户作答。');
    for(let i = 0; i < 4; i++) await page.locator('#m-next').click();
    await page.locator('#m-finish').click(); await page.locator('#m-card').waitFor();
    check('test round contains only five Pi questions', await page.evaluate(() => Store.data.mock.rounds[0].items.length === 5 && Store.data.mock.rounds[0].items.every(q => q.qid.startsWith('PI-'))));
    check('all pre-existing personal fields remain unchanged', await page.evaluate(record => JSON.stringify(Store.data.questions['PY-001']) === JSON.stringify(record), oldRecord));
    check('no page errors throughout Pi integration', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if(browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
