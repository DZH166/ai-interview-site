/* Project exports must use the selected saved evidence, never invent an experience. */
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm'), assert = require('assert');
global.window = global;
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '../app/js/express.js'), 'utf8'));
let passed = 0, failed = 0;
function test(name, fn) { try { fn(); passed++; console.log('  PASS', name); } catch(e) { failed++; console.error('  FAIL', name, e.message); } }
const project = { id: 'proj-a', name: '可靠调用层' };
const runs = [
  { runId: 'older', ts: 100, runOutput: '第一次失败：超时', debug: '限制重试次数', todo: '仍需测取消', stepStatus: 'trying' },
  { runId: 'newer', ts: 200, runOutput: '第二次：已返回结果', debug: '补了错误回喂', stepStatus: 'verified' }
];
const draft = { speak_short: '30秒：我用本地替身验证了分类重试', speak_long: '2分钟：需求、取舍、失败、修复与边界', speak_ask: '旧版提纲保留', speakLevel: 'tried', evidenceRunId: 'older', updatedAt: 300 };
test('selected run identity, both pitches and legacy outline are exported', () => {
  const r = ExpressCard.buildFromProject(project, draft, runs);
  assert(r.ok); for(const text of ['older', runs[0].runOutput, draft.speak_short, draft.speak_long, draft.speak_ask]) { assert(r.markdown.includes(text)); assert(r.html.includes(text)); }
  assert(!r.markdown.includes(runs[1].runOutput)); assert(r.markdown.includes('未独立验证'));
});
test('explicit historic run exports that run and labels current speech as a draft', () => {
  const r = ExpressCard.buildFromProject(project, draft, runs, 'newer');
  assert(r.ok); assert(r.markdown.includes(runs[1].runOutput)); assert(!r.markdown.includes(runs[0].runOutput));
  assert(r.markdown.includes('当前口述草稿')); assert(r.notes.some(x => x.includes('不同')));
});
test('missing evidence is an error, never silently replaced with newest', () => {
  const r = ExpressCard.buildFromProject(project, { ...draft, evidenceRunId: 'gone' }, runs);
  assert.strictEqual(r.ok, false); assert(r.error.includes('证据'));
});
test('empty project does not produce an empty card', () => {
  assert.strictEqual(ExpressCard.buildFromProject(project, {}, []).ok, false);
});
test('design-only speech can be exported without claiming a completed run', () => {
  const r = ExpressCard.buildFromProject(project, { speak_short: '如果遇到，我会这样设计', speakLevel: 'design' }, []);
  assert(r.ok); assert(r.markdown.includes('无运行记录')); assert(r.markdown.includes('如果遇到我会这样设计'));
});
test('HTML and Markdown render user markup literally', () => {
  const payload = '<script>alert(1)</script>\n![remote](https://example.com/x.png)';
  const r = ExpressCard.buildFromProject(project, { speak_short: payload }, []);
  assert(!r.html.includes('<script>')); assert(!r.markdown.includes('<script>'));
  assert(!r.markdown.includes('![remote]')); assert(r.html.includes('&lt;script&gt;'));
});
test('building a card never mutates saved runs or drafts', () => {
  const before = JSON.stringify({ draft, runs }); ExpressCard.buildFromProject(project, draft, runs);
  assert.strictEqual(JSON.stringify({ draft, runs }), before);
});
test('long personal text is preserved in project materials', () => {
  const text = '完整项目说明'.repeat(1000) + '最后一段重要结论';
  const r = ExpressCard.buildFromProject(project, { speak_long: text }, []);
  assert(r.markdown.includes('最后一段重要结论')); assert(r.html.includes('最后一段重要结论'));
});
test('real Markdown rendering preserves quotes, entities and code literally', () => {
  const original = "print('hello') and don't\n&#39; &amp; <script>alert(1)</script>\n![picture](https://example.com/x) \\path **literal**";
  const card = ExpressCard.buildFromProject(project, { speak_short: original }, []);
  const python = `import sys,json
from markdown_it import MarkdownIt
from html.parser import HTMLParser
sys.stdout.reconfigure(encoding='utf-8')
class Reader(HTMLParser):
 def __init__(self):
  super().__init__(); self.blocks=[]; self.depth=0; self.active=[]
 def handle_starttag(self, tag, attrs):
  if tag in ('script','img','a'): self.active.append(tag)
  if tag=='blockquote':
   if self.depth==0: self.blocks.append('')
   self.depth+=1
 def handle_endtag(self, tag):
  if tag=='blockquote': self.depth-=1
 def handle_data(self, data):
  if self.depth: self.blocks[-1]+=data
r=Reader(); r.feed(MarkdownIt().render(sys.stdin.buffer.read().decode('utf-8')))
print(json.dumps({'blocks':[s.strip() for s in r.blocks],'active':r.active},ensure_ascii=False))`;
  const result = JSON.parse(require('child_process').execFileSync(process.env.AIIV_PYTHON || 'python', ['-c', python], { input: card.markdown, encoding: 'utf8' }));
  assert(result.blocks.includes(original)); assert.deepStrictEqual(result.active, []);
});
console.log(`\n结果: ${passed} 通过, ${failed} 失败`); process.exitCode = failed ? 1 : 0;
