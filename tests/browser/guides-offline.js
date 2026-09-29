/* 训练单元/离线出口。--unit 只运行纯快照与失败边界，不启动浏览器。
   浏览器全部采用新上下文与专用端口，不读取个人浏览器数据。 */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { spawn } = require('child_process');
const ROOT = path.resolve(__dirname, '../..'), PORT = process.env.PORT || '9511', BASE = 'http://127.0.0.1:' + PORT;
let passed = 0;
const check = (name, condition) => { assert(condition, name); passed++; console.log('PASS ' + name); };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function unitChecks() {
  const box = { window: {} }; vm.createContext(box);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/express.js'), 'utf8'), box);
  const card = box.window.ExpressCard;
  const source = { id: 'RG-038', title: '原始维度题', topic: 'rag', answer: '原始维度参考', format: 'quiz', options: [{ label: 'A', text: '旧选项', right: true }] };
  const guide = { id: 'ig-fixture', title: '多模态知识库', mainQuestion: '如何组织文本与图像检索？', answer60: '一分钟参考', answer180: '三分钟参考', followups: [{ q: '如何对齐？', a: '对齐参考' }] };
  check('专题快照映射接口存在', typeof card.questionForGuide === 'function');
  const snapshot = card.questionForGuide(source, guide);
  check('主问与参考来自训练单元，原题只保留来源', snapshot.prompt === guide.mainQuestion && snapshot.answer === guide.answer60 && snapshot.interview === guide.answer180 && snapshot.sourceQuestionId === source.id && snapshot.title === guide.title);
  check('专题问答不继承原题选择题和选项', snapshot.format === 'qa' && !snapshot.options);
  guide.followups[0].q = '新版追问'; guide.answer60 = '新版参考';
  check('参考与追问均为不可变快照', snapshot.followups[0].q === '如何对齐？' && snapshot.answer === '一分钟参考');
  const out = card.buildFromRound([{ ts: 1, items: [{ qid: source.id, self: '本人回答', questionSnapshot: snapshot }] }], 0, () => source);
  check('表达卡保留专题主问、本人回答和两档参考', out.ok && ['如何组织文本与图像检索？', '本人回答', '一分钟参考', '三分钟参考', 'RG-038'].every(x => out.markdown.includes(x) && out.html.includes(x)) && !out.markdown.includes('原始维度参考'));
  check('训练主问不被误报为缺失选择题选项', !out.markdown.includes('旧练习未保存选项') && !out.html.includes('旧练习未保存选项'));

  const nodes = { '#offline-bar': {}, '#offline-progress': {}, '#offline-errors': {} };
  const buttons = ['core', 'all'].map(scope => ({ dataset: { download: scope }, addEventListener: (event, fn) => { if (scope === 'core') nodes.download = fn; } }));
  let downloads = 0;
  const offline = { navigator: { serviceWorker: { ready: new Promise(() => {}) } },
    Data: { offlineStatus: async () => ({ supported: true, total: 1, ready: 0, missing: ['guides'] }), topicName: x => x, downloadOffline: async () => { downloads++; } },
    $: selector => nodes[selector], $$: () => buttons,
    setTimeout: fn => setTimeout(fn, 10), clearTimeout };
  vm.createContext(offline); vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/views-guides.js'), 'utf8'), offline);
  offline.root = {}; await vm.runInContext('OfflineView.render(root)', offline);
  const done = await Promise.race([nodes.download().then(() => true), sleep(150).then(() => false)]);
  check('Worker一直未ready时有界失败并恢复下载按钮', done && !buttons[0].disabled && downloads === 0 && /下载未完成/.test(nodes['#offline-progress'].textContent));
}

