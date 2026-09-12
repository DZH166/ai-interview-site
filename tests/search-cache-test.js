/* 搜索分层缓存测试:个人写入触发动态重建,静态层不重复构建;
   查询行为与单层索引一致。运行:node tests/search-cache-test.js */
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
['app/js/srs.js', 'app/js/util.js', 'app/js/markdown.js', 'app/js/store.js', 'app/js/search.js'].forEach(load);

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

/* ---- 构造上下文:静态(题库+文档+概念+专项+项目) 与动态(笔记/尝试/资料) ---- */
function makeCtx(noteText, extraQuestion) {
  const questions = [
    { id: 'RG-001', topic: 'rag', title: '向量检索的原理', prompt: '', tags: ['检索'], answer: '用嵌入向量做近邻搜索', plain: '', deep: '', example: '', interview: '',
      pitfalls: [], followups: [{ q: '为什么用余弦相似度?', a: '方向一致性与模长无关' }], check: null },
    { id: 'RG-002', topic: 'rag', title: '重排的作用', prompt: '', tags: ['检索'], answer: '精排提升前几名质量', plain: '', deep: '', example: '', interview: '',
      pitfalls: [], followups: [], check: null },
  ];
  if (extraQuestion) questions.push(extraQuestion);
  return {
    questions,
    docs: [{ id: 'doc-rag-1', topic: 'rag', title: 'RAG 章节', summary: '', md: '# 一章\n\n向量检索内容。\n\n## 二节\n\n分块策略内容。\n' }],
    userDocs: [{ id: 'udoc-1', title: '我的资料', text: '# 笔记节\n\n独家口诀内容。\n' }],
    records: { questions: { 'RG-001': { note: noteText } }, ui: {} },
    concepts: [{ id: 'c-emb', topic: 'rag', name: '嵌入', definition: '把文本变成向量' }],
    drills: [{ id: 'drill-1', stage: 's1', type: '预测', q: '预测输出', reference: '参考' }],
    projects: [{ id: 'proj-a', name: '项目A', goal: '调用层', expected: '', debug_case: '', deliverable: '', extensions: [] }],
    drillAttempts: { 'drill-1': [{ attemptId: 'at-1', drillId: 'drill-1', status: 'completed', myAnswer: '我的专项回答', updatedAt: Date.now() }] },
  };
}

console.log('== 1. 首次构建与查询 ==');
Search.build(makeCtx('我的向量笔记'));
eq('查询命中静态字段', Search.query('余弦相似度').length > 0 ? 1 : 0, 1);
eq('查询命中章节', Search.query('分块策略').length > 0 ? 1 : 0, 1);
eq('查询命中笔记', Search.query('我的向量笔记').length > 0 ? 1 : 0, 1);
eq('查询命中尝试', Search.query('我的专项回答').length > 0 ? 1 : 0, 1);
eq('查询命中导入资料', Search.query('独家口诀').length > 0 ? 1 : 0, 1);
eq('查询命中概念', Search.query('嵌入').length > 0 ? 1 : 0, 1);
const first = Search.stats();
ok('静态层只构建了一次', first.staticBuilds === 1, JSON.stringify(first));

console.log('== 2. 个人写入:只重建动态层 ==');
Search.build(makeCtx('笔记被改成新内容了'));
const second = Search.stats();
eq('个人写入后静态层构建次数仍为 1', second.staticBuilds, 1);
eq('动态层重建了一次', second.dynamicBuilds, 2);
ok('旧笔记搜不到', Search.query('我的向量笔记').length === 0);
ok('新笔记搜得到', Search.query('笔记被改成新内容').length > 0);
ok('静态内容仍在(拼接行为一致)', Search.query('余弦相似度').length > 0 && Search.query('分块策略').length > 0);

console.log('== 3. 题库规模变化:静态层重建 ==');
Search.build(makeCtx('笔记', { id: 'RG-003', topic: 'rag', title: '混合检索的新题', prompt: '', tags: [], answer: '', plain: '', deep: '', example: '', interview: '', pitfalls: [], followups: [], check: null }));
const third = Search.stats();
eq('题库变了,静态层重建一次(共 2 次)', third.staticBuilds, 2);
ok('新题可检索', Search.query('混合检索的新题').length > 0);

console.log('== 4. 动态层不丢字段类型 ==');
{
  const ctx = makeCtx('');
  ctx.records.ui = { projectRuns: { 'proj-a': [{ runId: 'run-1', runOutput: '运行输出ABC', debug: '', todo: '', updatedAt: 1 }] },
                     projectDrafts: { 'proj-a': { speak_short: '三十秒口述XYZ', updatedAt: 1 } } };
  Search.build(ctx);
  ok('运行记录可检索', Search.query('运行输出ABC').length > 0);
  ok('口述草稿可检索', Search.query('三十秒口述XYZ').length > 0);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
