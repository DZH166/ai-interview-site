/* Imported exam config must not turn malformed values into instant timeouts or hidden answers. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function fixture() {
  const disk = new Map(), context = { console, setTimeout() { return 1; }, clearTimeout() {},
    localStorage: { getItem: key => disk.get(key) || null, setItem: (key, value) => disk.set(key, String(value)), removeItem: key => disk.delete(key) },
    document: { readyState: 'loading', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } },
    location: { hash: '', hostname: 'localhost', protocol: 'http:' } };
  context.window = context; context.addEventListener = () => {}; vm.createContext(context);
  for (const name of ['srs', 'util', 'store']) vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/' + name + '.js'), 'utf8'), context);
  vm.runInContext('toast=()=>{};Store.load();this.store=Store;', context);
  return { store: context.store, disk };
}
function records(config = { examMode: true, timeLimitSec: 30 }) {
  const answer = { self: '原答', revision: '本人修订', quizPicked: ['A'], quizCorrect: true, quizJudged: true, timeout: false };
  return { v: 3, questions: {}, mock: { rounds: [{ ts: 100, config, durationMs: 1000, items: [{ qid: 'AG-001', ...answer }] }],
    draft: { sessionId: 'main', config, items: [{ qid: 'AG-001' }], answers: { 'AG-001': answer } },
    alternates: [{ sessionId: 'other', config, items: [{ qid: 'AG-001' }], answers: { 'AG-001': answer } }], ended: {} }, ui: {} };
}
const backup = records => JSON.stringify({ type: 'aiiv-records', v: 2, records });
test('valid and legacy config preserve answers in round, current draft and alternate draft', () => {
  for (const config of [undefined, {}, { examMode: false, timeLimitSec: 0 }, { examMode: true, timeLimitSec: 0.5 }]) {
    const p = fixture(), input = records(config); if (config === undefined) for (const obj of [input.mock.rounds[0], input.mock.draft, input.mock.alternates[0]]) delete obj.config;
    assert.strictEqual(p.store.validateRecordsObj(input).length, 0);
    p.store.importRecords(backup(input));
    assert.strictEqual(p.store.data.mock.rounds[0].items[0].revision, '本人修订');
    assert.strictEqual(p.store.data.mock.draft.answers['AG-001'].quizJudged, true);
    assert.strictEqual(p.store.data.mock.alternates[0].answers['AG-001'].timeout, false);
  }
});
test('malformed config and judgment flags reject before preview, import or remote merge changes data', () => {
  const edits = [
    input => { input.mock.draft.config.examMode = 'false'; },
    input => { input.mock.rounds[0].config.timeLimitSec = -1; },
    input => { input.mock.alternates[0].config.timeLimitSec = '30'; },
    input => { input.mock.draft.config = []; },
    input => { input.mock.draft.answers['AG-001'].timeout = 1; },
    input => { input.mock.alternates[0].answers['AG-001'].quizJudged = 'false'; },
    input => { input.mock.rounds[0].items[0].quizJudged = null; },
    input => { input.mock.rounds[0].items[0].timeout = 'yes'; },
    input => { input.mock.rounds[0].durationMs = -100; }
  ];
  for (const edit of edits) {
    const p = fixture(), input = JSON.parse(JSON.stringify(records())); edit(input);
    p.store.setNote('KEEP', '保留本人笔记'); p.store.saveNow();
    const before = JSON.stringify(p.store.data), disk = p.disk.get('aiiv:records');
    assert(p.store.validateRecordsObj(input).length > 0);
    assert.throws(() => p.store.previewRecordsMerge(backup(input)), /校验未通过/);
    assert.throws(() => p.store.importRecords(backup(input)), /校验未通过/);
    assert.strictEqual(p.store.adoptRemoteRecords(JSON.stringify(input)).ok, false);
    assert.strictEqual(JSON.stringify(p.store.data), before); assert.strictEqual(p.disk.get('aiiv:records'), disk);
  }
});
test('non-finite time limits and round durations remain invalid at the object boundary', () => {
  const p = fixture();
  for (const value of [Infinity, -Infinity, NaN]) {
    const input = records(); input.mock.draft.config.timeLimitSec = value;
    assert(p.store.validateRecordsObj(input).some(error => error.includes('timeLimitSec')));
    const round = records(); round.mock.rounds[0].durationMs = value;
    assert(p.store.validateRecordsObj(round).some(error => error.includes('durationMs')));
  }
});
console.log(`\n结果: ${passed} 通过, 0 失败`);
