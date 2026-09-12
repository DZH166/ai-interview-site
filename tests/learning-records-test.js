/* Exercise the real Store and PathView handlers, including imported parallel drafts. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log('  PASS', name); }
  catch (e) { failed++; console.error('  FAIL', name, e.message); }
}
function environment() {
  const disk = new Map(); let choices = [];
  const c = { console, window: { rebuildIndex() {} }, toast() {}, debounce: f => f,
    esc: s => String(s ?? ''), query: {}, parseHash: () => ({ query: c.query }), $$: () => [],
    modal: (_, __, buttons) => { choices = buttons; },
    localStorage: { getItem: k => disk.get(k) || null, setItem: (k, v) => disk.set(k, String(v)), removeItem: k => disk.delete(k) } };
  vm.createContext(c);
  const util = fs.readFileSync(path.join(ROOT, 'app/js/util.js'), 'utf8');
  vm.runInContext(util.slice(util.indexOf('function fmtTime('), util.indexOf('function toast(')), c);
  ['app/data.js', 'app/js/store.js', 'app/js/common.js', 'app/js/markdown.js', 'app/js/search.js',
    'app/js/views-knowledge.js', 'app/js/views-review.js'].forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c));
  vm.runInContext('Store.load(); Data.init(); this.store=Store; this.view=PathView;', c);
  return { c, store: c.store, get choices() { return choices; } };
}
const DID = 'drill-1pred01';
function attempt(id, time, answer = '') {
  return { attemptId: id, drillId: DID, version: 1, status: 'draft', ts: time, updatedAt: time, myAnswer: answer, observed: '', review: '' };
}
function attach(e) {
  let html = '', box;
  const node = value => ({ value, handlers: {}, addEventListener(k, f) { (this.handlers[k] ||= []).push(f); }, classList: { add() {}, remove() {} } });
  const root = { get innerHTML() { return html; }, set innerHTML(v) {
    html = v; const fields = {};
    ['answer', 'obs', 'review'].forEach(k => { fields[k] = node((v.match(new RegExp('<textarea[^>]*data-drill-' + k + '="' + DID + '"[^>]*>([\\s\\S]*?)</textarea>')) || [])[1] || ''); });
    fields.save = node(''); fields.new = node('');
    box = { dataset: { drill: DID }, fields, querySelector(s) {
      if (s === '[data-rate].btn-primary') return null;
      const m = s.match(/data-drill-(answer|obs|review|save|new)/); return m ? fields[m[1]] : null;
    } };
  }, querySelector() { return null; } };
  e.c.$$ = s => s === '.path-drill' ? [box] : [];
  return { render() { e.c.view.render(root); }, click(k) { [...box.fields[k].handlers.click].forEach(f => f()); }, get answer() { return box.fields.answer.value; }, get html() { return html; } };
}
function backup(method, records) {
  return JSON.stringify(method === 'importFull' ? { type: 'aiiv-full', v: 1, records, questions: [], docs: [] } : { type: 'aiiv-records', v: 2, records });
}
for (const method of ['importRecords', 'importFull']) {
  test(method + ': older backup preserves explicit note/status/favourite clearing', () => {
    const e = environment();
    e.store.data.questions['PY-001'] = { note: '', status: '', fav: false, _updatedAt: 200 };
    e.store[method](backup(method, { questions: { 'PY-001': { note: 'old', status: 'weak', fav: true, _updatedAt: 100 } } }));
    const q = e.store.rec('PY-001'); assert.strictEqual(q.note, ''); assert.strictEqual(q.status, ''); assert.strictEqual(q.fav, false);
  });
  test(method + ': untouched defaults accept legacy data; newer backup still wins', () => {
    const e = environment(); e.store.rec('PY-001');
    e.store[method](backup(method, { questions: { 'PY-001': { note: 'legacy', status: 'weak', fav: true } } }));
    assert.strictEqual(e.store.rec('PY-001').note, 'legacy');
    e.store.data.questions['PY-001']._updatedAt = 200;
    e.store[method](backup(method, { questions: { 'PY-001': { note: 'new', status: 'ok', fav: false, _updatedAt: 300 } } }));
    assert.strictEqual(e.store.rec('PY-001').note, 'new'); assert.strictEqual(e.store.rec('PY-001').fav, false);
  });
}
test('parallel draft never silently replaces a just-submitted answer', () => {
  const e = environment(); e.store.data.drillAttempts[DID] = [attempt('local-A', 100, 'older A')];
  e.store.importRecords(backup('importRecords', { questions: {}, drillAttempts: { [DID]: [attempt('backup-B', 200, 'newer B')] } }));
  const v = attach(e); v.render(); assert.strictEqual(v.answer, 'newer B'); v.click('save');
  assert.strictEqual(v.answer, ''); assert(v.html.includes('at=local-A'), 'older draft must remain explicitly reachable');
  e.c.query = { d: DID, at: 'local-A' }; v.render(); assert.strictEqual(v.answer, 'older A');
});
test('submit-and-new does not invent an unsolved rating', () => {
  const e = environment(); e.store.data.drillAttempts[DID] = [attempt('unrated', 100, 'my prediction')];
  const v = attach(e); v.render(); v.click('new'); e.choices.find(x => x.label === '提交后另开').onClick();
  assert(!e.store.data.drillAttempts[DID].find(x => x.attemptId === 'unrated').selfRating);
});
test('a rating-only draft requires a choice and is retained when abandoned', () => {
  const e = environment(); e.store.data.drillAttempts[DID] = [{ ...attempt('rated', 100), selfRating: 'solved' }];
  const v = attach(e); v.render(); v.click('new');
  assert(e.choices.some(x => x.label === '放弃草稿(留痕)'));
  e.choices.find(x => x.label === '放弃草稿(留痕)').onClick();
  const a = e.store.data.drillAttempts[DID].find(x => x.attemptId === 'rated');
  assert.strictEqual(a.status, 'abandoned'); assert.strictEqual(a.selfRating, 'solved');
});
test('equal timestamps choose the same latest record regardless of import order', () => {
  const e = environment(), a = attempt('a', 100), b = attempt('b', 100);
  assert.strictEqual(e.store.latestOf([a, b]).attemptId, e.store.latestOf([b, a]).attemptId);
});
console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exitCode = failed ? 1 : 0;
