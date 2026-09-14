/* 保存前协议直接断言(saveNow 的统一行为,后续轮2):
   ①磁盘无变化 → 直接写;②磁盘有新内容 → 合并后再写,不丢对方数据;
   ③磁盘数据非法 → 返回 false 不覆盖;④内存与磁盘同刻冲突 → 确定决胜。
   运行:node tests/save-protocol-test.js */
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
const disk = () => JSON.parse(localStorage.getItem('aiiv:records'));

Store.load();

console.log('== 1. 无竞争:直接写 ==');
{
  Store.setNote('RG-001', '普通保存');
  const r = Store.saveNow();
  ok('返回 true', r === true);
  ok('磁盘为新值', disk().questions['RG-001'].note === '普通保存');
}

console.log('== 2. 磁盘有对方新内容:合并后再写,不丢对方 ==');
{
  /* 模拟对方页直接写盘(绕过本页内存) */
  const d = disk();
  d.questions['RG-010'] = { note: '对方的新笔记', _updatedAt: Date.now() + 5000, status: '', fav: false, viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
  localStorage.setItem('aiiv:records', JSON.stringify(d));
  /* 本页同时写自己的数据 */
  Store.setNote('RG-011', '本页的写入');
  const r = Store.saveNow();
  ok('返回 true', r === true);
  ok('对方数据保留(不丢)', disk().questions['RG-010'].note === '对方的新笔记', disk().questions['RG-010'].note);
  ok('本页数据写入', disk().questions['RG-011'].note === '本页的写入');
  ok('本页内存收敛到合并结果', Store.rec('RG-010').note === '对方的新笔记');
}

console.log('== 3. 磁盘数据非法:返回 false,不覆盖 ==');
{
  localStorage.setItem('aiiv:records', '{broken json');
  const r = Store.saveNow();
  ok('返回 false', r === false);
  ok('磁盘坏数据未被覆盖(用户可导出原始字节)', localStorage.getItem('aiiv:records') === '{broken json');
  ok('lastSaveError 已设置', (Store.lastSaveError || '').includes('保存前读取最新记录失败') || (Store.lastSaveError || '').includes('校验失败'), Store.lastSaveError);
  /* 恢复合法磁盘后可重试 */
  localStorage.setItem('aiiv:records', JSON.stringify({ v: 3, questions: {}, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} }));
  Store.load();        /* 重新 load:从磁盘重建内存 */
  ok('恢复后重试成功', Store.saveNow() === true);
}

console.log('== 4. 同刻冲突:决胜确定 ==');
{
  localStorage.clear(); Store.load();
  const T = 1700000000000;
  /* 磁盘放一份同刻不同内容 */
  const d = { v: 3, questions: { 'RG-020': { note: '磁盘版本', _updatedAt: T, status: '', fav: false, viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 } }, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {}, resetEpoch: 0, resetTs: 0 };
  localStorage.setItem('aiiv:records', JSON.stringify(d));
  Store.load();
  Store.rec('RG-020').note = '内存版本';
  Store.rec('RG-020')._updatedAt = T;
  const first = (Store.saveNow(), disk().questions['RG-020'].note);
  /* 重复运行同样输入:决胜必须一致 */
  localStorage.clear(); Store.load();
  localStorage.setItem('aiiv:records', JSON.stringify(d));
  Store.load();
  Store.rec('RG-020').note = '内存版本';
  Store.rec('RG-020')._updatedAt = T;
  Store.saveNow();
  const second = disk().questions['RG-020'].note;
  ok('同刻决胜确定(两次一致): ' + first, first === second && (first === '内存版本' || first === '磁盘版本'), first + ' / ' + second);
  ok('本页内存与磁盘一致', Store.rec('RG-020').note === first);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
