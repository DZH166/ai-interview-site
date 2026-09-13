/* 阶段0 复现用例(浏览器侧):ST-01 跨页写回循环与焦点丢失 / ST-02 旧DOM覆盖新笔记 /
   SP-05 清空复活 / SP-06 完成草稿复活 / SP-02 追问错配(响应替换)。
   隔离上下文 + 独立端口,不触碰真实学习数据。不接入 CI;
   对应阶段修复完成后,断言并入正式套件,本文件随之删除。
   运行:PW=<playwright> CHROME=default node tests/baseline/issues-browser-test.js(预期:失败) */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9300', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0, failed = 0;
const failures = [];
function check(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail ? ' :: ' + detail : ''); }
}
const sleep = ms => new Promise(r => setTimeout(r, ms));

async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && document.querySelector('#view > *'));
}
/* 页内仪表:统计业务写盘(aiiv:records 的 setItem)与 App.route 调用、toast 次数 */
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
const SEED = { 'PY-001': { status: 'weak', note: 'A与B共见的旧笔记' }, 'AG-001': { status: '', note: '旧笔记' } };
async function reseed(page, questions) {
  await page.goto(BASE + '/__seed__');
  await page.evaluate(recs => localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: recs, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} })), questions);
}

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });

    /* ============ ST-01: 无内容变化仍跨页写盘、重绘(循环) ============ */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, { 'PY-001': { status: 'weak' } });
      await open(A, '#/home'); await open(B, '#/home');
      await instrument(A); await instrument(B);
      /* 一次真实编辑触发同步,随后双方静置 */
      await B.evaluate(() => { Store.setNote('PY-001', 'B 的一次编辑'); Store.saveNow(); });
      await sleep(3000);                       /* 静置 3 秒(验收门槛) */
      const a1 = await A.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      const b1 = await B.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      await sleep(1500);                       /* 再静置 1.5 秒 */
      const a2 = await A.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      const b2 = await B.evaluate(() => JSON.parse(JSON.stringify(window.__m)));
      check('ST-01a A 页静置期写盘计数稳定', a1.writes === a2.writes, `3s时${a1.writes} → 4.5s时${a2.writes}`);
      check('ST-01b A 页静置期路由/重绘计数稳定', a1.routes === a2.routes, `${a1.routes} → ${a2.routes}`);
      check('ST-01c B 页静置期写盘计数稳定', b1.writes === b2.writes, `${b1.writes} → ${b2.writes}`);
      check('ST-01d B 页静置期路由计数稳定', b1.routes === b2.routes, `${b1.routes} → ${b2.routes}`);
      check('ST-01e 静置期无新提示(去重后不应反复通知)', b1.toasts === b2.toasts, `${b1.toasts} → ${b2.toasts}`);
      await A.close(); await B.close();
    }

    /* ============ ST-01f/ST-02: 焦点保持 + 旧DOM不得覆盖新笔记 ============ */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, { 'AG-001': { note: '旧笔记' }, 'RG-001': { note: '' } });
      await open(A, '#/study/AG-001'); await open(B, '#/home');
      await instrument(A); await instrument(B);
      /* A 聚焦自己的笔记框但不输入任何内容 */
      await A.locator('#note-area').click();
      check('ST-02pre A 聚焦在笔记框', await A.evaluate(() => document.activeElement && document.activeElement.id === 'note-area'));
      /* B 对另一道题写入并保存 */
      await B.evaluate(() => { Store.setNote('RG-001', 'B 页写的另一题笔记'); Store.saveNow(); });
      await sleep(1500);
      check('ST-01f 跨页更新不抢走 A 的输入焦点', await A.evaluate(() => document.activeElement && document.activeElement.id === 'note-area'),
        'activeElement=' + await A.evaluate(() => (document.activeElement || {}).id));
      /* B 对 A 正在查看的同一题写入新笔记;A 未编辑 */
      await B.evaluate(() => { Store.setNote('AG-001', 'B 页保存的新笔记'); Store.saveNow(); });
      await B.waitForFunction(() => Store.rec('AG-001').note === 'B 页保存的新笔记').catch(() => {});
      await sleep(1500);
      const ag = {
        a: await A.evaluate(() => Store.rec('AG-001').note),
        b: await B.evaluate(() => Store.rec('AG-001').note),
        dom: await A.evaluate(() => (document.querySelector('#note-area') || {}).value),
        disk: await A.evaluate(() => { try { return (JSON.parse(localStorage.getItem('aiiv:records')).questions['AG-001'] || {}).note; } catch (e) { return '(读取失败)'; } })
      };
      check('ST-02a A 内存保持新版笔记', ag.a === 'B 页保存的新笔记', ag.a);
      check('ST-02b B 内存保持新版笔记', ag.b === 'B 页保存的新笔记', ag.b);
      check('ST-02c 磁盘保持新版笔记', ag.disk === 'B 页保存的新笔记', ag.disk);
      check('ST-02d A 页textarea显示新版(旧控件没有覆盖)',
        ag.dom === 'B 页保存的新笔记', 'DOM显示:' + ag.dom);
      await A.close(); await B.close();
    }

    /* ============ SP-05: 清空全部记录后不得被另一页复活 ============ */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, SEED);
      await open(A, '#/home'); await open(B, '#/home');
      await instrument(A); await instrument(B);
      /* 同步断言:clearAll 后内存立即为空(异步窗口会被 ST-01 的循环污染,不能作为前置) */
      const preClear = await A.evaluate(() => {
        Store.clearAll(); Store.saveNow();
        return { mem: !Store.rec('PY-001').note && !Store.data.questions.PY_001 };
      });
      check('SP-05pre A 清空后内存(同步)为空', preClear.mem);
      /* B(仍持有清空前副本)随后写入 → A 不得复活被清空的笔记 */
      await B.evaluate(() => { Store.setNote('RG-009', 'B 清空后的新笔记'); Store.saveNow(); });
      await sleep(1500);
      const st = {
        a: await A.evaluate(() => Store.rec('PY-001').note),
        disk: await A.evaluate(() => { try { return (JSON.parse(localStorage.getItem('aiiv:records')).questions || {})['PY-001']; } catch (e) { return '(空)'; } })
      };
      check('SP-05a A 内存不复活被清空笔记', !st.a, st.a);
      check('SP-05b 磁盘不复活被清空笔记', !st.disk || st.disk === '' ? true : JSON.stringify(st.disk), JSON.stringify(st.disk));
      await A.close(); await B.close();
    }

    /* ============ SP-06: 已完成会话不得恢复为未完成草稿 ============ */
    {
      const A = await context.newPage(), B = await context.newPage();
      await reseed(A, {});
      await open(A, '#/home'); await open(B, '#/home');
      await instrument(A); await instrument(B);
      /* A 开始单题定向练习并写下回答(草稿自动落盘) */
      await A.evaluate(() => MockView.startDirected(['PY-001'], '基线测试'));
      await A.waitForFunction(() => document.querySelector('#m-self'));
      await A.locator('#m-self').fill('A 的回答');
      await sleep(400);                        /* 等待草稿防抖落盘并同步到 B */
      await B.waitForFunction(() => !!(Store.data.mock.draft), null, { timeout: 5000 }).catch(() => {});
      check('SP-06pre B 已收到草稿', await B.evaluate(() => !!Store.data.mock.draft));
      /* A 完成该轮:轮次入历史,草稿清除 */
      await A.locator('#m-finish').click();
      const preFinish = await A.evaluate(() => { Store.saveNow();
        return { draft: !!Store.data.mock.draft, rounds: Store.data.mock.rounds.length }; });
      check('SP-06pre A 完成后(同步)草稿为空、历史1轮', !preFinish.draft && preFinish.rounds === 1,
        JSON.stringify(preFinish));
      /* B(仍持旧草稿)随后写入 → A 不得把旧草稿接回来 */
      await B.evaluate(() => { Store.setNote('RG-009', '触发合并的一次写入'); Store.saveNow(); });
      await sleep(1500);
      const st = {
        aDraft: await A.evaluate(() => Store.data.mock.draft),
        diskDraft: await A.evaluate(() => { try { return JSON.parse(localStorage.getItem('aiiv:records')).mock.draft; } catch (e) { return '(空)'; } }),
        aRounds: await A.evaluate(() => Store.data.mock.rounds.length)
      };
      check('SP-06a A 内存不复活已完成会话的草稿', !st.aDraft, JSON.stringify(st.aDraft && st.aDraft.answers));
      check('SP-06b 磁盘不复活草稿', !st.diskDraft, JSON.stringify(st.diskDraft && st.diskDraft.answers));
      check('SP-06c 不制造同一会话的第二轮假历史', st.aRounds === 1, String(st.aRounds));
      await A.close(); await B.close();
    }

    /* ============ SP-02: 题库更新后旧回答错配到另一追问(响应替换) ============ */
    {
      /* SW 对 data.js 是 networkFirst 且 SW 内 fetch 不经过页面级路由,必须阻断 SW 才能替换响应 */
      const ctx2 = await browser.newContext({ viewport: { width: 1200, height: 850 }, serviceWorkers: 'block' });
      const P = await ctx2.newPage();
      await reseed(P, {});
      /* 响应替换:下一页加载开始,data.js 里 AG-001 的前两条追问互换(模拟内容升级) */
      let swapOn = false;
      await P.route('**/data.js', async route => {
        const resp = await route.fetch();
        let body = await resp.text();
        if (swapOn) {
          const i0 = body.indexOf('"id":"AG-001"');
          const arrStart = body.indexOf('"followups":[', i0) + '"followups":['.length;
          let depth = 1, i = arrStart;
          while (depth > 0) { const ch = body[i]; if (ch === '[') depth++; else if (ch === ']') depth--; i++; }
          const arrText = body.slice(arrStart, i - 1);
          const arr = JSON.parse('[' + arrText + ']');
          if (arr.length >= 2) { const t = arr[0]; arr[0] = arr[1]; arr[1] = t; }
          body = body.slice(0, arrStart) + JSON.stringify(arr).slice(1, -1) + body.slice(i - 1);
        }
        route.fulfill({ status: 200, contentType: 'application/javascript', body });
      });
      await open(P, '#/home');
      const fuQ0 = await P.evaluate(() => Data.question('AG-001').followups[0].q);
      await P.evaluate(() => MockView.startDirected(['AG-001'], '基线测试'));
      await P.waitForFunction(() => document.querySelector('#mock-fu-list') || document.querySelector('#m-reveal'));
      if (await P.locator('#m-reveal').count()) await P.locator('#m-reveal').click();
      await P.waitForFunction(() => document.querySelector('#mock-fu-list'));
      await P.locator('#mock-fu-list [data-fu-id]').first().fill('我的追问回答ABC');
      await sleep(400);                        /* 草稿落盘 */
      const qBefore = await P.evaluate(() => Data.question('AG-001').followups[0].q);
      /* 内容升级:互换追问顺序后刷新 */
      swapOn = true;
      await P.reload();
      await P.waitForFunction(() => typeof Data !== 'undefined' && document.querySelector('#view > *'));
      await open(P, '#/mock/run');             /* 草稿自动恢复进 run 视图 */
      await P.waitForFunction(() => document.querySelector('#mock-fu-list') || document.querySelector('#m-resume') || document.querySelector('#m-self'));
      const qAfter = await P.evaluate(() => Data.question('AG-001').followups[0].q);
      /* 修复后:回答按内容身份绑定——互换顺序后,回答必须仍显示在原题面下 */
      const paired = await P.evaluate((origQ) => {
        const d = Store.data.mock.draft;
        const fu = (d.answers['AG-001'] || {}).fu || {};
        const entry = Object.values(fu).find(e => (e.self || '') === '我的追问回答ABC');
        if (!entry) return { ok: false, why: '回答丢失', entry: null };
        const el = document.querySelector(`[data-fu-item="${entry.id}"] textarea`);
        const fuq = document.querySelector(`[data-fu-item="${entry.id}"] .fu-q`);
        const shownUnder = fuq ? fuq.textContent.replace(/^追问 \d+:/, '') : '(未找到)';
        return { ok: !!(el && el.value === '我的追问回答ABC' && shownUnder === entry.q && entry.q === origQ), shownUnder, snap: entry.q };
      }, fuQ0);
      check('SP-02pre 题库确实已更新(追问顺序互换)', qBefore !== qAfter, `${qBefore} → ${qAfter}`);
      check('SP-02a 旧回答跟随原题面(不按下标错配)', paired.ok === true, JSON.stringify(paired));
      await P.unroute('**/data.js');
      await P.close(); await ctx2.close();
    }

    console.log(`\n结果: ${passed} 通过, ${failed} 失败(阶段0基线:失败项即待修复问题)`);
    if (failures.length) console.log('失败项:\n  - ' + failures.join('\n  - '));
    process.exit(failed ? 1 : 0);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
