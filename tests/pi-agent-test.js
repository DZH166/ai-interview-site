/* Read back every imported question, not only a title/count fixture. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const adapter = require('../tools/import-pi-agent');
const source = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/imports/pi-agent/questions.json'), 'utf8'));
const questions = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions/pi-agent.json'), 'utf8'));
const sourceTotal = fs.readdirSync(path.join(ROOT, 'data/questions')).filter(f => f.endsWith('.json'))
  .reduce((n, f) => n + JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions', f), 'utf8')).length, 0);
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  PASS', name); } catch(e) { failed++; console.error('  FAIL', name, e.message); } }
test('30 stable native IDs, three groups and 90 nested follow-ups', () => {
  assert.deepStrictEqual(questions.map(q => q.id), Array.from({ length: 30 }, (_, i) => 'PI-' + String(i + 1).padStart(3, '0')));
  assert.strictEqual(questions.reduce((n, q) => n + q.followups.length, 0), 90);
  for(const group of source.categories) assert.strictEqual(questions.filter(q => q.metadata.pi_agent.original.category === group.id).length, 10);
});
test('all source objects and hashes survive the adaptation without loss', () => {
  for(const q of questions) {
    const original = source.questions.find(s => s.id === q.id);
    assert.deepStrictEqual(q.metadata.pi_agent.original, original);
    assert.strictEqual(adapter.hash(original), q.metadata.pi_agent.source_hash);
    assert.strictEqual(q.external_id, source.bank_id + ':' + q.id);
  }
});
test('all main content, terminology, rubrics and exercises are visible native fields', () => {
  for(const q of questions) {
    const s = q.metadata.pi_agent.original;
    assert.strictEqual(q.prompt, s.question); assert.strictEqual(q.answer, s.pitched_answer);
    for(const e of s.explanation) { assert(q.deep.includes(e.heading)); assert(q.deep.includes(e.body)); }
    for(const t of s.terms) { assert(q.plain.includes(t.term)); assert(q.plain.includes(t.zh)); assert(q.plain.includes(t.meaning)); }
    for(const r of s.rubric) assert(q.interview.includes(r.criterion));
    for(const a of s.practice.acceptance) assert(q.example.includes(a));
    assert(q.example.includes('proposed_not_run'));
    assert(q.deep.includes(s.version_notes)); assert(q.plain.includes(s.why_it_matters));
    s.misconceptions.forEach((m, i) => { assert(q.pitfalls[i].includes(m.claim)); assert(q.pitfalls[i].includes(m.correction)); });
    assert.deepStrictEqual(q.followups, s.follow_ups.map(f => ({ q: f.question, a: f.answer })));
    assert.strictEqual(s.rubric.reduce((n, r) => n + r.points, 0), 10);
  }
});
test('source URLs remain pinned and prerequisites resolve within the new bank', () => {
  const ids = new Set(questions.map(q => q.id));
  for(const q of questions) {
    assert(q.sources.every(s => s.url.includes('/blob/' + source.source_baseline.commit + '/')));
    assert(q.prerequisites.every(id => ids.has(id)));
    assert.strictEqual(q.verify.status, 'partial');
  }
});
test('same content is skipped and managed content edits are detectable', () => {
  const g = adapter.generate(); assert(g.plan.every(p => p.action === 'skip'));
  const changed = structuredClone(questions[0]); changed.title += ' user edit';
  assert.notStrictEqual(adapter.managedHash(changed), changed.metadata.pi_agent.adapter_hash);
});
test('built application retains the full bank and Pi Agent without touching personal records', () => {
  const records = { v: 3, questions: { 'PY-001': { note: 'my existing note', fav: true, status: 'weak', practiceCount: 4 } }, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} };
  const disk = new Map([['aiiv:records', JSON.stringify(records)]]);
  const c = { window: {}, console, toast() {}, debounce: f => f, esc: String,
    localStorage: { getItem: k => disk.get(k) || null, setItem: (k, v) => disk.set(k, String(v)), removeItem: k => disk.delete(k) } };
  vm.createContext(c);
  ['app/data.js', 'app/js/store.js', 'app/js/common.js', 'app/js/markdown.js', 'app/js/search.js', 'app/js/express.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c));
  vm.runInContext('Store.load(); Data.init(); this.S=Store; this.D=Data; this.Search=Search; this.Card=ExpressCard;', c);
  assert.strictEqual(c.D.allQuestions().length, sourceTotal); assert.strictEqual(c.D.topic('pi-agent').name, 'Pi Agent');
  for(const q of questions) assert.strictEqual(c.D.question(q.id).metadata.pi_agent.source_hash, q.metadata.pi_agent.source_hash);
  assert.strictEqual(JSON.stringify(c.S.data.questions), JSON.stringify(records.questions));
  assert.strictEqual(disk.get('aiiv:records'), JSON.stringify(records));
  c.Search.build({ questions: c.D.allQuestions(), docs: c.D.allDocs(), records: c.S.data });
  assert(c.Search.query('固定发票校验').some(r => r.unit.qid === 'PI-001' && r.unit.field === 'prompt'));
  const card = c.Card.buildFromRound([{ ts: 1, items: [{ qid: 'PI-004', self: 'my independent answer' }] }], 0, id => c.D.question(id));
  assert(card.markdown.includes(questions[3].prompt)); assert(card.html.includes(questions[3].prompt));
  assert.strictEqual(c.S.validateQuestions(questions, new Set()).errors.length, 0);
  assert(c.S.validateQuestions([{ ...questions[0], prompt: [] }], new Set()).errors.some(e => e.includes('prompt')));
});
test('a locally edited managed question blocks the entire import without changing files', () => {
  const os = require('os'), cp = require('child_process');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'pi-agent-import-'));
  try {
    for(const d of ['tools', 'data/imports/pi-agent', 'data/questions']) fs.mkdirSync(path.join(temp, d), { recursive: true });
    fs.copyFileSync(path.join(ROOT, 'tools/import-pi-agent.js'), path.join(temp, 'tools/import-pi-agent.js'));
    for(const f of ['questions.json', 'import-manifest.json', 'GLOSSARY.md']) fs.copyFileSync(path.join(ROOT, 'data/imports/pi-agent', f), path.join(temp, 'data/imports/pi-agent', f));
    fs.copyFileSync(path.join(ROOT, 'data/topics.json'), path.join(temp, 'data/topics.json'));
    const edited = structuredClone(questions); edited[0].title += '：用户改过';
    const file = path.join(temp, 'data/questions/pi-agent.json'); const before = JSON.stringify(edited);
    fs.writeFileSync(file, before);
    const result = cp.spawnSync(process.execPath, [path.join(temp, 'tools/import-pi-agent.js'), '--write'], { encoding: 'utf8' });
    assert.notStrictEqual(result.status, 0); assert(result.stdout.includes('"conflict": 1'));
    assert.strictEqual(fs.readFileSync(file, 'utf8'), before);
    assert(!fs.existsSync(path.join(temp, 'data/docs/pi-agent.md')));
  } finally {
    const resolved = fs.realpathSync(temp), parent = fs.realpathSync(os.tmpdir());
    assert.strictEqual(path.dirname(resolved), parent); assert(path.basename(resolved).startsWith('pi-agent-import-'));
    fs.rmSync(resolved, { recursive: true, force: true });
  }
});
console.log(`\n结果: ${passed} 通过, ${failed} 失败`); process.exitCode = failed ? 1 : 0;
