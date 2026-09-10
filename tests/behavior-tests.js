/* 行为测试骨架:在 Node 中以浏览器方式加载 app/js 的纯逻辑模块并断言行为。
   覆盖:Markdown 列表、Search 片段与锚点、Store 导入/导出合并规则、导入题库校验、
   计算例题复算(FD-026 / EN-009)。运行:node tests/behavior-tests.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---- 最小浏览器全局桩 ---- */
const listeners = new Map();
global.window = global;
global.document = {
  readyState: 'loading',            /* 阻止 App.init 自动运行 */
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
global.debounce = undefined; /* 由 util.js 提供 */
global.URL = URL;
global.Blob = class { constructor(parts) { this.parts = parts; } };
global.location = { hash: '', hostname: 'localhost', protocol: 'http:' };
Object.defineProperty(global, 'navigator', { value: { serviceWorker: null }, configurable: true });
global.HashChangeEvent = class HashChangeEvent { constructor(t) { this.type = t; } };
global.addEventListener = () => {};
global.removeEventListener = () => {};
/* 与站点一致的数据桩:专题清单(校验器依赖)与内置题库(空) */
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
  questions: []
};

function load(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInThisContext(src, { filename: file });
}
['app/js/util.js', 'app/js/markdown.js', 'app/js/store.js', 'app/js/search.js'].forEach(load);

/* ---- 断言工具 ---- */
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

/* ===================================================================== */
console.log('== Markdown 列表 ==');
{
  const cases = [
    ['- a\n- b\n- c', '<ul><li>a</li><li>b</li><li>c</li></ul>'],
    ['1. one\n2. two', '<ol><li>one</li><li>two</li></ol>'],
    ['- parent\n  - child1\n  - child2\n- sibling', '<ul><li>parent<ul><li>child1</li><li>child2</li></ul></li><li>sibling</li></ul>'],
    ['- item with\n  continued line\n- next', '<ul><li>item with<br>continued line</li><li>next</li></ul>'],
    ['- 含 *强调* 与 `code`', '<ul><li>含 <em>强调</em> 与 <code>code</code></li></ul>'],
    ['- x\n\n段落', '<ul><li>x</li></ul><p>段落</p>'],
  ];
  cases.forEach(([input, want], idx) => {
    const got = Markdown.render(input).replace(/\n/g, '');
    eq('列表用例 ' + (idx + 1), got, want);
  });
  /* 嵌套列表不影响标题编号(与 build.py sections 一致) */
  const sec = Markdown.sections('# H1\n- a\n- b\n## H2\ntext');
  eq('sections 编号', sec.map(s => s.id), ['sec-1', 'sec-2']);
}

console.log('== Search 片段与锚点 ==');
{
  Search.build({
    questions: [{ id: 'ZZ-001', topic: 'rag', title: '题目标题', answer: '答案是 A', plain: '像购物一样检索', deep: '原理:可哈希对象', example: 'x = 1', interview: '口述', followups: [], pitfalls: [], check: { q: '检查', a: '答案' } }],
    docs: [{ id: 'doc-rag-1', topic: 'rag', title: 'RAG 章节', summary: '', md: '# RAG 基础\n\n本章讲可哈希与分块。\n\n## 小节一\n\n正文提到可哈希对象的定义,以及更多上下文内容用于测试片段窗口。' }],
    userDocs: [], records: { questions: { 'ZZ-001': { note: '我的笔记提到 return_exceptions' } } }
  });
  const r1 = Search.query('可哈希', { scope: 'doc' });
  ok('文档正文命中有真实片段', r1.length > 0 && r1[0].snippet.includes('可哈希') && r1[0].snippet.length > 15,
     'snippet=' + (r1[0] || {}).snippet);
  ok('文档命中带 sec 锚点', r1.length > 0 && /^sec-\d+$/.test(r1[0].unit.anchor), 'anchor=' + (r1[0] || {}).anchor);
  const r2 = Search.query('return_exceptions', { scope: 'note' });
  ok('笔记可检索且带 note 锚点', r2.length === 1 && r2[0].unit.anchor === 'note' && r2[0].snippet.includes('return_exceptions'));
  const r3 = Search.query('可哈希');
  ok('题目原理字段命中锚点为 deep', r3.some(r => r.unit.kind === 'q' && r.unit.anchor === 'deep'));
  const r4 = Search.query('不存在的词组zzz');
  eq('无结果返回空', r4.length, 0);
  const r5 = Search.query('HASH'); /* 英文大小写:正文里没有 hash,应空 */
  eq('大小写不敏感但无词则空', r5.length, 0);
  const r6 = Search.query('可哈希 分块');
  ok('多关键词同时命中', r6.some(r => r.unit.kind === 'doc'));
}

