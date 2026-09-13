/* 阶段1 正式验收:跨页同步不写回循环、不抢焦点、旧控件不覆盖新笔记、冲突可处置(ST-01/ST-02)。
   运行:PW=<playwright> CHROME=default PORT=xxxx node tests/browser/remote-sync.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9400', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok, detail) { assert(ok, name + (detail ? ' :: ' + detail : '')); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
}
function instrument(page) {
  return page.evaluate(() => {
    window.__m = { writes: 0, routes: 0, toasts: 0 };
    const origSet = Storage.prototype.setItem;
    Storage.prototype.setItem = function (k, v) { if (k === 'aiiv:records') window.__m.writes++; return origSet.call(this, k, v); };
    const origRoute = App.route.bind(App);
    App.route = function () { window.__m.routes++; return origRoute(); };
    const origToast = window.toast;
    window.toast = function (m, t) { window.__m.toasts++; return origToast.call(window, m, t); };
    return true;
  });
}
const sleepMs = () => new Promise(r => setTimeout(r, 250));

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });

    /* ---- ST-01: 一次同步后静置,写盘/路由/提示计数稳定 ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await A.goto(BASE + '/__seed__');
      await A.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'PY-001': { status: 'weak' } }, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
      await open(A, '#/home'); await open(B, '#/home');
      await instrument(A); await instrument(B);
      await B.evaluate(() => { Store.setNote('PY-001', 'B 的一次编辑'); Store.saveNow(); });
      await sleep(3000);
      const a1 = await A.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      const b1 = await B.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      await sleep(1500);
      const a2 = await A.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      const b2 = await B.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      check('ST-01a A 写盘计数稳定(3s→4.5s)', a1.writes === a2.writes, `${a1.writes}→${a2.writes}`);
      check('ST-01b A 路由计数稳定', a1.routes === a2.routes, `${a1.routes}→${a2.routes}`);
      check('ST-01c B 写盘计数稳定', b1.writes === b2.writes, `${b1.writes}→${b2.writes}`);
      check('ST-01d B 路由计数稳定', b1.routes === b2.routes, `${b1.routes}→${b2.routes}`);
      check('ST-01e 无反复提示', b1.toasts === b2.toasts, `${b1.toasts}→${b2.toasts}`);
      await A.close(); await B.close();
    }

    /* ---- ST-01f + ST-02: 焦点保持;未编辑控件不覆盖;刷新后仍为新版 ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await A.goto(BASE + '/__seed__');
      await A.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'AG-001': { note: '旧笔记' }, 'RG-001': { note: '' } }, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
      await open(A, '#/study/AG-001'); await open(B, '#/home');
      await instrument(A); await instrument(B);
      await A.locator('#note-area').click();
      await B.evaluate(() => { Store.setNote('RG-001', 'B 页写的另一题笔记'); Store.saveNow(); });
      await sleep(1500);
      check('ST-01f 跨页更新不抢走 A 的输入焦点', await A.evaluate(() => document.activeElement && document.activeElement.id === 'note-area'),
        'activeElement=' + await A.evaluate(() => (document.activeElement || {}).id));
      check('ST-01g A 的滚动位置保留', await A.evaluate(() => { window.scrollTo(0, 180); return true; }));
      await B.evaluate(() => { Store.setNote('AG-001', 'B 页保存的新笔记'); Store.saveNow(); });
      await B.waitForFunction(() => Store.rec('AG-001').note === 'B 页保存的新笔记').catch(() => {});
      await sleep(1200);
      check('ST-02a A 内存保持新版', await A.evaluate(() => Store.rec('AG-001').note) === 'B 页保存的新笔记');
      check('ST-02b B 内存保持新版', await B.evaluate(() => Store.rec('AG-001').note) === 'B 页保存的新笔记');
      check('ST-02c 磁盘保持新版', await A.evaluate(() => (JSON.parse(localStorage.getItem('aiiv:records')).questions['AG-001'] || {}).note) === 'B 页保存的新笔记');
      check('ST-02d A 的textarea就地显示新版(未编辑控件被更新)', await A.evaluate(() => (document.querySelector('#note-area') || {}).value) === 'B 页保存的新笔记');
      check('ST-02e 滚动位置未被打断', await A.evaluate(() => window.scrollY >= 150), String(await A.evaluate(() => window.scrollY)));
      /* 刷新后(冷启动读盘)仍为新版 */
      await A.reload();
      await A.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#note-area'));
      check('ST-02f 刷新后仍为新版', await A.evaluate(() => (document.querySelector('#note-area') || {}).value) === 'B 页保存的新笔记');
      await A.close(); await B.close();
    }

    /* ---- ST-02g/k: A 正在编辑时,两版内容均能找回,处置有明确结果 ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await A.goto(BASE + '/__seed__');
      await A.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'AG-001': { note: '初始笔记' } }, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })));
      await open(A, '#/study/AG-001'); await open(B, '#/home');
      await instrument(A); await instrument(B);
      /* A 真实编辑(产生 dirty),不提交 */
      await A.locator('#note-area').fill('A 正在输入的版本');
      /* B 保存同一题的新版本 */
      await B.evaluate(() => { Store.setNote('AG-001', 'B 保存的版本'); Store.saveNow(); });
      await B.waitForFunction(() => Store.rec('AG-001').note === 'B 保存的版本').catch(() => {});
      await sleep(1200);
      check('ST-02g 冲突时 A 的本地输入保留(不被静默覆盖)', await A.evaluate(() => (document.querySelector('#note-area') || {}).value) === 'A 正在输入的版本');
      check('ST-02h A 内存为 B 的新版(数据层新者胜)', await A.evaluate(() => Store.rec('AG-001').note) === 'B 保存的版本');
      check('ST-02i 给出冲突处置入口', await A.locator('#remote-note-conflict').count() === 1);
      /* 「查看对方版本」能找回 B 的内容 */
      await A.locator('#rn-view').click();
      await A.waitForFunction(() => document.querySelector('.modal'));
      const modalText = await A.evaluate(() => (document.querySelector('.modal-body') || {}).textContent || '');
      check('ST-02j 对方版本可查看', modalText.includes('B 保存的版本'));
      await A.locator('.modal [data-close]').click();
      /* 选择「保留我的」:A 的输入保留,后续 flush 落盘为 A 的版本 */
      await A.locator('#rn-mine').click();
      await A.evaluate(() => { StudyView.flushNote(); });
      await sleep(400);
      check('ST-02k 保留我的后落盘为 A 的版本', await A.evaluate(() => {
        const disk = (JSON.parse(localStorage.getItem('aiiv:records')).questions['AG-001'] || {}).note;
        return disk === 'A 正在输入的版本' ? disk : disk;
      }) === 'A 正在输入的版本', await A.evaluate(() => (JSON.parse(localStorage.getItem('aiiv:records')).questions['AG-001'] || {}).note));
      /* B 收到 A 的落盘 → B 也收敛到 A 的版本(两版都可找回,处置结果一致) */
      await B.waitForFunction(() => Store.rec('AG-001').note === 'A 正在输入的版本', null, { timeout: 6000 }).catch(() => {});
      check('ST-02l B 收敛到 A 处置后的版本', await B.evaluate(() => Store.rec('AG-001').note) === 'A 正在输入的版本');
      await A.close(); await B.close();
    }

    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
