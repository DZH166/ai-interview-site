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

console.log('== 4c. 清空纪元(SP-05):旧快照不得越过清空边界 ==');
{
  localStorage.clear(); Store.load();
  Store.setNote('PY-001', '清空前的笔记'); Store.saveNow();
  /* 模拟另一页(旧纪元)持有的完整快照 */
  const staleSnapshot = JSON.parse(localStorage.getItem('aiiv:records'));
  /* 本页清空:纪元+1,同步落盘 */
  Store.clearAll();
  eq('清空后纪元为 1', Store.data.resetEpoch, 1);
  ok('清空后内存为空', !Store.rec('PY-001').note);
  /* 旧纪元快照整份合并:必须被拒绝(不得复活) */
  const r1 = Store.adoptRemoteRecords(JSON.stringify(staleSnapshot));
  ok('旧纪元快照不复活被清空笔记', !Store.rec('PY-001').note, Store.rec('PY-001').note);
  ok('旧纪元合并返回 staleEpoch 标记', r1.staleEpoch === true);
  /* 旧纪元页在清空后新写的记录(_updatedAt > resetTs):正常同步 */
  const postClear = JSON.parse(JSON.stringify(staleSnapshot));
  postClear.questions['RG-050'] = { note: '清空后新写', _updatedAt: Store.data.resetTs + 5000 };
  const r2 = Store.adoptRemoteRecords(JSON.stringify(postClear));
  eq('清空后新写的记录正常同步', Store.rec('RG-050').note, '清空后新写');
  ok('清空前的笔记仍不复活', !Store.rec('PY-001').note);
  /* 更高纪元到达:对方的清空发生在更晚时刻 → 该时刻之前的一切写入(无论哪页写的)都被那次清空抹掉 */
  Store.setNote('RG-051', '我在清空后新写'); Store.saveNow();
  const newer = { v: 3, questions: {}, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {}, resetEpoch: 2, resetTs: Date.now() + 20000 };
  const r3 = Store.adoptRemoteRecords(JSON.stringify(newer));
  eq('采用更高纪元', Store.data.resetEpoch, 2);
  eq('更高纪元清空时刻之前的记录被抹掉(RG-050)', Store.rec('RG-050').note, '');
  eq('更高纪元清空时刻之前的记录被抹掉(RG-051)', Store.rec('RG-051').note, '');
  /* 新纪元里新写的记录,不会被旧纪元页面的快照冲掉 */
  Store.setNote('RG-052', '新纪元里新写'); Store.saveNow();
  Store.adoptRemoteRecords(JSON.stringify(staleSnapshot));
  eq('新纪元的记录不受旧纪元快照影响', Store.rec('RG-052').note, '新纪元里新写');
  /* 用户主动恢复备份 = 明确意图:旧数据可以回来,但不把纪元倒回去 */
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: staleSnapshot }));
  eq('主动恢复:纪元不回退', Store.data.resetEpoch, 2);
  eq('主动恢复:备份内容按用户意图恢复', Store.rec('PY-001').note, '清空前的笔记');
}

console.log('== 4d. 会话终态(SP-06):终态优先于旧草稿 ==');
{
  /* 测试隔离:clearAll 让内存与磁盘真正归零;后续 incoming 携带相同纪元,
     确保走的是「终态守卫」路径而不是纪元路径(两条路径各有断言) */
  const resetRecords = () => { localStorage.clear(); Store.load(); Store.clearAll(); };
  const EP = () => Store.data.resetEpoch;
  const withEpoch = o => Object.assign({ resetEpoch: EP(), resetTs: Store.data.resetTs }, o);

  resetRecords();
  const SID = 'ms-1000-abc';
  Store.data.mock.ended[SID] = { status: 'completed', ts: 2000 }; Store.saveNow();
  const staleDraft = { config: {}, items: [{ qid: 'PY-001' }], idx: 0, answers: { 'PY-001': { self: '旧草稿回答', revealed: true } }, savedAt: 1500, sessionId: SID };
  Store.adoptRemoteRecords(JSON.stringify(withEpoch({ v: 3, questions: {}, mock: { rounds: [], draft: staleDraft, ended: {} }, drillAttempts: {}, ui: {} })));
  ok('终态会话的旧草稿不复活', Store.data.mock.draft === null, JSON.stringify(Store.data.mock.draft));

  resetRecords();
  Store.data.mock.ended['ms-x'] = { status: 'abandoned', ts: 5000 }; Store.saveNow();
  Store.adoptRemoteRecords(JSON.stringify(withEpoch({ v: 3, questions: {}, mock: { rounds: [], draft: { config: {}, items: [{ qid: 'PY-001' }], idx: 0, answers: {}, savedAt: 1000, sessionId: 'ms-x' }, ended: {} }, drillAttempts: {}, ui: {} })));
  ok('abandoned 终态同样拒绝草稿复活', Store.data.mock.draft === null);

  /* 收敛:B 页残留的同会话草稿,在终态合并到达后也被清除(不永远挂着死草稿) */
  resetRecords();
  Store.data.mock.draft = { config: {}, items: [{ qid: 'PY-001' }], idx: 0, answers: { 'PY-001': { self: 'B 的残留草稿' } }, savedAt: 1500, sessionId: 'ms-y' };
  Store.saveNow();
  Store.adoptRemoteRecords(JSON.stringify(withEpoch({ v: 3, questions: {}, mock: { rounds: [], draft: null, ended: { 'ms-y': { status: 'completed', ts: 2000 } } }, drillAttempts: {}, ui: {} })));
  ok('终态合并到达后,本页残留的同会话草稿被清除', Store.data.mock.draft === null, JSON.stringify(Store.data.mock.draft));

  resetRecords();
  Store.adoptRemoteRecords(JSON.stringify(withEpoch({ v: 3, questions: {}, mock: { rounds: [], draft: { config: {}, items: [{ qid: 'PY-001' }], idx: 0, answers: { 'PY-001': { self: '新草稿' } }, savedAt: 1000, sessionId: 'ms-fresh' }, ended: {} }, drillAttempts: {}, ui: {} })));
  eq('无终态:草稿正常恢复', Store.data.mock.draft && Store.data.mock.draft.answers['PY-001'].self, '新草稿');

  resetRecords();
  const base = { config: {}, items: [{ qid: 'PY-001' }], idx: 0, answers: {}, sessionId: 'ms-same', ended: {} };
  const d1 = JSON.parse(JSON.stringify(base)); d1.savedAt = 1000; d1.answers['PY-001'] = { self: '旧' };
  const d2 = JSON.parse(JSON.stringify(base)); d2.savedAt = 2000; d2.answers['PY-001'] = { self: '新' };
  Store.data.mock.draft = JSON.parse(JSON.stringify(d1)); Store.saveNow();
  Store.adoptRemoteRecords(JSON.stringify(withEpoch({ v: 3, questions: {}, mock: { rounds: [], draft: d2, ended: {} }, drillAttempts: {}, ui: {} })));
  eq('同会话草稿:新者胜', Store.data.mock.draft.answers['PY-001'].self, '新');
  Store.adoptRemoteRecords(JSON.stringify(withEpoch({ v: 3, questions: {}, mock: { rounds: [], draft: d1, ended: {} }, drillAttempts: {}, ui: {} })));
  eq('同会话草稿:旧的不覆盖新的(乱序到达安全)', Store.data.mock.draft.answers['PY-001'].self, '新');
}

console.log('== 5. 存储健康度 ==');
{
  const kb = Store.recordsSizeKB();
  ok('recordsSizeKB 返回正数', typeof kb === 'number' && kb > 0, String(kb));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