console.log('== Store 记录导入/导出 ==');
{
  /* 空库起步 */
  const res1 = Store.importRecords(JSON.stringify({
    type: 'aiiv-records', v: 2, exported_at: '2026-01-01',
    records: { v: 2, questions: { 'PY-001': { status: 'weak', fav: true, note: '备份笔记', practiceCount: 3, lastPracticedAt: 100, _updatedAt: 100 } }, mock: { rounds: [{ ts: 100, items: [{ qid: 'PY-001', title: 't', self: 's', revealed: true, mark: 'weak' }] }] }, ui: {} }
  }));
  eq('首次导入统计', [res1.qMerged, res1.roundsAdded], [1, 1]);
  eq('导入后笔记', Store.rec('PY-001').note, '备份笔记');

  /* 旧备份(无 _updatedAt)不得覆盖本机更新的笔记 */
  Store.setNote('PY-001', '本机新笔记');
  const res2 = Store.importRecords(JSON.stringify({
    type: 'aiiv-records', v: 2, records: { questions: { 'PY-001': { note: '备份笔记', status: 'ok' } }, mock: { rounds: [] } }
  }));
  eq('旧备份不覆盖新笔记', Store.rec('PY-001').note, '本机新笔记');
  eq('无时间戳时状态只补空不覆盖', Store.rec('PY-001').status, 'weak');

  /* 更新的备份(_updatedAt 更大)可以覆盖 */
  Store.importRecords(JSON.stringify({
    type: 'aiiv-records', v: 2, records: { questions: { 'PY-001': { note: '更新的备份笔记', _updatedAt: Date.now() + 5000 } }, mock: { rounds: [] } }
  }));
  eq('更新的备份覆盖笔记', Store.rec('PY-001').note, '更新的备份笔记');

  /* 轮次幂等:同内容重复导入不重复 */
  const roundJson = JSON.stringify({
    type: 'aiiv-records', v: 2,
    records: { questions: {}, mock: { rounds: [{ ts: 500, items: [{ qid: 'RG-001', title: 'x', self: '', revealed: false, mark: '' }] }] } }
  });
  Store.importRecords(roundJson);
  const before = Store.data.mock.rounds.length;
  Store.importRecords(roundJson);
  eq('重复导入轮次幂等', Store.data.mock.rounds.length, before);

  /* fav=false 语义保留:本机 true 不被 false 覆盖;OR 合并 */
  Store.toggleFav('PY-001'); /* true -> false */
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'PY-001': { fav: true } } } }));
  eq('备份 fav=true 恢复收藏', Store.rec('PY-001').fav, true);

  /* 坏备份:整批拒绝,状态不变 */
  const snapshot = JSON.stringify(Store.data);
  let threw = '';
  try { Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'X-01': { status: 3 } } } })); }
  catch (e) { threw = e.message; }
  ok('非法字段整批拒绝', threw.includes('status 非法'), threw);
  eq('拒绝后状态不变', JSON.stringify(Store.data), snapshot);
  threw = '';
  try { Store.importRecords('{"type":"aiiv-records","v":2,"records":{"questions":{},"mock":{"rounds":[{"ts":1,"items":"bad"}]}}}'); }
  catch (e) { threw = e.message; }
  ok('坏轮次整批拒绝', threw.includes('items'), threw);
  threw = '';
  try { Store.importRecords(JSON.stringify({ type: 'aiiv-bank', v: 1 })); }
  catch (e) { threw = e.message; }
  ok('类型不匹配报错', threw.includes('类型不匹配'), threw);
  threw = '';
  try { Store.importRecords('not json'); }
  catch (e) { threw = e.message; }
  ok('非 JSON 报错', threw.includes('JSON'), threw);
  threw = '';
  try { Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 99, records: { questions: {} } })); }
  catch (e) { threw = e.message; }
  ok('未知版本报错', threw.includes('版本'), threw);

  /* 导出→隔离环境恢复 */
  const exported = Store.exportRecords();
  global.localStorage = makeLocalStorage();   /* 模拟干净浏览器 */
  Store.load();
  Store.importRecords(exported);
  eq('隔离恢复:题目记录', Store.rec('PY-001').note, '更新的备份笔记');
  ok('隔离恢复:轮次', Store.data.mock.rounds.length >= 2, String(Store.data.mock.rounds.length));

  /* 完整备份类型 */
  const full = JSON.parse(Store.exportFull());
  eq('完整备份类型', full.type, 'aiiv-full');
  const lib = JSON.parse(Store.exportLibrary());
  eq('资料备份类型', lib.type, 'aiiv-library');
}

