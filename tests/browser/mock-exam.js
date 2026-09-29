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
const NEUTRAL = '已提交，完成本轮后查看结果';

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1200, height: 850 } });
    // 验证识别结果接入和生命周期，不启用真实麦克风或外部识别服务。
    await context.addInitScript(() => {
      window.__speech = { starts: 0, stops: 0, instances: [] };
      window.SpeechRecognition = class {
        constructor() { window.__speech.instances.push(this); }
        start() { window.__speech.starts++; }
        stop() { window.__speech.stops++; }
      };
    });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      try {
        await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
        if (hash === '#/mock/run') await page.waitForSelector('#m-self');
      } catch (e) {
        const st = await page.evaluate(() => ({ url: location.href, empty: (document.querySelector('#view .empty') || {}).textContent || null })).catch(() => ({}));
        console.log('  DEBUG open fail:', JSON.stringify(st));
        throw e;
      }
    };
    /* 走配置 UI 开一场考试模式会话(全专题,5 题) */
    const startExam = async (tlimit = '0') => {
      await open('#/mock');
      await page.selectOption('#m-count', '5');
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
    await page.waitForSelector('#m-self');
    check('考试模式:第二题仍无对照按钮', await page.locator('#m-reveal').count() === 0);
    /* 完成整轮(逐题走到最后一题点完成) */
    while (await page.locator('#m-next').count()) { await page.locator('#m-next').click(); await page.waitForSelector('#m-self'); }
    await page.locator('#m-finish').click();
    await page.waitForSelector('.round-list', { timeout: 30000 });
    check('考试模式:完成页汇总带「考试模式」', (await page.locator('.card p.muted').first().innerText()).includes('考试模式'));
    check('考试模式:完成页展开参考要点(exam-ref)', await page.locator('.exam-ref').count() >= 1);
    await open('#/review?t=rounds');
    await page.waitForSelector('.round-details', { timeout: 30000 });
    check('复习历史:轮次摘要带「考试模式」徽标', await page.locator('.round-summary .badge:has-text("考试模式")').count() >= 1);

    /* ---- 2. 考试模式提交只给中性状态，完成页才出对错与解析 ---- */
    await open('#/mock');
    await page.evaluate(() => { $$('#m-topics input:checked').forEach(i => { i.checked = false; }); });
    await page.locator('#m-topics input[value="quiz-ml"]').check();
    await page.selectOption('#m-count', '5');
    await page.locator('#m-exam').check();
    await page.locator('#m-start').click();
    await page.waitForFunction(() => document.querySelector('.mock-run') && document.querySelector('[data-quiz-pick]'), null, { timeout: 60000 });
    const wrong = await page.evaluate(() => {
      const d = Store.data.mock.draft, id = d.items[d.idx].qid;
      return Data.question(id).options.find(o => !o.right).label;
    });
    await page.locator('[data-quiz-pick="' + wrong + '"]').click();
    /* 多选题需「确认答案」才判定;单选即点即判 */
    if (await page.locator('[data-quiz-confirm]:visible').count()) await page.locator('[data-quiz-confirm]:visible').first().click();
    check('考试模式 quiz:提交仅显示中性状态', await page.locator('.quiz-result').first().innerText() === NEUTRAL);
    check('考试模式 quiz:判定后无参考要点区块', await page.locator('.mock-ref').count() === 0);
    check('考试模式 quiz:不以颜色或标记泄露对错', await page.locator('.quiz-revealed, .quiz-is-right, .quiz-is-wrong, .quiz-result-ok, .quiz-result-bad, .mock-ref, #m-revision').count() === 0
      && await page.evaluate(() => { const d = Store.data.mock.draft, r = Store.rec(d.items[d.idx].qid); return !r.lastSelfTest && r.status !== 'weak'; }));
    await page.reload(); await page.waitForSelector('#m-self');
    check('考试模式 quiz:刷新仍中性且保持提交记录', await page.locator('.quiz-revealed, .quiz-is-right, .quiz-is-wrong, .quiz-result-ok, .quiz-result-bad, .mock-ref').count() === 0
      && await page.locator('[data-quiz-result]').innerText() === NEUTRAL && await page.locator('[data-quiz-redo]').isVisible());
    while (await page.locator('#m-next').count()) { await page.locator('#m-next').click(); await page.waitForSelector('#m-self'); }
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

    for (const qtype of ['single', 'multi']) {
      await page.goto(BASE + '/__seed__');
      await page.evaluate(qtype => {
        const id = qtype === 'single' ? 'MLQ-0001' : 'CVQ-0015';
        const questionSnapshot = { id, title: '考试快照键盘回归', topic: qtype === 'single' ? 'quiz-ml' : 'quiz-cv',
          format: 'quiz', type: 'quiz', difficulty: 'basic', qtype, prompt: '请选择快照定义的正确选项',
          options: ['A', 'B', 'C'].map(label => ({ label, text: label + '快照选项', right: qtype === 'single' ? label === 'B' : label !== 'B' })),
          answer: 'EXAM_SNAPSHOT_REFERENCE', plain: 'EXAM_SNAPSHOT_EXPLANATION' };
        localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { [id]: { status: 'ok', _updatedAt: 1,
          lastSelfTest: { at: 1, correct: false, picked: ['C'] } } }, mock: { rounds: [],
          draft: { sessionId: 'exam-keyboard-' + qtype, savedAt: Date.now(), config: { examMode: true, timeLimitSec: 0 },
            items: [{ qid: id }], idx: 0, answers: { [id]: { self: '', revealed: false, questionSnapshot } } } }, drillAttempts: {}, ui: {} }));
      }, qtype);
      await open('#/mock/run');
      const wrongPick = qtype === 'single' ? 'A' : 'B';
      await page.locator('[data-quiz-pick="' + wrongPick + '"]').focus(); await page.keyboard.press('Enter');
      if (qtype === 'multi') { await page.locator('[data-quiz-confirm]').focus(); await page.keyboard.press('Space'); }
      check(qtype + ': 错误提交也只显示中性状态', await page.locator('[data-quiz-result]').innerText() === NEUTRAL
        && await page.locator('.quiz-revealed,.quiz-is-right,.quiz-is-wrong,.quiz-result-ok,.quiz-result-bad,.mock-ref').count() === 0);
      check(qtype + ': 提交不污染以前的自测结果与状态', await page.evaluate(() => {
        const d = Store.data.mock.draft, r = Store.rec(d.items[d.idx].qid);
        return r.status === 'ok' && r.lastSelfTest.at === 1 && r.lastSelfTest.picked.join() === 'C';
      }));
      await page.reload(); await page.waitForSelector('[data-quiz-redo]:visible');
      check(qtype + ': 刷新保留判题但隐藏快照参考', !(await page.locator('#view').innerText()).includes('EXAM_SNAPSHOT_REFERENCE')
        && await page.locator('.quiz-is-right,.quiz-revealed,.quiz-result-ok,.quiz-result-bad').count() === 0
        && await page.locator('[data-quiz-result]').innerText() === NEUTRAL);
      await page.locator('[data-quiz-redo]').focus(); await page.keyboard.press('Space');
      check(qtype + ': 考试重做保留以前的全局历史', await page.evaluate(() => {
        const d = Store.data.mock.draft, r = Store.rec(d.items[d.idx].qid);
        return r.status === 'ok' && r.lastSelfTest.at === 1 && r.lastSelfTest.picked.join() === 'C';
      }));
      for (const label of qtype === 'single' ? ['B'] : ['A', 'C']) {
        await page.locator('[data-quiz-pick="' + label + '"]').focus(); await page.keyboard.press('Enter');
      }
      if (qtype === 'multi') { await page.locator('[data-quiz-confirm]').focus(); await page.keyboard.press('Enter'); }
      check(qtype + ': 正确提交同样中性且焦点稳定', await page.locator('[data-quiz-result]').innerText() === NEUTRAL
        && await page.locator('.quiz-result-ok,.quiz-result-bad,.quiz-is-right,.quiz-is-wrong').count() === 0
        && await page.evaluate(() => document.activeElement.matches('[data-quiz-redo]')));
      if (qtype === 'single') {
        await page.locator('[data-quiz-redo]').click(); await page.locator('[data-quiz-pick="A"]').click();
        await page.evaluate(() => {
          const original = Storage.prototype.setItem;
          window.__restoreExamStorage = () => { Storage.prototype.setItem = original; };
          Storage.prototype.setItem = function(key, value) { if (key === 'aiiv:records') throw new DOMException('full', 'QuotaExceededError'); return original.call(this, key, value); };
        });
        await page.locator('#m-finish').click();
        check('考试完成保存失败回滚全局判定/薄弱状态/次数', await page.evaluate(() => {
          const r = Store.rec('MLQ-0001');
          return Store.data.mock.rounds.length === 0 && !!Store.data.mock.draft && r.status === 'ok'
            && r.lastSelfTest.at === 1 && r.lastSelfTest.picked.join() === 'C' && !r.practiceCount;
        }) && await page.locator('[data-quiz-result]').innerText() === NEUTRAL);
        await page.evaluate(() => window.__restoreExamStorage());
      }
      await page.locator('#m-finish').click(); await page.waitForSelector('.round-list');
      await page.locator('.exam-ref > summary').click();
      const completedState = await page.evaluate(() => {
        const ref = document.querySelector('.exam-ref'), it = Store.data.mock.rounds[0]?.items[0];
        return { referenceVisibleText: ref?.innerText, referenceAllText: ref?.textContent,
          referenceOpen: ref?.open, item: it, record: it && Store.rec(it.qid) };
      });
      check(qtype + ': 完成后才显示同一快照参考并计一次', (await page.locator('.exam-ref').innerText()).includes('EXAM_SNAPSHOT_REFERENCE')
        && await page.evaluate(qtype => {
          const it = Store.data.mock.rounds[0].items[0];
          const r = Store.rec(it.qid), expected = qtype === 'multi';
          return it.quizCorrect === expected && it.quizJudged && !it.revealed && r.practiceCount === 1
            && r.lastSelfTest.correct === expected && r.status === (expected ? 'ok' : 'weak');
        }, qtype), JSON.stringify(completedState));
    }

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
    await page.waitForFunction(() => document.querySelector('#m-countdown')?.textContent === '0:02', null, { timeout: 3000 });
    await page.locator('#m-self').fill('倒计时期间的原回答');
    await page.locator('#m-reveal').click();
    check('揭示参考的同题重绘不重置单题限时', await page.locator('#m-countdown').innerText() !== '0:03');
    await page.locator('#m-revision').fill('倒计时期间的独立修订');
    await page.waitForFunction(() => document.querySelector('.mock-progress span')?.textContent.includes('第 2 / 2 题'), null, { timeout: 5000 });
    check('到点自动进入下一题', (await page.locator('.mock-progress span').first().innerText()).includes('第 2 / 2 题'));
    check('自动换题保留原回答修订及超时标志', await page.evaluate(() => {
      const a = Store.data.mock.draft.answers['AG-001'];
      return a.self === '倒计时期间的原回答' && a.revision === '倒计时期间的独立修订' && a.timeout === true;
    }));
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
    await page.locator('#m-quit').click(); await page.waitForSelector('.round-list');

    /* ---- 4. 语音口述:支持则按钮可用并可切换,不支持则不渲染(无死 UI) ---- */
    const hasSR = await page.evaluate(() => !!(window.SpeechRecognition || window.webkitSpeechRecognition));
    await open('#/mock');
    await page.selectOption('#m-tlimit', '0');
    await page.locator('#m-start').click();
    await page.waitForSelector('.mock-run', { timeout: 60000 });
    const micCount = await page.locator('#m-mic').count();
    check('口述按钮按能力渲染', hasSR ? micCount === 1 : micCount === 0, 'SR=' + hasSR);
    if (hasSR && micCount === 1) {
      check('口述必须显式点击才能启用', await page.evaluate(() => window.__speech.starts === 0));
      await page.locator('#m-mic').click();
      check('口述开启:按钮进入录音态', await page.locator('#m-mic.recording').count() === 1);
      await page.evaluate(() => {
        const rec = window.__speech.instances.at(-1);
        window.__lateSpeech = rec.onresult;
        const final = [{ transcript: '语音输入测试' }]; final.isFinal = true;
        rec.onresult({ resultIndex: 0, results: [final] });
      });
      check('口述最终结果进入可编辑回答', (await page.locator('#m-self').inputValue()).includes('语音输入测试'));
      await page.locator('#m-mic').click();
      check('口述关闭:按钮恢复', await page.locator('#m-mic.recording').count() === 0);
      await page.locator('#m-next').click(); await page.waitForSelector('#m-self');
      const nextAnswer = await page.locator('#m-self').inputValue();
      await page.evaluate(() => {
        const final = [{ transcript: '停止后的延迟结果不得写入' }]; final.isFinal = true;
        window.__lateSpeech({ resultIndex: 0, results: [final] });
      });
      check('停录和换题后旧语音回调不能污染回答', await page.locator('#m-self').inputValue() === nextAnswer
        && await page.evaluate(() => window.__speech.instances[0].onresult === null));
    }

    check('全程无 JS 异常', errors.length === 0, errors.join(' | '));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
