/* 备份可预览恢复(后续轮3):previewRecordsMerge 与实际导入的一致性断言。
   运行:node tests/preview-restore-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
global.window = global;
global.document = {
  readyState: 'loading', querySelector: () => null, querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} }),
  addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }
};
function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { m.set(String(k), String(v)); },
    removeItem: k => { m.delete(k); }, clear: () => m.clear()
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
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name, detail || ''); }
}

console.log('== 预览四类归类与「不改状态」 ==');
{
  localStorage.clear(); Store.load();
  /* 本地:RG-001 新(将被备份覆盖)、RG-002 新(备份更旧→保留)、RG-003(备份明确清空→撤销)、RG-040 本地没有(新增) */
  const T = Date.now();
  Store.rec('RG-001').note = '本地新1'; Store.rec('RG-001')._updatedAt = T + 3000;
  Store.rec('RG-002').note = '本地新2'; Store.rec('RG-002')._updatedAt = T + 3000;
  Store.rec('RG-003').note = '本地有值'; Store.rec('RG-003')._updatedAt = T;
  Store.saveNow();
  const backup = { type: 'aiiv-records', v: 2, questions: {
    'RG-001': { note: '备份覆盖用', _updatedAt: T + 10000 },
    'RG-002': { note: '备份旧值', _updatedAt: T },
    'RG-003': { note: '', _updatedAt: T + 10000 },
    'RG-040': { note: '全新题目笔记', _updatedAt: T + 10000 },
  }, mock: { rounds: [{ ts: T, items: [{ qid: 'RG-001', title: 't', self: 's', revealed: true, mark: '' }] }], draft: null, ended: {} }, ui: {} };
  const diskBefore = localStorage.getItem('aiiv:records');
  const p = Store.previewRecordsMerge(JSON.stringify(backup));
  ok('预览成功', p.ok === true);
  ok('预览不改状态(内存)', Store.rec('RG-040').note === '' && Store.rec('RG-001').note === '本地新1');
  ok('预览不落盘', localStorage.getItem('aiiv:records') === diskBefore);
  const pq = p.summary.perQuestion;
  ok('归类:新增 1', pq.added === 1, JSON.stringify(pq));
  ok('归类:采用备份 ≥1(RG-001)', pq.overridden >= 1, JSON.stringify(pq));
  ok('归类:保留本机 ≥1(RG-002)', pq.kept >= 1, JSON.stringify(pq));
  ok('归类:撤销 1(RG-003 明确清空)', pq.reverted === 1, JSON.stringify(pq));
  ok('轮次新增预告', p.summary.roundsAdded === 1, JSON.stringify(p.summary));
  /* 无变化场景(exportRecords 外层是 aiiv-records v2 载荷,preview 与 import 同入口) */
  const p2 = Store.previewRecordsMerge(Store.exportRecords());
  ok('一致备份预览:noChanges', p2.summary.noChanges === true, JSON.stringify(p2.summary));
  /* 非法备份:预览与导入同样拒绝 */
  let threw = '';
  try { Store.previewRecordsMerge(JSON.stringify({ type: 'aiiv-records', v: 2, questions: { 'RG-9': { status: '非法状态' } }, mock: { rounds: [] }, ui: {} })); }
  catch (e) { threw = e.message; }
  ok('非法备份预览拒绝', threw.includes('校验未通过'), threw);
  /* 未知外层版本同样拒绝(与 importRecords 行为一致) */
  threw = '';
  try { Store.previewRecordsMerge(JSON.stringify({ type: 'aiiv-records', v: 99, questions: {}, mock: { rounds: [] }, ui: {} })); }
  catch (e) { threw = e.message; }
  ok('未知版本预览拒绝', threw.includes('版本'), threw);
  /* 预览→实际导入:结果一致 */
  Store.importRecords(JSON.stringify(backup));
  ok('实际导入后 RG-001=备份覆盖用', Store.rec('RG-001').note === '备份覆盖用');
  ok('实际导入后 RG-002=保留本地', Store.rec('RG-002').note === '本地新2');
  ok('实际导入后 RG-003=被撤销(空)', Store.rec('RG-003').note === '');
  ok('实际导入后 RG-040=新增', Store.rec('RG-040').note === '全新题目笔记');
  ok('实际导入轮次数与预告一致', Store.data.mock.rounds.length === 1);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
