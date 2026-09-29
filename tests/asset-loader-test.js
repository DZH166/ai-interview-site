/* Real Data assets: invalid successful responses must not poison retries or caches. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(ROOT, 'app/js/common.js'), 'utf8');
const valid = {
  docs: { docs: [{ id: 'D', title: '文档', md: '可阅读正文' }] },
  legacy: { questions: [{ id: 'OLD', topic: 'agent', title: '旧题', format: 'qa', prompt: '旧题面', answer: '旧参考答案' }] },
  guides: { guides: [{ id: 'G', title: '训练', mainQuestionId: 'A', mainQuestion: '专题主问',
    sourceQuestionIds: ['A'], resumeGroupIds: ['group'], answer60: '口述要点', answer180: '展开答案',
    followups: [{ q: '项目追问', a: '回答依据' }], rubric: { basic: ['基础'], competent: ['合格'], deep: ['深入'] },
    projectEvidence: { status: 'unverified', note: '待核实', prompts: ['证据'] },
    sources: [{ url: 'https://example.test/source', title: '来源', version: 'v1', checkedAt: '2026-09-29' }] }] }
};
function fixture() {
  const cache = new Map(), calls = [];
  const replies = structuredClone(valid);
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, URL,
    location: { href: 'https://example.test/index.html' },
    window: { APP_DATA: { questions_index: [{ id: 'A', topic: 'agent', title: '活动题' }],
      legacy_index: [{ id: 'OLD', topic: 'agent', title: '旧题', format: 'qa' }],
      docs: [{ id: 'D', title: '文档' }],
      resume: { sections: [{ groups: [{ id: 'group', guideId: 'G', questionIds: ['A'], mustKnow: true }] }] } } },
    Store: { loadIssues: {}, resetLoadIssues() {}, loadExtraBankSafe: () => [], loadUserDocsSafe: () => [] },
    caches: { open: async () => ({
      match: async key => cache.get(key)?.clone(), delete: async key => cache.delete(key),
      put: async (key, response) => { cache.set(key, response.clone()); }
    }) },
    fetch: async url => {
      calls.push(url);
      const name = url.split('/').pop().split('.')[0];
      return new Response(JSON.stringify(replies[name]), { headers: { 'Content-Type': 'application/json' } });
    }
  });
  ctx.window.APP_DATA.manifest = { topics: {}, assets: Object.fromEntries(Object.keys(valid).map(name => [name, { file: name + '.hash.json' }])) };
  vm.runInContext(source + '\nglobalThis.api = Data;', ctx); ctx.api.init();
  return { data: ctx.api, ctx, cache, calls, replies };
}
const load = (data, name) => name === 'docs' ? data.ensureDocs() : name === 'legacy' ? data.ensureQuestion('OLD') : data.ensureGuides();
function assertIndexRetained(f) {
  assert.equal(f.data.allDocs()[0]?.title, '文档');
  assert.equal(f.data.legacyQuestions()[0]?.id, 'OLD');
  assert.equal(f.data.question('A').title, '活动题');
  assert.equal(f.data.allQuestions().length, 1);
}
let passed = 0;
async function check(name, run) { await run(); passed++; console.log('PASS', name); }
(async () => {
  for (const name of Object.keys(valid)) {
    await check(name + ': empty asset rejects without caching or losing navigation; retry loads healthy bytes', async () => {
      const f = fixture(), key = name === 'legacy' ? 'questions' : name;
      f.replies[name] = { [key]: [] };
      await assert.rejects(load(f.data, name));
      assertIndexRetained(f); assert.equal(f.cache.size, 0); assert.equal(f.calls.length, 1);
      f.replies[name] = structuredClone(valid[name]); await load(f.data, name);
      assert.equal(f.calls.length, 2); assert.equal(f.cache.size, 1);
      f.data.init();
      if (name === 'docs') assert.equal(f.data.doc('D').md, '可阅读正文');
      if (name === 'legacy') assert.equal(f.data.question('OLD').answer, '旧参考答案');
      if (name === 'guides') assert.equal((await f.data.ensureGuides()).guides[0].id, 'G');
    });
  }
  await check('docs/legacy: missing required body or wrong identity rejects and remains retryable', async () => {
    for (const [name, malformed] of [
      ['docs', { docs: [{ id: 'D', title: '文档' }] }],
      ['docs', { docs: [{ id: 'OTHER', title: '错误文档', md: '正文' }] }],
      ['legacy', { questions: [{ id: 'OLD', topic: 'agent', title: '旧题', sources: [] }] }],
      ['legacy', { questions: [{ ...valid.legacy.questions[0], topic: 'wrong' }] }]
    ]) {
      const f = fixture(); f.replies[name] = malformed;
      await assert.rejects(load(f.data, name)); assertIndexRetained(f); assert.equal(f.cache.size, 0);
      f.replies[name] = structuredClone(valid[name]); await load(f.data, name); assert.equal(f.calls.length, 2);
    }
  });
  await check('guides: nested fields used by the view and directed practice cannot poison the asset', async () => {
    for (const change of [
      g => { delete g.rubric; }, g => { g.rubric.competent = null; },
      g => { g.followups = [null]; }, g => { delete g.projectEvidence.prompts; },
      g => { g.sources = [null]; }, g => { g.sourceQuestionIds = 'A'; },
      g => { delete g.answer180; }, g => { g.mainQuestionId = 'MISSING'; },
      g => { g.id = 'OTHER'; }
    ]) {
      const f = fixture(); change(f.replies.guides.guides[0]);
      await assert.rejects(f.data.ensureGuides()); assert.equal(f.cache.size, 0);
      assert.equal(f.ctx.window.APP_DATA.guides, undefined); assertIndexRetained(f);
      f.replies.guides = structuredClone(valid.guides); await f.data.ensureGuides(); assert.equal(f.calls.length, 2);
    }
  });
  await check('invalid cached asset is evicted and the healthy network response repairs it', async () => {
    for (const name of Object.keys(valid)) {
      const f = fixture(), key = name === 'legacy' ? 'questions' : name;
      f.cache.set('https://example.test/data/assets/' + name + '.hash.json', new Response(JSON.stringify({ [key]: [] })));
      await load(f.data, name); assert.equal(f.calls.length, 1);
      const response = f.cache.values().next().value;
      assert.deepStrictEqual(await response.clone().json(), valid[name]);
    }
  });
  await check('current generated assets meet the runtime contract and keep active/archive counts separate', async () => {
    const f = fixture();
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/data.js'), 'utf8'), f.ctx);
    f.ctx.fetch = async url => new Response(fs.readFileSync(path.join(ROOT, 'app', url), 'utf8'));
    f.data.init(); const active = f.data.allQuestions().length, archived = f.data.legacyQuestions().length;
    await f.data.ensureDocs(); await f.data.ensureGuides(); await f.data.ensureQuestion(f.data.legacyQuestions()[0].id);
    assert.equal(f.data.allQuestions().length, active); assert.equal(f.data.legacyQuestions().length, archived);
    assert(f.data.docsLoaded()); assert.equal((await f.data.ensureGuides()).guides.length, 17);
  });
  console.log(`\n结果: ${passed} 通过, 0 失败`);
})().catch(error => { console.error(error); process.exitCode = 1; });
