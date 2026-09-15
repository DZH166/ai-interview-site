/* 阶段4 暂停恢复:双 Store 实例模拟「后台标签页错过事件」的真实暂停——
   每个实例独立内存,共享同一个 localStorage;暂停方不执行对方的合并,恢复后保存。
   这是浏览器无法构造的场景(同页面注册的 storage 监听无法移除),Node 等价模拟是唯一途径。
   运行:node tests/stage4-pause-test.js */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.resolve(__dirname, '..');

/* 双实例环境:共享 localStorage,各自 vm 上下文与独立 Store 内存 */
function makeEnv(id, shared) {
  const ctx = { console, JSON, Date, Math, isFinite, setTimeout, clearTimeout };
  ctx.window = ctx;
  ctx.globalThis = ctx;
  ctx.document = {
    readyState: 'loading', querySelector: () => null, querySelectorAll: () => [],
    createElement: () => ({ style: {}, classList: { add() {}, remove() {}, toggle() {} }, appendChild() {}, remove() {}, addEventListener() {}, setAttribute() {} }),
    addEventListener() {}, removeEventListener() {}, body: { appendChild() {} }
  };
  ctx.localStorage = shared;                 /* 共享盘 */
  ctx.toast = () => {};
  ctx.debounce = f => f;                     /* 防抖直通:写入立即发生,便于时序控制 */
  ctx.location = { hash: '', hostname: 'localhost', protocol: 'http:' };
  ctx.addEventListener = () => {};           /* 不派发 storage 事件:模拟「后台页错过事件」 */
  ctx.removeEventListener = () => {};
  ctx.window.APP_DATA = { topics: [{ id: 'rag', name: 'RAG 与检索', short: 'RG' }], questions: [] };
  vm.createContext(ctx);
  for (const f of ['app/js/srs.js', 'app/js/util.js', 'app/js/store.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f });
  }
  /* const Store 是模块顶层 const,需要显式取出 */
  ctx.Store = vm.runInContext('Store', ctx);
  vm.runInContext('Store.load();', ctx);
  return ctx;
}
const shared = {
  _m: new Map(),
  getItem(k) { return this._m.has(k) ? this._m.get(k) : null; },
  setItem(k, v) { this._m.set(String(k), String(v)); },
  removeItem(k) { this._m.delete(k); },
  clear() { this._m.clear(); }
};
const diskNote = () => { try { return (JSON.parse(shared.getItem('aiiv:records')).questions['AG-001'] || {}).note; } catch (e) { return '(err)'; } };

let passed = 0, failed = 0;
function ok(name, cond, detail) {
  if (cond) { passed++; console.log('  PASS', name); }
  else { failed++; console.log('  FAIL', name, detail || ''); }
}

console.log('== 真实暂停恢复(双 Store 实例,后台页错过事件) ==');
{
  /* 种入初始记录(两实例创建前写盘,保证双页基线一致) */
  shared.setItem('aiiv:records', JSON.stringify({ v: 3, questions: { 'AG-001': { note: '初始', _updatedAt: 1 } }, mock: { rounds: [], draft: null, ended: {} }, drillAttempts: {}, ui: {} }));
  const A = makeEnv('A', shared), B = makeEnv('B', shared);
  /* 前置:两页都读到初始值 */
  ok('pre: A/B 基线一致(初始)', A.Store.rec('AG-001').note === '初始' && B.Store.rec('AG-001').note === '初始');
  /* B「进入后台」:不再读盘、不再合并(它内存里只有旧值,这正是暂停语义) */
  /* A 正常写入 */
  A.Store.setNote('AG-001', 'A在B后台时写的');
  A.Store.saveNow();
  ok('pre: A 写入落盘', diskNote() === 'A在B后台时写的', diskNote());
  /* 前置断言:B 仍是旧内存(后台页没有收到任何事件——暂停真实发生) */
  ok('S2-pre B 仍是旧内存(暂停真实生效)', B.Store.rec('AG-001').note === '初始', B.Store.rec('AG-001').note);
  /* B 恢复前台并保存自己的旧值:saveNow 前合并磁盘(A 新值) → 不得覆盖 */
  B.Store.setNote('RG-009', 'B顺手写的另一题');   /* 触发 B 的一次真实保存 */
  B.Store.saveNow();
  const aMem = A.Store.rec('AG-001').note;
  const bMem = B.Store.rec('AG-001').note;
  const st = { a: aMem, b: bMem, disk: diskNote() };
  ok('S2a 磁盘保持 A 的新值(B 的旧内存未覆盖)', st.disk === 'A在B后台时写的', st.disk);
  /* B 的 saveNow 前合并会把 A 的值带进 B 内存(saveNow 内部 reconcile) */
  ok('S2b B 内存收敛到 A 的新值(合并语义)', st.b === 'A在B后台时写的', st.b);
  /* A 侧读盘收敛(A 页下一次任何保存都会合并;这里直接验证磁盘权威) */
  ok('S2c A 内存仍为自己的值(A 没有理由变化)', st.a === 'A在B后台时写的', st.a);
  /* 重开等价:B 的内存即磁盘,已验证;A 重开同样从磁盘读到 A 值 */
}

console.log('== 暂停恢复+收敛传播(B 后台页也带一条新写入) ==');
{
  const A = makeEnv('A2', shared), B = makeEnv('B2', shared);
  A.Store.setNote('AG-001', 'A版本');
  A.Store.saveNow();
  ok('pre2: 磁盘为 A 版本', diskNote() === 'A版本');
  /* B 后台期做了一次本地编辑(内存有旧笔记的新值但从未落盘? 不——B 落盘了自己的值,
     这构成顺序旧页写入:磁盘被 B 覆盖,随后 A 恢复) */
  B.Store.setNote('AG-001', 'B后台写的值');
  B.Store.saveNow();
  /* 两次写入可能在同一毫秒:同刻走内容哈希决胜(稳定规则);不同刻走 LWW(B 后写者胜)。
     两种规则下,结果都必须「确定且两侧收敛」——不依赖事件到达顺序。 */
  const afterB = diskNote();
  const memB = B.Store.rec('AG-001').note;
  ok('S2-pre2 磁盘与 B 内存收敛(同刻决胜或 LWW,二者都是稳定规则)',
     afterB === memB && (afterB === 'A版本' || afterB === 'B后台写的值'), `disk=${afterB} memB=${memB}`);
  /* A 恢复:任何一次 saveNow 前合并会把磁盘胜者带进 A 内存 */
  A.Store.saveNow();
  ok('S2b2 A 内存收敛到磁盘胜者', A.Store.rec('AG-001').note === afterB, A.Store.rec('AG-001').note);
  ok('S2c2 磁盘稳定', diskNote() === afterB);
}

console.log(`\n结果: ${passed} 通过, ${failed} 失败`);
process.exit(failed ? 1 : 0);
