/* 牛客选择题「点击作答」+「重练乱序」浏览器验收(Stage1)。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/quiz-answer.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9410', BASE = 'http://127.0.0.1:' + PORT;
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
    /* 空记录种子;seedRecords 可注入特定状态(lastSelfTest/status/ui.shuffleOptions) */
    const seedRecords = (over) => {
      const base = { v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} };
      return JSON.stringify(Object.assign(base, over || {}));
    };
    await page.goto(BASE + '/__seed__');
    await page.evaluate(s => localStorage.setItem('aiiv:records', s), seedRecords());
    const open = async hash => {
      await page.goto(BASE + '/index.html' + hash);
      try {
        await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
      } catch (e) {
        const st = await page.evaluate(() => ({
          store: typeof Store !== 'undefined',
          children: document.querySelector('#view') ? document.querySelector('#view').children.length : -1,
          empty: (document.querySelector('#view .empty') || {}).textContent || null,
          url: location.href
        })).catch(e2 => ({ evalfail: e2.message.slice(0, 80) }));
        console.log('  DEBUG open fail:', JSON.stringify(st));
        throw e;
      }
      /* quiz 题正文来自分片异步合并:依赖选项渲染的用例都走这道门 */
      await page.waitForFunction(() => typeof Data !== 'undefined' && Data.questionsLoaded(), null, { timeout: 60000 });
    };
    const reseed = async s => {
      await page.goto(BASE + '/__seed__');
      await page.evaluate(s2 => localStorage.setItem('aiiv:records', s2), s);
    };

    /* ================= A. 点击作答:答对 ================= */
    await open('#/study/MLQ-0001');   /* 正确项 B */
    check('未作答时选项可点击(role=button + tabindex)', await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.quiz-options .quiz-opt')];
      return opts.length >= 2 && opts.every(o => o.getAttribute('role') === 'button' && o.getAttribute('tabindex') === '0');
    }));
    check('未作答时不显示正确项( Conceal 契约不破)', await page.locator('.quiz-options.quiz-revealed').count() === 0);
    /* 判定前答案文本不得泄漏(practice-contract 的安全属性在新交互下同样成立) */
    check('判定前官方解析不泄漏', !(await page.locator('#view').innerText()).includes('（选项B）最适合'));
    check('可点击项有 cursor:pointer 供能', await page.evaluate(() => {
      const el = document.querySelector('.quiz-options .quiz-opt[data-quiz-pick]');
      return el && getComputedStyle(el).cursor === 'pointer';
    }));
    await page.locator('.quiz-opt[data-quiz-pick="B"]').click();
    await page.waitForFunction(() => document.querySelector('.quiz-options.quiz-judged'));
    check('答对:结果行显示「答对了」', await page.evaluate(() => {
      const r = document.querySelector('[data-quiz-result]');
      return r && !r.hidden && r.textContent === '答对了' && r.classList.contains('quiz-result-ok');
    }));
    check('答对:正确项高亮 + 答案区块自动展开', await page.evaluate(() => {
      const box = document.querySelector('.quiz-options.quiz-judged.quiz-revealed');
      const right = box.querySelector('.quiz-opt.quiz-is-right');
      return !!box && !!right && !document.querySelector('.quiz-answer-block.quiz-answer-hidden');
    }));
    check('答对:lastSelfTest.correct=true 且 picked=[B]', await page.evaluate(() => {
      const t = Store.rec('MLQ-0001').lastSelfTest;
      return t && t.correct === true && JSON.stringify(t.picked) === '["B"]' && typeof t.at === 'number';
    }));
    check('答对:状态不自动标 ok', await page.evaluate(() => (Store.rec('MLQ-0001').status || '') === ''));
    check('判定后选项不再可点(role 已摘)', await page.evaluate(() =>
      document.querySelectorAll('.quiz-options.quiz-judged .quiz-opt[role="button"]').length === 0));

    /* ================= A. 点击作答:答错 ================= */
    await reseed(seedRecords());
    await open('#/study/MLQ-0001');
    await page.locator('.quiz-opt[data-quiz-pick="A"]').click();
    await page.waitForFunction(() => document.querySelector('.quiz-options.quiz-judged'));
    check('答错:结果行「答错了·已标记还不熟」', await page.evaluate(() => {
      const r = document.querySelector('[data-quiz-result]');
      return r && !r.hidden && r.textContent === '答错了·已标记还不熟' && r.classList.contains('quiz-result-bad');
    }));
    check('答错:选中项红染 + 正确项高亮', await page.evaluate(() => {
      const box = document.querySelector('.quiz-options');
      const wrong = box.querySelector('.quiz-opt.quiz-is-wrong');
      const right = box.querySelector('.quiz-opt.quiz-is-right');
      return !!wrong && !!right && getComputedStyle(wrong).borderColor !== '';
    }));
    check('答错:status=weak 且 lastSelfTest.correct=false', await page.evaluate(() =>
      Store.rec('MLQ-0001').status === 'weak' && Store.rec('MLQ-0001').lastSelfTest.correct === false));
    check('答错进入 SRS:排期 rating=again', await page.evaluate(() => {
      const s = Store.rec('MLQ-0001').srs;
      return s && s.lastRating === 'again';
    }));

    /* ================= A3. 已作答态渲染 + 重做 ================= */
    await page.reload();
    await page.waitForFunction(() => document.querySelector('.quiz-options.quiz-judged'), null, { timeout: 30000 });
    check('刷新后渲染已作答态(quiz-judged + 历史选择)', await page.evaluate(() => {
      const box = document.querySelector('.quiz-options.quiz-judged');
      return !!box && !!box.querySelector('.quiz-opt.quiz-is-wrong[data-quiz-pick="A"]');
    }));
    check('刷新后重做按钮存在且可见', await page.evaluate(() => {
      const b = document.querySelector('[data-quiz-redo]');
      return b && !b.hidden;
    }));
    await page.locator('[data-quiz-redo]').click();
    check('重做:清除 lastSelfTest 并恢复可点击', await page.evaluate(() => {
      const box = document.querySelector('.quiz-options');
      const opts = [...box.querySelectorAll('.quiz-opt[data-quiz-pick]')];
      return Store.rec('MLQ-0001').lastSelfTest === undefined
        && !box.classList.contains('quiz-judged')
        && opts.every(o => o.getAttribute('role') === 'button');
    }));
    check('重做不撤销 weak 状态(那次作答真实发生过)', await page.evaluate(() => Store.rec('MLQ-0001').status === 'weak'));

    /* ================= A1. 多选:切换 + 确认判定 ================= */
    await reseed(seedRecords());
    await open('#/study/CVQ-0015');   /* multi,正确 A、C */
    check('多选题渲染确认按钮(选中前隐藏)', await page.evaluate(() => {
      const b = document.querySelector('[data-quiz-confirm]');
      return b && b.hidden && document.querySelector('.quiz-options').dataset.quizMulti === '1';
    }));
    await page.locator('.quiz-opt[data-quiz-pick="A"]').click();
    await page.locator('.quiz-opt[data-quiz-pick="C"]').click();
    check('多选:点击切换选中态(quiz-picked)', await page.evaluate(() =>
      document.querySelectorAll('.quiz-opt.quiz-picked').length === 2));
    check('多选:有选中后确认按钮出现', await page.evaluate(() => !document.querySelector('[data-quiz-confirm]').hidden));
    await page.locator('[data-quiz-confirm]').click();
    await page.waitForFunction(() => document.querySelector('.quiz-options.quiz-judged'));
    check('多选判定:选 AC 判对(答对了 + picked=[A,C])', await page.evaluate(() => {
      const t = Store.rec('CVQ-0015').lastSelfTest;
      const r = document.querySelector('[data-quiz-result]');
      return t && t.correct === true && JSON.stringify(t.picked) === '["A","C"]' && r.textContent === '答对了';
    }));

    /* 多选判错:选 A、B(漏 C 且多 B)→ weak */
    await reseed(seedRecords());
    await open('#/study/CVQ-0015');
    await page.locator('.quiz-opt[data-quiz-pick="A"]').click();
    await page.locator('.quiz-opt[data-quiz-pick="B"]').click();
    await page.locator('[data-quiz-confirm]').click();
    await page.waitForFunction(() => document.querySelector('.quiz-options.quiz-judged'));
    check('多选判错:答错标记 weak 且正确项高亮', await page.evaluate(() =>
      Store.rec('CVQ-0015').status === 'weak'
      && !!document.querySelector('.quiz-options .quiz-opt.quiz-is-right')));

    /* ================= A4. 模拟会话:作答写进轮次 ================= */
    await reseed(seedRecords());
    await open('#/home');
    await page.evaluate(() => MockView.startDirected(['MLQ-0001'], '作答测试'));
    await page.waitForSelector('.mock-run .quiz-opt[data-quiz-pick]', { timeout: 30000 });
    check('模拟会话:quiz 选项可点击', await page.evaluate(() => {
      const opts = [...document.querySelectorAll('.mock-run .quiz-opt[data-quiz-pick]')];
      return opts.length >= 2 && opts.every(o => o.getAttribute('role') === 'button');
    }));
    await page.locator('.mock-run .quiz-opt[data-quiz-pick="D"]').click();   /* 错项 */
    await page.waitForFunction(() => document.querySelector('.mock-run .quiz-options.quiz-judged'));
    check('模拟会话:判定后草稿记 quizPicked 且 revealed', await page.evaluate(() => {
      const a = Store.data.mock.draft.answers['MLQ-0001'];
      return a && a.revealed === true && JSON.stringify(a.quizPicked) === '["D"]' && a.mark === 'weak';
    }));
    await page.locator('#m-finish').click();
    await page.waitForSelector('.round-list', { timeout: 30000 });
    check('完成轮次:轮次项 mark=weak 且带 picked 留档', await page.evaluate(() => {
      const it = Store.data.mock.rounds[0].items[0];
      return it.mark === 'weak' && JSON.stringify(it.quizPicked) === '["D"]';
    }));
    check('完成轮次:题目记录同样标 weak', await page.evaluate(() => Store.rec('MLQ-0001').status === 'weak'));

    /* ================= B. 重练乱序 ================= */
    /* 种子:MLQ-0001 上次答错(lastSelfTest.correct=false)→ 默认就该乱序 */
    await reseed(JSON.stringify({ v: 3, questions: {
      'MLQ-0001': { status: '', fav: false, note: '', lastSelfTest: { at: Date.now() - 3600e3, correct: false, picked: ['A'] }, _updatedAt: Date.now() - 3600e3 }
    }, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} }));
    await open('#/study/MLQ-0001');
    const shuffled = await page.evaluate(() => {
      const box = document.querySelector('.quiz-options');
      return [...box.querySelectorAll('.quiz-lab')].map(e => e.textContent);
    });
    check('重练(上次答错):选项乱序且字母集合不变', JSON.stringify(shuffled.slice().sort()) === JSON.stringify(['A', 'B', 'C', 'D']) && JSON.stringify(shuffled) !== JSON.stringify(['A', 'B', 'C', 'D']), shuffled.join(','));
    /* label 与内容仍配对:按 label 找到正确项 B 的文本必须还是 z-score 原文 */
    check('乱序不拆散 label 与内容', await page.evaluate(() => {
      const lab = [...document.querySelectorAll('.quiz-lab')].find(e => e.textContent === 'B');
      return lab && lab.closest('.quiz-opt').textContent.includes('z-score');
    }));
    /* 乱序渲染的已作答态点不出新判定(quiz-judged 门禁住);先重做恢复可点,
       再点正确项 B(按 label 定位,不依赖位置)验证判定仍以 right 为准 */
    await page.locator('[data-quiz-redo]').click();
    await page.locator('.quiz-opt[data-quiz-pick="B"]').click();
    check('乱序后判定仍以 right 为准:点 B 判对', await page.evaluate(() => {
      const t = Store.rec('MLQ-0001').lastSelfTest;
      return t && t.correct === true && document.querySelector('[data-quiz-result]').textContent === '答对了';
    }));

    /* 全局开关:ui.shuffleOptions=true → 未答过的题也乱序 */
    await reseed(JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: { shuffleOptions: true } }));
    await open('#/study/MLQ-0002');
    const shuffled2 = await page.evaluate(() =>
      [...document.querySelectorAll('.quiz-lab')].map(e => e.textContent));
    check('全局开关开启:未答过的题也乱序', JSON.stringify(shuffled2.slice().sort()) === JSON.stringify(['A', 'B', 'C', 'D']) && JSON.stringify(shuffled2) !== JSON.stringify(['A', 'B', 'C', 'D']), shuffled2.join(','));
    /* 全局开关关闭:未答过的题保持原顺序 */
    await reseed(seedRecords());
    await open('#/study/MLQ-0002');
    const canonical = await page.evaluate(() =>
      [...document.querySelectorAll('.quiz-lab')].map(e => e.textContent));
    check('开关默认关闭:未答过的题保持原顺序', JSON.stringify(canonical) === JSON.stringify(['A', 'B', 'C', 'D']), canonical.join(','));
    /* 维护页开关存在且可切换 */
    await open('#/maintain');
    check('维护页有「选项乱序(重练)」开关', await page.locator('#opt-shuffle').count() === 1);
    await page.locator('#opt-shuffle').check();
    check('开关切换持久化到 ui.shuffleOptions', await page.evaluate(() => Store.data.ui.shuffleOptions === true));
    await page.waitForFunction(() => {
      const r = localStorage.getItem('aiiv:records');
      return r && r.includes('"shuffleOptions":true');
    }, null, { timeout: 10000 });

    /* ================= 收尾:360px 与无 JS 异常 ================= */
    await page.setViewportSize({ width: 360, height: 800 });
    await reseed(seedRecords());
    await open('#/study/MLQ-0001');
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    check('360px 作答界面无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('.quiz-opt[data-quiz-pick="A"]').click();
    await page.waitForFunction(() => document.querySelector('.quiz-options.quiz-judged'));
    check('360px 判定后无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    check('全程无 JS 异常', errors.length === 0, errors.join('|'));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
