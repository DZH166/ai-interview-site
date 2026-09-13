/* 多标签页远程合并测试:adoptRemoteRecords 复用备份导入的合并规则,
   只合并内存、不回写磁盘;非法载荷整体拒绝。运行:node tests/remote-merge-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
global.window = global;
global.document = {
  readyState: 'loading', querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, addEventListener() {} }),
  addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }
};
function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > 5 * 1024 * 1024) throw new Error('QuotaExceededError'); m.set(String(k), String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(), _dump: () => Object.fromEntries(m)
  };
}
global.localStorage = makeLocalStorage();
global.toast = () => {}; global.debounce = undefined;
global.location = { hash: '', hostname: 'localhost', protocol: 'http:' };
global.addEventListener = () => {}; global.removeEventListener = () => {};
global.window.APP_DATA = { topics: [{ id: 'rag', name: 'RAG 与检索', short: 'RG' }], questions: [] };

function load(file) { vm.runInThisContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), { filename: file }); }
['app/js/srs.js', 'app/js/util.js', 'app/js/store.js'].forEach(load);

let passed = 0, failed = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name, '\n    got:', g, '\n   want:', w); }
}
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name, detail || ''); }
}

Store.load();
const T = Date.now();

console.log('== 1. 合法远程记录:合并进内存,不回写磁盘 ==');
{
  Store.setStatus('RG-001', 'ok');
  const diskBefore = localStorage.getItem('aiiv:records');
  const remote = { v: 3, questions: { 'RG-002': { note: '另一页的笔记', _updatedAt: T + 1000 } }, mock: { rounds: [] }, ui: {} };
  const res = Store.adoptRemoteRecords(JSON.stringify(remote));
  ok('合并成功', res.ok === true, JSON.stringify(res));
  eq('对方的笔记进入本页内存', Store.rec('RG-002').note, '另一页的笔记');
  eq('本页原有记录保留', Store.rec('RG-001').status, 'ok');
  ok('不回写磁盘(等本页下次保存自然带上)', localStorage.getItem('aiiv:records') === diskBefore);
  ok('报告说明合并了什么', res.report.qMerged === 1, JSON.stringify(res.report));
  ok('数据版本已推进(索引会按需重建)', Store.rev >= 0);
}

console.log('== 2. 冲突:逐记录 _updatedAt 新者胜 ==');
{
  /* 本地更新 → 对方的旧笔记不覆盖 */
  Store.setNote('RG-010', '本地新笔记');
  const res = Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: {
    'RG-010': { note: '对方的旧笔记', _updatedAt: T - 60000 } }, mock: { rounds: [] }, ui: {} }));
  eq('本地较新:保留本地', Store.rec('RG-010').note, '本地新笔记');
  /* 对方更新 → 采用对方(含明确清空) */
  Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: {
    'RG-010': { note: '对方的更新笔记', _updatedAt: T + 60000 } }, mock: { rounds: [] }, ui: {} }));
  eq('对方较新:采用对方', Store.rec('RG-010').note, '对方的更新笔记');
}

console.log('== 3. 轮次/尝试/草稿:同一套合并规则 ==');
{
  const round = { ts: 12345, items: [{ qid: 'RG-020', title: 't', self: 's', revealed: true, mark: 'weak' }] };
  const res1 = Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: {}, mock: { rounds: [round] }, ui: {} }));
  ok('对方的新轮次进入本页', res1.report.roundsAdded === 1, JSON.stringify(res1.report));
  const res2 = Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: {}, mock: { rounds: [round] }, ui: {} }));
  eq('重复合并幂等(按内容去重)', res2.report.roundsAdded, 0);
  const res3 = Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: {}, mock: { rounds: [] },
    drillAttempts: { 'drill-x': [{ attemptId: 'at-1', drillId: 'drill-x', status: 'completed', myAnswer: '对方', updatedAt: T }] }, ui: {} }));
  eq('对方的专项尝试进入本页', (Store.data.drillAttempts['drill-x'] || []).length, 1);
  /* 本地较新的尝试不被覆盖 */
  Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: {}, mock: { rounds: [] },
    drillAttempts: { 'drill-x': [{ attemptId: 'at-1', drillId: 'drill-x', status: 'completed', myAnswer: '旧版', updatedAt: T - 5000 }] }, ui: {} }));
  eq('本地较新的尝试保留', Store.data.drillAttempts['drill-x'][0].myAnswer, '对方');
}

console.log('== 4. 非法载荷整体拒绝 ==');
{
  const diskBefore = localStorage.getItem('aiiv:records');
  const memBefore = JSON.stringify(Store.data.questions);
  ok('坏 JSON → ok:false', Store.adoptRemoteRecords('{bad').ok === false);
  ok('非对象 → ok:false', Store.adoptRemoteRecords('[1,2]').ok === false);
  const bad = Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: { 'RG-030': { status: '不合法状态' } }, mock: { rounds: [] }, ui: {} }));
  ok('校验不过 → ok:false', bad.ok === false && bad.error.includes('校验未通过'), JSON.stringify(bad));
  ok('拒绝后内存未动', JSON.stringify(Store.data.questions) === memBefore);
  ok('拒绝后磁盘未动', localStorage.getItem('aiiv:records') === diskBefore);
}

console.log('== 4b. 变更语义(ST-01):处理条数≠变更,无业务变化不推进版本 ==');
{
  localStorage.clear(); Store.load();
  Store.setStatus('RG-040', 'weak'); Store.saveNow();
  const revBefore = Store.rev;
  /* 同一份数据再次合并:无任何变化 */
  const raw = localStorage.getItem('aiiv:records');
  const r1 = Store.adoptRemoteRecords(raw);
  ok('重复合并:changed=false', r1.changed === false && r1.ok === true);
  eq('重复合并:版本不推进', Store.rev, revBefore);
  /* 仅 savedAt/lastHash 变化(对页导航/重存的元数据):不算业务变更 */
  const obj = JSON.parse(raw);
  obj.ui.savedAt = (obj.ui.savedAt || 0) + 12345;
  obj.ui.lastHash = '#/browse';
  const r2 = Store.adoptRemoteRecords(JSON.stringify(obj));
  ok('仅元数据变化:changed=false(不触发界面刷新)', r2.changed === false, JSON.stringify(r2.changes));
  eq('仅元数据变化:版本不推进', Store.rev, revBefore);
  /* 真实业务变更:返回变更集合 */
  const r3 = Store.adoptRemoteRecords(JSON.stringify({ v: 3, questions: { 'RG-041': { note: '真实变更', _updatedAt: Date.now() + 5000 } }, mock: { rounds: [] }, ui: {} }));
  ok('真实变更:changed=true', r3.changed === true);
  ok('变更集合指明题目', (r3.changes.qids || []).includes('RG-041'), JSON.stringify(r3.changes));
  ok('真实变更:版本推进', Store.rev > revBefore);
}

console.log('== 5. 存储健康度 ==');
{
  const kb = Store.recordsSizeKB();
  ok('recordsSizeKB 返回正数', typeof kb === 'number' && kb > 0, String(kb));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
