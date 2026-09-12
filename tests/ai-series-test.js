/* Coverage and state-preserving integration tests for the curated 98-topic fusion. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..'), fusion = require('../tools/fuse-ai-series');
const plan = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/imports/ai-series/fusion-plan.json'), 'utf8'));
const qs = fs.readdirSync(path.join(ROOT, 'data/questions')).filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions', f), 'utf8')));
const byId = new Map(qs.map(q => [q.id, q]));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  PASS', name); } catch(e) { failed++; console.error('  FAIL', name, e.message); } }
test('all 98 source topics resolve to real questions without duplicating IDs', () => {
  assert.strictEqual(plan.items.length, 98); assert.strictEqual(new Set(plan.items.map(r => r.url)).size, 98);
  assert.strictEqual(byId.size, qs.length);
  for(const r of plan.items) for(const id of r.target_ids) { assert(byId.has(id)); assert(byId.get(id).metadata.ai_series.source_ids.includes(r.source_id)); }
});
test('13 new questions and 72 existing questions retain deterministic source ownership', () => {
  const g = fusion.generate(); assert.strictEqual(g.manifest.added, 13); assert.strictEqual(g.manifest.existing_supplemented, 72);
  assert.strictEqual(g.manifest.existing_revised, 30); assert(g.changes.every(r => r.action === 'skip'));
  for(const q of qs.filter(q => q.metadata?.ai_series)) assert.strictEqual(fusion.managedHash(q), q.metadata.ai_series.output_hash);
});
test('curated corrections appear across the actual learning fields', () => {
  assert(byId.get('AG-004').answer.includes('不要求模型必须原生支持'));
  assert(byId.get('AG-022').answer.includes('节点开头'));
  assert(byId.get('AD-004').deep.includes('r×k'));
  assert(byId.get('AD-005').deep.includes('不能保证固定'));
  assert(byId.get('AD-008').answer.includes('奖励模型'));
  assert(byId.get('FD-013').answer.includes('SFT也属于后训练'));
  assert(byId.get('FD-012').answer.includes('共同前缀KV可以共享'));
  assert(byId.get('AD-024').answer.includes('维护模式'));
  assert(byId.get('AD-011').example.includes('4080'));
  assert(byId.get('AD-011').example.includes('1080'));
  assert(!byId.get('AD-011').example.includes('GPU空闲窗口消失'));
});
test('new framework category contains six distinct learning questions with valid prerequisites', () => {
  const framework = qs.filter(q => q.topic === 'langchain'); assert.strictEqual(framework.length, 6);
  for(const q of framework) { assert(q.prompt); assert(q.check.explain); assert(q.prerequisites.every(id => byId.has(id))); }
  assert.strictEqual(byId.get('AG-010').id, 'AG-010'); assert.strictEqual(byId.get('AG-022').id, 'AG-022');
});
test('built data and fused search do not create answers or erase existing user state', () => {
  const records = { v: 3, questions: { 'AG-010': { note: 'original note', fav: true, status: 'ok', practiceCount: 3 }, 'PI-001': { note: 'Pi note', status: 'weak' } }, mock: { rounds: [], draft: null }, drillAttempts: {}, ui: {} };
  const disk = new Map([['aiiv:records', JSON.stringify(records)]]);
  const c = { window: {}, console, toast() {}, debounce: f => f, esc: String, localStorage: { getItem: k => disk.get(k) || null, setItem: (k, v) => disk.set(k, String(v)), removeItem: k => disk.delete(k) } };
  vm.createContext(c);
  for(const f of ['app/data.js','app/js/store.js','app/js/common.js','app/js/markdown.js','app/js/search.js','app/js/express.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), c);
  vm.runInContext('Store.load(); Data.init(); this.S=Store;this.D=Data;this.Search=Search;this.Card=ExpressCard;', c);
  assert.strictEqual(c.D.allQuestions().length, qs.length);
  assert.strictEqual(JSON.stringify(c.S.data.questions), JSON.stringify(records.questions));
  assert.strictEqual(disk.get('aiiv:records'), JSON.stringify(records));
  assert.strictEqual(c.D.allQuestions().filter(q => q.topic === 'pi-agent').length, 30);
  c.Search.build({ questions: c.D.allQuestions(), docs: c.D.allDocs(), records: c.S.data });
  assert(c.Search.query('fencing token').some(r => r.unit.qid === 'AG-033'));
  const card = c.Card.buildFromRound([{ ts: 1, items: [{ qid: 'AG-033', self: 'my answer' }] }], 0, id => c.D.question(id));
  assert(card.markdown.includes('fencing token')); assert(card.html.includes('fencing token'));
  assert.strictEqual(c.S.validateQuestions(qs, new Set()).errors.length, 0);
});
console.log(`\n结果: ${passed} 通过, ${failed} 失败`); process.exitCode = failed ? 1 : 0;
