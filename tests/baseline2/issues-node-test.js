/* 阶段0 复现用例(Node):MR-01 预览漏迁移旧runId / MR-02 预览不显示项目运行覆盖 / ST-01 同毫秒顺序写不收敛。
   未修复版本上必然失败,不进CI;修复后并入正式套件,本文件删除。
   运行:node tests/baseline2/issues-node-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
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
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail || ''); }
}

console.log('== MR-01: 预览必须识别「旧runId迁移后可恢复」的项目记录 ==');
{
  localStorage.clear(); Store.load();
  /* 本地:proj-a 已存在但项目运行列表为空 */
  Store.data.ui.projectRuns = Store.data.ui.projectRuns || {};
  Store.data.ui.projectRuns['proj-a'] = [];
  Store.saveNow();
  /* 备份:该项目的旧格式运行记录(无 runId) */
  const backup = { type: 'aiiv-records', v: 2, questions: {}, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {
    projectRuns: { 'proj-a': [{ ts: 1700000000000, updatedAt: 1700000000000, runOutput: '旧版运行输出ABC', debug: '定位D', todo: '', stepStatus: 'verified' }] },
  } };
  const p = Store.previewRecordsMerge(JSON.stringify(backup));
  ok('MR-01a 预览不得返回 noChanges(有可迁移内容)', p.ok === true && p.summary.noChanges === false, JSON.stringify(p.summary));
  /* 对照:实际导入能恢复(迁移已前移到计划规范化阶段,导入复用其结果) */
  const r = Store.importRecords(JSON.stringify(backup));
  ok('MR-01b 对照:实际导入 runsAdded=1(迁移并入计划)', r.runsAdded === 1, JSON.stringify(r));
  ok('MR-01c 对照:正文完整恢复', (Store.data.ui.projectRuns['proj-a'] || []).some(x => (x.runOutput || '').includes('旧版运行输出ABC')));
}

console.log('== MR-02: 预览必须显示「将覆盖」的项目运行 ==');
{
  localStorage.clear(); Store.load();
  Store.data.ui.projectRuns = { 'proj-a': [{ runId: 'r1', ts: 1000, updatedAt: 1000, runOutput: '旧正文', debug: '', todo: '', stepStatus: '' }] };
  Store.saveNow();
  const backup = { type: 'aiiv-records', v: 2, questions: {}, mock: { rounds: [], draft: null, ended: {} }, ui: {
    projectRuns: { 'proj-a': [{ runId: 'r1', ts: 1000, updatedAt: 2000, runOutput: '新正文XYZ', debug: '', todo: '', stepStatus: '' }] },
  } };
  const p = Store.previewRecordsMerge(JSON.stringify(backup));
  ok('MR-02a 预览不得返回 noChanges(有覆盖)', p.ok === true && p.summary.noChanges === false, JSON.stringify(p.summary));
  ok('MR-02b 预览提供项目运行覆盖明细(r1 新旧正文)',
     JSON.stringify(p.summary).includes('r1') && JSON.stringify(p.summary).includes('新正文XYZ') && JSON.stringify(p.summary).includes('旧正文'),
     JSON.stringify(p.summary).slice(0, 400));
}

console.log('== ST-01: 同毫秒跨页写入必须收敛(审查报告场景:A页写A/B页写B) ==');
{
  /* 场景 = 审查报告 ST-01:两个正常应用页,相同 _updatedAt、不同值,顺序写入。
     语义:同刻决胜只约束「两页合并」;单页连续 saveNow 是用户自己的最新输入,后写者胜(正确语义)。 */
  localStorage.clear(); Store.load();
  const T = 1700000000000;
  Store.rec('RG-001').note = 'A同毫秒版本';
  Store.rec('RG-001')._updatedAt = T;
  Store.saveNow();
  /* B 页写 B(模拟另一页写盘):磁盘出现同刻的 B 版本 */
  const diskObj = JSON.parse(localStorage.getItem('aiiv:records'));
  diskObj.questions['RG-001'] = { note: 'B同毫秒版本', _updatedAt: T, status: '', fav: false, viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
  localStorage.setItem('aiiv:records', JSON.stringify(diskObj));
  /* A 页收到并合并(与浏览器 storage 事件同一入口) */
  Store.adoptRemoteRecords(localStorage.getItem('aiiv:records'));
  const mem = Store.rec('RG-001').note;
  const disk = (JSON.parse(localStorage.getItem('aiiv:records')).questions['RG-001'] || {}).note;
  ok('ST-01a 内存与磁盘收敛到同一版本', mem === disk, `mem=${mem} disk=${disk}`);
  ok('ST-01b 收敛值是两者之一', (mem === 'A同毫秒版本' || mem === 'B同毫秒版本'), mem);
  /* 交换:内存 B、磁盘 A → 仍收敛到同一胜者 */
  localStorage.clear(); Store.load();
  Store.rec('RG-001').note = 'B同毫秒版本';
  Store.rec('RG-001')._updatedAt = T;
  Store.saveNow();
  const diskObj2 = JSON.parse(localStorage.getItem('aiiv:records'));
  diskObj2.questions['RG-001'] = { note: 'A同毫秒版本', _updatedAt: T, status: '', fav: false, viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
  localStorage.setItem('aiiv:records', JSON.stringify(diskObj2));
  Store.adoptRemoteRecords(localStorage.getItem('aiiv:records'));
  const mem2 = Store.rec('RG-001').note;
  const disk2 = (JSON.parse(localStorage.getItem('aiiv:records')).questions['RG-001'] || {}).note;
  ok('ST-01c 交换顺序后内存与磁盘仍收敛', mem2 === disk2, `mem=${mem2} disk=${disk2}`);
  /* 阶段5:同刻决胜 = 内容哈希大者胜(对称稳定,与输入/到达顺序无关) */
  const hashA = Store.contentHash(JSON.stringify('A同毫秒版本'));
  const hashB = Store.contentHash(JSON.stringify('B同毫秒版本'));
  const winner = hashA > hashB ? 'A同毫秒版本' : 'B同毫秒版本';
  ok('ST-01d 两次运行收敛到同一稳定胜者(内容哈希大者): ' + mem,
     mem === winner && mem2 === winner && disk === winner && disk2 === winner, `run1=${mem} run2=${mem2} winner=${winner}`);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败(阶段0:失败项即待修复问题)`);
if (failures.length) console.log('失败项:\n  - ' + failures.join('\n  - '));
process.exit(failed ? 1 : 0);
