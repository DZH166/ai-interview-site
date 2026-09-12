/* SRS 间隔重复调度测试:调度数学、Store 集成(唯一排期入口)、
   备份校验与合并、到期判定,以及防止新模块漏出预缓存清单的常驻断言。
   运行:node tests/srs-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* ---- 最小浏览器全局桩(与 behavior-tests.js 同一套) ---- */
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
global.debounce = undefined;
global.location = { hash: '', hostname: 'localhost', protocol: 'http:' };
global.addEventListener = () => {};
global.removeEventListener = () => {};
global.window.APP_DATA = {
  topics: [{ id: 'rag', name: 'RAG 与检索', short: 'RG' }],
  questions: []
};

function load(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  vm.runInThisContext(src, { filename: file });
}
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

const DAY = SRS.DAY;
const T0 = 1757000000000; /* 固定"现在",调度数学必须可精确复算 */

/* ===================================================================== */
console.log('== 1. 调度数学(SM-2 简化) ==');
{
  /* 首次 good:1 天后 */
  const g1 = SRS.schedule(null, 'good', T0);
  eq('首次 good:间隔 1 天', g1.ivl, 1);
  eq('首次 good:到期 = 现在+1天', g1.due, T0 + DAY);
  eq('首次 good:ease 初值 2.5', g1.ease, 2.5);
  eq('首次 good:streak=1', g1.streak, 1);

  /* 第二次 good:固定 6 天;第三次起按间隔×ease */
  const g2 = SRS.schedule(g1, 'good', T0);
  eq('第二次 good:间隔 6 天', g2.ivl, 6);
  const g3 = SRS.schedule(g2, 'good', T0);
  eq('第三次 good:间隔 = 6×2.5 = 15', g3.ivl, 15);
  eq('第三次 good:streak=3', g3.streak, 3);

  /* easy:首次 3 天,ease 上升 */
  const e1 = SRS.schedule(null, 'easy', T0);
  eq('首次 easy:间隔 3 天', e1.ivl, 3);
  eq('首次 easy:ease 2.65', e1.ease, 2.65);
  const e2 = SRS.schedule({ ivl: 6, ease: 2.5, streak: 2 }, 'easy', T0);
  eq('easy 延长:间隔 = 6×2.5×1.3 = 20(取整)', e2.ivl, 20);

  /* hard:小步延长,ease 下降,streak 不涨 */
  const h1 = SRS.schedule({ ivl: 10, ease: 2.5, streak: 3, lapses: 0 }, 'hard', T0);
  eq('hard:间隔 = 10×1.2 = 12', h1.ivl, 12);
  eq('hard:ease 2.35', h1.ease, 2.35);
  eq('hard:streak 不变', h1.streak, 3);

  /* again:归零 + 遗忘计数 + ease 下降;ease 有下限 */
  const a1 = SRS.schedule(g3, 'again', T0);
  eq('again:间隔清零', a1.ivl, 0);
  eq('again:到期 = 现在(当天就该再看)', a1.due, T0);
  eq('again:streak 归零', a1.streak, 0);
  eq('again:lapses +1', a1.lapses, 1);
  eq('again:ease 2.3', a1.ease, 2.3);
  let al = a1;
  for (let i = 0; i < 8; i++) al = SRS.schedule(al, 'again', T0);
  ok('连续 again:ease 收敛到下限 1.3', al.ease === SRS.MIN_EASE, String(al.ease));
  ok('ease 不会低于下限', al.ease >= SRS.MIN_EASE);

  /* 上限与非法输入 */
  const capped = SRS.schedule({ ivl: 170, ease: 2.8, streak: 9, lapses: 0 }, 'good', T0);
  eq('间隔上限 180 天', capped.ivl, SRS.MAX_IVL);
  let threw = '';
  try { SRS.schedule(null, 'perfect', T0); } catch (e) { threw = e.message; }
  ok('未知评分抛错', threw.includes('未知评分'), threw);
  threw = '';
  try { SRS.schedule(null, 'good', 'yesterday'); } catch (e) { threw = e.message; }
  ok('非法时间抛错', threw.includes('时间非法'), threw);

  /* 状态映射:唯一映射点 */
  eq('weak → again', SRS.ratingFromStatus('weak'), 'again');
  eq('review → hard', SRS.ratingFromStatus('review'), 'hard');
  eq('ok → good', SRS.ratingFromStatus('ok'), 'good');
  eq('未练习无映射', SRS.ratingFromStatus(''), null);
}

