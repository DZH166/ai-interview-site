/* 阶段4:真实前置条件、noteDraft 副本与同毫秒四态收敛。
   禁用传播的反向回归在 Node save-protocol 套件验证，不在浏览器篡改 Storage。
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
async function openApp(context, route = 'home') {
  const page = await context.newPage();
  await page.goto(BASE + '/index.html#/' + route);
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
  return page;
}
async function seedPair(browser, note, routeA = 'home') {
  const context = await browser.newContext();
  const A = await context.newPage();
  await A.goto(BASE + '/__seed__');
  await A.evaluate(value => localStorage.setItem('aiiv:records', JSON.stringify({
    v: 3, resetEpoch: 0, resetTs: 0,
    questions: { 'AG-001': { note: value, _updatedAt: 0 } },
    mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {}
  })), note);
  assert.strictEqual(await diskNote(A, 'AG-001'), note, '真实种子必须写入独立 context');
  await A.goto(BASE + '/index.html#/' + routeA);
  await A.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
  const B = await openApp(context);
  return { context, A, B };
}
async function sameTimeWrite(page, note) {
  assert.strictEqual(await page.evaluate(value => {
    const r = Store.rec('AG-001'); r.note = value; r._updatedAt = 1700000000000;
    return Store.saveNow();
  }, note), true, '同毫秒测试必须通过真实 saveNow 成功落盘');
}
async function waitForFourStates(A, B, P, allowed) {
  const started = Date.now();
  let states, stable = 0, previous;
  while (Date.now() - started < 6000) {
    const [a, b, disk, reopen] = await Promise.all([
      A.evaluate(() => Store.rec('AG-001').note), B.evaluate(() => Store.rec('AG-001').note),
      diskNote(A, 'AG-001'), P.evaluate(() => Store.rec('AG-001').note)
    ]);
    states = { a, b, disk, reopen };
    const converged = allowed.includes(a) && a === b && b === disk && disk === reopen;
    stable = converged ? (a === previous ? stable + 1 : 1) : 0;
    previous = a;
    if (stable === 3) return states;
    await sleep(50);
  }
  assert.fail('四态未收敛: ' + JSON.stringify(states));
}

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const trace = [];

    /* ===== S1: 同毫秒顺序写(正常 saveNow 接口,同 _updatedAt) ===== */
    {
      const { context, A, B } = await seedPair(browser, 'S1独立初始笔记');
      /* 前置:两页都就绪,基线一致 */
      check('S1-pre 两页与磁盘均为独立初始笔记',
        await A.evaluate(() => Store.rec('AG-001').note) === 'S1独立初始笔记'
        && await B.evaluate(() => Store.rec('AG-001').note) === 'S1独立初始笔记'
        && await diskNote(A, 'AG-001') === 'S1独立初始笔记');
      /* A 写 A 版本,B 写 B 版本,同 _updatedAt,正常接口 */
      await sameTimeWrite(A, 'A同毫秒版本');
      await sameTimeWrite(B, 'B同毫秒版本');
      const P = await openApp(context);
      const states = await waitForFourStates(A, B, P, ['A同毫秒版本', 'B同毫秒版本']);
      const converged = states.a === states.b && states.b === states.disk && states.disk === states.reopen;
      trace.push({ case: 'S1 正向同毫秒顺序写 A→B', states, converged });
      check('S1 同毫秒 A→B: A/B/磁盘/重开四态收敛', converged, JSON.stringify(states));
      await context.close();
    }

    /* ===== S2: 真实暂停恢复 =====
       浏览器里同一 window 注册的 storage 监听无法移除(捕获阶段拦截在 target 阶段无效——
       按 target 阶段规则两者都执行,实测 stopImmediatePropagation 拦不住先注册的监听),
       所以「后台标签页错过事件」的场景在 Node 侧用双 Store 实例等价构造:
       tests/stage4-pause-test.js(独立内存 + 共享 localStorage,暂停方不接收对方写入)。
       此处不再用假标记(__paused)伪装前置条件——审查报告 ST-02 指出的正是这种假构造。 */
    {
      check('S2 Node 暂停恢复回归文件存在(行为结果由独立 Node 套件报告)', fs.existsSync(path.join(ROOT, 'tests', 'stage4-pause-test.js')));
    }

    /* ===== S3: 关闭前输入副本(noteDraft)+ 备份往返可找回 ===== */
    {
      const { context, A, B } = await seedPair(browser, '已保存版', 'study/AG-001');
      await A.waitForFunction(() => document.querySelector('#note-area'));
      /* A 输入但未提交;B 保存同题新笔记 */
      await A.locator('#note-area').fill('A关闭前的原文KEEPME');
      const aUpdatedAt = await A.evaluate(() => Store.rec('AG-001')._updatedAt);
      assert.strictEqual(await B.evaluate(previous => {
        Store.setNote('AG-001', 'B保存的新版');
        Store.rec('AG-001')._updatedAt = Math.max(Date.now(), previous + 1);
        return Store.saveNow();
      }, aUpdatedAt), true);
      await A.waitForFunction(() => Store.rec('AG-001').note === 'B保存的新版'
        && document.querySelector('#remote-note-conflict'), null, { timeout: 6000 });
      /* A pagehide:dirty 输入进 noteDraft */
      await A.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
      await A.waitForFunction(() => {
        const r = JSON.parse(localStorage.getItem('aiiv:records')).questions['AG-001'];
        return r.note === 'B保存的新版' && r.noteDraft
          && JSON.stringify(r.noteDraft).includes('A关闭前的原文KEEPME');
      });
      const draft = await diskDraft(A, 'AG-001');
      check('S3a noteDraft 落盘且含原文', !!(draft && JSON.stringify(draft).includes('A关闭前的原文KEEPME')), JSON.stringify(draft).slice(0, 120));
      check('S3b 正式笔记保持 B 的版本(不被覆盖)', await diskNote(A, 'AG-001') === 'B保存的新版');
      /* 关闭 A,新页面 + 备份往返证明仍可找回 */
      await A.close();
      const P = await openApp(context, 'maintain');
      const exported = await P.evaluate(() => Store.exportFull());
      await P.evaluate(() => { Store.clearAll(); Store.saveNow(); });
      check('S3c 清空后备份往返:noteDraft 仍在完整备份里', exported.includes('A关闭前的原文KEEPME'));
      await P.evaluate(text => Store.importFull(text), exported);
      await P.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
      const draftBack = await diskDraft(P, 'AG-001');
      check('S3d 恢复后输入副本可找回', !!(draftBack && JSON.stringify(draftBack).includes('A关闭前的原文KEEPME')), JSON.stringify(draftBack).slice(0, 120));
      trace.push({ case: 'S3 关闭副本往返', draftRestored: !!(draftBack && JSON.stringify(draftBack).includes('KEEPME')) });
      await context.close();
    }

    /* ===== S4: 独立存储、无拦截，交换写入先后验证真实正向收敛 =====
       仅断言两种候选值之一及四态相同；同毫秒冲突的稳定决胜与禁传播反向
       由 tests/save-protocol-test.js 和 tests/baseline2/issues-node-test.js 验证。 */
    {
      const { context, A, B } = await seedPair(browser, 'S4独立初始笔记');
      check('S4-pre A/B/磁盘均为独立种子，无 S3 记录残留',
        await A.evaluate(() => Store.rec('AG-001').note) === 'S4独立初始笔记'
        && await B.evaluate(() => Store.rec('AG-001').note) === 'S4独立初始笔记'
        && await diskNote(A, 'AG-001') === 'S4独立初始笔记');
      await sameTimeWrite(B, 'B同毫秒版本');
      await sameTimeWrite(A, 'A同毫秒版本');
      const P = await openApp(context);
      const states = await waitForFourStates(A, B, P, ['A同毫秒版本', 'B同毫秒版本']);
      const converged = states.a === states.b && states.b === states.disk && states.disk === states.reopen;
      check('S4 正向同毫秒 B→A: A/B/磁盘/重开四态收敛', converged, JSON.stringify(states));
      trace.push({ case: 'S4 正向同毫秒顺序写 B→A（独立 context、无存储拦截）', states, converged });
      await context.close();
    }

    fs.mkdirSync(path.join(ROOT, 'delivery', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'delivery', 'reviews', 'stage4-matrix.json'),
      JSON.stringify({ date: new Date().toISOString(), head: require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(), cases: trace }, null, 1), 'utf8');
    console.log(`\n结果: ${passed} 通过, 0 失败(轨迹: delivery/reviews/stage4-matrix.json)`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
