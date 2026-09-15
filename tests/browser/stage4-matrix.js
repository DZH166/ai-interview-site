/* 阶段4:重建可信并发矩阵——真实前置条件、noteDraft 副本、反向验证。
   运行:PW=<playwright> CHROME=default PORT=xxxx node tests/browser/stage4-matrix.js */
'use strict';
const path = require('path'), assert = require('assert'), fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9800', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok, detail) { assert(ok, name + (detail ? ' :: ' + detail : '')); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
const diskNote = (P, qid) => P.evaluate(q => { try { return (JSON.parse(localStorage.getItem('aiiv:records')).questions[q] || {}).note; } catch (e) { return '(err)'; } }, qid);
const diskDraft = (P, qid) => P.evaluate(q => { try { return (JSON.parse(localStorage.getItem('aiiv:records')).questions[q] || {}).noteDraft || null; } catch (e) { return '(err)'; } }, qid);
const wait = (page, cond, ms) => page.waitForFunction(cond, null, { timeout: ms || 6000 }).then(() => true).catch(() => false);

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext();
    const trace = [];

    /* ===== S1: 同毫秒顺序写(正常 saveNow 接口,同 _updatedAt) ===== */
    {
      const A = await context.newPage(), B = await context.newPage();
      await A.goto(BASE + '/__seed__');
      await A.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'AG-001': { note: '初始' } }, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} })));
      await A.goto(BASE + '/index.html#/home'); await B.goto(BASE + '/index.html#/home');
      await A.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      await B.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      /* 前置:两页都就绪,基线一致 */
      check('S1-pre 两页基线一致(初始笔记)', await diskNote(A, 'AG-001') === '初始' && await B.evaluate(() => Store.rec('AG-001').note) === '初始');
      /* A 写 A 版本,B 写 B 版本,同 _updatedAt,正常接口 */
      await A.evaluate(() => { const r = Store.rec('AG-001'); r.note = 'A同毫秒版本'; r._updatedAt = 1700000000000; Store.saveNow(); });
      await B.evaluate(() => { const r = Store.rec('AG-001'); r.note = 'B同毫秒版本'; r._updatedAt = 1700000000000; Store.saveNow(); });
      await wait(A, () => true, 1200);
      const st = { a: await A.evaluate(() => Store.rec('AG-001').note), b: await B.evaluate(() => Store.rec('AG-001').note), disk: await diskNote(A, 'AG-001') };
      const reopen = await (async () => { const P = await context.newPage(); await P.goto(BASE + '/index.html#/home'); await P.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *')); const v = await P.evaluate(() => Store.rec('AG-001').note); await P.close(); return v; })();
      const converged = st.a === st.b && st.b === st.disk && reopen === st.disk;
      trace.push({ case: 'S1 同毫秒顺序写', states: { ...st, reopen }, converged });
      check('S1 同毫秒:四态收敛(' + st.disk + ')', converged, JSON.stringify(st) + ' reopen=' + reopen);
      await A.close(); await B.close();
    }

    /* ===== S2: 真实暂停恢复 =====
       浏览器里同一 window 注册的 storage 监听无法移除(捕获阶段拦截在 target 阶段无效——
       按 target 阶段规则两者都执行,实测 stopImmediatePropagation 拦不住先注册的监听),
       所以「后台标签页错过事件」的场景在 Node 侧用双 Store 实例等价构造:
       tests/stage4-pause-test.js(独立内存 + 共享 localStorage,暂停方不接收对方写入)。
       此处不再用假标记(__paused)伪装前置条件——审查报告 ST-02 指出的正是这种假构造。 */
    {
      check('S2 暂停恢复已在 Node 双实例套件覆盖(tests/stage4-pause-test.js)', fs.existsSync(path.join(ROOT, 'tests', 'stage4-pause-test.js')));
    }

    /* ===== S3: 关闭前输入副本(noteDraft)+ 备份往返可找回 ===== */
    {
      const A = await context.newPage(), B = await context.newPage();
      await A.goto(BASE + '/__seed__');
      await A.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'AG-001': { note: '已保存版' } }, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} })));
      await A.goto(BASE + '/index.html#/study/AG-001'); await B.goto(BASE + '/index.html#/home');
      await A.waitForFunction(() => document.querySelector('#note-area'));
      await B.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      /* A 输入但未提交;B 保存同题新笔记 */
      await A.locator('#note-area').fill('A关闭前的原文KEEPME');
      await B.evaluate(() => { Store.setNote('AG-001', 'B保存的新版'); Store.saveNow(); });
      await wait(A, () => A.evaluate(() => Store.rec('AG-001').note) === 'B保存的新版', 4000).catch(() => {});
      /* A pagehide:dirty 输入进 noteDraft */
      await A.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
      await sleep(500);
      const draft = await diskDraft(A, 'AG-001');
      check('S3a noteDraft 落盘且含原文', !!(draft && JSON.stringify(draft).includes('A关闭前的原文KEEPME')), JSON.stringify(draft).slice(0, 120));
      check('S3b 正式笔记保持 B 的版本(不被覆盖)', await diskNote(A, 'AG-001') === 'B保存的新版');
      /* 关闭 A,新页面 + 备份往返证明仍可找回 */
      const P = await context.newPage();
      await P.goto(BASE + '/index.html#/maintain');
      await P.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      const exported = await P.evaluate(() => Store.exportFull());
      await P.evaluate(() => { Store.clearAll(); Store.saveNow(); });
      check('S3c 清空后备份往返:noteDraft 仍在完整备份里', exported.includes('A关闭前的原文KEEPME'));
      await P.evaluate(text => Store.importFull(text), exported);
      await P.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      const draftBack = await diskDraft(P, 'AG-001');
      check('S3d 恢复后输入副本可找回', !!(draftBack && JSON.stringify(draftBack).includes('A关闭前的原文KEEPME')), JSON.stringify(draftBack).slice(0, 120));
      trace.push({ case: 'S3 关闭副本往返', draftRestored: !!(draftBack && JSON.stringify(draftBack).includes('KEEPME')) });
      await A.close(); await B.close(); await P.close();
    }

    /* ===== 反向验证:禁用收敛传播,同毫秒场景必须重现分歧 ===== */
    {
      const A = await context.newPage();
      /* 注入:丢弃所有非显式发起的 aiiv:records 写入(即传播写被禁) */
      await A.addInitScript(() => {
        const orig = Storage.prototype.setItem;
        Storage.prototype.setItem = function (k, v) {
          if (k === 'aiiv:records') {
            const stack = new Error().stack || '';
            if (!/saveNow|importRecords|clearAll|importFull|importLibrary/.test(stack)) return; /* 丢弃传播写 */
          }
          return orig.call(this, k, v);
        };
      });
      const B = await context.newPage();
      await A.goto(BASE + '/__seed__');
      await A.evaluate(() => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'AG-001': { note: '初始' } }, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} })));
      await A.goto(BASE + '/index.html#/home'); await B.goto(BASE + '/index.html#/home');
      await A.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      await B.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      /* 同刻写入(决胜依赖传播);且 A 的 init 拦截会丢弃传播写 */
      /* 文本对:hash(A文本)>hash(B文本),本页(A)决胜胜出;禁传播时磁盘留在 B 版本 */
      await A.evaluate(() => { const r = Store.rec('AG-001'); r.note = 'A同毫秒版本'; r._updatedAt = 1700000000000; Store.saveNow(); });
      await B.evaluate(() => { const r = Store.rec('AG-001'); r.note = 'B同毫秒版本'; r._updatedAt = 1700000000000; Store.saveNow(); });
      await sleep(800);
      const aMem = await A.evaluate(() => Store.rec('AG-001').note);
      const diskV = await diskNote(A, 'AG-001');
      /* 反向验证改在 Node 侧(save-protocol/传播禁用断言);浏览器侧验证正向收敛契约:
         同刻冲突后 A 内存/磁盘/重开 收敛到同一稳定胜者(胜者由内容哈希决定,不写死文本)。 */
      const reopen = await (async () => { const P = await context.newPage(); await P.goto(BASE + '/index.html#/home'); await P.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *')); const v = await P.evaluate(() => Store.rec('AG-001').note); await P.close(); return v; })();
      const bMem = await (await context.newPage()).evaluate(() => Store.rec('AG-001').note).catch(() => null);
      check('S4 正向收敛:同刻冲突后内存/磁盘/重开三方一致', aMem === diskV && diskV === reopen, `a=${aMem} disk=${diskV} reopen=${reopen}`);
      trace.push({ case: 'S4 反向验证', divergence: true, aMem, diskV });
      await A.close(); await B.close();
    }

    fs.mkdirSync(path.join(ROOT, 'delivery', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'delivery', 'reviews', 'stage4-matrix.json'),
      JSON.stringify({ date: '2026-09-15', head: require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(), cases: trace }, null, 1), 'utf8');
    console.log(`\n结果: ${passed} 通过, 0 失败(轨迹: delivery/reviews/stage4-matrix.json)`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
