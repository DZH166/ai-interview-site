'use strict';
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9530', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let checks = 0;
function check(name, value) { assert(value, name); checks++; console.log('PASS', name); }
(async () => {
  let browser, server;
  const start = async () => {
    server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/index.html')).ok) return; } catch (_) {} await sleep(100); }
    throw Error('server did not start');
  };
  try {
    await start();
    browser = await chromium.launch({ executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ serviceWorkers: 'block' });
    const page = await context.newPage(), errors = [], requests = [];
    page.on('pageerror', e => errors.push(e.message)); page.on('request', r => requests.push(r.url()));
    await page.goto(BASE + '/index.html#/home');
    check('首页不后台下载题库', !requests.some(u => u.includes('/data/topics/')));
    let release;
    const gate = new Promise(r => { release = r; });
    await page.route('**/data/topics/agent.*.json', async route => { await gate; await route.continue(); });
    await page.evaluate(() => { location.hash = '#/study/AG-001'; });
    await page.waitForFunction(() => document.querySelector('#view').textContent.includes('加载'));
    await page.evaluate(() => { location.hash = '#/home'; });
    await sleep(100); const title = await page.locator('#view').textContent();
    release(); await page.waitForFunction(() => !!Data.question('AG-001').answer); await sleep(150);
    check('学习页加载结束不会覆盖已切换的首页', (await page.locator('#view').textContent()) === title);
    check('只加载目标Agent专题', requests.filter(u => u.includes('/data/topics/')).length === 1);
    let attempts = 0;
    await page.route('**/data/topics/rag.*.json', route => ++attempts === 1 ? route.fulfill({ status: 503, body: 'retry' }) : route.continue());
    check('失败会向调用者报告', await page.evaluate(() => Data.ensureQuestion('RG-001').then(() => false, () => true)));
    check('失败保留全部元数据索引', await page.evaluate(() => Data.allQuestions().length === window.APP_DATA.questions_index.length && !!Data.question('RG-001').title));
    await page.evaluate(() => Data.ensureQuestion('RG-001'));
    check('网络恢复后可重新加载', await page.evaluate(() => !!Data.question('RG-001').answer));
    const newPage = await context.newPage(); await newPage.goto(BASE + '/index.html#/home');
    await newPage.evaluate(async () => {
      const file = window.APP_DATA.manifest.topics['python-backend'].file;
      await (await caches.open('topics-v1')).put(new URL('data/topics/' + file, location.href), new Response(JSON.stringify({ questions: [] }), { headers: { 'Content-Type': 'application/json' } }));
      await Data.ensureQuestion('PY-001');
    });
    check('坏缓存被剔除并重新下载', await newPage.evaluate(() => !!Data.question('PY-001').answer));
    await context.close();

    const offline = await browser.newContext({ serviceWorkers: 'allow' });
    const p = await offline.newPage(); p.on('pageerror', e => errors.push(e.message));
    await p.goto(BASE + '/index.html#/study/AG-001');
    await p.waitForSelector('#note-area');
    await p.waitForFunction(() => !!navigator.serviceWorker.controller);
    check('首次访问已经缓存当前专题', await p.evaluate(async () => {
      const name = window.APP_DATA.manifest.topics.agent.file;
      return !!await (await caches.open('topics-v1')).match(new URL('data/topics/' + name, location.href));
    }));
    // Stop the actual server. context.setOffline alone does not reliably block worker fetches.
    await new Promise(resolve => { server.once('exit', resolve); server.kill(); }); server = null;
    await p.reload(); await p.waitForSelector('#note-area');
    check('真实停服后刷新仍能读首次访问的题目', await p.evaluate(() => !!Data.question('AG-001').answer));
    await offline.setOffline(true);
    await p.evaluate(() => { location.hash = '#/study/RG-001'; });
    await p.waitForFunction(() => document.querySelector('#view').textContent.includes('重试'));
    check('未缓存题目报告加载失败，不误报题目不存在', !(await p.locator('#view').textContent()).includes('题目不存在'));
    check('明确告知当前离线且尚未下载', (await p.locator('#view').textContent()).includes('当前离线，尚未下载'));
    check('全程无JS异常', errors.length === 0);
    await offline.close();
    console.log(`结果: ${checks} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); if (server) server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