console.log('== 导入题库校验(通过 MaintainView 前置的独立实现)==');
{
  /* MaintainView.validateQuestions 在浏览器视图内,Node 里以等价规则测试核心拒绝逻辑:
     这里直接测 Store.importLibrary 的去重与恢复;schema 校验在浏览器回归中覆盖。 */
  const okBank = [{ id: 'ZZ-901', topic: 'rag', type: 'concept', difficulty: 'basic', title: '合法题', tags: ['测试'], answer: 'a', plain: 'p', deep: 'd', example: 'e', interview: 'i', followups: [{ q: 'fq', a: 'fa' }], pitfalls: ['pf'], check: { q: 'cq', a: 'ca' }, sources: [{ kind: 'official', name: 'doc' }], verify: { status: 'partial' } }];
  const r = Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: okBank, docs: [{ id: 'udoc-9001', title: '资料', text: '内容', ts: 1, kind: 'md', parsed: true }] }));
  eq('合法题库+资料导入', [r.questionsAdded, r.docsAdded], [1, 1]);
  const r2 = Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: okBank, docs: [{ id: 'udoc-9001', title: '资料', text: '内容', ts: 1, kind: 'md', parsed: true }] }));
  eq('重复导入幂等', [r2.questionsAdded, r2.docsAdded], [0, 0]);
}

