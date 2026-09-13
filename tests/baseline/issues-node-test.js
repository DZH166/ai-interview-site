/* 阶段0 复现用例(Node 侧):SP-01 旧备份复活 SRS / SP-03 只答追问无法导出 / SP-04 未来日期显示已到期。
   本文件是审查报告 issues 的失败证据,不接入 CI(未修复版本上必然失败);
   对应阶段修复完成后,断言并入正式套件(tests/srs-test.js / tests/express-card-test.js),
   本文件随之删除。运行:node tests/baseline/issues-node-test.js(预期:失败,退出码 1) */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '../..');
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
['app/js/srs.js', 'app/js/util.js', 'app/js/markdown.js', 'app/js/store.js', 'app/js/search.js', 'app/js/express.js'].forEach(load);

let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail || ''); }
}

const DAY = SRS.DAY;
const T = 1757000000000;

console.log('== SP-01: 旧备份不得复活已撤销的 SRS(三个入口一致) ==');
/* 场景(审查报告 SP-01):标还不熟 → 导出备份 → 清空状态(撤销) → 恢复较旧备份。
   本地较新的「已撤销」状态必须胜出;旧排期不得补回,题目不得重新进入到期建议。 */
function sp01Scenario(importFn) {
  localStorage.clear();
  Store.load();
  Store.setStatus('RG-001', 'weak');                 /* srs 产生,due≈now */
  const backup = JSON.parse(Store.exportRecords());  /* 旧备份(含 status weak + srs) */
  Store.setStatus('RG-001', '');                     /* 撤销:状态清空,srs 一并删除,_updatedAt 更新 */
  if (!(Store.rec('RG-001').srs === undefined && Store.rec('RG-001').status === '')) {
    throw new Error('前置失败:清空状态未撤销 srs');
  }
  importFn(backup);
  return {
    srsGone: Store.rec('RG-001').srs === undefined,
    statusEmpty: (Store.rec('RG-001').status || '') === ''
  };
}
{
  const r1 = sp01Scenario(b => Store.importRecords(JSON.stringify(b)));
  ok('SP-01a 记录导入:撤销后旧备份不复活 srs', r1.srsGone, JSON.stringify(Store.rec('RG-001').srs));
  ok('SP-01a 撤销后的空状态保留', r1.statusEmpty);
  ok('SP-01a 撤销后不产生到期建议', !SRS.isDue(Store.rec('RG-001'), Date.now()));
}
{
  const r2 = sp01Scenario(b => Store.importFull(JSON.stringify({
    type: 'aiiv-full', v: 1, records: b.records, questions: [], docs: [] })));
  ok('SP-01b 完整恢复:同样不复活 srs', r2.srsGone, JSON.stringify(Store.rec('RG-001').srs));
}
{
  const r3 = sp01Scenario(b => Store.adoptRemoteRecords(JSON.stringify(b.records)));
  ok('SP-01c 跨页合并:同样不复活 srs', r3.srsGone, JSON.stringify(Store.rec('RG-001').srs));
}
{
  /* 对照组(保证修复不砍掉正常恢复):全新环境导入旧备份,srs 应正常恢复 */
  localStorage.clear();
  Store.load();
  Store.setStatus('RG-002', 'weak');
  const backup = JSON.parse(Store.exportRecords());
  localStorage.clear();
  Store.load();
  Store.importRecords(JSON.stringify(backup));
  ok('SP-01d 对照:全新环境导入,排期正常恢复(修复不得误伤)',
     !!(Store.rec('RG-002').srs && Store.rec('RG-002').srs.lastRating === 'again'));
}

console.log('== SP-03: 只写追问的真实练习必须可导出 ==');
{
  const lookup = id => id === 'FU-001' ? {
    id: 'FU-001', title: '追问主题', prompt: '', fusion_notes: '', topic: 'rag', difficulty: 'basic',
    answer: 'A', plain: 'P', interview: 'I', pitfalls: [], followups: [{ q: '追问A?', a: '因为X' }]
  } : null;
  /* 报告场景:主回答留空 → 对照主答案 → 填写一条追问 → 完成。 */
  const round = { ts: Date.now(), items: [{ qid: 'FU-001', title: '追问主题', self: '', revealed: true, mark: '',
    followups: [{ q: '追问A?', self: '我的追问回答', revealed: true }] }] };
  const r = ExpressCard.buildFromRound([round], 0, lookup);
  ok('SP-03a 只写追问可导出', r.ok === true, JSON.stringify(r && r.error));
  if (r.ok) ok('SP-03b 追问回答进入卡片', r.markdown.includes('我的追问回答'));
  /* 对照:仅揭示、未写任何内容 → 仍拒绝 */
  const round2 = { ts: Date.now(), items: [{ qid: 'FU-001', title: '追问主题', self: '', revealed: true, mark: '',
    followups: [{ q: '追问A?', self: '', revealed: true }] }] };
  const r2 = ExpressCard.buildFromRound([round2], 0, lookup);
  ok('SP-03c 仅揭示未写 → 仍拒绝(不产出空壳)', r2.ok === false, JSON.stringify(r2 && r2.error));
  /* 空格不算真实作答 */
  const round3 = { ts: Date.now(), items: [{ qid: 'FU-001', title: '追问主题', self: '   ', revealed: true, mark: '',
    followups: [{ q: '追问A?', self: '  ', revealed: true }] }] };
  const r3 = ExpressCard.buildFromRound([round3], 0, lookup);
  ok('SP-03d 只有空格 → 仍拒绝', r3.ok === false, JSON.stringify(r3 && r3.error));
}

console.log('== SP-04: 到期文案与队列判定一致 ==');
{
  const now = T;
  ok('SP-04a isDue:23 小时后未到期(该行为应保持)', SRS.isDue({ srs: { due: now + 23 * 3600000 } }, now) === false);
  ok('SP-04b 未来 23 小时不得显示「已到期」', SRS.dueLabel(now + 23 * 3600000, now) !== '已到期',
     '实际:' + SRS.dueLabel(now + 23 * 3600000, now));
  ok('SP-04c 未来 1 毫秒不得显示「已到期」', SRS.dueLabel(now + 1, now) !== '已到期',
     '实际:' + SRS.dueLabel(now + 1, now));
  ok('SP-04d 同一毫秒 = 已到期(边界保持)', SRS.dueLabel(now, now) === '已到期');
  ok('SP-04e 过去 1 毫秒 = 已到期', SRS.dueLabel(now - 1, now) === '已到期');
  ok('SP-04f 正好 24 小时 = 明天', SRS.dueLabel(now + DAY, now) === '明天', '实际:' + SRS.dueLabel(now + DAY, now));
  ok('SP-04g 49 小时 = 2 天后', SRS.dueLabel(now + 49 * 3600000, now) === '2 天后', '实际:' + SRS.dueLabel(now + 49 * 3600000, now));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败(阶段0基线:以下断言在修复前应失败)`);
if (failures.length) console.log('失败项(即待修复问题):\n  - ' + failures.join('\n  - '));
process.exit(failed ? 1 : 0);
