/* 表达卡导出验证(工作台的「出口」)
   这是新增功能,没法像修 bug 那样在旧代码上反向验证(旧代码里压根没有这个功能)。
   所以这里的断言重点是**容易出假货的地方**:
     - 没有内容时是否会产出「看着像材料其实空空如也」的文件;
     - 我写的 Markdown/HTML 字符会不会破坏卡片结构、甚至带出脚本;
     - 题库里找不到的题会不会编造参考要点;
     - 两种输出(Markdown / 打印版 HTML)内容是否一致。
   运行:node tests/express-card-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');
global.window = global;
vm.runInThisContext(fs.readFileSync(path.join(ROOT, 'app/js/express.js'), 'utf8'),
  { filename: 'app/js/express.js' });

let passed = 0, failed = 0; const failures = [];
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; failures.push(name); console.log('  FAIL', name, detail === undefined ? '' : '\n    → ' + detail); }
}

/* ---- 题库桩:只给两题,其中一题故意缺失,验证「找不到就不编」 ---- */
const BANK = {
  'AG-001': {
    id: 'AG-001', title: 'Agent 和工作流有什么区别?', topic: 'agent', difficulty: 'basic',
    answer: '区别在于谁决定流程:工作流由开发者写死步骤,Agent 由模型决定下一步。',
    interview: '口述版:分界是「谁决定流程」。',
    pitfalls: ['把固定脚本说成 Agent', '把多轮对话当成 Agent']
  },
  'PY-001': {
    id: 'PY-001', title: 'async/await 是怎么工作的?', topic: 'python-backend', difficulty: 'intermediate',
    answer: 'await 把控制权交回事件循环,协程在 I/O 就绪后恢复。',
    interview: '口述版:单线程内靠事件循环切换,不阻塞。',
    pitfalls: ['以为 await 会开新线程']
  }
};
const lookup = id => BANK[id] || null;

/* 取某一题在 Markdown 里的段落(到下一个 --- 分隔线为止) */
function sectionOf(markdown, qid) {
  const start = markdown.indexOf('`' + qid + '`');
  if (start < 0) return '';
  const rest = markdown.slice(start);
  const end = rest.indexOf('\n---');
  return end < 0 ? rest : rest.slice(0, end);
}
function missingQCardHasNoAnswer(markdown, qid) {
  const sec = sectionOf(markdown, qid);
  return sec.length > 0 && !sec.includes('### 参考要点') && !sec.includes('### 面试口述版');
}

console.log('== 1. 没有内容时,必须明确报错,而不是产出空文件 ==');
const empty = ExpressCard.buildFromRound([], 0, lookup);
ok('没有任何轮次 → ok:false', empty.ok === false, JSON.stringify(empty).slice(0, 120));
ok('并且给出人能看懂的原因', typeof empty.error === 'string' && empty.error.length > 5, empty.error);
const missing = ExpressCard.buildFromRound([{ ts: 1, items: [] }], 0, lookup);
ok('该轮没有题目记录 → ok:false', missing.ok === false);
const noAnswer = ExpressCard.buildFromRound([{ ts: 1, items: [{ qid: 'AG-001', title: 'x', self: '   ', revealed: false }] }], 0, lookup);
ok('有题但一题都没写回答 → ok:false(不产出空壳)', noAnswer.ok === false, noAnswer.error);
ok('未作答的报错说明里点明了原因', /没有写下任何回答/.test(String(noAnswer.error)), noAnswer.error);

console.log('\n== 2. 正常一轮:内容必须真的来自记录 ==');
const round = {
  ts: 1757500000000,
  items: [
    { qid: 'AG-001', title: 'Agent 和工作流有什么区别?', self: '我答:分界是流程由谁决定,不是调没调工具。', revealed: true, mark: 'weak' },
    { qid: 'PY-001', title: 'async/await 是怎么工作的?', self: '', revealed: false, mark: '' },
    { qid: 'ZZ-999', title: '题库里没有的题', self: '我随便写的', revealed: false, mark: '' }
  ]
};
const r = ExpressCard.buildFromRound([round], 0, lookup);
ok('有回答 → ok:true', r.ok === true, r.error);
ok('题数与记录一致(3 题)', r.count === 3, '实际 ' + r.count);
ok('Markdown 含我写的回答原文', r.markdown.includes('我答:分界是流程由谁决定,不是调没调工具。'));
ok('Markdown 含题目标题', r.markdown.includes('Agent 和工作流有什么区别?'));
ok('Markdown 含面试口述版', r.markdown.includes('### 面试口述版') && r.markdown.includes('口述版:分界是「谁决定流程」。'));
ok('Markdown 含参考要点', r.markdown.includes('### 参考要点') && r.markdown.includes('工作流由开发者写死步骤'));
ok('Markdown 含状态标签「还不熟」', r.markdown.includes('状态:还不熟'), r.markdown.split('\n').filter(l => l.includes('状态:')).join(' | '));
ok('未作答的题如实写「这一题当时没有作答」,不拿参考要点冒充',
  r.markdown.includes('（这一题当时没有作答）'));
ok('题库里找不到的题不编造参考要点', missingQCardHasNoAnswer(r.markdown, 'ZZ-999'),
  '缺失题目的段落里出现了参考要点');
