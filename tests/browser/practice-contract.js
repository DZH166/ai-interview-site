/* Regression: mixed question formats, paged batch actions and resume progress. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8950';
const BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
(async () => {
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/index.html')).ok) break; } catch (_) {}
      await new Promise(r => setTimeout(r, 100));
    }
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    async function test(name, fn) {
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      const page = await ctx.newPage(), errors = [];
      page.on('pageerror', e => errors.push(e.message));
      try { await fn(page); assert.deepStrictEqual(errors, []); passed++; console.log('PASS ' + name); }
      catch (e) { failed++; console.error('FAIL ' + name + ': ' + e.message); }
      finally { await ctx.close(); }
    }
    async function open(p, hash) {
      await p.goto(BASE + '/index.html' + hash);
      await p.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      /* data.js 拆分后题目正文走分片异步加载:依赖 Data.question 全量字段的用例
         必须等就绪,否则拿到的是 index-only 条目(无 options/answer)。
         (顶层 const 不挂 window,不能写 window.Data) */
      await p.waitForFunction(() => typeof Data !== 'undefined' && Data.questionsLoaded(), null, { timeout: 60000 });
    }
    await test('hidden quiz conceals ALL explanations, including after hide and reload', async p => {
      await open(p, '#/study/MLQ-0001');
      const phrase = '（选项B）最适合';
      assert(!(await p.locator('#view').innerText()).includes(phrase), 'explanation leaked before reveal');
      await p.locator('[data-quiz-reveal]').click();
      assert((await p.locator('#view').innerText()).includes(phrase));
      await p.locator('[data-quiz-reveal]').click();
      assert(!(await p.locator('#view').innerText()).includes(phrase));
      await p.reload(); await p.waitForSelector('[data-quiz-reveal]');
      assert(!(await p.locator('#view').innerText()).includes(phrase));
    });
    await test('quiz options and original snapshot survive reload, completion and both exports', async p => {
      await open(p, '#/home');
      const original = await p.evaluate(() => Data.question('MLQ-0001'));
      await p.evaluate(() => MockView.startDirected(['MLQ-0001'], 'quiz regression'));
      await p.waitForSelector('#m-self');
      assert.strictEqual(await p.locator('.mock-run .quiz-opt').count(), original.options.length, 'missing options');
      assert.strictEqual(await p.locator('.mock-run .quiz-mark:visible').count(), 0);
      await p.locator('#m-self').fill('B, because of real-time monitoring');
      await p.evaluate(() => MockView.flushDraft());
      const snapshot = await p.evaluate(() => Store.data.mock.draft.answers['MLQ-0001'].questionSnapshot);
      assert.deepStrictEqual(snapshot.options, original.options);
      assert.strictEqual(snapshot.qtype, original.qtype);
      /* data.js 拆分后是薄壳(questions 在 topic 分片里):fixture 注入改为
         在分片 JSON 响应上就地改写题目对象(分片经 r.json() 解析,不能拼 JS 代码),
         语义不变——验证活动页读的是快照而非实时题库 */
      const manifest = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/manifest.json'), 'utf8'));
      const shard = manifest.topics['quiz-ml'].file;
      await p.route('**/data/topics/' + shard, route => {
        const payload = JSON.parse(fs.readFileSync(path.join(ROOT, 'app/data/topics', shard), 'utf8'));
        const q = payload.questions.find(q => q.id === 'MLQ-0001');
        q.options[0].text = 'CHANGED_OPTION_FIXTURE';
        q.answer = 'CHANGED_ANSWER_FIXTURE';
        route.fulfill({ contentType: 'application/json', body: JSON.stringify(payload) });
      });
      await p.reload(); await p.waitForSelector('#m-self');
      assert.strictEqual(await p.locator('.mock-run .quiz-opt').count(), original.options.length);
      assert(!(await p.locator('.mock-run').innerText()).includes('CHANGED_OPTION_FIXTURE'));
      await p.locator('#m-reveal').click();
      await p.locator('#m-finish').click(); await p.waitForSelector('.round-list');
      const output = await p.evaluate(() => buildExpressCard('round', 0));
      assert(output.markdown.includes(original.options[0].text), 'Markdown lost options');
      assert(output.html.includes(original.options[0].text), 'HTML lost options');
      assert(!output.markdown.includes('CHANGED_ANSWER_FIXTURE'));
      const restored = await p.evaluate(() => {
        const incoming = JSON.parse(JSON.stringify(Store.data));
        const valid = Store.validateRecordsObj(incoming);
        const snap = incoming.mock.rounds[0].items[0].questionSnapshot;
        snap.options[0].text = { invalid: true };
        return { valid, invalid: Store.validateRecordsObj(incoming) };
      });
      assert.deepStrictEqual(restored.valid, []);
      assert(restored.invalid.some(e => e.includes('选项')));
    });
    await test('legacy quiz snapshots remain readable without inventing missing options', async p => {
      await open(p, '#/home');
      await p.evaluate(() => MockView.startDirected(['MLQ-0001'], 'legacy quiz'));
      await p.waitForSelector('#m-self');
      await p.locator('#m-self').fill('old answer');
      await p.evaluate(() => MockView.flushDraft());
      const old = await p.evaluate(() => JSON.parse(JSON.stringify(Store.data)));
      delete old.mock.draft.answers['MLQ-0001'].questionSnapshot.options;
      delete old.mock.draft.answers['MLQ-0001'].questionSnapshot.format;
      delete old.mock.draft.answers['MLQ-0001'].questionSnapshot.qtype;
      const ctx = await browser.newContext({ serviceWorkers: 'block' });
      try {
        const peer = await ctx.newPage(); await peer.goto(BASE + '/__seed__');
        await peer.evaluate(d => localStorage.setItem('aiiv:records', JSON.stringify(d)), old);
        await open(peer, '#/mock/run'); await peer.waitForSelector('#m-self');
        assert((await peer.locator('#view').innerText()).includes('旧练习未保存选项'));
        assert.strictEqual(await peer.locator('#m-self').inputValue(), 'old answer');
        await peer.locator('#m-finish').click(); await peer.waitForSelector('.round-list');
        assert((await peer.evaluate(() => buildExpressCard('round', 0))).markdown.includes('旧练习未保存选项'));
      } finally { await ctx.close(); }
    });
    await test('QA reveal keeps its label and has no empty interview sections', async p => {
      await open(p, '#/home');
      const id = await p.evaluate(() => Data.allQuestions().find(q => q.format === 'qa').id);
      await open(p, '#/study/' + id);
      await p.getByRole('button', { name: '显示参考答案', exact: true }).click();
      await p.getByRole('button', { name: '隐藏参考答案', exact: true }).click();
      await p.evaluate(id => MockView.startDirected([id], 'QA'), id); await p.waitForSelector('#m-self');
      await p.locator('#m-reveal').click();
      assert.strictEqual(await p.getByText('展开面试表达', { exact: true }).count(), 0);
    });
    await test('second page supports real batch update without changing unselected questions', async p => {
      await open(p, '#/browse?t=quiz-ml');
      await p.locator('#f-batch').click();
      await p.locator('#q-list > button').click();
      assert.strictEqual(await p.locator('.q-item').count(), 200);
      assert.strictEqual(await p.locator('.q-ck').count(), 200, 'second batch lacks checkboxes');
      const selected = await p.locator('.q-ck').nth(150).getAttribute('data-qid');
      const untouched = await p.locator('.q-ck').nth(151).getAttribute('data-qid');
      await p.locator('.q-ck').nth(150).check();
      await p.locator('[data-bs="weak"]').click();
      assert.strictEqual(await p.evaluate(id => Store.rec(id).status, selected), 'weak');
      assert.notStrictEqual(await p.evaluate(id => Store.rec(id).status, untouched), 'weak');
    });
    await test('resume total counts unique questions and pending review is not mastery', async p => {
      await open(p, '#/resume');
      const unique = await p.evaluate(() => new Set(APP_DATA.resume.sections.flatMap(s => s.groups.flatMap(g => g.questionIds))).size);
      assert((await p.locator('.resume-progress').innerText()).includes('0 / ' + unique), 'duplicate totals');
      await p.locator('.resume-q-item').first().click(); await p.waitForSelector('.study-wrap');
      await p.locator('[data-status="review"]').click();
      await p.locator('[data-view="resume"]').click();
      assert.strictEqual(await p.locator('.resume-q-done').count(), 0, 'review counted as mastered');
      assert((await p.locator('.resume-progress').innerText()).includes('待复习 1'));
    });
    await test('resume questions occupy distinct rows on desktop and mobile', async p => {
      await open(p, '#/resume');
      for (const width of [1200, 360]) {
        await p.setViewportSize({ width, height: 800 });
        const rects = await p.locator('.resume-q-list').first().locator('.resume-q-item').evaluateAll(els => els.slice(0, 2).map(e => { const r = e.getBoundingClientRect(); return { top: r.top, bottom: r.bottom }; }));
        assert(rects[1].top >= rects[0].bottom, 'question links run together at ' + width);
        assert(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      }
    });
  } finally { if (browser) await browser.close(); server.kill(); }
  console.log(`结果: ${passed} 通过, ${failed} 失败`);
  process.exitCode = failed ? 1 : 0;
})().catch(e => { console.error(e); process.exitCode = 1; });
