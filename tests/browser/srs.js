/* SRS 到期建议的浏览器验收:手动队列优先、建议单独一节、
   「还记得/忘了」两个出口、模拟面试复盘标记重排到期日、首页口径一致。 */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8957', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok) { assert(ok, name); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const DAY = 86400000;

async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash, { waitUntil: 'load' });
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
  await page.locator('body').ariaSnapshot();
}
/* 种入三条记录:PY-001 掌握但已到期 / RG-001 掌握未到期 / LP-001 还不熟(手动队列) */
const seed = (duePast, dueFuture) => ({
  'PY-001': { status: 'ok', fav: false, srs: { due: duePast, ivl: 1, ease: 2.5, streak: 1, lapses: 0, lastAt: duePast - DAY, lastRating: 'good' } },
  'RG-001': { status: 'ok', fav: false, srs: { due: dueFuture, ivl: 6, ease: 2.5, streak: 2, lapses: 0, lastAt: dueFuture - 6 * DAY, lastRating: 'good' } },
  'LP-001': { status: 'weak', fav: false }
});

/* 应用页的 pagehide 兜底会把内存记录写回 localStorage,直接在应用页上改存储会被冲掉;
   所以重种必须走 /__seed__(非应用页,不注册兜底),再回应用页让 Store.load 读入。 */
async function reseed(page, now) {
  await page.goto(BASE + '/__seed__');
  await page.evaluate(recs => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: recs, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })),
    seed(now - DAY, now + 3 * DAY));
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
    const now = Date.now();

    await reseed(page, now);

    /* ---- 复习中心:手动队列与到期建议各归各 ---- */
    await open(page, '#/review');
    const todayText = await page.locator('#review-body').innerText();
    check('手动队列显示还不熟的题(不看排期,永远优先)', todayText.includes('LP-001'));
    check('已到期的掌握题出现在到期建议里', todayText.includes('PY-001'));
    check('未到期的掌握题不出现在建议里', !todayText.includes('RG-001'));
    check('到期建议标注间隔与上次复盘', todayText.includes('间隔 1 天') && todayText.includes('上次复盘'));

    /* 「忘了」:转还不熟,回到手动队列 */
    await page.locator('[data-due-again="PY-001"]').click();
    await page.waitForFunction(() => {
      const r = Store.rec('PY-001');
      return r.status === 'weak' && r.srs && r.srs.lastRating === 'again';
    });
    check('「忘了」= 标还不熟 + 排期记一次遗忘', await page.evaluate(() => Store.rec('PY-001').status === 'weak' && Store.rec('PY-001').srs.lapses === 1));
    check('「忘了」后该题回到手动队列', (await page.locator('#review-body').innerText()).includes('LP-001') && (await page.locator('#review-body').innerText()).includes('PY-001'));
    check('「忘了」后不再出现在建议区', await page.waitForFunction(() => ![...document.querySelectorAll('[data-due-again]')].some(el => el.dataset.dueAgain === 'PY-001')).then(() => true).catch(() => false));

    /* 「还记得」:状态不变,重排到未来 */
    await reseed(page, now);
    await open(page, '#/review');
    const dueBefore = await page.evaluate(() => Store.rec('PY-001').srs.due);
    await page.locator('[data-due-ok="PY-001"]').click();
    await page.waitForFunction(() => document.querySelectorAll('[data-due-ok]').length === 0);
    const after = await page.evaluate(() => ({ status: Store.rec('PY-001').status, due: Store.rec('PY-001').srs.due, rating: Store.rec('PY-001').srs.lastRating }));
    check('「还记得」状态保持基本掌握', after.status === 'ok');
    check('「还记得」重排到期日到未来', after.due > Date.now() && after.due > dueBefore);
    eq_label: check('「还记得」记一次成功', after.rating === 'good');

    /* ---- 模拟面试复盘标记:即使状态相同也重排(否则建议里的题永远出不去) ---- */
    await reseed(page, now);
    await open(page, '#/review');
    /* 走「开始复习」定向会话;队列手动在前:先跳过 LP-001,到第二题 PY-001(到期建议) */
    await page.locator('#start-today').click();
    await page.waitForFunction(() => document.querySelector('#m-self'));
    await page.locator('#m-next').click();
    await page.waitForFunction(() => (Store.data.mock.draft || { idx: -1 }).idx === 1);
    await page.locator('#m-self').fill('我的回答:先讲结论再展开');
    await page.locator('#m-reveal').click();
    await page.locator('[data-mark="ok"]').click();
    const mockSrs = await page.evaluate(() => Store.rec('PY-001').srs);
    check('模拟面试标「基本掌握」:状态不变仍重排到期日', mockSrs.lastRating === 'good' && mockSrs.due > Date.now() && mockSrs.due > now, JSON.stringify(mockSrs));
    check('模拟面试标「基本掌握」:streak 连续成功 +1', mockSrs.streak >= 2, String(mockSrs.streak));

    /* ---- 信号身份:同一轮重复点击同一复盘按钮,不重复排期(SP 阶段3.5) ---- */
    await reseed(page, now);
    await open(page, '#/review');
    await page.locator('#start-today').click();
    await page.waitForFunction(() => document.querySelector('#m-self'));
    await page.locator('#m-next').click();   /* 队列手动在前:跳到 PY-001 */
    await page.waitForFunction(() => (Store.data.mock.draft || { idx: -1 }).idx === 1);
    await page.locator('#m-self').fill('回答内容');
    await page.locator('#m-reveal').click();
    await page.locator('[data-mark="ok"]').click();
    const afterOnce = await page.evaluate(() => JSON.stringify(Store.rec('PY-001').srs));
    await page.locator('[data-mark="ok"]').click();
    await page.locator('[data-mark="ok"]').click();
    const afterThrice = await page.evaluate(() => JSON.stringify(Store.rec('PY-001').srs));
    check('同一轮重复点击同一按钮:排期不变(不把一次练习当成多次)', afterOnce === afterThrice, `${afterOnce} → ${afterThrice}`);
    /* 更改自评 = 以新信号重新排期(替换语义) */
    await page.locator('[data-mark="weak"]').click();
    const afterChange = await page.evaluate(() => Store.rec('PY-001').srs);
    check('更改自评:以新信号重新排期', afterChange.lastRating === 'again' && afterChange.ivl === 0, JSON.stringify(afterChange));

    /* ---- 学习页记录栏:只读到期提示 ---- */
    await open(page, '#/study/RG-001');
    check('记录栏显示建议到期日(未来到期)', (await page.locator('.record-bar').innerText()).includes('建议:'));
    await open(page, '#/study/LP-002');
    check('没有排期的题不显示建议', !(await page.locator('.record-bar').innerText()).includes('建议:'));

    /* ---- 工作台首页:三件事的口径与复习中心一致 ---- */
    await reseed(page, now);
    await open(page, '#/home');
    const homeText = await page.locator('.desk-todos').innerText();
    check('首页第一件事包含到期建议数量并注明可无视', homeText.includes('到期建议 1 条') && homeText.includes('可无视'));
    check('首页复习数 = 手动队列 + 到期建议', homeText.includes('复习 2 题'));

    /* ---- 窄屏不横向溢出(建议卡片也要守这条防线) ---- */
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page, '#/review');
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    check('360px 下复习页无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));

    check('全程无页面 JS 异常', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
