/* 统计可视化(Track C)浏览器验收:热力表 / SRS 到期预测 / 错题分布 / 空态 / 360px。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/stats-view.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9722', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
const check = (n, ok, d) => { assert(ok, n + (d ? ' :: ' + d : '')); passed++; console.log('  PASS', n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 24 * 60 * 60 * 1000;

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

    /* 在种子页写 localStorage,再进应用页(绕开 pagehide 兜底的写回) */
    const seed = async records => {
      await page.goto(BASE + '/__seed__');
      await page.evaluate(r => localStorage.setItem('aiiv:records', JSON.stringify(r)), records);
    };
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    };
    /* 进复习页并点开「统计」标签 */
    const openStats = async () => {
      await open('#/review');
      await page.locator('.rtab[data-tab="stats"]').click();
      await page.waitForFunction(() => document.querySelector('[data-test="stats-heat"]'), null, { timeout: 15000 });
    };

    /* ---- 有数据的场景 ----
       种子:两个已知专题的题目,状态覆盖 weak/ok/review/未练习;
       srs:今天到期 1 题、+3 天 1 题、逾期 1 题;
       mock:一轮里 2 个 weak 标记(专题 A 2 次、专题 B 0 次→验证只统计 weak)。 */
    const now = Date.now();
    const today0 = new Date(); today0.setHours(0, 0, 0, 0);
    const dueToday = today0.getTime() + 2 * 3600 * 1000;         /* 今天内(今天 02:00) */
    const due3d = today0.getTime() + 3 * DAY + 3600 * 1000;      /* 第 3 天 */
    const overdue = now - 2 * DAY;                                /* 逾期 */
    const records = {
      v: 3,
      questions: {
        'AG-001': { status: 'weak', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0, _updatedAt: now },
        'AG-002': { status: 'weak', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0, _updatedAt: now },
        'AG-003': { status: 'ok', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0,
                    srs: { due: dueToday, ivl: 1, ease: 2.5, streak: 1, lapses: 0, lastAt: now - DAY, lastRating: 'good' }, _updatedAt: now },
        'RG-001': { status: 'ok', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 },
        'RG-002': { status: 'review', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0,
                    srs: { due: due3d, ivl: 3, ease: 2.5, streak: 1, lapses: 0, lastAt: now, lastRating: 'good' }, _updatedAt: now },
        'RG-003': { status: 'ok', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0,
                    srs: { due: overdue, ivl: 1, ease: 2.5, streak: 0, lapses: 1, lastAt: now - 3 * DAY, lastRating: 'good' }, _updatedAt: now },
        'RG-004': { status: '', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 },
      },
      mock: { rounds: [{ ts: now, sessionId: 'seed-s1', items: [
        { qid: 'AG-001', mark: 'weak' }, { qid: 'AG-002', mark: 'weak' },
        { qid: 'RG-001', mark: '' }, { qid: 'RG-002', mark: 'ok' },
      ] }], draft: null, ended: { 'seed-s1': { status: 'completed', ts: now } } },
      drillAttempts: {}, ui: {}
    };
    await seed(records);
    await openStats();

    /* 热力表:行 = 全部专题;种子专题计数正确(未种记录的题按「未练习」计入,
       所以 agent 未练习 = 题库 agent 总数 − 种子的 3 题) */
    check('热力表渲染全部专题行(20 行)', await page.locator('.stats-heat tbody tr').count() === 20);
    const counts = await page.evaluate(() => {
      const bankAgent = window.APP_DATA.questions.filter(q => q.topic === 'agent').length;
      const bankRag = window.APP_DATA.questions.filter(q => q.topic === 'rag').length;
      const cell = tr => [...tr.querySelectorAll('td.sh-cell')].map(td => Number(td.dataset.count));
      return {
        agent: cell(document.querySelector('.stats-heat tbody tr[data-topic="agent"]')),
        rag: cell(document.querySelector('.stats-heat tbody tr[data-topic="rag"]')),
        unPracticedAgent: bankAgent - 3, unPracticedRag: bankRag - 3,   /* RG-004 状态为空,仍计入未练习 */
      };
    });
    check('agent 行:未练习(全库−3)/ 还不熟 2 / 基本掌握 1 / 待复习 0',
      counts.agent && counts.agent.join(',') === [counts.unPracticedAgent, 2, 1, 0].join(','), JSON.stringify(counts));
    check('rag 行:未练习(全库−3)/ 还不熟 0 / 基本掌握 2 / 待复习 1',
      counts.rag && counts.rag.join(',') === [counts.unPracticedRag, 0, 2, 1].join(','), JSON.stringify(counts));
    check('热力格带色阶(有计数的格有背景色)', await page.evaluate(() => {
      const td = document.querySelector('.stats-heat tbody tr[data-topic="agent"] td.sh-cell[data-status="weak"]');
      return td && td.getAttribute('style') && td.getAttribute('style').includes('rgba(220,38,38');
    }));
    check('行标签链到 #/browse?t=', await page.locator('.stats-heat tbody tr[data-topic="agent"] th a[href="#/browse?t=agent"]').count() === 1);

    /* 到期预测:今天 1 / 7天内 2(今天+第3天)/ 30天内 2 / 逾期 1 */
    const summary = await page.locator('[data-test="stats-forecast-summary"]').textContent();
    check('到期摘要:今天 1 · 7天内 2 · 30天内 2 · 逾期 1',
      /今天到期\s*1\b/.test(summary) && /7天内\s*2\b/.test(summary)
      && /30天内\s*2\b/.test(summary) && /逾期\s*1\b/.test(summary), summary.trim());
    check('30 根柱子渲染', await page.locator('.stats-forecast .sf-col').count() === 30);
    check('今天的柱子高亮', await page.locator('.stats-forecast .sf-col.sf-today .sf-bar').count() === 1);

    /* 错题分布:agent 2 次,降序在最前;未标记 weak 的题不计入 */
    const weakRows = await page.evaluate(() =>
      [...document.querySelectorAll('.stats-dist .sd-row')].map(r => ({
        topic: r.dataset.topic, n: Number(r.querySelector('.sd-count').dataset.count)
      })));
    check('错题分布只含 agent(2 次)且降序',
      weakRows.length === 1 && weakRows[0].topic === 'agent' && weakRows[0].n === 2, JSON.stringify(weakRows));

    check('有数据场景全程无 JS 异常', errors.length === 0, errors.join('|'));

    /* ---- 空态场景:全新记录。热力表仍渲染全专题(题库未练习计数),
       预测与错题分布两块给出友好空态,全程无崩溃。
       (复习页自身会把题库全部题目物化成空白记录——既有行为——
       所以「空记录」下热力表的未练习列 = 各专题题库题数,不是 0。) */
    errors.length = 0;
    await seed({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} });
    await openStats();
    check('空数据:热力表仍有全部专题行,非未练习列全为 0', await page.evaluate(() => {
      const rows = document.querySelectorAll('.stats-heat tbody tr');
      if (rows.length !== 20) return false;
      return [...rows].every(tr => {
        const cells = [...tr.querySelectorAll('td.sh-cell')];
        return cells[0].dataset.count !== '0' &&
          cells.slice(1).every(td => td.dataset.count === '0');
      });
    }));
    check('空数据:预测与错题分布两块都有空态文案', await page.evaluate(() => {
      const empties = [...document.querySelectorAll('.stats-block .empty')];
      return empties.length === 2 && empties[0].textContent.includes('间隔重复排期')
        && empties[1].textContent.includes('错题');
    }));
    check('空数据:错题分布无柱状行', await page.locator('[data-test="stats-weak"]').count() === 0);
    check('空数据场景全程无 JS 异常', errors.length === 0, errors.join('|'));

    /* ---- 360px 无横向溢出 ---- */
    await page.setViewportSize({ width: 360, height: 800 });
    await openStats();
    check('360px 统计页无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