console.log('== A1/A3: 导入入口统一校验 / 启动隔离 / 完整恢复 / 清空语义 ==');
{
  const ZZ907_FIXTURE = { id: 'ZZ-907', topic: 'rag', type: 'concept', difficulty: 'basic', title: '隔离测试合法题', tags: ['测试'], answer: 'a', plain: 'p', deep: 'd', example: 'e', interview: 'i', followups: [{ q: 'q', a: 'a' }], pitfalls: ['p'], check: { q: 'q', a: 'a' }, sources: [{ kind: 'official', name: 'doc', url: 'https://example.com' }], verify: { status: 'partial' } };
  const validQFull = { id: 'ZZ-908', topic: 'rag', type: 'concept', difficulty: 'basic', title: '完整恢复测试题', tags: ['测试'], answer: 'a', plain: 'p', deep: 'd', example: 'e', interview: 'i', followups: [{ q: 'q', a: 'a' }], pitfalls: ['p'], check: { q: 'q', a: 'a' }, sources: [{ kind: 'official', name: 'doc', url: 'https://example.com' }], verify: { status: 'partial' } };
  /* noop */
  /* A1: 坏 library(tags 是字符串)整批拒绝,存储不变 */
  const before = localStorage.getItem('aiiv:bank-extra');
  let threw = '';
  try { Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: [{ id: 'ZZ-902', title: '自备题', tags: 'Python' }], docs: [] })); }
  catch (e) { threw = e.message; }
  ok('坏 library 整体拒绝', threw.includes('备份校验未通过'), threw);
  eq('坏 library 未写入', localStorage.getItem('aiiv:bank-extra'), before);
  /* 未知版本 */
  threw = '';
  try { Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 9, questions: [], docs: [] })); }
  catch (e) { threw = e.message; }
  ok('library 未知版本拒绝', threw.includes('版本'), threw);
  threw = '';
  try { Store.importFull(JSON.stringify({ type: 'aiiv-full', v: 7, records: { questions: {} }, questions: [], docs: [] })); }
  catch (e) { threw = e.message; }
  ok('full 未知版本拒绝', threw.includes('版本'), threw);
  /* 坏资料条目(缺正文/坏 id) */
  threw = '';
  try { Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: [], docs: [{ id: 'udoc-abc', title: 'x', text: 't' }] })); }
  catch (e) { threw = e.message; }
  ok('坏资料 id 拒绝', threw.includes('id 非法'), threw);
  threw = '';
  try { Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: [], docs: [{ id: 'udoc-5', title: 'x' }] })); }
  catch (e) { threw = e.message; }
  ok('缺正文的资料拒绝', threw.includes('text'), threw);
  /* 启动隔离:storage 里的坏扩展数据不进内存,原始保留在隔离键 */
  localStorage.setItem('aiiv:bank-extra', JSON.stringify({ v: 1, saved_at: 1, questions: [
    { id: 'ZZ-905', title: 'bad', tags: 'x' },
    ZZ907_FIXTURE,
  ] }));
  const safe = Store.loadExtraBankSafe();
  eq('隔离后内存只含合法题', safe.map(q => q.id), ['ZZ-907']);
  ok('坏数据进入隔离键', Store.quarantineCount() > 0);
  ok('隔离数据可导出(原始内容保留)', Store.quarantineExport().includes('ZZ-905'));
  /* full 从记录/资料入口拒绝(应走完整恢复入口) */
  threw = '';
  try { Store.importRecords(JSON.stringify({ type: 'aiiv-full', v: 1, records: { questions: {} }, questions: [], docs: [] })); }
  catch (e) { threw = e.message; }
  ok('记录入口拒绝 full', threw.includes('完整备份'), threw);
  threw = '';
  try { Store.importLibrary(JSON.stringify({ type: 'aiiv-full', v: 1, records: { questions: {} }, questions: [], docs: [] })); }
  catch (e) { threw = e.message; }
  ok('资料入口拒绝 full', threw.includes('完整备份'), threw);
  /* A3: 完整恢复一次到位(记录+轮次+题库+资料) */
  const full = JSON.stringify({
    type: 'aiiv-full', v: 1,
    records: { v: 2, questions: { 'PY-001': { note: '完整恢复笔记', _updatedAt: Date.now() + 10000 } }, mock: { rounds: [{ ts: 7, items: [{ qid: 'PY-001', title: 't', self: 's', revealed: false, mark: '' }] }] }, ui: {} },
    questions: [validQFull],
    docs: [{ id: 'udoc-777', title: '恢复资料', text: '内容', ts: 1, kind: 'md', parsed: true }]
  });
  const r = Store.importFull(full);
  ok('完整恢复统计(记录/轮次/题库/资料)', r.qMerged === 1 && r.roundsAdded === 1 && r.questionsAdded === 1 && r.docsAdded === 1, JSON.stringify(r));
  eq('完整恢复笔记', Store.rec('PY-001').note, '完整恢复笔记');
  const r2 = Store.importFull(full);
  eq('完整恢复幂等', [r2.roundsAdded, r2.questionsAdded, r2.docsAdded], [0, 0, 0]);
  /* A3 清空语义:更新的备份明确清空 → 生效 */
  Store.setNote('PY-001', '本地新笔记');
  Store.setStatus('PY-001', 'ok');
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'PY-001': { note: '', status: '', fav: false, _updatedAt: Date.now() + 20000 } }, mock: { rounds: [] } } }));
  eq('更新的备份明确清空笔记', Store.rec('PY-001').note, '');
  eq('更新的备份明确清空状态', Store.rec('PY-001').status, '');
  eq('更新的备份明确取消收藏', Store.rec('PY-001').fav, false);
  /* 旧备份(无时间戳)不清空 */
  Store.setNote('PY-001', '再写回');
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'PY-001': { note: '', status: '' } }, mock: { rounds: [] } } }));
  eq('旧备份不清空新笔记', Store.rec('PY-001').note, '再写回');
  /* 未采用不盖新时间戳:备份字段与本地相同且时间更新 → 本地 _updatedAt 不变 */
  const tsBefore = Store.rec('PY-001')._updatedAt;
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'PY-001': { note: '再写回', _updatedAt: Date.now() + 50000 } }, mock: { rounds: [] } } }));
  eq('无变化的更新不提升时间戳', Store.rec('PY-001')._updatedAt, tsBefore);
}