ok('开头写明来源与题数', /# 面试表达卡/.test(r.markdown) && /来源:模拟面试第 1 轮/.test(r.markdown) && /共 3 题/.test(r.markdown));

console.log('\n== 3. 我写的内容不得破坏卡片结构、不得带出脚本 ==');
const evil = {
  ts: 1757500000001,
  items: [{
    qid: 'AG-001', title: '标题里带 | 竖线和 # 井号', mark: 'weak', revealed: true,
    self: '# 我的一级标题\n| a | b |\n| - | - |\n---\n<script>alert(1)</script>\n> 引用'
  }]
};
const e = ExpressCard.buildFromRound([evil], 0, lookup);
ok('恶意/粘手的回答 → 仍然成功导出', e.ok === true, e.error);
const body = e.markdown;
const selfPart = body.split('### 我的回答')[1].split('###')[0];
ok('回答整体进引用块:每一行都以 > 开头(不会被解析成标题/表格/分隔线)',
  selfPart.split('\n').filter(l => l.trim()).every(l => l.trim().startsWith('>')),
  JSON.stringify(selfPart.slice(0, 160)));
ok('Markdown 里题目数仍为 1(没有被回答里的 --- 切成两题)',
  (body.match(/^## /gm) || []).length === 1,
  '实际 ' + (body.match(/^## /gm) || []).length + ' 个二级标题');
ok('打印版 HTML 里脚本被转义', e.html.includes('&lt;script&gt;') && !e.html.includes('<script>alert(1)'));
ok('打印版 HTML 里竖线/井号原样保留(不误伤内容)', e.html.includes('| a | b |'));

console.log('\n== 4. 超长回答被截断,不会撑爆文件 ==');
const longText = '啊'.repeat(ExpressCard.MAX_SELF + 500);
const l = ExpressCard.buildFromRound([{ ts: 1, items: [{ qid: 'AG-001', title: 't', self: longText, revealed: true }] }], 0, lookup);
ok('超长回答被截到上限内', l.markdown.length < ExpressCard.MAX_SELF + 2000,
  'Markdown 长度 ' + l.markdown.length);
ok('截断处给出省略号(不静默丢内容)', l.markdown.includes('…'));

console.log('\n== 5. 打印版 HTML 是一份能独立打开的文件 ==');
ok('含 DOCTYPE 与结束标签', /^<!DOCTYPE html>/.test(r.html) && r.html.trim().endsWith('</html>'));
ok('含打印样式(打印时不留灰底)', r.html.includes('@media print'));
ok('含全部 3 题的卡片', (r.html.match(/<section class="card">/g) || []).length === 3,
  '实际 ' + (r.html.match(/<section class="card">/g) || []).length);
ok('Markdown 与 HTML 的题数一致',
  (r.html.match(/<section class="card">/g) || []).length === (r.markdown.match(/^## /gm) || []).length);

console.log('\n== 6. 待攻克清单(没有我的回答,给口述版与误区) ==');
const marks = [
  { qid: 'AG-001', status: 'weak', note: '我记的:判据是流程由谁决定' },
  { qid: 'PY-001', status: 'review', note: '' },
  { qid: 'ZZ-404', status: 'weak', note: '' }
];
const m = ExpressCard.buildFromMarks(marks, lookup);
ok('有标记 → ok:true', m.ok === true, m.error);
ok('题库里找不到的题被跳过,不放占位条目', m.count === 2, '实际 ' + m.count);
ok('含面试口述版', m.markdown.includes('### 面试口述版'));
ok('含常见误区', m.markdown.includes('### 常见误区') && m.markdown.includes('把固定脚本说成 Agent'));
ok('待攻克清单用「我的笔记」标签,不把笔记冒充成「我的回答」',
  m.markdown.includes('### 我的笔记') && !m.markdown.includes('### 我的回答'),
  m.markdown.split('\n').filter(l => /^### /.test(l)).join(' | '));
ok('笔记原文被带进卡片', m.markdown.includes('我记的:判据是流程由谁决定'));
ok('模拟面试那一路仍叫「我的回答」', r.markdown.includes('### 我的回答') && !r.markdown.includes('### 我的笔记'));
ok('待攻克卡不给没有笔记的题编「未作答」占位(那是模拟面试才有的事)',
  (m.markdown.match(/当时没有作答/g) || []).length === 0);
const mEmpty = ExpressCard.buildFromMarks([], lookup);
ok('没有标记的题 → ok:false', mEmpty.ok === false, mEmpty.error);
const mAllMissing = ExpressCard.buildFromMarks([{ qid: 'ZZ-1', status: 'weak' }], lookup);
ok('标记的题都不在题库里 → ok:false(不产出空文件)', mAllMissing.ok === false, mAllMissing.error);

console.log('\n== 7. 文件名可直接落盘 ==');
ok('Markdown 文件名以「日期.md」结尾', /\d{4}-\d{2}-\d{2}\.md$/.test(r.mdName), r.mdName);
ok('HTML 文件名以「日期.html」结尾', /\d{4}-\d{2}-\d{2}\.html$/.test(r.htmlName), r.htmlName);
ok('文件名不含 Windows 非法字符', !/[\\/:*?"<>|]/.test(r.mdName) && !/[\\/:*?"<>|]/.test(r.htmlName),
  r.mdName + ' / ' + r.htmlName);
ok('Markdown 与 HTML 文件名不同', r.mdName !== r.htmlName);

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
if (failed) console.log('失败项:\n  - ' + failures.join('\n  - '));
process.exit(failed ? 1 : 0);
