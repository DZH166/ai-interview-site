/* 重点标注:每条标注必须真的在浏览器里包成 <mark>,且三种级别在视觉上可区分。
 *
 * 为什么用「逐条命中」而不是「有没有 mark」:后者只要有一条命中就绿,
 * 漏标、对不上原文、被 markdown 吃掉都会漏过去。这里要求 applied === expected 且 missing 为空。
 * 另外在改动前的版本上跑,本文件应当整片失败——标注机制当时并不存在。
 */
'use strict';
const fs = require('fs'), path = require('path'), assert = require('assert');
const { spawn } = require('child_process');
const { chromium } = require(process.env.PW || 'playwright');
const ROOT = path.resolve(__dirname, '../..');
const PORT = process.env.PORT || '8961', BASE = 'http://127.0.0.1:' + PORT;
const sleep = ms => new Promise(r => setTimeout(r, ms));
let passed = 0;
function check(name, ok) { assert(ok, name); passed++; console.log('  PASS', name); }
async function open(page, hash) {
  await page.goto(BASE + '/index.html' + hash);
  await page.waitForFunction(() => typeof Store !== 'undefined' && Store.data.ui.lastHash === location.hash && document.querySelector('#view > *'));
}

/* 直接读源文件,不依赖构建产物,这样标注数据本身出错也会被发现 */
const highlights = {};
for (const f of fs.readdirSync(path.join(ROOT, 'data/highlights')).filter(n => n.endsWith('.json'))) {
  const rec = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/highlights', f), 'utf8'));
  Object.assign(highlights, rec.questions || {});
}
const annotated = Object.keys(highlights).sort();
const expectedSpans = annotated.reduce((n, id) => n + highlights[id].spans.length, 0);

(async () => {
  let browser;
  const server = spawn(process.env.AIIV_PYTHON || 'python', [path.join(ROOT, 'tools/serve.py'), PORT], { cwd: ROOT, stdio: 'ignore' });
  try {
    let ready = false;
    for (let i = 0; i < 50; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready, 'isolated server did not start');
    browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const ctx = await browser.newContext({ viewport: { width: 1100, height: 900 } });
    const page = await ctx.newPage(), errors = [];
    page.on('pageerror', e => errors.push(e.message));

    await open(page, '#/home');

    /* ---- 数据层:构建产物里的标注与源文件一致 ---- */
    const shipped = await page.evaluate(() => Object.keys((window.APP_DATA.highlights) || {}).length);
    check('build ships every annotated question', shipped === annotated.length);
    const spanTotal = await page.evaluate(() => Object.values(window.APP_DATA.highlights || {}).reduce((n, r) => n + (r.spans || []).length, 0));
    check('build ships every highlight span', spanTotal === expectedSpans);

    /* ---- 逐条:每条标注都必须真的落到 DOM 上 ---- */
    const rows = await page.evaluate(ids => Highlight.auditAll(
      ids.map(id => Data.question(id)).filter(Boolean)), annotated);
    const bad = rows.filter(r => r.applied !== r.expected || r.missing.length);
    check(`every span of every annotated question is applied (${rows.length} field-groups)`, bad.length === 0,
      JSON.stringify(bad.slice(0, 3)));
    check('audit actually exercised every annotated question', new Set(rows.map(r => r.id)).size === annotated.length,
      `${new Set(rows.map(r => r.id)).size} / ${annotated.length}`);

    /* ---- 未标注的题:一个 mark 都不该有(证明不会误伤) ---- */
    const unannotated = await page.evaluate(ids => {
      const q = Data.allQuestions().find(x => !ids.includes(x.id));
      const html = QRender.mdField(q, 'answer') + QRender.mdField(q, 'deep') + QRender.mdField(q, 'plain');
      return { id: q.id, marks: (html.match(/<mark/g) || []).length };
    }, annotated);
    check('unannotated question renders no marks (' + unannotated.id + ')', unannotated.marks === 0);

    /* ---- 真实页面上确实显示出来了 ---- */
    const first = annotated[0];
    await open(page, '#/study/' + first);
    const inPage = await page.evaluate(() => document.querySelectorAll('#view mark.hl-key, #view mark.hl-term, #view mark.hl-warn').length);
    check('study page shows the marks (' + first + ' → ' + inPage + ')', inPage >= highlights[first].spans.length);
    const keyText = await page.locator('#view mark.hl-key').first().innerText();
    const keys = highlights[first].spans.filter(s => s.level === 'key').map(s => s.text);
    check('a key mark carries exactly the annotated phrase', keys.some(t => t.includes(keyText) || keyText.includes(t)));

    /* ---- 三种级别在视觉上真的不同(可视化才算成立) ----
       注意必须分别比较「底色」与「字重」:把两者拼成一个字符串比较,
       会让「底色改成一样、只有字重不同」的退化蒙混过关。 */
    const styles = await page.evaluate(() => {
      const weight = w => (w === 'bold' ? 700 : (w === 'normal' ? 400 : Number(w)));
      const probe = lv => {
        let el = document.querySelector('#view mark.hl-' + lv);
        if (!el) {
          el = document.createElement('mark'); el.className = 'hl-' + lv; el.textContent = '样本';
          document.querySelector('#view').appendChild(el);
        }
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, weight: weight(cs.fontWeight) };
      };
      return { key: probe('key'), term: probe('term'), warn: probe('warn') };
    });
    const bgs = [styles.key.bg, styles.term.bg, styles.warn.bg];
    check('three levels use three different background colours', new Set(bgs).size === 3, JSON.stringify(bgs));
    check('key level is bold while term level is not',
      styles.key.weight >= 600 && styles.term.weight < 600,
      JSON.stringify([styles.key.weight, styles.term.weight]));
    check('no level falls back to the browser default mark colour or stays transparent',
      !bgs.some(b => b === 'rgb(255, 255, 0)' || b === 'rgba(0, 0, 0, 0)' || b === 'transparent'));

    /* ---- 窄屏不溢出 ---- */
    await page.setViewportSize({ width: 360, height: 800 });
    await open(page, '#/study/' + first);
    await page.evaluate(() => Promise.all(document.getAnimations().filter(a => a.effect?.getComputedTiming().iterations !== Infinity).map(a => a.finished.catch(() => {}))));
    check('marks do not break the 360px layout', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    if (process.env.AUDIT_ARTIFACTS) { fs.mkdirSync(process.env.AUDIT_ARTIFACTS, { recursive: true }); await page.screenshot({ path: path.join(process.env.AUDIT_ARTIFACTS, 'highlight-360.png'), fullPage: true }); }

    check('no page errors while rendering highlights', errors.length === 0);
    console.log(`\n结果: ${passed} 通过, 0 失败`);
  } finally { if (browser) await browser.close(); server.kill(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