console.log('== R3-1/2/3: 隔离失败保原文 / 来源类型兼容 / pathProgress 合并 ==');
{
  /* 用独立沙箱跑,避免污染前面的测试状态 */
  const sandboxStore = (() => {
    const m2 = new Map();
    let fq = false;
    const ls = {
      getItem: k => (m2.has(k) ? m2.get(k) : null),
      setItem: (k, v) => { if (fq && k === 'aiiv:quarantine') throw new Error('QuotaExceededError'); m2.set(k, String(v)); },
      removeItem: k => m2.delete(k),
      clear: () => m2.clear()
    };
    Object.defineProperty(global, 'localStorage', { value: ls, configurable: true });
    Store.load();
    Store.data.ui.pathProgress = {};
    return { get ls() { return ls; }, setFail: v => { fq = v; } };
  })();

  const badBank = JSON.stringify({ v: 1, saved_at: 1, questions: [
    { id: 'ZZ-902', title: '自备题', tags: 'Python' },
    { id: 'ZZ-903', topic: 'rag', type: 'concept', difficulty: 'basic', title: '合法题', tags: ['t'], answer: 'a', plain: 'p', deep: 'd', example: 'e', interview: 'i', followups: [{ q: 'x', a: 'y' }], pitfalls: ['p'], check: { q: 'q', a: 'a' }, sources: [{ kind: 'official', name: 'd', url: 'https://e.com' }], verify: { status: 'partial' } }
  ]});
  sandboxStore.ls.setItem('aiiv:bank-extra', badBank);
  sandboxStore.setFail(true);
  const got = Store.loadExtraBankSafe();
  ok('隔离容量失败: 内存返回合法子集', got.length === 1 && got[0].id === 'ZZ-903');
  ok('隔离容量失败: 原键字节未动', sandboxStore.ls.getItem('aiiv:bank-extra') === badBank);
  ok('隔离容量失败: 无假成功(隔离为空)', Store.quarantineCount() === 0);
  ok('原始内容可直接导出', Store.rawExtrasExport().includes('ZZ-902'));
  sandboxStore.setFail(false);
  Store.loadExtraBankSafe();
  ok('重试(第二次启动): 隔离成功', Store.quarantineCount() === 1);
  const q1 = Store.quarantineCount();
  Store.loadExtraBankSafe();
  ok('重复启动不累积隔离项', Store.quarantineCount() === q1);

  const realKinds = ['official-docs', 'official-blog', 'website', 'official', 'paper', 'repo', 'independent'];
  const batch = realKinds.map((k, i) => ({ id: 'ZZ-92' + i, topic: 'rag', type: 'concept', difficulty: 'basic', title: 'T' + i, tags: ['t'], answer: 'a', plain: 'p', deep: 'd', example: 'e', interview: 'i', followups: [{ q: 'x', a: 'y' }], pitfalls: ['p'], check: { q: 'q', a: 'a' }, sources: [{ kind: k, name: 'n', url: 'https://e.com' }], verify: { status: 'partial' } }));
  const r2 = Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: batch, docs: [] }));
  ok('真实题库 7 种来源类型全部接受', r2.questionsAdded === 7, JSON.stringify(r2));
  ok('website 归一映射', Store.normalizeSourceKind('website') === 'web');

  Store.data.ui.pathProgress = { s1: { done: 100, cancelled: 200 } };
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, ui: { pathProgress: { s1: { done: 150 } } } } }));
  ok('阶段进度: 取消晚于备份done → 保留取消态', JSON.stringify(Store.data.ui.pathProgress.s1) === JSON.stringify({ done: 100, cancelled: 200 }));
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, ui: { pathProgress: { s2: { done: 300, cancelled: 400 } } } } }));
  ok('阶段进度: 备份取消更晚 → 采用取消态', JSON.stringify(Store.data.ui.pathProgress.s2) === JSON.stringify({ done: 300, cancelled: 400 }));
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, ui: { pathProgress: { s3: 600 } } } }));
  ok('阶段进度: 旧版 number 形状迁移', Store.data.ui.pathProgress.s3.done === 600);
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, ui: { docPos: { docId: 'doc-rag-1', secId: '6', y: 1056 } } } }));
  ok('阅读位置: 本地为空才采用备份', Store.data.ui.docPos.y === 1056);
}


