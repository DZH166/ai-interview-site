/* Fusion readback across old/new topics in an isolated browser context. */
'use strict';
const path = require('path'), fs = require('fs'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8956', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok) { assert(ok, name); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data.ui.lastHash === location.hash && document.querySelector('#view > *'));
  const anchor = new URLSearchParams(hash.split('?')[1] || '').get('a');
  if(anchor) await page.locator(`[data-sec="${anchor}"].open`).waitFor();
  await page.locator('body').ariaSnapshot();
}
(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for(let i = 0; i < 50; i++) { try { if((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch(_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));
    const old = { 'AG-010': { note: '保留框架学习笔记', status: 'ok', fav: true, practiceCount: 3 }, 'PI-001': { note: '保留Pi笔记', status: 'weak', fav: false } };
    await page.goto(BASE + '/__seed__');
    await page.evaluate(questions => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })), old);
    await open(page, '#/home');
    check('new framework topic appears without removing Pi Agent', await page.locator('a[href="#/browse?t=langchain"]').count() === 1 && await page.locator('a[href="#/browse?t=pi-agent"]').count() === 1);
    check('349 questions are loaded and new questions have no fabricated practice', await page.evaluate(() => Data.allQuestions().length === 349 && Data.allQuestions().filter(q => q.topic === 'langchain').every(q => !Store.rec(q.id).practiceCount && !Store.rec(q.id).status)));
    await open(page, '#/browse?t=langchain');
    await page.waitForFunction(() => document.querySelector('#f-topic')?.value === 'langchain');
    check('framework category has six questions', await page.locator('.q-item[data-qid]').count() === 6);
    await open(page, '#/study/LC-003');
    check('new scenario prompt is visible before answers', await page.locator('[data-question-prompt="LC-003"]').isVisible() && !await page.locator('[data-sec="answer"] .q-sec-body').isVisible());
    await page.locator('[data-toggle="deep"]').click();
    check('new question explains replay and displays fusion notes', (await page.locator('[data-sec="deep"]').innerText()).includes('融合补充'));
    await open(page, '#/study/AG-004?a=answer');
    check('existing MCP question uses corrected nondependency explanation', (await page.locator('[data-sec="answer"]').innerText()).includes('不要求模型必须原生支持'));
    await open(page, '#/study/AD-004?a=deep');
    check('LoRA dimensions and validation case are displayed', (await page.locator('[data-sec="deep"]').innerText()).includes('r×k'));
    await open(page, '#/study/AG-033?a=deep');
    check('existing question retains its ID and gains the specific resilience note', (await page.locator('[data-sec="deep"]').innerText()).includes('fencing token'));
    await page.locator('#global-search-input').fill('fencing token'); await page.locator('#global-search-input').press('Enter');
    const target = page.locator('a[href="#/study/AG-033?a=deep"]').first(); await target.waitFor();
    check('fusion-only phrase is searchable at the original question', await target.count() === 1);
    await target.click(); await page.locator('[data-sec="deep"].open').waitFor();
    check('search opens the deep section containing the supplement', (await page.locator('[data-sec="deep"]').innerText()).includes('失联不等于进程已停止'));
    await open(page, '#/docs/doc-ai-series-1');
    check('source index contains all 98 article references', await page.locator('#view a[href^="https://xiaolinnote.com/ai/"]').count() === 98);
    check('source index links to both new and original questions', await page.locator('#view a[href="#/study/LC-001"]').count() > 0 && await page.locator('#view a[href="#/study/AG-001"]').count() > 0);
    await open(page, '#/docs/doc-langchain-1');
    check('framework guide links to all six LC questions', (await page.locator('#view a[href^="#/study/LC-"]').count()) === 6);
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page, '#/study/LC-003?a=deep');
    // Responsive controls animate their width after resize; measure the settled layout.
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    check('new content fits a 360px viewport', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if(process.env.AUDIT_ARTIFACTS) { fs.mkdirSync(process.env.AUDIT_ARTIFACTS, { recursive: true }); await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: path.join(process.env.AUDIT_ARTIFACTS, 'langchain-360.png') }); }
    check('old notes, favourite, mastery and Pi learning state remain intact', await page.evaluate(old => ['AG-010','PI-001'].every(id => ['note','status','fav','practiceCount'].every(k => Store.rec(id)[k] === old[id][k])), old));
    check('no browser errors during fusion workflow', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if(browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
