/* 简历页定向自测闭环浏览器验收:分组定向自测 / summary 不被误开合 /
   必知题一键开测 / 表达卡真实下载。
   运行:PW=<playwright> CHROME=<chromium|default> PORT=xxxx node tests/browser/resume-loop.js */
'use strict';
const path = require('path'), assert = require('assert'), fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9700', BASE = 'http://127.0.0.1:' + PORT;
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
      await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'), null, { timeout: 60000 });
    };

    await open('#/resume');
    await page.waitForFunction(() => document.querySelectorAll('.resume-group').length > 0, null, { timeout: 60000 });

    /* ---- ① 每个分组 summary 都有「定向自测」按钮,题数与有效题号一致 ----
       先切「全部」模式,让非必知组也渲染出来一起覆盖 */
    await page.locator('[data-rv-filter="all"]').first().click();
    await page.waitForFunction(() => {
      const r = window.APP_DATA.resume;
      const seen = new Set();
      let n = 0;
      (r.sections || []).forEach(s => (s.groups || []).forEach(g => { if (!seen.has(g.name)) { seen.add(g.name); n++; } }));
      return document.querySelectorAll('.resume-group').length === n;
    }, null, { timeout: 60000 });
    const groupExpect = await page.evaluate(() => {
      const r = window.APP_DATA.resume;
      const seen = new Set();
      return (r.sections || []).flatMap(s => s.groups || []).map(g => {
        const ids = [...new Set((g.questionIds || []).filter(id => !!Data.question(id)))];
        return { name: g.name, ids };
      }).filter(g => {
        if (!g.ids.length || seen.has(g.name)) return false;
        seen.add(g.name);
        return true;
      });
    });
    check('每个分组都有定向自测按钮', await page.locator('[data-rv-mock]').count() === groupExpect.length);
    const firstLabel = await page.locator('[data-rv-mock]').first().textContent();
    check('定向自测按钮标注题数', new RegExp(`定向自测\\(${groupExpect[0].ids.length}题\\)`).test(firstLabel.trim()), firstLabel);

    /* ---- ② 定向自测:开出一轮 label=简历·组名 的定向会话 ----
       toggle 验证用拦截版 startDirected(不真的跳走,details 还在页面上才能断言开合) */
    const firstDetails = page.locator('.resume-group').first();
    await firstDetails.locator('summary').scrollIntoViewIfNeeded();
    const beforeOpen = await firstDetails.evaluate(el => el.open);
    assert(beforeOpen, '前置:分组默认展开');
    /* 打开第一个分组(折叠它)再点按钮:如果按钮误触发 summary 切换,details 会被重新展开 */
    await firstDetails.locator('summary').click();
    check('手动点击 summary 可折叠分组', !(await firstDetails.evaluate(el => el.open)));
    await page.evaluate(() => {
      window.__capStart = window.__capStart || [];
      const orig = MockView.startDirected.bind(MockView);
      MockView.startDirected = (ids, label) => { window.__capStart.push({ ids, label }); };
      window.__restoreStart = () => { MockView.startDirected = orig; };
    });
    await firstDetails.locator('[data-rv-mock]').click();
    await page.waitForFunction(() => (window.__capStart || []).length > 0, null, { timeout: 15000 });
    check('点击定向自测不会误展开 details', !(await firstDetails.evaluate(el => el.open)));
    const cap1 = await page.evaluate(() => { const c = window.__capStart[0]; window.__restoreStart(); return c; });
    check('拦截版收到 label=简历·组名 与有效题号',
      cap1.label === '简历·' + groupExpect[0].name
      && JSON.stringify(cap1.ids) === JSON.stringify(groupExpect[0].ids), JSON.stringify(cap1).slice(0, 120));

    /* 真实路径:不拦截,点按钮应跳到 #/mock/run 并留下定向会话草稿 */
    await firstDetails.locator('summary').click();   /* 重新展开 */
    await firstDetails.locator('[data-rv-mock]').click();
    check('跳转到模拟会话页', await page.waitForFunction(() => location.hash.startsWith('#/mock/run'), null, { timeout: 15000 }).then(() => true).catch(() => false));
    const draft1 = await page.evaluate(() => {
      const d = Store.data.mock.draft;
      return d ? { label: d.label, count: (d.items || []).length, directed: d.directed } : null;
    });
    check('会话草稿为定向模式', draft1 && draft1.directed === true, JSON.stringify(draft1));
    check('会话 label 以「简历·」开头且含组名',
      draft1 && draft1.label.startsWith('简历·') && draft1.label.includes(groupExpect[0].name), draft1 && draft1.label);
    check('会话题数 = 分组有效题号数', draft1 && draft1.count === groupExpect[0].ids.length, `${draft1 && draft1.count} vs ${groupExpect[0].ids.length}`);
    check('页面进度指示与题数一致', await page.evaluate(n => {
      const t = (document.querySelector('.mock-progress') || {}).textContent || '';
      return t.includes(`/ ${n} 题`);
    }, groupExpect[0].ids.length));

    /* ---- ③ 顶层「必知题定向自测」:去重后的 mustKnow 题号 ---- */
    await open('#/resume');
    await page.waitForFunction(() => !!document.querySelector('[data-rv-must-mock]'), null, { timeout: 60000 });
    const mustExpect = await page.evaluate(() => {
      const r = window.APP_DATA.resume, seen = new Set();
      (r.sections || []).forEach(s => (s.groups || []).forEach(g => {
        if (!g.mustKnow) return;
        (g.questionIds || []).filter(id => !!Data.question(id)).forEach(id => seen.add(id));
      }));
      return [...seen];
    });
    const mustBtnLabel = (await page.locator('[data-rv-must-mock]').textContent()).trim();
    check('必知题按钮出现且标注题数', new RegExp(`必知题定向自测\\(${mustExpect.length}题\\)`).test(mustBtnLabel), mustBtnLabel);
    await page.locator('[data-rv-must-mock]').click();
    await page.waitForFunction(() => location.hash.startsWith('#/mock/run'), null, { timeout: 15000 });
    const draft2 = await page.evaluate(() => {
      const d = Store.data.mock.draft;
      return d ? { label: d.label, ids: (d.items || []).map(it => it.qid) } : null;
    });
    check('必知会话 label = 简历·必知题', draft2 && draft2.label === '简历·必知题', draft2 && draft2.label);
    check('必知会话题号保序去重且与配置一致',
      draft2 && JSON.stringify(draft2.ids) === JSON.stringify(mustExpect), JSON.stringify((draft2 && draft2.ids || []).slice(0, 5)));

    /* ---- ④ 导出表达卡:真实 download 事件,内容含【题号】头与非空要点 ---- */
    await open('#/resume');
    await page.waitForFunction(() => document.querySelectorAll('[data-rv-export]').length > 0, null, { timeout: 60000 });
    const firstGroup = groupExpect[0];
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 30000 }),
      page.locator('[data-rv-export]').first().click()
    ]);
    const fname = download.suggestedFilename();
    /* 文件名与 ExpressCard.fileName 同一约定:去掉空白与非法字符 */
    const safeName = `简历表达卡-${firstGroup.name}`.replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '');
    check('文件名形如 简历表达卡-<组名>.txt', fname === safeName + '.txt', fname);
    const tmp = path.join(require('os').tmpdir(), 'aiiv-resume-card-' + Date.now() + '.txt');
    await download.saveAs(tmp);
    const text = fs.readFileSync(tmp, 'utf8');
    fs.unlinkSync(tmp);
    check('表达卡含每题【题号】头', firstGroup.ids.every(id => text.includes(`【${id}】`)), text.slice(0, 120));
    check('表达卡含问/答行且非空', /问：.+/s.test(text) && /答（要点）：.+/s.test(text), text.slice(0, 200));
    check('表达卡题数与分组一致', (text.match(/【/g) || []).length === firstGroup.ids.length);

    /* ---- ⑤ 全程无 JS 异常 ---- */
    check('全程无 JS 异常', errors.length === 0, errors.join('|'));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