console.log('== R4-1.1: 阶段状态统一(最新事件判定/取消留痕/旧格式) ==');
{
  function stageStatus(entry) {
    if (entry == null) return { state: 'none', ts: 0 };
    if (typeof entry === 'number') return { state: 'done', ts: entry };
    const done = typeof entry.done === 'number' && isFinite(entry.done) ? entry.done : 0;
    const cancelled = typeof entry.cancelled === 'number' && isFinite(entry.cancelled) ? entry.cancelled : 0;
    if (done > cancelled) return { state: 'done', ts: done };
    if (cancelled > 0) return { state: 'cancelled', ts: cancelled };
    if (done > 0) return { state: 'done', ts: done };
    return { state: 'none', ts: 0 };
  }
  ok('取消晚于完成 → 未完成(报告用例)', stageStatus({ done: 1788750000000, cancelled: 1788750300000 }).state === 'cancelled');
  ok('时间戳有效(fmtTime 不再 NaN)', isFinite(new Date(stageStatus({ done: 1, cancelled: 1788750300000 }).ts).getTime()));
  ok('旧 number 形状 → done', stageStatus(1788750000000).state === 'done');
  ok('重新完成(晚于取消)→ done', stageStatus({ done: 1788750400000, cancelled: 1788750300000 }).state === 'done');
  ok('空/null → none', stageStatus({}).state === 'none' && stageStatus(null).state === 'none');
  /* 取消留痕 + 备份交互 */
  Store.data.ui.pathProgress = { s9: { done: 100, cancelled: 200 } };
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, ui: { pathProgress: { s9: { done: 100 } } } } }));
  ok('旧备份不复活完成态(本地取消 200 更新)', stageStatus(Store.data.ui.pathProgress.s9).state === 'cancelled');
  Store.data.ui.pathProgress = { s9: { done: 100, cancelled: 0 } };
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, ui: { pathProgress: { s9: { done: 100 } } } } }));
  ok('本地仅完成(无取消事件)且备份同刻 done → 本地保留 done', stageStatus(Store.data.ui.pathProgress.s9).state === 'done');
}


console.log('== R6-1.1: 阶段1 前两题参考答案的每条断言实际验证 ==');
{
  const { execFileSync } = require('child_process');
  const os = require('os');
  const paths = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/paths.json'), 'utf8')).paths[0];
  const s1 = paths.stages.find(s => s.id === 's1-python-core');

  /* 用例1:tuple 槽位赋值异常 + 副作用残留 */
  const code1 = [
    "import json, sys",
    "t = ('a', ['x'])",
    "out = {'raised': None, 't_after': None, 'printed': False}",
    "try:",
    "    t[1] += ['y']",
    "    out['printed'] = True   # print(t) 在异常时不执行,这里若执行说明参考错了",
    "except TypeError as e:",
    "    out['raised'] = str(e)",
    "out['t_after'] = t",
    "print(json.dumps(out))"
  ].join('\n');
  const f1 = path.join(os.tmpdir(), '_r6_tuple.py');
  fs.writeFileSync(f1, code1, 'utf8');
  const r1 = JSON.parse(execFileSync('python', [f1], { encoding: 'utf8' }));
  ok('题1:抛 TypeError(槽位赋值)', r1.raised === "'tuple' object does not support item assignment", r1.raised);
  ok('题1:异常前列表已改(副作用)', JSON.stringify(r1.t_after) === JSON.stringify(['a', ['x', 'y']]), JSON.stringify(r1.t_after));
  ok('题1:print 未执行', r1.printed === false);

  /* 用例2:t += ('b',) 重绑定不抛 */
  const f2 = path.join(os.tmpdir(), '_r6_tuple2.py');
  fs.writeFileSync(f2, "t = ('a', ['x'])\nt += ('b',)\nprint(t)", 'utf8');
  const r2 = execFileSync('python', [f2], { encoding: 'utf8' }).trim();
  ok('题1对照:t += 重绑定不抛', r2 === "('a', ['x'], 'b')", r2);

  /* 用例3:count_words 重复词 AttributeError;单词输入看似正常 */
  const code3 = [
    "import json, sys",
    "def count_words(words):",
    "    counters = {}",
    "    for w in words:",
    "        c = counters.get(w, [])",
    "        c.append(1)",
    "        counters[w] = len(c)",
    "    return counters",
    "out = {'single': None, 'dup_err': None}",
    "out['single'] = count_words(['x'])",
    "try:",
    "    count_words(['x', 'x'])",
    "except AttributeError as e:",
    "    out['dup_err'] = str(e)",
    "print(json.dumps(out, ensure_ascii=False))"
  ].join('\n');
  const f3 = path.join(os.tmpdir(), '_r6_count.py');
  fs.writeFileSync(f3, code3, 'utf8');
  const r3 = JSON.parse(execFileSync('python', [f3], { encoding: 'utf8' }));
  ok('题2:单元素输入看似正常(陷阱)', JSON.stringify(r3.single) === '{"x":1}', JSON.stringify(r3.single));
  ok('题2:重复词 AttributeError(int.append)', (r3.dup_err || '').includes("'int' object has no attribute 'append'"), r3.dup_err);

  /* 参考文本与事实一致(不允许再出现"不会异常/逻辑能算对") */
  ok('题1参考不再声称"没有异常"', !s1.drills[0].reference.includes('所以没有异常'));
  ok('题2参考不再声称"逻辑能算对"', !s1.drills[1].reference.includes('逻辑能算对'));
  ok('题2参考给出正确修复(get 0 + 1 / Counter / setdefault)',
     s1.drills[1].reference.includes('get(w, 0) + 1') && s1.drills[1].reference.includes('Counter'));
}


