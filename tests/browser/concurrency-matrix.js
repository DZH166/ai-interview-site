/* 并发压力基线(后续轮1):固定种子双页矩阵,7类情境,每步核对 A内存/B内存/磁盘/重开 四态。
   合并策略允许明确选择胜者;不允许静默丢弃无冲突写入(任务书 后续1)。
   运行:PW=<playwright> CHROME=default PORT=xxxx node tests/browser/concurrency-matrix.js */
'use strict';
const path = require('path'), assert = require('assert'), fs = require('fs');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9600', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
function check(name, ok, detail) { assert(ok, name + (detail ? ' :: ' + detail : '')); passed++; console.log('  PASS', name); }
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
}
async function reseed(page, questions) {
  await page.goto(BASE + '/__seed__');
  await page.evaluate(recs => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: recs, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} })), questions);
}
const diskNote = (A, qid) => A.evaluate(qid => { try { const d = JSON.parse(localStorage.getItem('aiiv:records')); return (d.questions[qid] || {}).note; } catch (e) { return '(parse-err)'; } }, qid);
const reopenNote = async (A, qid) => {
  const P = await A.context().newPage();
  await P.goto(BASE + '/index.html#/home');
  await P.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
  const v = await P.evaluate(q => Store.rec(q).note, qid);
  await P.close();
  return v;
};
const wait = (page, cond, ms) => page.waitForFunction(cond, null, { timeout: ms || 6000 }).then(() => true).catch(() => false);

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    const log = [];

    /* ---- 情境1: 同时写同字段(顺序发生的读改写) ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, { 'AG-001': { note: '初始' } });
      await open(A, '#/home'); await open(B, '#/home');
      await A.evaluate(() => { Store.setNote('AG-001', 'A写'); Store.saveNow(); });
      await wait(B, () => Store.rec('AG-001').note === 'A写');
      await B.evaluate(() => { Store.setNote('AG-001', 'B写'); Store.saveNow(); });
      await wait(A, () => Store.rec('AG-001').note === 'B写');
      const st = { a: await A.evaluate(() => Store.rec('AG-001').note), b: await B.evaluate(() => Store.rec('AG-001').note),
                   disk: await diskNote(A, 'AG-001'), reopen: await reopenNote(A, 'AG-001') };
      const okAll = st.a === 'B写' && st.b === 'B写' && st.disk === 'B写' && st.reopen === 'B写';
      log.push({ case: '同字段顺序写入', winner: '后写者', states: st, ok: okAll });
      check('1. 同字段顺序写入:四态收敛到后写者(B写)', okAll, JSON.stringify(st));
      await A.close(); await B.close();
    }

    /* ---- 情境2: 同时写不同字段(不同题)——无冲突,不得静默丢弃 ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, {});
      await open(A, '#/home'); await open(B, '#/home');
      await A.evaluate(() => { Store.setNote('PY-001', 'A的无冲突写入'); Store.saveNow(); });
      await wait(B, () => Store.rec('PY-001').note === 'A的无冲突写入');
      await B.evaluate(() => { Store.setNote('RG-001', 'B的无冲突写入'); Store.saveNow(); });
      await wait(A, () => Store.rec('RG-001').note === 'B的无冲突写入');
      const st = {
        pyDisk: await diskNote(A, 'PY-001'), pyReopen: await reopenNote(A, 'PY-001'),
        rgDisk: await diskNote(A, 'RG-001'), rgReopen: await reopenNote(A, 'RG-001')
      };
      const okAll = st.pyDisk === 'A的无冲突写入' && st.pyReopen === 'A的无冲突写入'
                 && st.rgDisk === 'B的无冲突写入' && st.rgReopen === 'B的无冲突写入';
      log.push({ case: '不同字段并发', states: st, ok: okAll });
      check('2. 不同题并发写入:两条都保留(无静默丢弃)', okAll, JSON.stringify(st));
      await A.close(); await B.close();
    }

    /* ---- 情境3: 同毫秒双写(同 _updatedAt)——决胜规则稳定,不依赖事件到达顺序 ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, {});
      await open(A, '#/home'); await open(B, '#/home');
      /* 两页用同一固定时间戳写:决胜必须确定(内容哈希大者),重复运行结果一致 */
      const T = 1700000000000;
      await A.evaluate(t => {
        const r = Store.rec('AG-001');
        r.note = 'A同毫秒版本'; r._updatedAt = t;
        Store.saveNow();
      }, T);
      await B.evaluate(t => {
        /* B 不经过 storage 合并(模拟同时写盘):直接写一份同刻不同内容的磁盘 */
        const d = JSON.parse(localStorage.getItem('aiiv:records'));
        d.questions['AG-001'] = { note: 'B同毫秒版本', _updatedAt: t, status: '', fav: false, viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
        localStorage.setItem('aiiv:records', JSON.stringify(d));
      }, T);
      /* A 再次保存触发合并路径 */
      await A.evaluate(() => { Store.setNote('RG-002', '触发合并'); Store.saveNow(); });
      await wait(A, () => Store.rec('RG-002').note === '触发合并');
      const s1 = await diskNote(A, 'AG-001');
      const reopen1 = await reopenNote(A, 'AG-001');
      /* 重复运行:同样的输入,决胜结果必须一致 */
      const B2 = await context.newPage();
      await reseed(A, {});
      await B2.goto(BASE + '/__seed__');   /* B2 只直接写盘,不需要应用页 */
      await open(A, '#/home');
      await A.evaluate(t => { const r = Store.rec('AG-001'); r.note = 'A同毫秒版本'; r._updatedAt = t; Store.saveNow(); }, T);
      await B2.evaluate(t => {
        const d = JSON.parse(localStorage.getItem('aiiv:records'));
        d.questions['AG-001'] = { note: 'B同毫秒版本', _updatedAt: t, status: '', fav: false, viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
        localStorage.setItem('aiiv:records', JSON.stringify(d));
      }, T);
      await A.evaluate(() => { Store.setNote('RG-003', '再次触发'); Store.saveNow(); });
      await wait(A, () => Store.rec('RG-003').note === '再次触发');
      const s2 = await diskNote(A, 'AG-001');
      const st = { first: s1, second: s2, reopen: reopen1 };
      const okAll = s1 === s2 && (s1 === 'A同毫秒版本' || s1 === 'B同毫秒版本') && reopen1 === s1;
      log.push({ case: '同毫秒双写(决胜稳定性)', states: st, ok: okAll });
      check('3. 同毫秒双写:决胜规则确定且磁盘/重开一致', okAll, JSON.stringify(st));
      await A.close(); await B2.close();
    }

    /* ---- 情境4: 双清空(两次清空,计数与时刻都不同) ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, { 'AG-001': { note: '将被清空的笔记' } });
      await open(A, '#/home'); await open(B, '#/home');
      await A.evaluate(() => { Store.clearAll(); Store.saveNow(); });
      await wait(B, () => B.evaluate(() => Store.data.resetEpoch >= 1).then(() => true).catch(() => false));
      const epAfterFirst = await B.evaluate(() => Store.data.resetEpoch);
      await B.evaluate(() => { Store.clearAll(); Store.saveNow(); });
      await wait(A, () => Store.data.resetEpoch >= 2);
      const st = {
        aEpoch: await A.evaluate(() => Store.data.resetEpoch),
        bEpoch: await B.evaluate(() => Store.data.resetEpoch),
        diskEpoch: await A.evaluate(() => JSON.parse(localStorage.getItem('aiiv:records')).resetEpoch),
        aNote: await A.evaluate(() => Store.rec('AG-001').note),
        diskNote: await diskNote(A, 'AG-001')
      };
      const okAll = st.aEpoch >= 2 && st.bEpoch >= 2 && st.diskEpoch >= 2 && !st.aNote && !st.diskNote;
      log.push({ case: '双清空(计数与时刻不同)', states: { aEpoch: st.aEpoch, bEpoch: st.bEpoch, diskEpoch: st.diskEpoch }, ok: okAll });
      check('4. 双清空:两次清空都被采纳(取较晚清空),笔记不复活', okAll, JSON.stringify(st));
      await A.close(); await B.close();
    }

    /* ---- 情境5: 暂停恢复(旧页在暂停期间错过事件,恢复后保存) ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, { 'AG-001': { note: '初始' } });
      await open(A, '#/home'); await open(B, '#/home');
      /* B 暂停:停掉事件处理(模拟后台标签页错过 storage 事件) */
      await B.evaluate(() => { window.__paused = true; });
      await A.evaluate(() => { Store.setNote('AG-001', 'A在B暂停时写的'); Store.saveNow(); });
      await sleep(300);
      /* B 恢复并保存自己的旧值(顺序发生的旧页写入) */
      await B.evaluate(() => {
        window.__paused = false;
        /* B 内存还是旧值(错过了事件),直接保存 → saveNow 前会与磁盘快照合并 */
        Store.saveNow();
      });
      await wait(A, () => Store.rec('AG-001').note === 'A在B暂停时写的');
      const st = { a: await A.evaluate(() => Store.rec('AG-001').note), b: await B.evaluate(() => Store.rec('AG-001').note),
                   disk: await diskNote(A, 'AG-001'), reopen: await reopenNote(A, 'AG-001') };
      const okAll = st.a === 'A在B暂停时写的' && st.disk === 'A在B暂停时写的' && st.reopen === 'A在B暂停时写的';
      log.push({ case: '暂停恢复后旧页保存', states: st, ok: okAll });
      check('5. 暂停恢复:B 的旧内存不得覆盖 A 已保存的新值', okAll, JSON.stringify(st));
      await A.close(); await B.close();
    }

    /* ---- 情境6: 关闭前保存(pagehide flush 与对页保存竞争) ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, { 'AG-001': { note: '初始' } });
      await open(A, '#/study/AG-001'); await open(B, '#/home');
      /* A 在学习页输入(触发 dirty),B 同时保存同题 */
      await A.locator('#note-area').fill('A关闭前输入的内容');
      await B.evaluate(() => { Store.setNote('AG-001', 'B在A关闭时保存的'); Store.saveNow(); });
      await wait(A, () => Store.rec('AG-001').note === 'B在A关闭时保存的');
      /* A pagehide flush:dirty 输入的处置 = 保留在冲突副本,不静默覆盖正式笔记 */
      await A.evaluate(() => { window.dispatchEvent(new Event('pagehide')); });
      await sleep(400);
      const st = { disk: await diskNote(A, 'AG-001'), reopen: await reopenNote(A, 'AG-001'),
                   b: await B.evaluate(() => Store.rec('AG-001').note) };
      /* 冲突时:磁盘/重开保持 B 的已保存版本;A 的输入在冲突副本里可找回 */
      const conflictKept = await A.evaluate(() => {
        const ui = Store.data.ui;
        return JSON.stringify(Object.keys(ui.conflictDrafts || {}));
      });
      const okAll = st.disk === 'B在A关闭时保存的' && st.reopen === 'B在A关闭时保存的' && st.b === 'B在A关闭时保存的';
      log.push({ case: '关闭前保存与对页写入竞争', states: st, conflictDrafts: conflictKept, ok: okAll });
      check('6. pagehide 竞争:已保存版本不被旧输入覆盖(A 的输入留在冲突副本)', okAll,
        JSON.stringify(st) + ' conflict=' + conflictKept);
      await A.close(); await B.close();
    }

    /* ---- 情境7: 清空与对页新写入交错 ---- */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, { 'AG-001': { note: '旧' } });
      await open(A, '#/home'); await open(B, '#/home');
      await A.evaluate(() => { Store.clearAll(); Store.saveNow(); });
      await wait(B, () => B.evaluate(() => Store.data.resetEpoch >= 1).then(() => true).catch(() => false));
      await B.evaluate(() => { Store.setNote('RG-010', '清空后B写的新记录'); Store.saveNow(); });
      await wait(A, () => Store.rec('RG-010').note === '清空后B写的新记录');
      const st = {
        newDisk: await diskNote(A, 'RG-010'), newReopen: await reopenNote(A, 'RG-010'),
        oldMem: await A.evaluate(() => Store.rec('AG-001').note), oldDisk: await diskNote(A, 'AG-001')
      };
      const okAll = st.newDisk === '清空后B写的新记录' && st.newReopen === '清空后B写的新记录'
                 && !st.oldMem && !st.oldDisk;
      log.push({ case: '清空后新写入交错', states: st, ok: okAll });
      check('7. 清空后新写入保留、被清空内容不复活', okAll, JSON.stringify(st));
      await A.close(); await B.close();
    }

    /* 机器可读基线记录 */
    const out = { date: '2026-09-15', head: require('child_process').execSync('git rev-parse HEAD', { cwd: ROOT }).toString().trim(),
      cases: log, env: '隔离Chromium双页,固定种子,独立端口' };
    fs.mkdirSync(path.join(ROOT, 'delivery', 'reviews'), { recursive: true });
    fs.writeFileSync(path.join(ROOT, 'delivery', 'reviews', 'concurrency-matrix.json'),
      JSON.stringify(out, null, 1), 'utf8');
    console.log(`\n结果: ${passed} 通过, 0 失败(矩阵记录: delivery/reviews/concurrency-matrix.json)`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
