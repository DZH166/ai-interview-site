/* 模拟面试考试模式/单题倒计时/语音口述(Stage2)浏览器验收。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/mock-exam.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9460', BASE = 'http://127.0.0.1:' + PORT;
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
      try {
        await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
        await page.waitForFunction(() => typeof Data !== 'undefined' && Data.questionsLoaded(), null, { timeout: 60000 });
      } catch (e) {
        const st = await page.evaluate(() => ({ url: location.href, empty: (document.querySelector('#view .empty') || {}).textContent || null })).catch(() => ({}));
        console.log('  DEBUG open fail:', JSON.stringify(st));
        throw e;
      }
    };
    /* 走配置 UI 开一场考试模式会话(全专题,5 题) */
    const startExam = async (tlimit = '0') => {
      await open('#/mock');
      await page.selectOption('#m-tlimit', tlimit);
      await page.locator('#m-exam').check();
      await page.locator('#m-start').click();
      await page.waitForFunction(() => /^#\/mock\/run/.test(location.hash) && document.querySelector('.mock-run'), null, { timeout: 60000 });
    };

    /* ---- 1. 考试模式:期间不出现对照入口与参考要点 ---- */
    await startExam();
    check('考试模式:进度行有「考试模式」徽标', await page.locator('.mock-run .badge:has-text("考试模式")').count() >= 1);
    check('考试模式:无对照参考按钮', await page.locator('#m-reveal').count() === 0);
    check('考试模式:有锁定提示', (await page.locator('.mock-actions').innerText()).includes('统一对照'));
    check('不限时:无倒计时牌', await page.locator('#m-countdown').count() === 0);
    await page.locator('#m-self').fill('考试模式下的口述练习答案');
    await page.locator('#m-next').click();
    check('考试模式:第二题仍无对照按钮', await page.locator('#m-reveal').count() === 0);
    /* 完成整轮(逐题走到最后一题点完成) */
    while (await page.locator('#m-next').count()) await page.locator('#m-next').click();
    await page.locator('#m-finish').click();
    await page.waitForSelector('.round-list', { timeout: 30000 });
    check('考试模式:完成页汇总带「考试模式」', (await page.locator('.card p.muted').first().innerText()).includes('考试模式'));
    check('考试模式:完成页展开参考要点(exam-ref)', await page.locator('.exam-ref').count() >= 1);
    await open('#/review?t=rounds');
    await page.waitForSelector('.round-details', { timeout: 30000 });
    check('复习历史:轮次摘要带「考试模式」徽标', await page.locator('.round-summary .badge:has-text("考试模式")').count() >= 1);

    /* ---- 2. 考试模式 + quiz 判定:只看对错不看解析,完成页出对错徽标 ---- */
    await open('#/mock');
    await page.evaluate(() => { $$('#m-topics input:checked').forEach(i => { i.checked = false; }); });
    await page.locator('#m-topics input[value="quiz-ml"]').check();
    await page.selectOption('#m-count', '5');
    await page.locator('#m-exam').check();
    await page.locator('#m-start').click();
    await page.waitForFunction(() => document.querySelector('.mock-run') && document.querySelector('[data-quiz-pick]'), null, { timeout: 60000 });
    await page.locator('[data-quiz-pick]:not(.quiz-is-right)').first().click();
    /* 多选题需「确认答案」才判定;单选即点即判 */
    if (await page.locator('[data-quiz-confirm]:visible').count()) await page.locator('[data-quiz-confirm]:visible').first().click();
    check('考试模式 quiz:判定后出结果行(答错)', (await page.locator('.quiz-result').first().innerText()).includes('答错'));
    check('考试模式 quiz:判定后无参考要点区块', await page.locator('.mock-ref').count() === 0);
    while (await page.locator('#m-next').count()) await page.locator('#m-next').click();
    await page.locator('#m-finish').click();
    await page.waitForSelector('.round-list', { timeout: 30000 });
    check('考试模式 quiz:完成页有「✗ 答错」徽标', await page.locator('.round-head .badge:has-text("✗ 答错")').count() >= 1);
    check('考试模式 quiz:完成页参考要点含解析文本', await page.evaluate(() => {
      const el = document.querySelector('.exam-ref');
      return !!el && (el.textContent || '').length > 20;
    }));
    await open('#/review?t=rounds');
    await page.waitForSelector('.round-details', { timeout: 30000 });
    check('复习历史:quiz 考试项显示「已判定未对照」', await page.evaluate(() =>
      [...document.querySelectorAll('.round-list')].some(el => (el.textContent || '').includes('已判定'))));

    /* ---- 3. 单题倒计时:到点自动推进 + 手动导航后旧定时器自毁 ---- */
    /* 直接种草稿(config.timeLimitSec=3)走恢复路径 */
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => {
      /* __seed__ 是清空不是预置:必须整包写入(records 形状与其余套件的种子一致) */
      localStorage.setItem('aiiv:records', JSON.stringify({
        v: 3, questions: {},
        mock: { rounds: [], drillAttempts: {}, ui: {},
          draft: { config: { topics: [], diffs: [], count: 2, timeLimitSec: 3, examMode: false },
            items: [{ qid: 'AG-001' }, { qid: 'AG-002' }], idx: 0, answers: {},
            directed: true, label: '倒计时测试', savedAt: Date.now(), sessionId: 'ms-exam-cd' } }
      }));
    });
    await open('#/mock/run');
    await page.waitForSelector('#m-countdown', { timeout: 30000 });
    const cd0 = await page.locator('#m-countdown').innerText();
    check('倒计时牌出现且在走', /^0:0[123]$/.test(cd0.trim()) || /^\d+:\d\d$/.test(cd0.trim()), cd0);
    await sleep(4200);   /* 越过 3 秒限时 */
    check('到点自动进入下一题', (await page.locator('.mock-progress span').first().innerText()).includes('第 2 / 2 题'));
    await page.locator('#m-finish').click();
    await page.waitForSelector('.round-list', { timeout: 30000 });
    check('完成页超时题带 ⏰ 标记', await page.locator('.round-head .badge:has-text("⏰")').count() >= 1);
    /* 手动导航后旧定时器必须自毁:3 秒限时,人先点下一题,等待后不得双重推进 */
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => {
      localStorage.setItem('aiiv:records', JSON.stringify({
        v: 3, questions: {},
        mock: { rounds: [], drillAttempts: {}, ui: {},
          draft: { config: { topics: [], diffs: [], count: 3, timeLimitSec: 3, examMode: false },
            items: [{ qid: 'AG-001' }, { qid: 'AG-002' }, { qid: 'AG-003' }], idx: 0, answers: {},
            directed: true, label: '倒计时测试2', savedAt: Date.now(), sessionId: 'ms-exam-cd2' } }
      }));
    });
    await open('#/mock/run');
    await page.waitForSelector('#m-countdown', { timeout: 30000 });
    await page.locator('#m-next').click();   /* 限时内手动换题 → 旧定时器应作废,新定时器重新武装 */
    await sleep(4200);   /* 越过 3 秒:q1 的过期定时器若未自毁会在此窗口双重推进 */
    check('手动导航后仍在本轮(未误结束)', await page.locator('.mock-run').count() === 1);
    check('到点恰好推进一次(第 3 / 3 题)', (await page.locator('.mock-progress span').first().innerText()).includes('第 3 / 3 题'));

    /* ---- 4. 语音口述:支持则按钮可用并可切换,不支持则不渲染(无死 UI) ---- */
    const hasSR = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
    await open('#/mock');
    await page.selectOption('#m-tlimit', '0');
    await page.locator('#m-start').click();
    await page.waitForSelector('.mock-run', { timeout: 60000 });
    const micCount = await page.locator('#m-mic').count();
    check('口述按钮按能力渲染', hasSR ? micCount === 1 : micCount === 0, 'SR=' + hasSR);
    if (hasSR && micCount === 1) {
      await page.locator('#m-mic').click();
      check('口述开启:按钮进入录音态', await page.locator('#m-mic.recording').count() === 1);
      await page.locator('#m-mic').click();
      check('口述关闭:按钮恢复', await page.locator('#m-mic.recording').count() === 0);
    }

    check('全程无 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