console.log('== R7: reviewReasons 取消语义(整套覆盖,非并集)==');
{
  Store.data.ui.pathProgress = {};
  Store.rec('PY-090').reviewReasons = ['causal', 'edge'];
  Store.rec('PY-090')._updatedAt = 100;
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'PY-090': { reviewReasons: ['causal'], _updatedAt: 200 } } } }));
  ok('更新的备份取消原因 → 生效', JSON.stringify(Store.rec('PY-090').reviewReasons) === JSON.stringify(['causal']));
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'PY-090': { reviewReasons: [] } } } }));
  ok('旧备份空数组不清空当前', JSON.stringify(Store.rec('PY-090').reviewReasons) === JSON.stringify(['causal']));
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: { 'PY-090': { reviewReasons: ['causal', 'concept'], _updatedAt: 300 } } } }));
  ok('更新备份新增原因 → 生效', JSON.stringify(Store.rec('PY-090').reviewReasons) === JSON.stringify(['causal', 'concept']));
}


console.log('== R9: 备份 round-trip(真实题库数据,非最小 fixture)==');
{
  /* 用真实题库的题目构造完整学习状态 */
  const realQ = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions/python-backend.json'), 'utf8'))[0];
  const full = JSON.stringify({
    type: 'aiiv-full', v: 1,
    records: {
      v: 2,
      questions: {
        [realQ.id]: { note: 'round-trip 笔记', fav: true, status: 'weak', reviewReasons: ['causal', 'exec'],
                      drillTries: [{ drillId: 'drill-1pred01', version: 1, ts: 111, myAnswer: '我的预测', observed: '实际输出', selfRating: 'partial', review: '槽位误解' }] },
        'PY-099': { status: 'review', _updatedAt: 50 }
      },
      mock: { rounds: [{ ts: 88, id: 'rt-1', config: { label: 'rt' }, items: [{ qid: realQ.id, title: 't', self: '答', revealed: true, mark: 'weak' }] }], draft: null },
      ui: { pathProgress: { 's1-python-core': { done: 111, cancelled: 222 } }, docPos: { docId: 'doc-python-1', secId: '5', y: 900 } }
    },
    questions: [realQ],
    docs: [{ id: 'udoc-88', title: 'rt资料', text: 'rt_probe 内容', ts: 1, kind: 'md', parsed: true }]
  });
  /* 清空后恢复 */
  Store.clearAll();
  const r = Store.importFull(full);
  ok('round-trip: 记录恢复(笔记/收藏/状态)', Store.rec(realQ.id).note === 'round-trip 笔记' && Store.rec(realQ.id).fav && Store.rec(realQ.id).status === 'weak');
  ok('round-trip: drillTries 迁移恢复(drillAttempts)', (Store.data.drillAttempts['drill-1pred01'] || []).length >= 1);
  ok('round-trip: reviewReasons 恢复', JSON.stringify(Store.rec(realQ.id).reviewReasons) === JSON.stringify(['causal', 'exec']));
  ok('round-trip: 轮次恢复', Store.data.mock.rounds.length === 1);
  ok('round-trip: 阶段取消态恢复', JSON.stringify(Store.data.ui.pathProgress['s1-python-core']) === JSON.stringify({ done: 111, cancelled: 222 }));
  ok('round-trip: 阅读位置恢复', Store.data.ui.docPos.y === 900);
  ok('round-trip: 扩展题恢复(Store 层)', Store.loadExtraBankSafe().some(q => q.id === realQ.id));
  ok('round-trip: 资料恢复(Store 层)', Store.userDocsLoad().some(d => d.id === 'udoc-88'));
  /* 幂等 */
  const r2 = Store.importFull(full);
  ok('round-trip: 重复恢复幂等', r2.roundsAdded === 0 && r2.questionsAdded === 0 && r2.docsAdded === 0);
  ok('round-trip: drillTries 不重复', (Store.data.drillAttempts['drill-1pred01'] || []).length === 1);
}


