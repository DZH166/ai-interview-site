/* 独立浏览器上下文验证原回答 → 追问 → 修订；不读取个人浏览器记录。 */
'use strict';
const assert = require('assert'), path = require('path');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9523';
const BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let passed = 0;
const check = (name, value) => { assert(value, name); passed++; console.log('PASS ' + name); };

(async () => {
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) {
      try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {}
      await sleep(100);
    }
    assert(ready, 'test server ready');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const errors = [];
    async function fresh(backup) {
      const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
      const page = await context.newPage();
      page.on('pageerror', e => errors.push(e.message));
      await page.goto(BASE + '/index.html#/mock');
      await page.waitForSelector('#m-start');
      if (backup) {
        await page.evaluate(text => Store.importRecords(text), backup);
        await page.reload(); await page.waitForSelector('#m-start');
      }
      return page;
    }
    async function start(page) {
      await page.evaluate(() => MockView.startDirected(['AG-001'], '修订回归'));
      await page.waitForSelector('#m-self');
    }
    const page = await fresh(); await start(page);
    check('看参考前不显示修订框', await page.locator('#m-revision').count() === 0);
    await page.locator('#m-self').fill('ORIGINAL_BEFORE_REFERENCE');
    await page.locator('#m-reveal').focus(); await page.keyboard.press('Enter');
    check('Enter 展开参考后焦点停在参考标题而不跳过追问', await page.evaluate(() => document.activeElement.id === 'm-reference-title'));
    check('原回答只读且修订不自动复制参考', await page.locator('#m-self').getAttribute('readonly') !== null && await page.locator('#m-revision').inputValue() === '');
    const followupId = await page.locator('[data-fu-reveal]').first().getAttribute('data-fu-reveal');
    await page.locator('[data-fu-reveal]').first().focus(); await page.keyboard.press('Space');
    check('Space 展开追问参考后焦点停在对应参考正文', await page.evaluate(id => document.activeElement.dataset.fuReference === id
      && document.activeElement.tabIndex === -1 && document.activeElement.textContent.trim().length > 0, followupId));
    await page.locator('[data-mark="ok"]').focus(); await page.keyboard.press('Space');
    check('Space 自评重绘后保留同一自评按钮焦点', await page.evaluate(() => document.activeElement.matches('[data-mark="ok"].active')));
    await page.locator('#m-revision').fill('REVISION_SELECTION_KEEP');
    const selection = await page.evaluate(() => {
      const revision = document.querySelector('#m-revision');
      revision.setSelectionRange(3, 8);
      const scrollYBefore = scrollY;
      // 焦点仍在输入框时触发重绘，验证常规选区恢复分支未被按钮恢复逻辑破坏。
      document.querySelector('[data-mark="review"]').click();
      const active = document.activeElement;
      return { id: active.id, start: active.selectionStart, end: active.selectionEnd, value: active.value, scrollYBefore, scrollYAfter: scrollY };
    });
    check('输入框重绘保留修订文字选区和滚动位置', selection.id === 'm-revision' && selection.start === 3 && selection.end === 8
      && selection.value === 'REVISION_SELECTION_KEEP' && selection.scrollYBefore === selection.scrollYAfter);
    // 同一任务中输入并立即完成，防抖回调没有机会先运行。
    await page.evaluate(() => {
      const fu = document.querySelector('#mock-fu-list [data-fu-id]');
      fu.value = 'FOLLOWUP_LAST_KEY'; fu.dispatchEvent(new Event('input', { bubbles: true }));
      const revision = document.querySelector('#m-revision');
      revision.value = 'REVISION_LAST_KEY'; revision.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#m-finish').click();
    });
    await page.waitForSelector('.round-list');
    const result = await page.evaluate(() => ({ item: Store.data.mock.rounds[0].items[0],
      card: ExpressCard.buildFromRound(Store.data.mock.rounds, 0, id => Data.question(id)),
      count: Store.rec('AG-001').practiceCount,
      backup: JSON.stringify({ type: 'aiiv-records', v: 2, records: Store.data }) }));
    check('立即完成独立捕获三份原文', result.item.self === 'ORIGINAL_BEFORE_REFERENCE' && result.item.revision === 'REVISION_LAST_KEY' && result.item.followups[0].self === 'FOLLOWUP_LAST_KEY');
    check('一道题的原回答追问修订只计一次', result.count === 1);
    check('两种导出都有三份原文', ['ORIGINAL_BEFORE_REFERENCE', 'FOLLOWUP_LAST_KEY', 'REVISION_LAST_KEY'].every(x => result.card.markdown.includes(x) && result.card.html.includes(x)));
    await page.locator('#m-card').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 Markdown', exact: true }).click()]);
    let downloaded = ''; for await (const chunk of await download.createReadStream()) downloaded += chunk.toString('utf8');
    check('真实下载保留独立修订段', downloaded.includes('### 参考后修订 / 补充') && downloaded.includes('ORIGINAL_BEFORE_REFERENCE') && downloaded.includes('REVISION_LAST_KEY'));

    const imported = await fresh(result.backup);
    await imported.evaluate(() => { location.hash = '#/review?t=rounds'; });
    await imported.waitForSelector('.saved-revision');
    const history = await imported.locator('.round-details').first().innerText();
    check('导入刷新后的历史同时展示原回答追问修订', ['ORIGINAL_BEFORE_REFERENCE', 'FOLLOWUP_LAST_KEY', 'REVISION_LAST_KEY', '真实作答 1 题', '修订/补充 1 题'].every(x => history.includes(x)));
    await imported.evaluate(() => { location.hash = '#/search'; });
    await imported.waitForSelector('#s-input');
    await imported.locator('#s-input').fill('REVISION_LAST_KEY');
    await imported.locator('#s-go').click();
    const hit = imported.locator('.search-item').filter({ hasText: 'REVISION_LAST_KEY' }).first();
    await hit.waitFor(); await hit.click();
    await imported.waitForSelector('.saved-revision');
    const landed = await imported.locator('.round-details[open]').first().innerText();
    check('搜索本人修订真实点击落到同时保留原答与修订的历史', (await imported.evaluate(() => location.hash)).includes('t=rounds') && landed.includes('ORIGINAL_BEFORE_REFERENCE') && landed.includes('REVISION_LAST_KEY'));
    await imported.context().close(); await page.context().close();

    const draftPage = await fresh(); await start(draftPage);
    await draftPage.locator('#m-reveal').click();
    check('仅查看参考仍未作答', await draftPage.evaluate(() => !ExpressCard.itemAnswered(Store.data.mock.draft.answers['AG-001'])));
    await draftPage.evaluate(() => {
      const revision = document.querySelector('#m-revision');
      revision.value = 'REVISION_ONLY_DRAFT'; revision.dispatchEvent(new Event('input', { bubbles: true }));
      MockView.flushDraft();
    });
    const draftBackup = await draftPage.evaluate(() => JSON.stringify({ type: 'aiiv-records', v: 2, records: Store.data }));
    await draftPage.reload(); await draftPage.waitForSelector('#m-revision');
    check('刷新保留仅修订草稿且不伪造原回答', await draftPage.locator('#m-self').inputValue() === '' && await draftPage.locator('#m-revision').inputValue() === 'REVISION_ONLY_DRAFT');
    const restored = await fresh(draftBackup);
    await restored.locator('#m-resume').click(); await restored.waitForSelector('#m-revision');
    check('备份导入可继续编辑修订草稿', await restored.locator('#m-revision').inputValue() === 'REVISION_ONLY_DRAFT');
    await restored.evaluate(() => {
      const revision = document.querySelector('#m-revision');
      revision.value = 'REVISION_ONLY_FINAL'; revision.dispatchEvent(new Event('input', { bubbles: true }));
      document.querySelector('#m-finish').click();
    });
    await restored.waitForSelector('.round-list');
    check('只有修订也按真实作答进入轮次', await restored.evaluate(() => Store.data.mock.rounds[0].items[0].self === '' && Store.data.mock.rounds[0].items[0].revision === 'REVISION_ONLY_FINAL' && Store.rec('AG-001').practiceCount === 1));
    await restored.context().close(); await draftPage.context().close();

    const early = await fresh();
    await early.route('**/data/topics/python-backend.*.json', route => route.abort());
    await early.evaluate(() => MockView.startDirected(['AG-001', 'PY-001'], '跨专题提前结束'));
    await early.waitForSelector('#m-self');
    await early.locator('#m-self').fill('ONLY_FIRST_TOPIC_ANSWER');
    await early.locator('#m-quit').click(); await early.waitForSelector('.round-list');
    const partial = await early.evaluate(() => ({ round: Store.data.mock.rounds[0],
      validation: Store.validateRecordsObj(Store.data),
      backup: JSON.stringify({ type: 'aiiv-records', v: 2, records: Store.data }) }));
    check('跨专题提前结束只存已访问题快照', !!partial.round.items[0].questionSnapshot && !Object.hasOwn(partial.round.items[1], 'questionSnapshot') && partial.validation.length === 0);
    const afterImport = await fresh(partial.backup);
    check('提前结束的真实备份可导入且只计已回答题', await afterImport.evaluate(() => Store.data.mock.rounds[0].items[0].self === 'ONLY_FIRST_TOPIC_ANSWER'
      && !Object.hasOwn(Store.data.mock.rounds[0].items[1], 'questionSnapshot')
      && Store.data.mock.rounds[0].items.filter(ExpressCard.itemAnswered).length === 1));
    await afterImport.context().close(); await early.context().close();

    const single = await fresh();
    await single.evaluate(() => MockView.startDirected(['MLQ-0001'], '单选键盘回归'));
    await single.waitForSelector('[data-quiz-pick="B"]');
    await single.locator('[data-quiz-pick="B"]').focus();
    await single.keyboard.press('Enter');
    check('单选 Enter 判题后焦点在重做且关联判题结果', await single.evaluate(() => {
      const active = document.activeElement;
      return active.matches('[data-quiz-redo]') && !active.hidden
        && document.getElementById(active.getAttribute('aria-describedby'))?.textContent === '答对了';
    }));
    await single.keyboard.press('Space');
    check('单选 Space 重做后焦点回到首个可作答选项', await single.evaluate(() => document.activeElement === document.querySelector('[data-quiz-pick][tabindex="0"]')
      && !document.querySelector('.quiz-judged')));
    await single.keyboard.press('Space');
    check('单选重做后可直接用 Space 再次判题', await single.evaluate(() => document.activeElement.matches('[data-quiz-redo]')
      && Store.data.mock.draft.answers['MLQ-0001'].quizPicked.length === 1));
    await single.context().close();

    const multi = await fresh();
    await multi.evaluate(() => MockView.startDirected(['CVQ-0015'], '多选键盘回归'));
    await multi.waitForSelector('[data-quiz-pick="A"]');
    await multi.locator('[data-quiz-pick="A"]').focus(); await multi.keyboard.press('Enter');
    await multi.locator('[data-quiz-pick="C"]').focus(); await multi.keyboard.press('Space');
    check('多选 Enter / Space 选中后仍保留选项焦点', await multi.evaluate(() => document.activeElement.matches('[data-quiz-pick="C"]')
      && document.querySelectorAll('.quiz-picked').length === 2));
    await multi.locator('[data-quiz-confirm]').focus(); await multi.keyboard.press('Enter');
    check('多选 Enter 确认后焦点在重做且正确判题', await multi.evaluate(() => document.activeElement.matches('[data-quiz-redo]')
      && document.querySelector('[data-quiz-result]').textContent === '答对了'));
    await multi.keyboard.press('Space');
    check('多选 Space 重做恢复首选项焦点和确认控件', await multi.evaluate(() => document.activeElement === document.querySelector('[data-quiz-pick][tabindex="0"]')
      && !!document.querySelector('[data-quiz-confirm]') && !document.querySelector('.quiz-judged')));
    await multi.keyboard.press('Space');
    await multi.locator('[data-quiz-confirm]').focus(); await multi.keyboard.press('Space');
    check('多选重做后 Space 选项与确认仍可完成判题', await multi.evaluate(() => document.activeElement.matches('[data-quiz-redo]')
      && Store.data.mock.draft.answers['CVQ-0015'].quizPicked.length === 1));
    await multi.context().close();
    check('修订、提前结束和键盘流程没有页面异常', errors.length === 0);
  } finally { if (browser) await browser.close(); server.kill(); }
  console.log(`\n结果: ${passed} 通过, 0 失败`);
})().catch(error => { console.error(error); process.exitCode = 1; });
