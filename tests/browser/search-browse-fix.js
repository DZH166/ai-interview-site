/* 搜索与浏览的缺陷回归。这三条都是**实测复现过**的真缺陷,不是审美偏好:
 *
 *   1) 搜索结果把同一道题的每个命中字段各刷一张卡片 —— 修复前搜「向量检索」得到 44 条,
 *      其中 RG-003 / RG-005 / PY-026 / RG-006 / EN-007 / RG-028 / AG-036 / RG-044 重复出现。
 *   2) 摘要高亮逐词 replace:先点亮「rag」再替换「a」,a 会钻进 <mark> 的标签名里,
 *      把标签打成 <m<mark>a</mark>rk>(修复前实测 rawMarks=10 / parsed=4,标签被解析器吞掉)。
 *   3) browse 切筛选后详情停在已被筛掉的题上,分页分母虚高
 *      (修复前实测:左栏 71 条,右栏仍是 PY 题,指示器 1 / 44)。
 *
 * 三条都在修复前的版本上跑过,确认会失败 —— 否则断言没有牙。
 */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || '8971', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;

function check(name, ok, detail) {
  assert(ok, name + (detail ? '  —  ' + detail : ''));
  passed++; console.log('  PASS', name);
}
async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() =>
    typeof Store !== 'undefined' && typeof Search !== 'undefined'
    && Store.data.ui.lastHash === location.hash && document.querySelector('#view > *'));
}

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python',
    [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) {
      try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {}
      await sleep(100);
    }
    assert(ready, 'isolated server did not start');
    browser = await chromium.launch({
      headless: true,
      executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined
    });
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    /* ---- 1. 搜索结果:同一目标只出一条卡片 ---- */
    await open(page, '#/search/' + encodeURIComponent('向量检索'));
    await page.waitForSelector('.search-item');
    const s1 = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.search-item')];
      return {
        n: items.length,
        hrefs: items.map(a => a.getAttribute('href')),
        qids: items.map(a => (a.querySelector('.qid') || {}).textContent || '').filter(Boolean),
      };
    });
    const dupHref = s1.hrefs.filter((x, i) => s1.hrefs.indexOf(x) !== i);
    const dupQid = s1.qids.filter((x, i) => s1.qids.indexOf(x) !== i);
    check('搜索结果:同一目标只出现一次(href 唯一)', dupHref.length === 0,
      '重复 ' + JSON.stringify([...new Set(dupHref)]) + ' / 共 ' + s1.n + ' 条');
    check('搜索结果:同一题号只出现一次', dupQid.length === 0, JSON.stringify([...new Set(dupQid)]));
    check('搜索结果:命中位置以标签并列展示(而不是把卡片拆开)',
      await page.evaluate(() => document.querySelectorAll('.search-item .si-head .badge.b-tag').length > 0));

    /* ---- 2. 摘要高亮:不嵌套、不破坏标签 ---- */
    /* 「长词在前、它的子串在后」才会触发,所以一次覆盖多组关键词;
       判定必须走 DOM —— 畸形标签会被解析器当成「名叫 m<mark 的元素」吞掉,
       字符串层面看着完全正常,只有 raw/parsed 数量对不上才暴露。 */
    const kws = ['rag a', 'rag g', 'agent a', 'rank r', 'token t', 'prompt p', 'embedding e', 'chunk c'];
    const s2 = await page.evaluate(list => {
      const bad = [];
      let marks = 0;
      list.forEach(k => {
        Search.query(k).forEach(r => {
          const d = document.createElement('div');
          d.innerHTML = r.snippet;
          const rawMarks = (r.snippet.match(/<mark/gi) || []).length;
          const parsed = d.querySelectorAll('mark').length;
          marks += parsed;
          const nested = [...d.querySelectorAll('mark')].some(m => m.querySelector('mark'));
          if (nested || rawMarks !== parsed) {
            bad.push({ k, rawMarks, parsed, nested, sample: r.snippet.slice(0, 90) });
          }
        });
      });
      return { marks, bad };
    }, kws);
    check('摘要:高亮确实发生(正对照,否则下一条毫无意义)', s2.marks > 0,
      JSON.stringify({ marks: s2.marks }));
    check('摘要:高亮不嵌套、不破坏标签(8 组子串关键词)', s2.bad.length === 0,
      JSON.stringify(s2.bad.slice(0, 3)));

    /* ---- 3. browse 切筛选:详情与分页指示器必须跟着走 ---- */
    await open(page, '#/browse');
    await page.waitForSelector('.q-item');
    /* 先在「Python 后端」里选一道,再切到 RAG —— 保证选中项一定落在新筛选集之外 */
    await page.selectOption('#f-topic', 'python-backend');
    await sleep(280);
    await page.click('.q-item');
    await sleep(150);
    const before = await page.evaluate(() =>
      (document.querySelector('#q-detail .q-title-sm') || {}).textContent || '');

    await page.selectOption('#f-topic', 'rag');
    await sleep(350);
    const after = await page.evaluate(() => {
      const items = [...document.querySelectorAll('.q-item')];
      const bar = document.querySelector('#q-detail .detail-toolbar .muted');
      return {
        listCount: items.length,
        listTitles: items.map(el => (el.querySelector('.q-item-title') || {}).textContent || ''),
        detailTitle: (document.querySelector('#q-detail .q-title-sm') || {}).textContent || '',
        indicator: bar ? bar.textContent.trim() : '',
        count: (document.querySelector('#f-count') || {}).textContent || '',
      };
    });
    const denom = Number((after.indicator.match(/\/\s*(\d+)/) || [])[1] || 0);
    check('前置:切换前确实停在一道会被筛掉的题上',
      !!before && !after.listTitles.includes(before), JSON.stringify({ before }));
    check('切筛选后:详情标题属于当前列表',
      !!after.detailTitle && after.listTitles.includes(after.detailTitle),
      JSON.stringify({ detailTitle: after.detailTitle, firstFew: after.listTitles.slice(0, 3) }));
    /* 分批渲染(Fix3)后 DOM 只渲染首批 100 条,分页分母的正确语义是当前筛选集总数:
       必须与 #f-count 显示的筛选数一致(切筛选后同步收敛,不再虚高回全量) */
    const filteredTotal = Number((after.count.match(/\d+/) || [])[0] || 0);
    check('切筛选后:分页分母等于当前筛选集总数', filteredTotal > 0 && denom === filteredTotal,
      JSON.stringify({ indicator: after.indicator, filteredTotal, count: after.count }));

    check('全程无页面 JS 异常', errors.length === 0, JSON.stringify(errors.slice(0, 3)));

    console.log('\n结果: ' + passed + ' 通过, 0 失败');
    await browser.close();
    server.kill();
    process.exit(0);
  } catch (e) {
    console.error('\nFAIL: ' + e.message);
    try { await browser.close(); } catch (_) {}
    server.kill();
    process.exit(1);
  }
})();
