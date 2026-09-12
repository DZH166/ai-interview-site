/* Deterministic adapter for the user-provided Pi question kit.
   Default: dry run. --write applies managed content; --check verifies generated files.
   Personal learning records live in the browser and are never read or changed here. */
'use strict';
const fs = require('fs'), path = require('path'), crypto = require('crypto'), assert = require('assert');
const ROOT = path.resolve(__dirname, '..');
const SOURCE = path.join(ROOT, 'data/imports/pi-agent');
const TARGET = path.join(ROOT, 'data/questions/pi-agent.json');
const BANK = 'pi-agent-interview-30';
const TOPIC = { id: 'pi-agent', short: 'PI', order: 8, name: 'Pi Agent', desc: '30 道 Pi Agent 源码原理与业务场景题：执行机制、上下文会话、扩展与生产工程。含完整题干、追问、评分、建议练习与固定版本依据。' };
const DOC = 'doc-pi-agent-1';
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const hash = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const readText = file => fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n');
const json = file => JSON.parse(readText(file));
const text = value => JSON.stringify(value, null, 2) + '\n';
const SCOPE = { pi_source: 'Pi 源码事实', engineering_design: '工程设计方案', pi_source_and_design: 'Pi 源码事实与工程设计方案' };
function managedHash(q) {
  const copy = structuredClone(q);
  delete copy.metadata.pi_agent.adapter_hash;
  return hash(copy);
}
function mapQuestion(q, bank, manifest) {
  const group = bank.categories.find(c => c.id === q.category);
  const rubric = ['### 评分标准（满分 10 分）',
    '五项分别评 0、1、2 分：0 分为缺失或错误，1 分为方向正确但缺机制或边界，2 分为准确且能解释场景。未作答不预填分数。',
    ...q.rubric.map((r, i) => `${i + 1}. ${r.criterion}（${r.points} 分）`)].join('\n\n');
  const acceptance = q.practice.acceptance.map(a => '- ' + a).join('\n');
  const mapped = {
    id: q.id, topic: TOPIC.id, type: q.kind, difficulty: q.difficulty === 'foundation' ? 'basic' : q.difficulty,
    title: q.title, prompt: q.question,
    tags: [...new Set(['Pi Agent', group.name, q.priority + ' 学习优先级', ...q.tags])],
    prerequisites: q.prerequisite_ids,
    answer: q.pitched_answer,
    plain: ['### 考察价值', q.why_it_matters, '### 英文术语与白话解释',
      ...q.terms.map(t => `- **${t.term}（${t.zh}）**：${t.meaning}`)].join('\n\n'),
    deep: [...q.explanation.flatMap(e => ['### ' + e.heading, e.body]), '### 版本与事实边界',
      `内容范围：${SCOPE[q.fact_scope]}。${q.version_notes}`, `${bank.source_baseline.tag} · ${bank.source_baseline.commit}`, bank.source_baseline.policy].join('\n\n'),
    example: ['### 建议练习（尚未执行）', q.practice.task, '### 验收标准', acceptance,
      `执行状态：${q.practice.execution_status}（这是建议练习，不是已完成记录）。`,
      q.practice.requires_paid_api ? '付费模型要求：按练习要求使用真实模型，执行前确认费用。' : '不要求付费模型，可使用确定性假模型、本地数据或设计测试。'].join('\n\n'),
    interview: q.pitched_answer + '\n\n' + rubric,
    followups: q.follow_ups.map(f => ({ q: f.question, a: f.answer })),
    pitfalls: q.misconceptions.map(m => `**错误说法：**${m.claim}\n\n**正确理解：**${m.correction}`),
    check: { q: q.practice.task, a: acceptance, explain: rubric },
    sources: q.sources.map(s => ({ kind: 'repo', name: 'Pi · ' + s.path, url: s.url, note: s.supports + '；定位：' + s.symbols.join('、') })),
    verify: { status: 'partial', checked_date: bank.source_baseline.verified_at,
      note: `从用户提供的 ${BANK} v${bank.content_version} 完整接入；固定 Pi ${bank.source_baseline.tag}。保留源码与工程方案边界，建议练习尚未执行。` },
    related: [], doc_refs: [DOC], external_id: `${BANK}:${q.id}`,
    metadata: { pi_agent: { bank_id: BANK, content_version: bank.content_version, source_hash: manifest.content_hash,
      source_baseline: bank.source_baseline, original: q } }
  };
  mapped.metadata.pi_agent.adapter_hash = managedHash(mapped);
  return mapped;
}
function generate() {
  const bank = json(path.join(SOURCE, 'questions.json')), manifest = json(path.join(SOURCE, 'import-manifest.json'));
  assert.strictEqual(bank.bank_id, BANK); assert.strictEqual(bank.questions.length, 30);
  assert.strictEqual(manifest.questions.length, 30);
  assert.strictEqual(bank.questions.reduce((n, q) => n + q.follow_ups.length, 0), 90);
  for (const group of bank.categories) assert.strictEqual(bank.questions.filter(q => q.category === group.id).length, 10);
  const mapped = bank.questions.map((q, i) => {
    assert.strictEqual(q.id, 'PI-' + String(i + 1).padStart(3, '0'));
    const m = manifest.questions.find(m => m.external_id === `${BANK}:${q.id}`);
    assert(m && m.content_hash === hash(q), 'Source hash mismatch: ' + q.id);
    assert.strictEqual(q.rubric.length, 5); assert.strictEqual(q.rubric.reduce((n, r) => n + r.points, 0), 10);
    assert.strictEqual(q.practice.execution_status, 'proposed_not_run');
    return mapQuestion(q, bank, m);
  });
  const current = fs.existsSync(TARGET) ? json(TARGET) : [];
  assert.strictEqual(new Set(current.map(q => q.id)).size, current.length, 'Duplicate managed IDs; review before overwriting.');
  const otherIds = new Set(fs.readdirSync(path.dirname(TARGET)).filter(f => f.endsWith('.json') && f !== path.basename(TARGET))
    .flatMap(f => json(path.join(path.dirname(TARGET), f)).map(q => q.id)));
  const plan = mapped.map(q => {
    const old = current.find(x => x.id === q.id);
    let action = 'insert';
    if (otherIds.has(q.id)) action = 'conflict';
    else if (old) {
      if (old.external_id !== q.external_id || !old.metadata?.pi_agent?.adapter_hash || managedHash(old) !== old.metadata.pi_agent.adapter_hash) action = 'conflict';
      else action = hash(old) === hash(q) ? 'skip' : 'update';
    }
    return { id: q.id, external_id: q.external_id, action, source_hash: q.metadata.pi_agent.source_hash };
  });
  for (const q of current) if (!mapped.some(m => m.id === q.id)) plan.push({ id: q.id, action: 'conflict' });
  const topicsPath = path.join(ROOT, 'data/topics.json'), topics = json(topicsPath);
  const at = topics.findIndex(t => t.id === TOPIC.id);
  if (at >= 0 && hash(topics[at]) !== hash(TOPIC)) throw new Error('Pi Agent topic definition differs; review before overwriting.');
  if (at < 0) topics.push(TOPIC);
  const glossary = readText(path.join(SOURCE, 'GLOSSARY.md'));
  const doc = `---\nid: ${DOC}\ntopic: ${TOPIC.id}\ntitle: Pi Agent：学习说明与术语\norder: 8\nsummary: 30 道固定版本源码与业务场景面试题的学习入口、三组题目索引和英文术语速查。\n---\n\n` +
    `# Pi Agent\n\n本分类有 30 道主问题、90 个归属原题的追问。每题保留完整题干、解释、术语、评分、建议练习与出处。\n\n` +
    `源码基线：${bank.source_baseline.tag}，提交 \`${bank.source_baseline.commit}\`。工程方案不等同于框架开箱即用能力；建议练习尚未执行。新内容不会创建作答、成绩或到期复习任务。\n\n` +
    `使用方式：先读完整题干并作答，再展开解释与面试表达；评分标准位于面试表达和理解检查。P0/P1 仅表示建议学习优先级。\n\n` +
    bank.categories.map(c => '## ' + c.name + '\n\n' + bank.questions.filter(q => q.category === c.id).map(q => `- [${q.id} · ${q.title}](#/study/${q.id})`).join('\n')).join('\n\n') +
    '\n\n' + glossary.replace(/相关题：([^\n]+)/g, (_, ids) => '相关题：' + ids.replace(/PI-\d{3}/g, id => `[${id}](#/study/${id})`));
  return { bank, mapped, plan, topicsPath, topics, doc };
}
function main(args) {
  const g = generate();
  const summary = Object.fromEntries(['insert', 'skip', 'update', 'conflict'].map(a => [a, g.plan.filter(p => p.action === a).length]));
  console.log(JSON.stringify({ bank_id: BANK, category: TOPIC.name, ...summary, questions: g.mapped.length, followups: 90 }, null, 2));
  if (summary.conflict) throw new Error('Conflicting content exists; no files were written.');
  const outputs = [[TARGET, text(g.mapped)], [g.topicsPath, text(g.topics)], [path.join(ROOT, 'data/docs/pi-agent.md'), g.doc]];
  if (args.includes('--write')) {
    for (const [file, content] of outputs) if (!fs.existsSync(file) || readText(file) !== content) fs.writeFileSync(file, content, 'utf8');
  }
  if (args.includes('--check')) for (const [file, content] of outputs) assert.strictEqual(readText(file), content, 'Generated content out of sync: ' + file);
  return summary;
}
if (require.main === module) main(process.argv.slice(2));
module.exports = { generate, mapQuestion, hash, managedHash, main };
