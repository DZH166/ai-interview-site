/* Compatibility for the exact null sentinel emitted by released 336c0f9 Mock.finish.
   Reads the original implementation from Git and never writes app files or launches a browser. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const baseline = name => execFileSync('git', ['show', '336c0f9:app/js/' + name + '.js'], { cwd: ROOT, encoding: 'utf8' });
const oldStore = baseline('store'), oldPractice = baseline('views-practice');
const candidateStore = process.env.AIIV_STORE_SOURCE
  ? fs.readFileSync(path.resolve(process.env.AIIV_STORE_SOURCE), 'utf8')
  : fs.readFileSync(path.join(ROOT, 'app/js/store.js'), 'utf8');
const clone = value => JSON.parse(JSON.stringify(value));
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function page(disk = new Map(), storeSource = candidateStore) {
  const context = { console, localStorage: { getItem: key => disk.get(key) || null,
    setItem: (key, value) => disk.set(key, String(value)), removeItem: key => disk.delete(key) },
    setTimeout() { return 1; }, clearTimeout() {}, location: { hash: '', hostname: 'localhost', protocol: 'http:' },
    document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } } };
  context.window = context; context.addEventListener = () => {}; vm.createContext(context);
  for (const name of ['srs', 'util']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/' + name + '.js'), 'utf8'), context);
  vm.runInContext(storeSource + '\nthis.store = Store;', context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/express.js'), 'utf8'), context);
  vm.runInContext('toast=()=>{}; Store.load();', context);
  return { store: context.store, card: context.ExpressCard, context, disk };
}
const key = 'aiiv:records';
let releasedRecords;
test('released finish actually saves null for a removed unsnapshotted question', () => {
  const p = page(new Map(), oldStore);
  const live = { id: 'AG-001', title: '原题面', topic: 'agent', answer: '原参考' };
  p.context.Data = { question: id => id === live.id ? live : null, questionsLoaded: () => true };
  p.context.go = hash => { p.context.location.hash = hash; };
  const seam = 'return { render, startDirected, flushDraft, applyRemote };';
  assert.strictEqual(oldPractice.split(seam).length, 2);
  vm.runInContext(oldPractice.replace(seam,
    'return { render, startDirected, flushDraft, applyRemote, seed(value) { state = value; }, finish };')
    + '\nthis.mock = MockView;', p.context);
  const draft = { sessionId: 'released-deleted-question', savedAt: 100, config: { count: 2 }, idx: 1,
    items: [{ qid: 'AGQ-0166' }, { qid: live.id }], answers: {
      'AGQ-0166': { self: '被删题本人的旧回答', revealed: false, fu: { old: { id: 'old', q: '旧追问', self: '旧追问本人回答' } } },
      [live.id]: { self: '仍存在题的本人回答', questionSnapshot: live }
    } };
  p.store.data.mock.draft = draft; p.store.saveNow();
  p.context.mock.seed({ ...draft, sid: 1, ended: false, qStartAt: null, startedAt: Date.now(), qms: {} });
  p.context.mock.finish(null);
  assert.strictEqual(p.context.location.hash, '#/mock/done');
  releasedRecords = JSON.parse(p.disk.get(key));
  assert.strictEqual(releasedRecords.mock.rounds[0].items[0].questionSnapshot, null);
  assert.strictEqual(releasedRecords.mock.rounds[0].items[0].self, '被删题本人的旧回答');
  assert(p.store.validateRecordsObj(releasedRecords).some(error => error.includes('questionSnapshot')));
});
function checkMigrated(records) {
  const round = records.mock.rounds.find(r => r.sessionId === 'released-deleted-question');
  assert(round); assert.strictEqual(round.id, releasedRecords.mock.rounds[0].id);
  const item = round.items[0], expected = clone(releasedRecords.mock.rounds[0].items[0]);
  delete expected.questionSnapshot;
  assert.deepStrictEqual(clone(item), expected, 'only the null snapshot sentinel may change');
  assert.deepStrictEqual(clone(round.items[1]), releasedRecords.mock.rounds[0].items[1]);
}
const recordsBackup = records => JSON.stringify({ type: 'aiiv-records', v: 2, records });
const fullBackup = records => JSON.stringify({ type: 'aiiv-full', v: 1, records, questions: [], docs: [] });
test('load normalizes only round sentinel in memory, retaining original disk until normal save', () => {
  const raw = JSON.stringify(releasedRecords), disk = new Map([[key, raw]]), p = page(disk);
  assert(p.store.validateRecordsObj(releasedRecords).some(error => error.includes('questionSnapshot')),
    'direct validator must remain strict; compatibility belongs only at read boundaries');
  checkMigrated(p.store.data); assert.strictEqual(disk.get(key), raw);
  assert.strictEqual(p.store.validateRecordsObj(p.store.data).length, 0);
  assert(p.store.saveNow()); checkMigrated(JSON.parse(disk.get(key)));
});
test('preview is read-only and agrees with import; repeated import stays idempotent', () => {
  const p = page(), backup = recordsBackup(releasedRecords), memoryBefore = JSON.stringify(p.store.data);
  const preview = p.store.previewRecordsMerge(backup);
  assert(preview.ok); assert.strictEqual(preview.summary.roundsAdded, 1);
  assert.strictEqual(JSON.stringify(p.store.data), memoryBefore); assert.strictEqual(p.disk.get(key), undefined);
  p.store.importRecords(backup); checkMigrated(p.store.data);
  p.store.importRecords(backup); assert.strictEqual(p.store.data.mock.rounds.length, 1);
  assert(p.store.previewRecordsMerge(backup).summary.noChanges);
});
test('full backup retains individual answers and round identity', () => {
  const p = page(); p.store.importFull(fullBackup(releasedRecords)); checkMigrated(p.store.data);
  const reopened = page(p.disk); checkMigrated(reopened.store.data);
});
test('adoptRemote and refreshFromDisk accept and propagate only normalized historical records', () => {
  for (const refresh of [false, true]) {
    const p = page(), raw = JSON.stringify(releasedRecords); p.disk.set(key, raw);
    const result = refresh ? p.store.refreshFromDisk() : p.store.adoptRemoteRecords(raw);
    assert(result.ok); checkMigrated(p.store.data); checkMigrated(JSON.parse(p.disk.get(key)));
    assert.strictEqual(p.store.validateRecordsObj(JSON.parse(p.disk.get(key))).length, 0);
  }
});
test('save-before-write reconciles old null sentinel while retaining the new local note', () => {
  const p = page(); p.store.setNote('PY-001', '当前页尚未写盘的笔记');
  p.disk.set(key, JSON.stringify(releasedRecords));
  assert(p.store.saveNow()); checkMigrated(p.store.data);
  assert.strictEqual(p.store.rec('PY-001').note, '当前页尚未写盘的笔记');
  checkMigrated(JSON.parse(p.disk.get(key)));
});
test('both exports identify missing historical snapshots without synthesizing one', () => {
  const p = page(); p.store.importRecords(recordsBackup(releasedRecords));
  const before = JSON.stringify(p.store.data.mock.rounds);
  const current = { id: 'AGQ-0166', title: '如今归档的题名', answer: 'CURRENT_REFERENCE_ONLY' };
  const output = p.card.buildFromRound(p.store.data.mock.rounds, 0, id => id === current.id ? current : null);
  assert(output.ok);
  for (const text of [output.markdown, output.html]) {
    assert(text.includes('未保存历史题面；下面如有参考来自当前题库。'));
    assert(text.includes('被删题本人的旧回答'));
    assert(text.includes('旧追问本人回答'));
    assert(text.includes('CURRENT_REFERENCE_ONLY'));
  }
  assert.strictEqual(JSON.stringify(p.store.data.mock.rounds), before);
  assert(!Object.hasOwn(p.store.data.mock.rounds[0].items[0], 'questionSnapshot'));
});
test('other malformed snapshots and draft null still reject entire restore and remote adoption', () => {
  const variants = ['bad', 123, false, [], {}, { id: 'wrong', title: '错误身份' }].map(value => {
    const input = clone(releasedRecords); input.mock.rounds[0].items[0].questionSnapshot = value; return input;
  });
  const badDraft = clone(releasedRecords);
  badDraft.mock.draft = { sessionId: 'another', items: [{ qid: 'AG-001' }], answers: { 'AG-001': { questionSnapshot: null } } };
  variants.push(badDraft);
  const badAlternate = clone(releasedRecords);
  badAlternate.mock.alternates = [clone(badDraft.mock.draft)];
  variants.push(badAlternate);
  const badField = clone(releasedRecords); badField.mock.rounds[0].items[0].revision = {};
  variants.push(badField);
  for (const input of variants) {
    const p = page(); p.store.setNote('KEEP', '原笔记'); p.store.saveNow();
    const memory = JSON.stringify(p.store.data), raw = p.disk.get(key);
    for (const run of [() => p.store.previewRecordsMerge(recordsBackup(input)),
      () => p.store.importRecords(recordsBackup(input)), () => p.store.importFull(fullBackup(input))]) assert.throws(run, /校验未通过/);
    assert.strictEqual(p.store.adoptRemoteRecords(JSON.stringify(input)).ok, false);
    assert.strictEqual(JSON.stringify(p.store.data), memory); assert.strictEqual(p.disk.get(key), raw);
  }
});
console.log(`\n结果: ${passed} 通过, 0 失败`);
