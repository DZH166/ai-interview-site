/* Integrate the 98-topic study extraction without duplicating existing questions.
   --write applies curated edits; --check verifies an already generated batch. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..'), DIR = path.join(ROOT, 'data/imports/ai-series');
const DATE = '2026-09-13', REV = 'ai-series-20260913';
const DOC = 'doc-ai-series-1', FRAMEWORK_DOC = 'doc-langchain-1';
const read = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const json = file => JSON.parse(read(file));
const canonical = v => Array.isArray(v) ? v.map(canonical) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map(k => [k, canonical(v[k])])) : v;
const hash = v => crypto.createHash('sha256').update(JSON.stringify(canonical(v))).digest('hex');
const dump = (v, indent = 2) => JSON.stringify(v, null, indent) + '\n';
function managedHash(q) { const copy = structuredClone(q); delete copy.metadata.ai_series.output_hash; return hash(copy); }
function primary(url) {
  const parsed = new URL(url);
  const name = parsed.hostname + ' · ' + (parsed.pathname.split('/').filter(Boolean).pop() || '官方说明');
  return { kind: parsed.hostname.includes('arxiv') ? 'paper' : parsed.hostname.includes('github') ? 'repo' : 'official-docs',
    name, url, note: '本轮融合的一手依据；按所引版本及实验范围理解，未据此声明用户已完成项目。' };
}
function generate() {
  const plan = json(path.join(DIR, 'fusion-plan.json'));
  const edits = [...json(path.join(DIR, 'model-edits.json')), ...json(path.join(DIR, 'runtime-edits.json'))];
  const additions = json(path.join(DIR, 'new-questions.json'));
  assert.strictEqual(plan.items.length, 98); assert.strictEqual(new Set(plan.items.map(r => r.source_id)).size, 98);
  assert.strictEqual(new Set(plan.items.map(r => r.url)).size, 98);
  const counts = { agent: 24, rag: 21, tools: 18, llm: 23, langchain: 12 };
  for(const [group, count] of Object.entries(counts)) assert.strictEqual(plan.items.filter(r => r.group === group).length, count);
  const qdir = path.join(ROOT, 'data/questions'), newFile = 'ai-series-new.json';
  const files = new Map(fs.readdirSync(qdir).filter(f => f.endsWith('.json')).map(f => [f, json(path.join(qdir, f))]));
  const byId = new Map();
  for(const [file, list] of files) for(const q of list) { assert(!byId.has(q.id), 'Duplicate question ID: ' + q.id); byId.set(q.id, { file, q }); }
  const newIds = new Set(additions.map(q => q.id)), patchById = new Map(edits.map(q => [q.id, q]));
  assert.strictEqual(newIds.size, 13); assert.strictEqual(patchById.size, edits.length);
  const targetIds = new Set(plan.items.flatMap(r => r.target_ids));
  for(const id of patchById.keys()) assert(targetIds.has(id), 'Edited item has no source mapping: ' + id);
  for(const id of targetIds) assert(byId.has(id) || newIds.has(id), 'Unresolved source mapping: ' + id);
  const changes = [], nextById = new Map();
  for(const id of targetIds) {
    const old = byId.get(id)?.q;
    if (old?.metadata?.ai_series) assert.strictEqual(managedHash(old), old.metadata.ai_series.output_hash, 'Managed question was edited; review before overwriting: ' + id);
    if (newIds.has(id) && old && !old.metadata?.ai_series) throw new Error('New ID conflicts with unrelated content: ' + id);
    const authored = newIds.has(id) ? additions.find(q => q.id === id) : patchById.get(id);
    const q = old ? structuredClone(old) : { ...structuredClone(authored), sources: [], verify: {}, doc_refs: [] };
    if(authored) for(const key of ['title', 'prompt', 'answer', 'plain', 'deep', 'example', 'interview', 'followups', 'pitfalls', 'check']) {
      if(authored[key] !== undefined && !(key === 'example' && authored.keep_example && old)) q[key] = structuredClone(authored[key]);
    }
    delete q.primary_urls; delete q.keep_example;
    const rows = plan.items.filter(r => r.target_ids.includes(id));
    q.fusion_notes = rows.map(r => '### ' + r.label + '\n\n' + r.insight).join('\n\n');
    q.tags = [...new Set([...(q.tags || []), 'AI系列融合'])];
    q.doc_refs = [...new Set([...(q.doc_refs || []), DOC, ...(q.topic === 'langchain' ? [FRAMEWORK_DOC] : [])])];
    const refs = authored ? authored.primary_urls.map(primary) : (q.sources || []).filter(s => !s.note?.includes('选题对照；'));
    for(const row of rows) for(const url of row.primary_urls || []) refs.push(primary(url));
    for(const row of rows) refs.push({ kind: 'web', name: '小林系列 · ' + row.label, url: row.url, note: '选题对照；站内答案独立整理，网站中的经历、比例与断言不自动视为事实。' });
    q.sources = [...new Map(refs.map(s => [s.url || s.name, s])).values()];
    q.verify = { ...q.verify, status: 'partial', checked_date: DATE,
      note: authored ? '本轮对照一手资料修订；示例为设计或算术，未运行真实模型/生产系统。事实、版本边界与工程建议分开理解。'
        : '保留原题并补充跨源场景边界；本轮不代表原题每一句都重新完成事实核验，未把材料经历转为用户经历。' };
    if(!newIds.has(id)) q.content_version = { rev: REV, date: DATE, summary: authored ? '跨字段校正概念、版本与实验边界' : '补充场景边界与来源对照', changed_fields: authored ? ['answer','plain','deep','example','interview','followups','pitfalls','check','fusion_notes'] : ['fusion_notes'] };
    const beforeHash = old?.metadata?.ai_series ? old.metadata.ai_series.before_hash : old ? hash(old) : null;
    q.metadata = { ...(q.metadata || {}), ai_series: { batch_id: plan.batch_id, source_ids: rows.map(r => r.source_id), before_hash: beforeHash } };
    q.metadata.ai_series.output_hash = managedHash(q);
    nextById.set(id, q);
    changes.push({ id, disposition: newIds.has(id) ? 'new' : authored ? 'revised' : 'supplemented',
      action: !old ? 'insert' : hash(old) === hash(q) ? 'skip' : 'update', before_hash: beforeHash, output_hash: q.metadata.ai_series.output_hash });
  }
  const outputs = [];
  for(const [file, list] of files) {
    if(file === newFile) continue;
    if(list.some(q => nextById.has(q.id))) {
      const target = path.join(qdir, file), indent = read(target).match(/\n( +)\{/)[1].length;
      outputs.push([target, dump(list.map(q => nextById.get(q.id) || q), indent)]);
    }
  }
  outputs.push([path.join(qdir, newFile), dump(additions.map(q => nextById.get(q.id)))]);
  const topicsFile = path.join(ROOT, 'data/topics.json'), topics = json(topicsFile);
  const topic = { id: 'langchain', short: 'LC', order: 9, name: 'LangChain 与 LangGraph', desc: 'Runnable与LCEL、LangChain v1工具循环、中间件、LangGraph中断恢复，以及Java和研究型Agent选学。' };
  const existing = topics.find(t => t.id === topic.id);
  if(existing) assert.strictEqual(hash(existing), hash(topic), 'Framework topic differs; review it before import.'); else topics.push(topic);
  outputs.push([topicsFile, dump(topics)]);
  const labels = { agent: 'Agent', rag: 'RAG', tools: '工具与协议', llm: '训练、推理与模型工程', langchain: 'LangChain 与 LangGraph' };
  let index = `---\nid: ${DOC}\ntopic:\ntitle: 小林 AI 系列：融合索引\norder: 10\nsummary: 将98个备课选题映射到既有与新增问题，保留题号、学习记录及技术纠错边界。\n---\n\n# 小林 AI 系列融合\n\n2026-09-12备课提取，2026-09-13融合。98个参考选题映射到${targetIds.size}道站内题，其中新增13题；重合内容按原题号补充。本站使用独立表述，不复制网站面试对话、图片或整篇答案。\n\n资料中的项目经历与性能比例不是用户已验证成果。重点技术结论结合一手资料校正，尚未运行的实验仍是建议。\n\n`;
  for(const [group, label] of Object.entries(labels)) {
    index += '## ' + label + '\n\n| 参考序号 | 知识点 | 站内入口 | 对照来源 |\n|---|---|---|---|\n';
    for(const row of plan.items.filter(r => r.group === group)) index += `| ${row.order} | ${row.label} | ${row.target_ids.map(id => `[${id}](#/study/${id})`).join('、')} | [原资料](${row.url}) |\n`;
    index += '\n';
  }
  outputs.push([path.join(ROOT, 'data/docs/ai-series.md'), index.trimEnd() + '\n']);
  const framework = `---\nid: ${FRAMEWORK_DOC}\ntopic: langchain\ntitle: LangChain 与 LangGraph：接口、状态和验证\norder: 9\nsummary: 从统一调用接口到Agent循环、中间件与可恢复状态，区分框架能力、应用责任和版本变化。\n---\n\n# 框架学习路线\n\n先理解模型请求和实际工具执行，再选择运行时。LangChain提供标准Agent入口，LangGraph提供更直接的状态与流程控制；二者可以组合。示例需要按所用版本验证，不把接口名称当作行为保证。\n\n` + additions.filter(q => q.topic === 'langchain').map(q => `## ${q.title}\n\n[进入 ${q.id}](#/study/${q.id})\n\n${q.plain}\n`).join('\n') +
    '\n## 与旧题连接\n\n- [AG-010 框架取舍](#/study/AG-010)\n- [AG-005 状态与记忆](#/study/AG-005)\n- [AG-022 图编排](#/study/AG-022)\n- [全部98项融合索引](#/docs/' + DOC + ')\n\nJava与研究型Agent属于拓展，不能把未运行方案写成自己的已完成经历。\n';
  outputs.push([path.join(ROOT, 'data/docs/langchain.md'), framework]);
  const manifest = { batch_id: plan.batch_id, extraction_date: '2026-09-12', integrated_date: DATE, source_count: 98,
    existing_supplemented: changes.filter(c => c.disposition !== 'new').length, existing_revised: edits.length, added: 13,
    source_to_question: plan.items.map(({ source_id, group, order, label, url, target_ids }) => ({ source_id, group, order, label, url, target_ids })),
    questions: changes.map(({ action, ...row }) => row), personal_state_written: false };
  outputs.push([path.join(ROOT, 'delivery/ai-series-fusion.json'), dump(manifest)]);
  return { outputs, changes, manifest };
}
function main(args) {
  const g = generate();
  const summary = { sources: 98, insert: g.changes.filter(r => r.action === 'insert').length,
    update: g.changes.filter(r => r.action === 'update').length, skip: g.changes.filter(r => r.action === 'skip').length,
    rewritten: g.manifest.existing_revised, existing: g.manifest.existing_supplemented, new_questions: 13 };
  console.log(JSON.stringify(summary, null, 2));
  if(args.includes('--write')) for(const [file, content] of g.outputs) if(!fs.existsSync(file) || read(file) !== content) fs.writeFileSync(file, content, 'utf8');
  if(args.includes('--check')) for(const [file, content] of g.outputs) assert.strictEqual(read(file), content, 'Fusion output differs: ' + file);
  return summary;
}
if(require.main === module) main(process.argv.slice(2));
module.exports = { generate, main, managedHash, hash };
