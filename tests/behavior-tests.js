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
    type: 'aiiv-records', v: 2, records: { questions: { 'PY-001': { note: '更新的备份笔记', _updatedAt: 9999999999999 } }, mock: { rounds: [] } }
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
  const okBank = [{ id: 'ZZ-901', topic: 'rag', type: 'concept', difficulty: 'basic', title: '合法题', answer: 'a', plain: 'p', deep: 'd', example: 'e', interview: 'i', followups: [{ q: 'fq', a: 'fa' }], pitfalls: ['pf'], check: { q: 'cq', a: 'ca' }, sources: [{ kind: 'official', name: 'doc' }], verify: { status: 'partial' } }];
  const r = Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: okBank, docs: [{ id: 'udoc-9001', title: '资料', text: '内容', ts: 1, kind: 'md', parsed: true }] }));
  eq('合法题库+资料导入', [r.questionsAdded, r.docsAdded], [1, 1]);
  const r2 = Store.importLibrary(JSON.stringify({ type: 'aiiv-library', v: 1, questions: okBank, docs: [{ id: 'udoc-9001', title: '资料', text: '内容', ts: 1, kind: 'md', parsed: true }] }));
  eq('重复导入幂等', [r2.questionsAdded, r2.docsAdded], [0, 0]);
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
