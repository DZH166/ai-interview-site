/* saveNow 主动合并必须发出与 storage 事件等价的业务通知。
   真 Store + 内存 localStorage；通知消费者按真实界面行为再次保存冲突副本。
   运行：node tests/save-notification-test.js */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const source = fs.readFileSync(path.join(__dirname, '../app/js/store.js'), 'utf8');
let passed = 0;
function fresh() {
  const memory = new Map(), events = {};
  const state = { writes: 0, failWrite: false, now: 1000 };
  const context = { window: { APP_DATA: {}, addEventListener: (name, fn) => { events[name] = fn; } },
    localStorage: { getItem: key => memory.get(key) || null,
      setItem: (key, value) => { if (state.failWrite) throw Error('injected disk failure'); state.writes++; memory.set(key, value); },
      removeItem: key => memory.delete(key) },
    Date: class extends Date { static now() { return state.now; } },
    debounce: fn => () => {}, toast: () => {}, console };
  vm.createContext(context); vm.runInContext(source, context);
  const store = vm.runInContext('Store', context);
  store.load(); store.setNote('AG-001', 'A未处理的输入'); store.saveNow();
  return { store, state, context, events, memory, disk: () => JSON.parse(memory.get('aiiv:records')) };
}
function remote(fixture, text = 'B后保存的版本') {
  const next = fixture.disk(); next.questions['AG-001'].note = text; next.questions['AG-001']._updatedAt = 2000;
  fixture.memory.set('aiiv:records', JSON.stringify(next)); fixture.state.writes = 0;
}
function test(name, run) { run(); passed++; console.log('PASS ' + name); }

test('主动合并通知在提交后发出，通知中的冲突副本保存不递归', () => {
  const f = fresh(); let notifications = 0;
  f.store.onRemoteChange(changes => {
    notifications++;
    assert.strictEqual(f.disk().questions['AG-001'].note, 'B后保存的版本');
    assert(changes.qids.includes('AG-001'));
    assert(f.store.saveNoteDraft('AG-001', 'A未处理的输入'));
  });
  remote(f);
  assert(f.store.saveNow());
  assert.strictEqual(notifications, 1, 'saveNow 主动采纳远端值后必须通知界面');
  assert.strictEqual(f.state.writes, 2, '外层提交+通知消费者保存副本，各一次');
  assert.strictEqual(f.disk().questions['AG-001'].note, 'B后保存的版本');
  assert(Object.values(f.disk().questions['AG-001'].noteDraft.versions).some(v => v.text === 'A未处理的输入'));
  f.store.saveNow();
  assert.strictEqual(notifications, 1, '无新远端业务变化不得再次通知');
});

test('提交失败不通知/不替换内存，恢复存储后重试只通知一次', () => {
  const f = fresh(); let notifications = 0; f.store.onRemoteChange(() => { notifications++; });
  remote(f); f.state.failWrite = true;
  assert.strictEqual(f.store.saveNow(), false);
  assert.strictEqual(f.store.rec('AG-001').note, 'A未处理的输入');
  assert.strictEqual(notifications, 0);
  f.state.failWrite = false; assert(f.store.saveNow());
  assert.strictEqual(notifications, 1);
  assert.strictEqual(f.store.rec('AG-001').note, 'B后保存的版本');
});

test('本页写入和仅远端UI元数据变化不触发远端通知', () => {
  const f = fresh(); let notifications = 0; f.store.onRemoteChange(() => { notifications++; });
  f.store.setNote('RG-001', '本页的新笔记'); assert(f.store.saveNow());
  const next = f.disk(); next.ui.savedAt = 3000; next.ui.lastHash = '#/resume';
  f.memory.set('aiiv:records', JSON.stringify(next)); assert(f.store.saveNow());
  assert.strictEqual(notifications, 0);
});

console.log(`\n结果: ${passed} 通过, 0 失败`);