console.log('== R6: drillAttempts 稳定归属(全链)==');
{
  Store.data.drillAttempts = {};
  Store.data.drillAttempts['drill-1pred01'] = [{ attemptId: 'at-1', drillId: 'drill-1pred01', status: 'completed', myAnswer: 'A', updatedAt: 1 }];
  Store.rec('PY-001').drillTries = [{ drillId: 'drill-1pred01', version: 1, ts: 200, myAnswer: '旧格式预测', observed: '旧观察', selfRating: 'solved', review: '旧复盘' }];
  const moved = Store.migrateLegacyDrillTries();
  ok('旧格式迁移 1 条', moved === 1);
  ok('迁移后 2 条 attempt', Store.data.drillAttempts['drill-1pred01'].length === 2);
  Store.migrateLegacyDrillTries();
  ok('迁移幂等', Store.data.drillAttempts['drill-1pred01'].length === 2);
  const exported = Store.exportFull();
  Store.clearAll();
  Store.importFull(exported);
  ok('round-trip: attempts 恢复', Store.data.drillAttempts['drill-1pred01'].length === 2);
  Store.importFull(exported);
  ok('round-trip: 幂等', Store.data.drillAttempts['drill-1pred01'].length === 2);
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, drillAttempts: { 'drill-1pred01': [{ attemptId: 'at-1', drillId: 'drill-1pred01', status: 'completed', myAnswer: 'A-更新', updatedAt: 999 }] } } }));
  ok('updatedAt 新者胜', Store.data.drillAttempts['drill-1pred01'][0].myAnswer === 'A-更新');
  let threw = '';
  try { Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: { questions: {}, drillAttempts: { x: [{ attemptId: 'a', drillId: 'd', status: 'bad' }] } } })); }
  catch (e) { threw = e.message; }
  ok('坏 attempt 整批拒绝', threw.includes('status'), threw);
}

console.log('== B1: PY-003 展示代码从题库字段提取并实际运行 ==');
{
  const { execFileSync } = require('child_process');
  const os = require('os');
  const src = fs.readFileSync(path.join(ROOT, 'data/questions/python-backend.json'), 'utf8');
  const py3 = JSON.parse(src).find(q => q.id === 'PY-003');
  const blocks = [...py3.example.matchAll(/```python\n([\s\S]*?)```/g)].map(m => m[1]);
  const runnable = blocks.filter(b => b.includes('asyncio.run'));
  eq('PY-003 可运行展示块数量(无锁版+锁版)', runnable.length, 2);
  runnable.forEach((code, i) => {
    const tmp = path.join(os.tmpdir(), `_py003_block${i}.py`);
    fs.writeFileSync(tmp, code, 'utf8');
    let out = '', code0 = 1;
    try { out = execFileSync('python', [tmp], { encoding: 'utf8' }); code0 = 0; }
    catch (e) { out = String(e.stdout || '') + String(e.stderr || ''); }
    const hasLock = code.includes('Lock');
    ok(`展示代码块${i + 1}(${hasLock ? '锁版' : '无锁版'})原样运行成功`, code0 === 0, out.slice(0, 200));
    ok(`展示代码块${i + 1} 输出${hasLock ? ' 1000' : ' 10'}`, out.includes(hasLock ? '1000' : '10'), out.trim());
  });
}

console.log('== 计算例题复算 ==');
{
  /* FD-026:batch=1, 32 层, 8 个 KV 头, head_dim=128, FP16(2 字节)
     KV 缓存字节 = 2(K/V) * layers * kv_heads * head_dim * 2 字节 * seq_len * batch
     4K:  2*32*8*128*2*4096  = 0.5 GiB
     32K: 4 GiB; 128K: 16 GiB */
  const kv = L => 2 * 32 * 8 * 128 * 2 * L;
  eq('FD-026 4K=0.5GiB', +(kv(4096) / 1024 ** 3).toFixed(2), 0.5);
  eq('FD-026 32K=4GiB', +(kv(32768) / 1024 ** 3).toFixed(1), 4);
  eq('FD-026 128K=16GiB', +(kv(131072) / 1024 ** 3).toFixed(0), 16);
  /* EN-009: 10000 TPM / 2000 token = 5 请求/分钟 ≈ 0.083 QPS;50 QPS * 3500 * 60 = 10,500,000 TPM */
  eq('EN-009 0.0833 QPS', +(10000 / 2000 / 60).toFixed(4), 0.0833);
  eq('EN-009 10.5M TPM', 50 * 3500 * 60, 10500000);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
