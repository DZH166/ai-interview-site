/* 分片缓存的生命周期验收(配合 Track E 分片架构)。

   要证明两件事:
   1. 分片必须写进**独立于 shell 版本**的 topics 缓存。
      修复前分片和 shell 共用一个 CACHE_VERSION 缓存:
      改一行 CSS → 版本章变 → activate 清旧缓存 → 10MB 分片全量重下,
      内容寻址带来的「只有变的那片失效」被整包失效吃掉。
   2. 分片缓存按 manifest 名单**增量清理**:
      manifest 之外的旧分片要删掉,manifest 之内的一律保留。

   运行:PW=<playwright> CHROME=<chromium|default> AIIV_PYTHON=<python> PORT=xxxx node tests/browser/sw-topic-cache.js */
'use strict';
const path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '8961', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
const check = (n, ok, d) => { assert(ok, n + (d ? ' :: ' + d : '')); passed++; console.log('  PASS', n); };
const sleep = ms => new Promise(r => setTimeout(r, ms));

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready);
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ viewport: { width: 1200, height: 850 } });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));

    /* SW 首次加载只注册,第二次才接管 —— 必须等到受控,否则 fetch 不过 SW,
       下面的缓存断言就全成了在测浏览器原生缓存 */
    await page.goto(BASE + '/index.html');
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 60000 }).catch(() => {});
    await page.reload();
    await page.waitForFunction(() => navigator.serviceWorker && navigator.serviceWorker.controller, null, { timeout: 60000 });
    /* 全量分片到位:index-only 的壳里没有 answer,有 answer 的题数远大于 0 才说明分片合并完了 */
    await page.waitForFunction(() => typeof Data !== 'undefined' && Data.questionsLoaded()
      && Data.allQuestions().filter(q => q.answer).length > 100, null, { timeout: 60000 });

    const snap = await page.evaluate(async () => {
      const keys = await caches.keys();
      const shell = keys.find(k => k.startsWith('shell-'));
      const topics = keys.find(k => k.startsWith('topics-'));
      const paths = async n => n ? (await (await caches.open(n)).keys()).map(r => new URL(r.url).pathname) : [];
      const mf = await (await fetch('data/manifest.json')).json();
      return {
        keys, shell, topics,
        shellPaths: await paths(shell),
        topicPaths: await paths(topics),
        want: Object.values(mf.topics).map(t => t.file)
      };
    });

    check('缓存一分为二:shell 版本名 + topics 独立名', !!snap.shell && !!snap.topics, JSON.stringify(snap.keys));
    check('分片全部落在 topics 缓存里',
      snap.topicPaths.length === snap.want.length && snap.topicPaths.length >= 20,
      `topics=${snap.topicPaths.length} 期望=${snap.want.length}`);
    check('topics 缓存里没有分片之外的杂项',
      snap.topicPaths.every(p => p.includes('/data/topics/')),
      snap.topicPaths.filter(p => !p.includes('/data/topics/')).join(','));
    /* 这条就是修复点:修复前 20 条分片都在 shell 缓存里 */
    const leak = snap.shellPaths.filter(p => p.includes('/data/topics/'));
    check('shell 缓存里一条分片都没有', leak.length === 0, leak.length + ' 条');

    /* 增量清理:塞一个 manifest 里不存在的幽灵分片,下次 manifest 取回时该被删掉,
       同时真分片一个不能少(只增不减的「清理」等于没清,清过头的「清理」等于把库删了) */
    const ghost = await page.evaluate(async () => {
      const name = (await caches.keys()).find(k => k.startsWith('topics-'));
      const c = await caches.open(name);
      await c.put(new Request('data/topics/ghost.000000000000.json'),
        new Response('{"topic":"ghost","questions":[]}'));
      const before = (await c.keys()).length;
      await fetch('data/manifest.json', { cache: 'no-store' });
      const keys = await c.keys();
      return { before, after: keys.length, still: keys.some(r => r.url.includes('ghost.000000000000.json')) };
    });
    check('幽灵分片已入缓存(前置条件)', ghost.before === snap.want.length + 1, JSON.stringify(ghost));
    check('manifest 之外的旧分片被清掉,其余不动',
      !ghost.still && ghost.after === snap.want.length, JSON.stringify(ghost));

    /* 核心修复点:shell 缓存整包消失(等价于 CACHE_VERSION 变化后的 activate 清理),
       分片必须原地不动 —— 修复前它们就在那个被删的缓存里 */
    const survived = await page.evaluate(async (shell) => {
      await caches.delete(shell);
      const keys = await caches.keys();
      const topics = keys.find(k => k.startsWith('topics-'));
      return { n: topics ? (await (await caches.open(topics)).keys()).length : -1, keys };
    }, snap.shell);
    check('shell 缓存整包失效后分片依然在', survived.n === snap.want.length, JSON.stringify(survived));

    check('全程无 JS 异常', errors.length === 0, errors.join('|'));
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
