/* 回归测试:可靠学习记录(问题 A–H 的可重复失败用例)
   这些断言写的是「期望行为」。在 e0adacb 基线上它们应当失败——
   失败即证据:当前源代码确实存在对应缺陷。修复后应全部转绿。
   运行:node tests/regression-tests.js [--evidence]
   --evidence 额外打印原始观测值(修复前/后快照对照用)。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
const EVIDENCE = process.argv.includes('--evidence');

/* ---- 最小浏览器全局桩(与 behavior-tests.js 一致)---- */
global.window = global;
global.document = {
  readyState: 'loading',
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, addEventListener() {} }),
  addEventListener() {}, removeEventListener() {},
  body: { appendChild() {} }
};
function makeLocalStorage() {
  const m = new Map();
  return {
    getItem: k => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (String(v).length > 5 * 1024 * 1024) throw new Error('QuotaExceededError'); m.set(String(k), String(v)); },
    removeItem: k => { m.delete(k); },
    clear: () => m.clear(),
    _dump: () => Object.fromEntries(m)
  };
}
global.localStorage = makeLocalStorage();
global.toast = () => {};
global.URL = URL;
global.Blob = class { constructor(parts) { this.parts = parts; } };
global.location = { hash: '', hostname: 'localhost', protocol: 'http:' };
Object.defineProperty(global, 'navigator', { value: { serviceWorker: null }, configurable: true });
global.HashChangeEvent = class HashChangeEvent { constructor(t) { this.type = t; } };
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.window.APP_DATA = {
  topics: [
    { id: 'python-backend', name: 'Python 与 AI 后端基础', short: 'PY' },
    { id: 'llm-prompt', name: '大模型调用与提示词', short: 'LP' },
    { id: 'rag', name: 'RAG 与检索', short: 'RG' },
    { id: 'agent', name: 'Agent 与工具调用', short: 'AG' },
    { id: 'engineering', name: '工程实践与项目面试', short: 'EN' },
    { id: 'fundamentals', name: 'AI 基础原理', short: 'FD' },
    { id: 'advanced', name: '进阶专题(选学)', short: 'AD' }
  ],
  questions: [],
  paths: { paths: [{ id: 'p1', stages: [{ id: 's1', drills: [
    { id: 'drill-1pred01', stage: 's1', type: '预测', q: '第一题', reference: 'r', reason: '', version: 1 }
  ] }] }] },
  concepts: { concepts: [] },
  projects: { projects: [{ id: 'proj-c-mini-rag', name: '项目C:小型文档问答', goal: '本地检索', expected: '', debug_case: '', deliverable: '', extensions: [] }] }
};
/* 视图层桩:views-review.js 只在函数内引用,这里给最小实现 */
global.Data = {
  allQuestions: () => [],
  question: () => null,
  statusInfo: () => ({ label: '', cls: '' }),
  topicShort: () => '',
  diffLabel: () => '',
  topicName: () => '',
  allDocs: () => [],
  allUserDocs: () => [],
  doc: () => null
};
global.QRender = { badge: () => '' };
global.MockView = { startDirected() {} };
global.go = () => {};
global.modal = () => {};
global.$ = () => null;
global.$$ = () => [];
global.fmtTime = () => '';
global.esc = s => String(s == null ? '' : s);

function load(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInThisContext(src, { filename: file });
}
['app/js/util.js', 'app/js/markdown.js', 'app/js/store.js', 'app/js/search.js', 'app/js/views-review.js'].forEach(load);

/* ---- 断言工具 ---- */
let passed = 0, failed = 0;
const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail === undefined ? '' : '\n    → ' + detail); }
}
function note(label, value) {
  if (EVIDENCE) console.log('    [观测]', label, '=', typeof value === 'string' ? value : JSON.stringify(value));
}
function freshStore() {
  global.localStorage = makeLocalStorage();
  Store.load();
  return Store;
}