console.log('== 2. Store 集成:setStatus 是唯一排期入口 ==');
{
  Store.load();
  /* → weak:立即到期(还不熟当天就在队列里) */
  Store.setStatus('RG-001', 'weak');
  let r = Store.rec('RG-001');
  ok('标 weak:产生 srs', !!(r.srs && r.srs.due), JSON.stringify(r.srs));
  ok('标 weak:立即到期', r.srs.due <= Date.now());
  eq('标 weak:lastRating = again', r.srs.lastRating, 'again');
  /* → ok:排到未来 */
  const dueWeak = r.srs.due;
  Store.setStatus('RG-001', 'ok');
  r = Store.rec('RG-001');
  ok('标 ok:到期在未来', r.srs.due > Date.now());
  eq('标 ok:lastRating = good', r.srs.lastRating, 'good');
  /* 重复点击同一状态:不推进(浏览页状态按钮的无效点击不该偷跑排期) */
  const dueOk = r.srs.due;
  Store.setStatus('RG-001', 'ok');
  eq('重复标 ok:到期日不变', Store.rec('RG-001').srs.due, dueOk);
  /* review:hard 映射,至少 1 天 */
  Store.setStatus('RG-001', 'review');
  r = Store.rec('RG-001');
  eq('标 review:lastRating = hard', r.srs.lastRating, 'hard');
  ok('标 review:至少 1 天', r.srs.ivl >= 1, String(r.srs.ivl));
  /* 清空状态:排期一并清 */
  Store.setStatus('RG-001', '');
  r = Store.rec('RG-001');
  ok('清空状态:srs 一并清掉', r.srs === undefined, JSON.stringify(r.srs));
  /* 练习但不标状态:不排期(没有明确信号就不假设计划) */
  Store.markPracticed('RG-002', 'mock');
  ok('只练习不标状态:无 srs', Store.rec('RG-002').srs === undefined);
  /* 排期字段留在备份里:导出→干净环境恢复往返 */
  Store.setStatus('RG-003', 'ok');
  const exported = Store.exportRecords();
  global.localStorage = makeLocalStorage();
  Store.load();
  Store.importRecords(exported);
  const s3 = Store.rec('RG-003').srs;
  ok('备份往返:srs 被恢复', !!(s3 && s3.due && s3.lastRating === 'good'), JSON.stringify(s3));
}

console.log('== 3. 备份校验与合并(srs 随状态归属) ==');
{
  /* 校验:合法 srs 通过;坏 srs 被拒 */
  let errs = Store.validateRecordsObj({ questions: { 'RG-010': { status: 'ok', srs: { due: T0, ivl: 1, ease: 2.5, streak: 1, lapses: 0, lastAt: T0, lastRating: 'good' } } } });
  eq('合法 srs 校验通过', errs, []);
  errs = Store.validateRecordsObj({ questions: { 'RG-010': { status: 'ok', srs: { due: '明天' } } } });
  ok('srs.due 非数字被拒', errs.some(e => e.includes('srs.due')), errs.join(';'));
  errs = Store.validateRecordsObj({ questions: { 'RG-010': { status: 'ok', srs: { lastRating: 'perfect' } } } });
  ok('srs.lastRating 非法被拒', errs.some(e => e.includes('lastRating')), errs.join(';'));
  errs = Store.validateRecordsObj({ questions: { 'RG-010': { status: 'ok', srs: '明天复习' } } });
  ok('srs 非对象被拒', errs.some(e => e.includes('srs 必须是对象')), errs.join(';'));

  /* 合并:更新的备份带 srs → 整份采用;旧备份带 srs → 不覆盖 */
  Store.load();
  localStorage.clear();
  Store.load();
  Store.setStatus('RG-020', 'ok');               /* 本地 srs:good */
  const localDue = Store.rec('RG-020').srs.due;
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: {
    questions: { 'RG-020': { status: 'weak', srs: { due: T0, ivl: 0, ease: 2.0, streak: 0, lapses: 1, lastAt: T0, lastRating: 'again' }, _updatedAt: Date.now() + 10000 } },
    mock: { rounds: [] }
  } }));
  eq('更新的备份:srs 整份采用', Store.rec('RG-020').srs.lastRating, 'again');
  eq('更新的备份:状态随备份', Store.rec('RG-020').status, 'weak');
  /* 旧备份(无 _updatedAt)不清掉新 srs */
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: {
    questions: { 'RG-020': { status: 'weak' } }, mock: { rounds: [] }
  } }));
  eq('旧备份不覆盖新 srs', Store.rec('RG-020').srs.lastRating, 'again');
  /* 更新的备份明确清空状态 → 派生的 srs 一并清(与 setStatus('') 一致) */
  Store.importRecords(JSON.stringify({ type: 'aiiv-records', v: 2, records: {
    questions: { 'RG-020': { status: '', _updatedAt: Date.now() + 20000 } }, mock: { rounds: [] }
  } }));
  ok('备份清空状态 → srs 一并清', Store.rec('RG-020').srs === undefined, JSON.stringify(Store.rec('RG-020').srs));
  ok('本地原有 due 已无关紧要(引用检查)', typeof localDue === 'number');
}

