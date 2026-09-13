/* 追问二跳的浏览器验收:对照参考后出现追问、先写后看、
   草稿刷新可恢复、完成轮次带追问记录、表达卡含追问练习。 */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8958', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok, detail) { assert(ok, name + (detail ? ' :: ' + detail : '')); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
}

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));

    /* 开始一轮自测 */
    await open(page, '#/mock');
    await page.locator('#m-start').click();
    await page.waitForFunction(() => document.querySelector('#m-self'));
    const firstQid = await page.evaluate(() => Store.data.mock.draft.items[0].qid);
    const fuCount = await page.evaluate(qid => Data.question(qid).followups.length, firstQid);
    check('题目有追问可用(题库校验保证非空)', fuCount >= 1, String(fuCount));

    /* 对照参考要点后,追问二跳出现;未对照前不出现 */
    check('未对照前没有追问区', await page.locator('#mock-fu-list').count() === 0);
    await page.locator('#m-reveal').click();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list'));
    check('对照后出现追问二跳区', (await page.locator('#mock-fu-list .fu').count()) === fuCount);

    /* 先写后看:追问参考默认不显示;写回答 → 对照 → 参考出现 */
    check('追问参考默认不显示', await page.locator('#mock-fu-list .fu-a').count() === 0);
    const q0text = await page.evaluate(qid => Data.question(qid).followups[0].q, firstQid);
    const fid = await page.evaluate(({ qid, q }) => fuId(qid, q), { qid: firstQid, q: q0text });
    await page.locator(`[data-fu-id="${fid}"]`).fill('我的追问回答:先说结论');
    await page.locator(`[data-fu-reveal="${fid}"]`).click();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list .fu-a'));
    check('对照后该追问参考显示', await page.locator('#mock-fu-list .fu-a').count() === 1);
    check('回答进入会话草稿(按追问 ID)', await page.evaluate(fid => {
      const qid = Store.data.mock.draft.items[Store.data.mock.draft.idx].qid;
      return ((Store.data.mock.draft.answers[qid].fu || {})[fid] || {}).self === '我的追问回答:先说结论';
    }, fid));
    check('草稿保存作答时题面快照', await page.evaluate(fid => {
      const qid = Store.data.mock.draft.items[Store.data.mock.draft.idx].qid;
      const e = (Store.data.mock.draft.answers[qid].fu || {})[fid] || {};
      return e.q === Data.question(qid).followups[0].q;
    }, fid));

    /* 刷新:#/mock/run 上的草稿自动恢复进 run 视图,追问回答与揭示状态都在 */
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#m-self'));
    check('刷新后追问回答保留(按 ID 定位)', await page.locator(`[data-fu-id="${fid}"]`).inputValue() === '我的追问回答:先说结论');
    check('刷新后已对照的追问保持揭示', await page.locator('#mock-fu-list .fu-a').count() === 1);

    /* 完成本轮(第 1 题就结束:结束本轮同样收尾入历史);轮次记录带追问;表达卡含追问练习 */
    await page.locator('#m-self').fill('我的主回答');
    await page.locator('#m-quit').click();
    await page.waitForFunction(() => document.querySelector('.round-list'));
    const roundHasFu = await page.evaluate(() => {
      const rd = Store.data.mock.rounds[0];
      const it = (rd.items || []).find(x => x.followups && x.followups.length);
      return it && it.qid === Store.data.mock.rounds[0].items[0].qid;
    });
    check('完成轮次的题目记录带追问(只留真实写过的)', roundHasFu);
    const card = await page.evaluate(() => {
      const r = buildExpressCard('round', 0);
      return r && r.ok ? r.markdown : ('ERR:' + (r && r.error));
    });
    check('表达卡含「追问练习」一节', card.includes('### 追问练习'), card.slice(0, 200));
    check('表达卡带追问原文', card.includes('我的追问回答:先说结论'));

    /* 复习中心历史:轮次详情能看到追问 */
    await open(page, '#/review');
    await page.locator('[data-tab="rounds"]').click();
    await page.waitForFunction(() => document.querySelectorAll('.round-details').length > 0);

    /* ---- 身份:重排追问后,回答仍跟随原题面(不按下标错配) ---- */
    await page.evaluate(qid => MockView.startDirected([qid], '身份测试'), firstQid);
    await page.waitForFunction(() => document.querySelector('#m-reveal'));
    await page.locator('#m-reveal').click();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list'));
    await page.evaluate(() => {
      const d = Store.data.mock.draft;
      const qid = d.items[d.idx].qid;
      d.answers[qid].fu = {};   /* 清掉前面的回答,单独构造 */
      const q0 = Data.question(qid).followups[0].q;
      const id0 = fuId(qid, q0);
      d.answers[qid].fu[id0] = { id: id0, q: q0, self: '绑定在原题面的回答', revealed: false };
      Store.saveNow();
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list'));
    check('重排前:回答显示在原题面下',
      await page.evaluate(() => {
        const qid = Store.data.mock.draft.items[Store.data.mock.draft.idx].qid;
        const id0 = fuId(qid, Data.question(qid).followups[0].q);
        const el = document.querySelector(`[data-fu-id="${id0}"]`);
        return { ok: !!(el && el.value === '绑定在原题面的回答'), hasEl: !!el, val: el && el.value, qid, id0, fuKeys: Object.keys(Store.data.mock.draft.answers[qid].fu || {}) };
      }).then(r => { if (!r.ok) console.log('  DEBUG', JSON.stringify(r)); return r.ok; }));
    /* 模拟重排:交换题库里该题前两条追问,再刷新(不发请求,直接改内存数据源并重载视图) */
    await page.evaluate(() => {
      const qid = Store.data.mock.draft.items[Store.data.mock.draft.idx].qid;
      const f = Data.question(qid).followups;
      const t = f[0]; f[0] = f[1]; f[1] = t;
      window.__swapped = true;
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list'));
    check('重排后:回答仍显示在原题面下(身份跟内容走,不跟位置走)',
      await page.evaluate(() => {
        const qid = Store.data.mock.draft.items[Store.data.mock.draft.idx].qid;
        const q0 = '绑定在原题面的回答';
        const id0 = fuId(qid, Store.data.mock.draft.answers[qid].fu && Object.values(Store.data.mock.draft.answers[qid].fu)[0] ? Object.values(Store.data.mock.draft.answers[qid].fu)[0].q : '');
        const el = document.querySelector(`[data-fu-id="${id0}"]`);
        const fuq = document.querySelector(`[data-fu-item="${id0}"] .fu-q`);
        return el && el.value === q0 && fuq && Store.data.mock.draft.answers[qid].fu[id0].q === fuq.textContent.replace(/^追问 \d+:/, '');
      }));
    /* 改写题面:旧回答不绑定新题,进入「待核对」 */
    await page.evaluate(() => {
      const qid = Store.data.mock.draft.items[Store.data.mock.draft.idx].qid;
      const d = Store.data.mock.draft;
      d.answers[qid].fu = { 'AG-001-fu-old': { id: 'AG-001-fu-old', q: '已被改写的旧题面', self: '旧回答原文', revealed: false } };
      Store.saveNow();
    });
    await page.reload();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list'));
    check('题面改写后:旧回答进入待核对区,不冒充新题的回答',
      await page.evaluate(() => {
        const legacyBox = document.querySelector('.fu-legacy');
        return !!legacyBox && legacyBox.textContent.includes('旧回答原文') && legacyBox.textContent.includes('待核对')
          && ![...document.querySelectorAll('#mock-fu-list [data-fu-id]')].some(el => el.value === '旧回答原文');
      }));

    /* ---- 统一资格:只写追问也能完成并导出;完成页与首页同一口径(SP-03) ---- */
    await page.goto(BASE + '/__seed__');
    await page.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
    await open(page, '#/mock');
    await page.evaluate(() => MockView.startDirected(['AG-001'], '资格测试'));
    await page.waitForFunction(() => document.querySelector('#m-reveal'));
    await page.locator('#m-reveal').click();
    await page.waitForFunction(() => document.querySelector('#mock-fu-list'));
    const fid0 = await page.evaluate(() => fuId('AG-001', Data.question('AG-001').followups[0].q));
    await page.locator(`[data-fu-id="${fid0}"]`).fill('只有追问的回答');
    await page.locator('#m-quit').click();
    await page.waitForFunction(() => document.querySelector('.round-list'));
    check('完成页展示追问回答与题面快照(主回答未写如实标注)',
      await page.evaluate(() => {
        const t = document.querySelector('.card').textContent;
        return t.includes('只有追问的回答') && t.includes('主回答未写') && t.includes('追问回答 1 条') && t.includes('有真实作答 1 题');
      }));
    const card2 = await page.evaluate(() => { const r = buildExpressCard('round', 0); return r && r.ok ? r.markdown : 'ERR:' + (r && r.error); });
    check('完成页表达卡资格:只写追问可导出', card2.includes('只有追问的回答'), card2.slice(0, 80));
    /* 首页:今天已写过模拟回答 + 数量口径 */
    await open(page, '#/home');
    check('首页「今天已写过模拟回答」认可只写追问的轮次',
      await page.evaluate(() => document.querySelector('.desk-todos').textContent.includes('今天已写过模拟回答')));
    check('首页数量口径分列主回答与追问',
      await page.evaluate(() => {
        const t = document.querySelector('.desk-out').textContent;
        return t.includes('主回答 0') && t.includes('追问回答 1 条');
      }));

    check('全程无页面 JS 异常', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
