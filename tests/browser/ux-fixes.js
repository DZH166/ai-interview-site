/* 体验修复包验收:搜索零结果降级与别名、主题跟随系统、空格键不再被吞、无 JS 异常。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/ux-fixes.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9742', BASE = 'http://127.0.0.1:' + PORT;
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
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    };

    /* (b) 别名:搜「rag」应命中中文题库(题干/标签里的「检索增强」等) */
    await open('#/search/rag');
    await page.waitForFunction(() => document.querySelectorAll('.search-item').length > 0, null, { timeout: 15000 });
    check('搜索 rag(别名展开)返回结果', await page.locator('.search-item').count() > 0);

    /* (a) 零结果降级:多词严格 AND 必然扑空的组合 → 出「部分匹配」提示且仍有结果 */
    await open('#/search/' + encodeURIComponent('余弦相似度 zzz不存在的词'));
    await page.waitForFunction(() => document.querySelector('#s-results .empty') || document.querySelector('.search-partial') || document.querySelector('.search-item'), null, { timeout: 15000 });
    await page.waitForFunction(() => {
      const partial = document.querySelector('.search-partial');
      const items = document.querySelectorAll('.search-item');
      return (partial && items.length > 0) || (!partial && document.querySelector('#s-results .empty'));
    }, null, { timeout: 15000 });
    check('零结果降级显示部分匹配提示', await page.locator('.search-partial').count() === 1);
    check('部分匹配提示文案正确', (await page.locator('.search-partial').textContent()).includes('未找到全部匹配'));
    check('降级后仍有结果', await page.locator('.search-item').count() > 0);
    /* 对照组:正常严格命中不出现提示 */
    await open('#/search/' + encodeURIComponent('余弦相似度'));
    await page.waitForFunction(() => document.querySelectorAll('.search-item').length > 0, null, { timeout: 15000 });
    check('严格命中不出现部分匹配提示', await page.locator('.search-partial').count() === 0);

    /* (c) 主题跟随系统:未显式选择 + colorScheme dark → data-theme=dark;
           显式 light → 即使系统 dark 也保持 light。 */
    await page.evaluate(() => localStorage.removeItem('aiiv:theme'));
    const page2 = await context.newPage();
    const errors2 = [];
    page2.on('pageerror', e => errors2.push(e.message));
    const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 850 }, colorScheme: 'dark' });
    const p2 = await ctx2.newPage();
    const errors3 = [];
    p2.on('pageerror', e => errors3.push(e.message));
    await p2.goto(BASE + '/__seed__');
    await p2.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    await p2.goto(BASE + '/index.html#/home');
    await p2.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    check('未显式选择 + 系统 dark → 页面为暗色', await p2.evaluate(() => document.documentElement.getAttribute('data-theme') === 'dark'));
    /* 显式 light:同一 dark 系统下,点切换按钮写入 light 后重开仍为 light */
    await p2.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'light');
      localStorage.setItem('aiiv:theme', 'light');
    });
    await p2.reload();
    await p2.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    check('显式 light + 系统 dark → 保持亮色', await p2.evaluate(() => document.documentElement.getAttribute('data-theme') !== 'dark'));

    /* (d) 空格键不再被全局 keydown 吞掉:学习页非交互焦点下向输入框打空格。
           修复前:StudyView 的全局 handler 对空格 preventDefault(哪怕 #expand-all
           已不存在),输入框里打不出空格。 */
    await page.evaluate(() => localStorage.setItem('aiiv:theme', 'light'));
    await open('#/home');
    const firstQid = await page.evaluate(() => Data.allQuestions()[0].id);
    await open('#/study/' + firstQid);
    await page.waitForFunction(() => !!document.querySelector('#note-area'), null, { timeout: 30000 });
    await page.click('#note-area');
    await page.keyboard.type('a b');
    const noteVal = await page.evaluate(() => document.querySelector('#note-area').value);
    check('学习页笔记框可输入空格', noteVal === 'a b', '实际: ' + JSON.stringify(noteVal));
    /* 方向键快捷键仍在 */
    await page.evaluate(() => document.activeElement && document.activeElement.blur());
    await page.keyboard.press('ArrowRight');
    await sleep(400);
    check('方向键翻题仍生效', await page.evaluate(qid => location.hash !== '#/study/' + qid, firstQid));

    check('全程无 JS 异常(主页面)', errors.length === 0, errors.join('|'));
    check('全程无 JS 异常(暗色页面)', errors2.length === 0 && errors3.length === 0, (errors2.concat(errors3)).join('|'));
    await ctx2.close();
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