/* ===================================================================== */
console.log('\n== 问题 B:恢复规则不确定 / 字段顺序依赖(projectDrafts 字段级合并)==');
{
  /* B-1 更新的备份只能恢复第一个字段,后续字段被静默丢弃,且时间戳被抬高 */
  freshStore();
  Store.data.ui.projectDrafts = {
    'proj-a-model-client': { runOutput: '本地旧输出', updatedAt: 1000, debug: '本地旧定位', todo: '本地旧待办' }
  };
  /* 本地插入顺序复刻真实写入顺序:首字段 → updatedAt → 其余字段 */
  const localKeys = Object.keys(Store.data.ui.projectDrafts['proj-a-model-client']);
  note('本地字段插入顺序', localKeys);

  Store.importFull(JSON.stringify({
    type: 'aiiv-full', v: 1,
    records: {
      questions: {}, mock: { rounds: [] },
      ui: { projectDrafts: { 'proj-a-model-client': { runOutput: '备份新输出', updatedAt: 9000, debug: '备份新定位', todo: '备份新待办' } } }
    },
    questions: [], docs: []
  }));
  const d = Store.data.ui.projectDrafts['proj-a-model-client'];
  note('恢复后的草稿', d);
  ok('B-1 更新的备份:第一个字段被恢复', d.runOutput === '备份新输出', 'runOutput=' + d.runOutput);
  ok('B-1 更新的备份:第二个字段也被恢复', d.debug === '备份新定位', 'debug=' + d.debug + '(仍为本地旧值 → 静默丢弃)');
  ok('B-1 更新的备份:第三个字段也被恢复', d.todo === '备份新待办', 'todo=' + d.todo + '(仍为本地旧值 → 静默丢弃)');
  ok('B-1 未采用内容时不得抬高 updatedAt', d.updatedAt === 9000 ? d.debug === '备份新定位' : true,
     'updatedAt=' + d.updatedAt + ' 但 debug/todo 未被采用 → 混合状态且旧备份此后永远无法恢复');

  /* B-2 用户主动清空的字段被「更旧的备份」复活 */
  freshStore();
  Store.data.ui.projectDrafts = { 'proj-a-model-client': { runOutput: '', updatedAt: 2000, debug: '保留' } };
  Store.importFull(JSON.stringify({
    type: 'aiiv-full', v: 1,
    records: {
      questions: {}, mock: { rounds: [] },
      ui: { projectDrafts: { 'proj-a-model-client': { runOutput: '用户早就删掉的内容', updatedAt: 1000 } } }
    },
    questions: [], docs: []
  }));
  const d2 = Store.data.ui.projectDrafts['proj-a-model-client'];
  note('清空后恢复旧备份', d2);
  ok('B-2 本地更新的明确清空不被旧备份复活', d2.runOutput === '',
     'runOutput=' + JSON.stringify(d2.runOutput) + '(旧备份 updatedAt=1000 < 本地 2000,却仍然复活)');
}

console.log('\n== 问题 C:无 runId 的历史项目运行记录被静默丢弃 ==');
{
  freshStore();
  const r = Store.importFull(JSON.stringify({
    type: 'aiiv-full', v: 1,
    records: {
      questions: {}, mock: { rounds: [] },
      ui: { projectRuns: { 'proj-c-mini-rag': [{ ts: 1, runOutput: '旧版运行记录(无 runId)', debug: '旧版定位' }] } }
    },
    questions: [], docs: []
  }));
  const runs = (Store.data.ui.projectRuns || {})['proj-c-mini-rag'] || [];
  note('恢复的项目运行记录', runs);
  note('importFull 返回统计', r);
  ok('C 无 runId 的旧运行记录必须被保留(可迁移补齐 id)而不是静默丢弃',
     runs.length === 1, '恢复后条数=' + runs.length + ' → 静默丢失,且界面显示「已提交 0 次」');
  /* 幂等性:补齐 runId 后重复导入不得翻倍 */
  Store.importFull(JSON.stringify({
    type: 'aiiv-full', v: 1,
    records: { questions: {}, mock: { rounds: [] },
      ui: { projectRuns: { 'proj-c-mini-rag': [{ ts: 1, runOutput: '旧版运行记录(无 runId)', debug: '旧版定位' }] } } },
    questions: [], docs: []
  }));
  const runs2 = (Store.data.ui.projectRuns || {})['proj-c-mini-rag'] || [];
  ok('C 迁移后重复导入仍幂等', runs2.length === runs.length, '第二次导入后条数=' + runs2.length);
}

console.log('\n== 问题 E-4:「最新一次尝试」按数组顺序而非时间判定 ==');
{
  freshStore();
  /* 数组顺序被导入/合并打乱(先新后旧)——这是 importFull 追加式合并的正常结果 */
  Store.data.drillAttempts = {
    'drill-1pred01': [
      { attemptId: 'at-new', drillId: 'drill-1pred01', status: 'completed', selfRating: 'solved', review: '', updatedAt: 300, ts: 300 },
      { attemptId: 'at-old', drillId: 'drill-1pred01', status: 'completed', selfRating: 'unsolved', review: '旧的误解原因', updatedAt: 100, ts: 100 }
    ]
  };
  const list = ReviewView.getUnsolvedDrills();
  note('待消化专项队列', list);
  ok('E-4 最新一次自评是「已解决」时不得进入待消化队列',
     list.length === 0, '队列条数=' + list.length + ' → 取到了数组末位(旧记录),把已解决的问题又拎回来');

  /* 反向:真正未解决的在最新 → 必须在队列里 */
  Store.data.drillAttempts['drill-1pred01'] = [
    { attemptId: 'at-old2', drillId: 'drill-1pred01', status: 'completed', selfRating: 'solved', updatedAt: 100, ts: 100 },
    { attemptId: 'at-new2', drillId: 'drill-1pred01', status: 'completed', selfRating: 'unsolved', review: '仍未理解', updatedAt: 300, ts: 300 }
  ];
  const list2 = ReviewView.getUnsolvedDrills();
  ok('E-4 最新一次确实未解决时必须进入队列', list2.length === 1, '队列条数=' + list2.length);
}

