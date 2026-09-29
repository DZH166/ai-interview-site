'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function page(disk = new Map()) {
  const c = { console, localStorage: { getItem: k => disk.get(k) || null,
    setItem: (k, v) => disk.set(k, String(v)), removeItem: k => disk.delete(k) },
    setTimeout() { return 1; }, clearTimeout() {}, location: { hash: '', hostname: 'localhost', protocol: 'http:' },
    document: { readyState: 'loading', addEventListener() {}, getElementById() { return null; }, querySelector() { return null; }, querySelectorAll() { return []; } } };
  c.window = c; c.addEventListener = () => {}; vm.createContext(c);
  for (const name of ['srs', 'util', 'store', 'express']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js', name + '.js'), 'utf8'), c);
  vm.runInContext('toast=()=>{}; Store.load(); this.store=Store;', c);
  return { store: c.store, card: c.ExpressCard, disk, context: c };
}
const records = mock => ({ v: 3, questions: {}, mock, drillAttempts: {}, ui: {} });
const question = { id: 'AG-001', title: '题目', answer: '只属于参考的原文', interview: '参考口述', followups: [{ q: '追问', a: '追问参考' }] };
const own = { qid: question.id, self: '本人原回答', revision: '本人修订 <script>alert(1)</script>', revealed: true,
  followups: [{ id: 'f1', q: '追问', self: '本人追问回答', revealed: true }], questionSnapshot: question };

test('original, followup and revision remain separate in both exports', () => {
  const { card } = page();
  const before = JSON.stringify(own), out = card.buildFromRound([{ ts: 1, items: [own] }], 0, () => question);
  assert(out.ok);
  for (const text of ['本人原回答', '本人追问回答', '本人修订', '参考后修订 / 补充']) {
    assert(out.markdown.includes(text), text); assert(out.html.includes(text), text);
  }
  assert(!out.html.includes('<script>alert(1)</script>'));
  assert(out.html.includes('&lt;script&gt;'));
  assert.strictEqual(card.answerText(own), own.self, 'revision must not masquerade as the original answer');
  assert.strictEqual(JSON.stringify(own), before);
});

test('revision-only answers count once, but reference reveal and whitespace never count', () => {
  const { card } = page();
  const revisionOnly = { qid: question.id, revision: '只写了个人修订', revealed: true };
  assert(card.itemAnswered(revisionOnly));
  assert(card.buildFromRound([{ ts: 1, items: [revisionOnly] }], 0, () => question).ok);
  assert(card.buildFromPracticeGroup('专题', [revisionOnly], () => question).ok);
  for (const item of [{ qid: question.id, revealed: true }, { qid: question.id, self: '', revision: ' \n ' },
    { qid: question.id, revealed: true, answer: question.answer, interview: question.interview }]) {
    assert(!card.itemAnswered(item));
    assert(!card.buildFromRound([{ ts: 1, items: [item] }], 0, () => question).ok);
  }
});

test('backup import and reload preserve all three answers in rounds and both draft slots', () => {
  const { store, disk } = page();
  const answer = { self: own.self, revision: own.revision, revealed: true,
    fu: { f1: { id: 'f1', q: '追问', self: '本人追问回答', revealed: true } } };
  const draft = { sessionId: 'revision-draft', savedAt: 10, items: [{ qid: question.id }], answers: { [question.id]: answer } };
  const input = records({ rounds: [{ ts: 30, sessionId: 'revision-round', items: [own] }], draft,
    alternates: [{ ...draft, sessionId: 'revision-alternate', savedAt: 20 }], ended: {} });
  assert.strictEqual(store.validateRecordsObj(input).length, 0);
  store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: input }));
  const restored = page(disk).store.data.mock;
  assert.strictEqual(restored.rounds[0].items[0].self, own.self);
  assert.strictEqual(restored.rounds[0].items[0].revision, own.revision);
  assert.strictEqual(restored.rounds[0].items[0].followups[0].self, '本人追问回答');
  for (const d of [restored.draft, ...restored.alternates]) {
    assert.strictEqual(d.answers[question.id].self, own.self);
    assert.strictEqual(d.answers[question.id].revision, own.revision);
    assert.strictEqual(d.answers[question.id].fu.f1.self, '本人追问回答');
  }
});