console.log('== 4. 到期判定与展示 ==');
{
  ok('无 srs → 永不到期', SRS.isDue({}, T0) === false);
  ok('due 在过去 → 到期', SRS.isDue({ srs: { due: T0 - 1 } }, T0) === true);
  ok('due 在未来 → 不到期', SRS.isDue({ srs: { due: T0 + DAY } }, T0) === false);
  ok('due = 现在 → 到期(<=)', SRS.isDue({ srs: { due: T0 } }, T0) === true);
  ok('坏 due → 不到期(不猜)', SRS.isDue({ srs: { due: '明天' } }, T0) === false);
  eq('到期文案:已到期', SRS.dueLabel(T0 - 1, T0), '已到期');
  eq('到期文案:明天', SRS.dueLabel(T0 + DAY, T0), '明天');
  eq('到期文案:3 天后', SRS.dueLabel(T0 + 3 * DAY, T0), '3 天后');
}

console.log('== 5. 轮次上限只有一份 ==');
{
  eq('Store.MAX_ROUNDS = 100', Store.MAX_ROUNDS, 100);
  const practiceSrc = fs.readFileSync(path.join(ROOT, 'app', 'js', 'views-practice.js'), 'utf8');
  ok('views-practice 完成本轮使用 Store.MAX_ROUNDS(不再各写一个数字)', practiceSrc.includes('Store.MAX_ROUNDS'));
  ok('views-practice 不再硬编码 slice(0, 50)', !practiceSrc.includes('slice(0, 50)'));
  const storeSrc = fs.readFileSync(path.join(ROOT, 'app', 'js', 'store.js'), 'utf8');
  ok('store.js 的 mergeRounds 也用 MAX_ROUNDS', !storeSrc.includes('slice(0, 100)') && storeSrc.includes('MAX_ROUNDS'));
}

console.log('== 6. 常驻防线:srs.js 在预缓存与盖章清单里 ==');
{
  const buildSrc = fs.readFileSync(path.join(ROOT, 'tools', 'build.py'), 'utf8');
  const listMatch = buildSrc.match(/shell_files\s*=\s*\[([\s\S]*?)\]/);
  const shellFiles = listMatch ? (listMatch[1].match(/"([^"]+)"/g) || []).map(s => s.slice(1, -1)) : [];
  ok('build.py 盖章清单含 app/js/srs.js', shellFiles.includes('app/js/srs.js'));
  const swSrc = fs.readFileSync(path.join(ROOT, 'app', 'sw.js'), 'utf8');
  const shellArr = (swSrc.match(/const APP_SHELL = \[([\s\S]*?)\]/) || [, ''])[1];
  const cacheSet = new Set((shellArr.match(/'([^']+)'/g) || []).map(s => s.slice(1, -1)).map(e => 'app/' + e.replace(/^\.\//, '')));
  ok('sw.js APP_SHELL 含 ./js/srs.js', cacheSet.has('app/js/srs.js'));
  const indexSrc = fs.readFileSync(path.join(ROOT, 'app', 'index.html'), 'utf8');
  ok('index.html 在 store.js 之前加载 srs.js',
     indexSrc.indexOf('js/srs.js') >= 0 && indexSrc.indexOf('js/srs.js') < indexSrc.indexOf('js/store.js'));
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
