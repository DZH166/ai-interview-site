/* 练习可靠性:通过真实 UI 验证草稿保护、选择题计数/导出、重做、历史快照与计时。
   全部记录位于新建浏览器上下文;只启动独立端口,不读取用户学习浏览器。 */
'use strict';
const assert = require('assert');
const path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || '9511', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const blank = () => ({ v: 3, questions: {}, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} });

(async () => {
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {}
      await sleep(100);
    }
    assert(ready, '独立测试服务已启动');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    async function scenario(name, run, records) {
      if (process.env.CASE && !name.includes(process.env.CASE)) return;
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', e => errors.push(e.message));
      try {
        await page.goto(BASE + '/__seed__');
        await page.evaluate(r => localStorage.setItem('aiiv:records', JSON.stringify(r)), records || blank());
        await page.goto(BASE + '/index.html#/home');
        await page.waitForFunction(() => typeof Data !== 'undefined' && typeof MockView !== 'undefined');
        await run(page);
        assert.deepStrictEqual(errors, [], '无未捕获页面异常');
        passed++; console.log('PASS ' + name);
      } catch (e) {
        failed++; console.error('FAIL ' + name + ': ' + e.message);
        console.error('页面:', (await page.locator('#view').innerText().catch(() => '')).slice(0, 500), '异常:', errors);
      }
      finally { await context.close(); }
    }
    const loadQuestion = (page, qid) => page.evaluate(async id => {
      if (Data.ensureQuestion) await Data.ensureQuestion(id); else await Data.questionsReady();
    }, qid);
    async function start(page, ids, label = '可靠性自测') {
      await page.evaluate(({ ids, label }) => MockView.startDirected(ids, label), { ids, label });
      await page.waitForSelector('#m-self');
    }
    async function go(page, hash, selector) {
      await page.evaluate(h => { location.hash = h; }, hash);
      await page.waitForSelector(selector);
    }

    await scenario('草稿保护:默认继续保留回答', async page => {
      await start(page, ['AG-001'], '旧草稿');
      await page.locator('#m-self').fill('必须保留的原回答');
      await go(page, '#/resume', '[data-rv-mock]');
      await page.locator('[data-rv-mock]').first().click();
      assert.strictEqual(await page.getByRole('dialog').count(), 1, '开新练习前提供草稿选择');
      assert.strictEqual(await page.evaluate(() => document.activeElement.textContent), '继续上次练习');
      await page.getByRole('button', { name: '继续上次练习', exact: true }).click();
      await page.waitForSelector('#m-self');
      assert.strictEqual(await page.locator('#m-self').inputValue(), '必须保留的原回答');
    });

    await scenario('点击作答:完成统计和个人表达卡一致且不重复计数', async page => {
      await start(page, ['MLQ-0001']);
      await page.locator('[data-quiz-pick="B"]').click();
      await page.locator('#m-finish').click();
      await page.waitForSelector('.round-list');
      assert((await page.locator('#view').innerText()).includes('有真实作答 1 题'));
      const result = await page.evaluate(() => {
        const round = Store.data.mock.rounds[0];
        const card = ExpressCard.buildFromRound([round], 0, id => Data.question(id));
        return { count: Store.rec('MLQ-0001').practiceCount, picked: round.items[0].quizPicked, card };
      });
      assert.strictEqual(result.count, 1);
      assert.deepStrictEqual(result.picked, ['B']);
      assert(result.card.ok && result.card.markdown.includes('我的选择') && result.card.markdown.includes('B'));
      assert(result.card.html.includes('我的选择'));
      await page.reload();
      assert.strictEqual(await page.evaluate(() => Store.rec('MLQ-0001').practiceCount), 1);
    });

    await scenario('多选重做:刷新后仍可确认新答案', async page => {
      await loadQuestion(page, 'CVQ-0015');
      await go(page, '#/study/CVQ-0015', '[data-quiz-pick="A"]');
      await page.locator('[data-quiz-pick="A"]').click();
      await page.locator('[data-quiz-pick="C"]').click();
      await page.locator('[data-quiz-confirm]').click();
      await page.reload();
      await page.waitForSelector('.quiz-judged');
      await page.locator('[data-quiz-redo]').click();
      await page.locator('[data-quiz-pick="A"]').click();
      await page.locator('[data-quiz-pick="C"]').click();
      assert.strictEqual(await page.locator('[data-quiz-confirm]').count(), 1);
      await page.locator('[data-quiz-confirm]').click();
      assert.strictEqual(await page.locator('[data-quiz-result]').innerText(), '答对了');
    });

    const old = blank();
    old.mock.draft = { sessionId: 'ms-historical-quiz', config: { count: 1 }, items: [{ qid: 'LBQ-0006' }], idx: 0,
      answers: { 'LBQ-0006': { self: '', revealed: false, mark: '', questionSnapshot: { id: 'LBQ-0006',
        title: '已删除题目的历史题面', format: 'quiz', qtype: 'single', topic: 'quiz-llm', type: 'quiz', difficulty: 'basic',
        options: [{ label: 'A', text: '旧错误项', right: false }, { label: 'B', text: '旧正确项', right: true }], answer: 'B:旧正确项' } } },
      directed: true, label: '旧草稿', savedAt: Date.now() };
    await scenario('历史快照:已删除题仍按当时选项判分与导出', async page => {
      await go(page, '#/mock/run', '[data-quiz-pick="B"]');
      assert.strictEqual(await page.evaluate(() => Data.allQuestions().some(q => q.id === 'LBQ-0006')), false, '旧题不重新进入当前抽题池');
      await page.locator('[data-quiz-pick="B"]').click();
      assert.strictEqual(await page.locator('[data-quiz-result]').innerText(), '答对了');
      await page.locator('#m-finish').click();
      await page.waitForSelector('.round-list');
      const card = await page.evaluate(() => ExpressCard.buildFromRound(Store.data.mock.rounds, 0, id => Data.question(id)));
      assert(card.ok && card.markdown.includes('旧正确项') && card.html.includes('旧正确项'));
    }, old);

    await scenario('计时:揭示和自评前的思考时间累加', async page => {
      await loadQuestion(page, 'AG-001');
      await page.evaluate(() => { window.testNow = Date.now(); Date.now = () => window.testNow; });
      await start(page, ['AG-001']);
      await page.evaluate(() => { window.testNow += 10000; });
      await page.locator('#m-reveal').click();
      await page.evaluate(() => { window.testNow += 1000; });
      await page.locator('#m-finish').click();
      await page.waitForSelector('.round-list');
      const times = await page.evaluate(() => ({ total: Store.data.mock.rounds[0].durationMs, item: Store.data.mock.rounds[0].items[0].ms }));
      assert.deepStrictEqual(times, { total: 11000, item: 11000 });
    });

    await scenario('草稿事务:保存失败不切换，保留副本可刷新找回', async page => {
      await start(page, ['AG-001'], '原回答草稿');
      await page.locator('#m-self').fill('事务验证原文');
      await go(page, '#/resume', '[data-rv-mock]');
      const oldId = await page.evaluate(() => Store.data.mock.draft.sessionId);
      await page.locator('[data-rv-mock]').first().click();
      await page.evaluate(() => {
        window.savedSetItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function(k, v) {
          if (k === 'aiiv:records') throw new DOMException('injected quota failure', 'QuotaExceededError');
          return window.savedSetItem.call(this, k, v);
        };
      });
      await page.getByRole('button', { name: '保留草稿并开始新练习', exact: true }).click();
      assert.strictEqual(await page.getByRole('dialog').count(), 1, '失败可留在原弹窗重试');
      assert.strictEqual(await page.evaluate(() => Store.data.mock.draft.sessionId), oldId);
      assert((await page.evaluate(() => localStorage.getItem('aiiv:records'))).includes('事务验证原文'));
      await page.evaluate(() => { Storage.prototype.setItem = window.savedSetItem; });
      await page.getByRole('button', { name: '保留草稿并开始新练习', exact: true }).click();
      await page.waitForSelector('#m-self');
      assert(await page.evaluate(id => Store.data.mock.alternates.some(d => d.sessionId === id && d.answers['AG-001'].self === '事务验证原文'), oldId));
      const backup = await page.evaluate(() => Store.exportRecords());
      await page.goto(BASE + '/__seed__');
      await page.evaluate(() => localStorage.clear());
      await page.goto(BASE + '/index.html#/home');
      await page.evaluate(text => { Store.importRecords(text); Store.importRecords(text); }, backup);
      assert.strictEqual(await page.evaluate(id => [Store.data.mock.draft, ...Store.data.mock.alternates].filter(d => d?.sessionId === id).length, oldId), 1, '备份往返与重复导入不丢副本或重复身份');
      await page.goto(BASE + '/index.html#/mock');
      await page.locator('details:has([data-m-alternate]) summary').click();
      await page.locator('[data-m-alternate]').click();
      await page.getByRole('button', { name: '保留草稿并开始新练习', exact: true }).click();
      await page.waitForSelector('#m-self');
      assert.strictEqual(await page.locator('#m-self').inputValue(), '事务验证原文');
    });

    await scenario('未确认多选不计完成，已练旧题新会话不泄题', async page => {
      await start(page, ['CVQ-0015']);
      await page.locator('[data-quiz-pick="A"]').click();
      await page.locator('#m-finish').click();
      await page.waitForSelector('.round-list');
      assert((await page.locator('#view').innerText()).includes('有真实作答 0 题'));
      assert.strictEqual(await page.evaluate(() => Store.rec('CVQ-0015').practiceCount || 0), 0);
      await start(page, ['MLQ-0001']);
      await page.locator('[data-quiz-pick="B"]').click();
      await page.locator('#m-finish').click();
      await page.waitForSelector('.round-list');
      await start(page, ['MLQ-0001']);
      assert.strictEqual(await page.locator('.quiz-revealed').count(), 0, '新会话不能带入全局上次判定');
      assert.strictEqual(await page.locator('.quiz-judged').count(), 0);
    });

    await scenario('统计:30天以外的排期不假报没有排期', async page => {
      await page.evaluate(() => {
        Store.setStatus('AG-001', 'ok');
        const due = new Date(); due.setDate(due.getDate() + 40);
        Store.rec('AG-001').srs.due = due.getTime(); Store.saveNow();
      });
      await go(page, '#/review?t=stats', '[data-test="stats-heat"]');
      assert(!(await page.locator('#view').innerText()).includes('还没有任何间隔重复排期'));
      assert((await page.locator('#view').innerText()).includes('未来 30 天没有到期题目'));
    });

    await scenario('训练单元:追问快照不被新版覆盖，个人回答可导出', async page => {
      await page.evaluate(() => {
        window.auditGuide = { id: 'ig-fixture', title: '训练单元旧版', followups: [{ q: 'GUIDE_ORIGINAL', a: '旧版追问参考' }] };
        MockView.startDirected(['AG-001'], '训练单元旧版', { guideId: window.auditGuide.id, guideSnapshot: window.auditGuide });
        window.auditGuide.followups[0].q = 'GUIDE_CHANGED';
      });
      await page.waitForSelector('#m-reveal');
      await page.locator('#m-reveal').click();
      const input = page.locator('[data-fu-q="GUIDE_ORIGINAL"]');
      await input.fill('训练单元的个人回答');
      await page.locator('#mock-save-retry').click();
      await page.reload();
      await page.waitForSelector('[data-fu-q="GUIDE_ORIGINAL"]');
      assert(!(await page.locator('#view').innerText()).includes('GUIDE_CHANGED'));
      assert.strictEqual(await page.locator('#m-self').inputValue(), '', '参考内容不冒充个人主回答');
      assert.strictEqual(await input.inputValue(), '训练单元的个人回答');
      await page.locator('#m-finish').click(); await page.waitForSelector('.round-list');
      const out = await page.evaluate(() => ({ round: Store.data.mock.rounds[0], card: buildExpressCard('round', 0) }));
      assert.strictEqual(out.round.guideId, 'ig-fixture');
      assert.strictEqual(out.round.guideSnapshot.followups[0].q, 'GUIDE_ORIGINAL');
      assert(out.card.ok && out.card.markdown.includes('训练单元的个人回答'));
    });

    const accuracy = blank();
    accuracy.mock.rounds = [{ ts: Date.now(), sessionId: 'accuracy-isolated', items: [
      { qid: 'MLQ-0001', self: '', quizPicked: ['B'], quizCorrect: true, mark: 'weak' },
      { qid: 'CVQ-0015', self: '', quizPicked: ['B'], quizCorrect: false, mark: 'ok' },
      { qid: 'AG-001', self: '个人叙述答案', mark: 'ok' },
      { qid: 'MLQ-0002', self: '', quizPicked: ['A'], mark: '' }
    ] }];
    await scenario('统计:客观正确率与自评掌握分开', async page => {
      await go(page, '#/review?t=stats', '[data-test="stats-quiz-accuracy"]');
      const text = await page.locator('[data-test="stats-quiz-accuracy"]').innerText();
      assert(text.includes('客观正确率 50%'));
      assert(text.includes('旧记录无判定 1'));
      assert(text.includes('已提交选择 3 次'));
    }, accuracy);

    await scenario('按题加载:离开学习页后旧请求不覆盖新页面', async page => {
      let release;
      const gate = new Promise(resolve => { release = resolve; });
      await page.route('**/data/topics/agent.*.json', async route => { await gate; await route.continue(); });
      await go(page, '#/study/AG-001', '#view .empty');
      await go(page, '#/resume', '.resume-head');
      release();
      await page.waitForFunction(() => Data.isFullQuestion(Data.question('AG-001')));
      assert.strictEqual(await page.locator('.resume-head').count(), 1);
      assert.strictEqual(await page.locator('.study-wrap').count(), 0);
    });

    await scenario('计时:刷新保留已累计时间，停止期间不计学习时长', async page => {
      await loadQuestion(page, 'AG-001');
      await page.evaluate(() => { window.testNow = Date.now(); Date.now = () => window.testNow; });
      await start(page, ['AG-001']);
      await page.evaluate(() => { window.testNow += 10000; });
      await page.locator('#mock-save-retry').click();
      await page.reload(); await page.waitForSelector('#m-self');
      await page.locator('#m-finish').click(); await page.waitForSelector('.round-list');
      const round = await page.evaluate(() => Store.data.mock.rounds[0]);
      assert(round.durationMs >= 10000 && round.durationMs < 15000);
      assert(round.items[0].ms >= 10000 && round.items[0].ms < 15000);
    });

    await scenario('简历出口:参考资料与个人表达卡区分且真实下载', async page => {
      const exportQid = await page.evaluate(() => APP_DATA.resume.sections.flatMap(s => s.groups).find(g => g.mustKnow).questionIds.find(id => Data.question(id)));
      await start(page, [exportQid]);
      await page.locator('#m-self').fill('PERSONAL_EXPORT_SENTINEL');
      await page.locator('#m-finish').click(); await page.waitForSelector('.round-list');
      await go(page, '#/resume', '[data-rv-personal]');
      const group = page.locator('.resume-group').filter({ has: page.locator('a[href="#/study/' + exportQid + '"]') }).first();
      const [personal] = await Promise.all([page.waitForEvent('download'), group.locator('[data-rv-personal]').click()]);
      const stream = await personal.createReadStream();
      let text = ''; for await (const chunk of stream) text += chunk.toString('utf8');
      assert(personal.suggestedFilename().includes('个人'));
      assert(text.includes('PERSONAL_EXPORT_SENTINEL'));
      const [reference] = await Promise.all([page.waitForEvent('download'), group.locator('[data-rv-export]').click()]);
      const source = await reference.createReadStream();
      let referenceText = ''; for await (const chunk of source) referenceText += chunk.toString('utf8');
      assert(reference.suggestedFilename().includes('参考资料'));
      assert(!referenceText.includes('PERSONAL_EXPORT_SENTINEL'));
      assert(referenceText.includes('不代表我的作答'));
      assert(!referenceText.includes('(无参考要点)'));
    });

    await scenario('快速判分:未防抖的文字回答跨判分重绘保留', async page => {
      await start(page, ['MLQ-0001']);
      await page.evaluate(() => {
        const box = document.querySelector('#m-self');
        box.value = '快速输入不能丢失';
        box.dispatchEvent(new Event('input', { bubbles: true }));
        document.querySelector('[data-quiz-pick="B"]').click();
      });
      assert.strictEqual(await page.locator('#m-self').inputValue(), '快速输入不能丢失');
      await page.locator('#m-finish').click(); await page.waitForSelector('.round-list');
      assert.strictEqual(await page.evaluate(() => Store.data.mock.rounds[0].items[0].self), '快速输入不能丢失');
    });

    await scenario('完成出口:再来一轮保留另一页后来创建的草稿', async page => {
      await start(page, ['AG-001']);
      await page.locator('#m-self').fill('已经完成的回答');
      await page.locator('#m-finish').click(); await page.waitForSelector('.round-list');
      const other = await page.context().newPage();
      await other.goto(BASE + '/index.html#/mock');
      await other.waitForSelector('#m-start');
      await start(other, ['MLQ-0001'], '另一页的新草稿');
      await other.locator('#m-self').fill('新草稿回答');
      await other.locator('#mock-save-retry').click();
      const sessionId = await other.evaluate(() => Store.data.mock.draft.sessionId);
      await page.waitForFunction(id => Store.data.mock.draft?.sessionId === id, sessionId);
      await page.locator('#m-again').click(); await page.waitForSelector('#m-start');
      assert.strictEqual(await page.evaluate(() => Store.data.mock.draft?.sessionId), sessionId);
      await page.locator('#m-resume').click(); await page.waitForSelector('#m-self');
      assert.strictEqual(await page.locator('#m-self').inputValue(), '新草稿回答');
      await other.close();
    });
    console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
    if (failed) process.exitCode = 1;
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