test('non-text revision is rejected before backup or remote records can change storage', () => {
  const { store, disk } = page(); store.setNote(question.id, 'keep'); store.saveNow();
  const before = JSON.stringify(store.data), beforeDisk = disk.get('aiiv:records');
  for (const value of [null, 1, true, [], {}]) {
    const draft = { sessionId: 'bad', savedAt: 1, items: [{ qid: question.id }], answers: { [question.id]: { revision: value } } };
    for (const mock of [{ rounds: [], draft }, { rounds: [], draft: null, alternates: [draft] },
      { rounds: [{ ts: 1, items: [{ qid: question.id, revision: value }] }], draft: null }]) {
      const input = records(mock), backup = JSON.stringify({ type: 'aiiv-records', v: 2, records: input });
      assert(store.validateRecordsObj(input).some(x => x.includes('revision')));
      assert.throws(() => store.importRecords(backup), /校验未通过/);
      assert.strictEqual(store.adoptRemoteRecords(JSON.stringify(input)).ok, false);
      assert.strictEqual(JSON.stringify(store.data), before);
      assert.strictEqual(disk.get('aiiv:records'), beforeDisk);
    }
  }
});

test('old backups without revision stay valid and never synthesize one from references', () => {
  const { store, card, disk } = page();
  const item = { qid: question.id, self: '旧答案', revealed: true, questionSnapshot: question };
  const input = records({ rounds: [{ ts: 1, items: [item] }], draft: { items: [{ qid: question.id }], answers: { [question.id]: { self: '旧草稿' } } } });
  assert.strictEqual(store.validateRecordsObj(input).length, 0);
  store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: input }));
  const restored = page(disk).store.data.mock;
  assert.strictEqual(restored.rounds[0].items[0].revision, undefined);
  assert.strictEqual(restored.draft.answers[question.id].revision, undefined);
  assert(!card.buildFromRound(restored.rounds, 0, () => question).markdown.includes('### 参考后修订'));
});
test('actual finish omits unvisited snapshots, preserves visited evidence and makes an importable backup', () => {
  const { store, card, disk, context } = page();
  const original = { id: 'AG-001', title: '练习时题面', answer: '练习时参考', topic: 'agent' };
  const bank = { 'AG-001': { ...original, title: '后来更新的题面' },
    'RG-001': { id: 'RG-001', title: '未加载的跨专题题', topic: 'rag' },
    'PY-001': { id: 'PY-001', title: '已缓存但没访问的题', topic: 'python-backend', answer: '不能冒充练习快照' } };
  context.Data = { question: id => bank[id] || null };
  context.go = hash => { context.location.hash = hash; };
  const source = fs.readFileSync(path.join(ROOT, 'app/js/views-practice.js'), 'utf8');
  const publicReturn = 'return { render, startDirected, flushDraft, applyRemote };';
  assert.strictEqual(source.split(publicReturn).length, 2, 'test seam must match the one MockView return');
  // Expose the real closure only inside the VM; no production test API or copied finish logic.
  vm.runInContext(source.replace(publicReturn, 'return { render, startDirected, flushDraft, applyRemote, seed(s) { state = s; }, finish };') + '\nthis.mock = MockView;', context);
  const draft = { sessionId: 'early-end', savedAt: Date.now(), config: { count: 4 }, idx: 0,
    items: [{ qid: 'AG-001' }, { qid: 'RG-001' }, { qid: 'PY-001' }, { qid: 'ZZ-999', title: '已下架的原题名' }],
    answers: { 'AG-001': { self: '实际写过', questionSnapshot: original } } };
  store.data.mock.draft = draft; store.saveNow();
  context.mock.seed({ ...draft, sid: 1, ended: false, qStartAt: null, qms: {}, durationMs: 0 });
  context.mock.finish(null);
  assert.strictEqual(context.location.hash, '#/mock/done');
  const saved = JSON.parse(disk.get('aiiv:records')), items = saved.mock.rounds[0].items;
  assert.deepStrictEqual(items[0].questionSnapshot, original);
  assert.strictEqual(items[0].title, original.title);
  assert.strictEqual(items[1].title, bank['RG-001'].title);
  assert.strictEqual(items[3].title, '已下架的原题名');
  for (const item of items.slice(1)) assert(!Object.hasOwn(item, 'questionSnapshot'));
  assert.strictEqual(items.filter(card.itemAnswered).length, 1);
  assert.strictEqual(store.validateRecordsObj(saved).length, 0);
  const imported = page().store;
  imported.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: saved }));
  assert.strictEqual(imported.data.mock.rounds[0].items[0].self, '实际写过');
});
console.log(`\n结果: ${passed} 通过, 0 失败`);