async function browserChecks() {
  const { chromium } = require(process.env.PW || 'playwright');
  const server = spawn(process.env.AIIV_PYTHON || 'python', ['tools/serve.py', PORT], { cwd: ROOT, stdio: 'ignore' });
  let browser;
  const screenshot = async (page, name) => {
    if (!process.env.QA_SCREENSHOTS) return;
    const dir = path.join(ROOT, 'output/playwright'); fs.mkdirSync(dir, { recursive: true });
    const file = path.join(dir, name + '.png'); await page.screenshot({ path: file, animations: 'disabled' }); console.log('SCREENSHOT ' + file);
  };
  try {
    let ready = false;
    for (let i = 0; i < 60; i++) { try { if ((await fetch(BASE + '/index.html')).ok) { ready = true; break; } } catch (_) {} await sleep(100); }
    assert(ready); browser = await chromium.launch({ headless: true, executablePath: process.env.CHROME && process.env.CHROME !== 'default' ? process.env.CHROME : undefined });
    const context = await browser.newContext({ serviceWorkers: 'block', viewport: { width: 1280, height: 900 } });
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.goto(BASE + '/index.html#/guides');
    await page.waitForSelector('.guide-card');
    check('17个训练单元都有列表入口', await page.locator('.guide-card').count() === 17);
    check('桌面训练列表使用多列网格', await page.locator('.guide-grid').evaluate(el => getComputedStyle(el).display === 'grid' && getComputedStyle(el).gridTemplateColumns.split(' ').length > 1));
    await screenshot(page, 'guides-desktop');
    const guide = await page.evaluate(async () => (await Data.ensureGuides()).guides.find(g => g.id === 'ig-vt-multimodal'));
    assert(guide?.mainQuestion, '构建后的训练资料必须包含 mainQuestion');
    await page.locator('a[href="#/guides/ig-vt-multimodal"]').first().click();
    await page.waitForSelector('#guide-start');
    check('详情展示明确主问与分档参考', await page.locator('.guide-main-question').innerText() === guide.mainQuestion && await page.locator('.guide-reference').count() === 2);
    await screenshot(page, 'guide-detail-desktop');
    for (const width of [360, 390]) {
      await page.setViewportSize({ width, height: 844 });
      check(width + '宽训练详情无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      await screenshot(page, 'guide-detail-mobile-' + width);
    }
    await page.route('**/data/topics/*.json', route => route.abort());
    await page.locator('#guide-start').click(); await page.waitForSelector('#m-self');
    check('训练模式使用专题主问，不依赖原题正文', (await page.locator('.mock-run').innerText()).includes(guide.mainQuestion) && await page.locator('.quiz-options').count() === 0);
    check('来源题回链保留', await page.locator('.mock-run a[href="#/study/' + guide.mainQuestionId + '"]').count() >= 1);
    await page.locator('#m-self').fill('GUIDE_PERSONAL_ORIGINAL');
    await page.locator('#m-reveal').click();
    check('对照后原回答只读且修订为空', await page.locator('#m-self').getAttribute('readonly') !== null && await page.locator('#m-revision').inputValue() === '');
    check('主参考采用60秒与3分钟版本', (await page.locator('.mock-ref').innerText()).includes(guide.answer60) && await page.locator('.mock-ref summary').innerText() === '参考学习资料 · 3 分钟展开');
    await screenshot(page, 'guide-practice-mobile');
    await page.locator('#mock-fu-list [data-fu-id]').first().fill('GUIDE_FOLLOWUP_ORIGINAL');
    await page.locator('#m-revision').fill('GUIDE_REVISION_DRAFT');
    await page.locator('#mock-save-retry').click();
    const originalSnapshot = await page.evaluate(() => Store.data.mock.draft.answers[Store.data.mock.draft.items[0].qid].questionSnapshot);
    await page.route('**/data/assets/guides.*.json', async route => {
      const response = await route.fetch(), payload = await response.json();
      const g = payload.guides.find(g => g.id === guide.id);
      g.mainQuestion = '新版主问不应覆盖旧作答'; g.answer60 = '新版参考不应覆盖旧作答'; g.followups[0].q = '新版追问';
      await route.fulfill({ response, json: payload });
    });
    await page.evaluate(async () => {
      const cache = await caches.open('topics-v1');
      await cache.delete(new URL('data/assets/' + APP_DATA.manifest.assets.guides.file, location.href).href);
    });
    await page.reload(); await page.waitForSelector('#m-self');
    check('新版训练资料确已加载', await page.evaluate(async id => (await Data.ensureGuides()).guides.find(g => g.id === id).mainQuestion === '新版主问不应覆盖旧作答', guide.id));
    check('手机刷新独立恢复原回答、追问和修订', await page.locator('#m-self').inputValue() === 'GUIDE_PERSONAL_ORIGINAL' && await page.locator('#mock-fu-list [data-fu-id]').first().inputValue() === 'GUIDE_FOLLOWUP_ORIGINAL' && await page.locator('#m-revision').inputValue() === 'GUIDE_REVISION_DRAFT');
    check('恢复仍使用原训练快照', await page.evaluate(snapshot => JSON.stringify(Store.data.mock.draft.answers[Store.data.mock.draft.items[0].qid].questionSnapshot) === JSON.stringify(snapshot), originalSnapshot));
    await page.locator('#m-revision').fill('GUIDE_PERSONAL_REVISED');
    check('390宽练习页无横向溢出', await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    await page.locator('#m-finish').click(); await page.waitForSelector('.round-list');
    const output = await page.evaluate(() => ExpressCard.buildFromRound(Store.data.mock.rounds, 0, id => Data.question(id)));
    const exportLines = [guide.mainQuestion, guide.answer60, guide.answer180, 'GUIDE_PERSONAL_ORIGINAL', 'GUIDE_PERSONAL_REVISED', 'GUIDE_FOLLOWUP_ORIGINAL'].flatMap(x => x.split(/\n+/));
    check('导出分别包含原回答、修订、追问及完整训练参考', exportLines.every(x => output.markdown.includes(x) && output.html.includes(x)));
    await page.locator('#m-card').click();
    const [download] = await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: '下载 Markdown', exact: true }).click()]);
    let downloaded = ''; for await (const chunk of await download.createReadStream()) downloaded += chunk.toString('utf8');
    check('完成页实际下载独立保留原回答和本人修订', downloaded.includes(guide.mainQuestion) && downloaded.includes('GUIDE_PERSONAL_ORIGINAL') && downloaded.includes('GUIDE_PERSONAL_REVISED') && !downloaded.includes('新版主问不应覆盖旧作答'));
    check('Guide完成轮次保留原单元身份', await page.evaluate(id => Store.data.mock.rounds[0].guideId === id, guide.id));
    check('训练路径无页面异常', errors.length === 0);
    await context.close();

    const offlineContext = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const offlinePage = await offlineContext.newPage();
    await offlinePage.goto(BASE + '/index.html#/offline');
    await offlinePage.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 30000 });
    await offlinePage.waitForSelector('[data-download="core"]');
    const failedTopic = await offlinePage.evaluate(() => {
      const id = Data.coreTopics()[0], file = APP_DATA.manifest.topics[id].file;
      window.realFetch = window.fetch;
      window.fetch = (url, ...rest) => String(url).includes(file) ? Promise.resolve(new Response('injected unavailable', { status: 503 })) : window.realFetch(url, ...rest);
      return id;
    });
    await offlinePage.locator('[data-download="core"]').click();
    await offlinePage.waitForFunction(() => !document.querySelector('[data-download="core"]').disabled && !document.querySelector('#offline-progress').textContent.includes('正在'), null, { timeout: 60000 });
    const failed = await offlinePage.evaluate(() => Data.offlineStatus('core'));
    check('单片下载失败不会虚报离线就绪', failed.missing.includes(failedTopic) && !(await offlinePage.locator('#offline-progress').innerText()).includes('可离线使用'));
    await offlinePage.evaluate(() => { window.fetch = window.realFetch; });
    await offlinePage.locator('[data-download="core"]').click();
    await offlinePage.waitForFunction(() => document.querySelector('#offline-progress').textContent.includes('可离线使用'), null, { timeout: 60000 });
    const cached = await offlinePage.evaluate(async () => ({ status: await Data.offlineStatus('core'), keys: (await (await caches.open('topics-v1')).keys()).map(r => r.url) }));
    check('重试把核心专题与训练资料写入真实CacheStorage', cached.status.ready === cached.status.total && !cached.status.missing.length && cached.keys.some(url => url.includes('/data/assets/guides.')));
    await screenshot(offlinePage, 'offline-mobile');
    const evicted = await offlinePage.evaluate(async id => {
      const cache = await caches.open('topics-v1'), url = new URL('data/topics/' + APP_DATA.manifest.topics[id].file, location.href).href;
      await cache.delete(url); return (await Data.offlineStatus('core')).missing.includes(id);
    }, failedTopic);
    check('缓存驱逐能识别内存中仍存在的缺片', evicted);
    await offlinePage.locator('[data-download="core"]').click();
    await offlinePage.waitForFunction(() => !document.querySelector('[data-download="core"]').disabled
      && document.querySelector('#offline-progress').textContent.includes('可离线使用'), null, { timeout: 60000 });
    const restored = await offlinePage.evaluate(() => Data.offlineStatus('core'));
    assert(!restored.missing.length, '驱逐后状态:' + JSON.stringify(restored));
    check('驱逐后重新下载实际恢复缓存', restored.ready === restored.total);
    await offlineContext.setOffline(true);
    await offlinePage.goto(BASE + '/index.html#/guides'); await offlinePage.waitForSelector('.guide-card');
    check('断网重载仍能打开17个已下载训练单元', await offlinePage.locator('.guide-card').count() === 17);
    await offlinePage.locator('.guide-card a').first().click(); await offlinePage.waitForSelector('#guide-start');
    await offlinePage.locator('#guide-start').click(); await offlinePage.waitForSelector('#m-self');
    await offlinePage.locator('#m-self').fill('OFFLINE_PERSONAL_ANSWER');
    await offlinePage.locator('#mock-save-retry').click();
    await offlinePage.reload(); await offlinePage.waitForSelector('#m-self');
    check('离线练习刷新保留草稿', await offlinePage.locator('#m-self').inputValue() === 'OFFLINE_PERSONAL_ANSWER');
    await offlineContext.close();
  } finally { if (browser) await browser.close(); server.kill(); }
}
(async () => { await unitChecks(); if (!process.argv.includes('--unit')) await browserChecks(); console.log(`\n结果: ${passed} 通过, 0 失败`); })().catch(error => { console.error(error); process.exitCode = 1; });