console.log('\n== 问题 F:个人项目运行/排查记录不可检索 ==');
{
  freshStore();
  Store.data.ui.projectRuns = { 'proj-c-mini-rag': [{ runId: 'rc-1', ts: 1, runOutput: '召回排序踩坑唯一标记', debug: '定位过程唯一标记' }] };
  Store.data.ui.projectDrafts = { 'proj-c-mini-rag': { runOutput: '草稿里的唯一标记草稿', updatedAt: 1 } };
  Search.build({
    questions: [], docs: [], userDocs: [], concepts: [], drills: [], drillAttempts: {},
    projects: (window.APP_DATA.projects && window.APP_DATA.projects.projects) || [],
    records: Store.data
  });
  const hitRun = Search.query('召回排序踩坑唯一标记');
  const hitDraft = Search.query('草稿里的唯一标记草稿');
  note('检索项目运行记录命中数', hitRun.length);
  note('检索项目草稿命中数', hitDraft.length);
  ok('F 已保存的项目运行记录可被全文检索到', hitRun.length >= 1, '命中 0 条 → 用户保存的证据搜不到');
  ok('F 项目草稿可被全文检索到', hitDraft.length >= 1, '命中 0 条 → 未提交的草稿搜不到');
}

console.log('\n== 问题 H-1:测试中的恒真断言 ==');
{
  const src = fs.readFileSync(path.join(ROOT, 'tests/behavior-tests.js'), 'utf8');
  const vacuous = (src.match(/\|\|\s*true\b/g) || []);
  const lineHits = src.split('\n').map((l, i) => [i + 1, l]).filter(([, l]) => /\|\|\s*true\b/.test(l));
  note('恒真断言所在行', lineHits.map(([n]) => n));
  ok('H-1 断言不得恒真(形如 `... || true`)', vacuous.length === 0,
     vacuous.length + ' 处恒真断言:' + lineHits.map(([n, l]) => `L${n} ${l.trim().slice(0, 60)}`).join(' | '));
  /* 把那条断言换成真实语义:两次恢复后 projectRuns 不翻倍 */
  freshStore();
  const full = JSON.stringify({
    type: 'aiiv-full', v: 1,
    records: { questions: {}, mock: { rounds: [] },
      ui: { projectRuns: { 'proj-a-model-client': [{ runId: 'ra-1', ts: 1, runOutput: 'A运行' }] } } },
    questions: [], docs: []
  });
  Store.importFull(full);
  const n1 = ((Store.data.ui.projectRuns || {})['proj-a-model-client'] || []).length;
  Store.importFull(full);
  const n2 = ((Store.data.ui.projectRuns || {})['proj-a-model-client'] || []).length;
  ok('H-1 真实语义:重复完整恢复后运行记录不翻倍', n1 === 1 && n2 === 1, `首次=${n1} 二次=${n2}`);
}

console.log('\n== 问题 H-2:清空记录后检索索引未失效(搜得到已清空的数据)==');
{
  freshStore();
  Store.data.questions = {};
  Store.rec('PY-001').note = '清空前笔记唯一标记';
  Store.data.drillAttempts = { 'drill-1pred01': [{ attemptId: 'at-x', drillId: 'drill-1pred01', status: 'completed', myAnswer: '清空前尝试唯一标记', updatedAt: 1 }] };
  const ctx = () => ({
    questions: [], docs: [], userDocs: [], concepts: [], drills: [], drillAttempts: Store.data.drillAttempts,
    projects: [], records: Store.data
  });
  Search.build(ctx());
  const before = Search.query('清空前笔记唯一标记').length + Search.query('清空前尝试唯一标记').length;
  note('清空前命中数', before);
  ok('H-2 前置:清空前确实可检索到', before >= 1, '命中 ' + before);

  /* 复刻维护页「清空全部记录」处理器:仅 Store.clearAll(),没有重建索引 */
  Store.clearAll();
  const after = Search.query('清空前笔记唯一标记').length + Search.query('清空前尝试唯一标记').length;
  note('清空后(未重建索引)命中数', after);
  ok('H-2 清空全部记录后检索不得再返回已清空的数据', after === 0,
     '仍命中 ' + after + ' 条 → 清空后搜索还能搜出已删笔记/尝试,点进去是空的');
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed) console.log('失败项(基线缺陷证据):\n  - ' + failures.join('\n  - '));
process.exit(failed ? 1 : 0);
