/* Local calendar and honest activity contracts for Stage8; no browser or disk records. */
'use strict';
const assert = require('assert'), fs = require('fs'), path = require('path'), vm = require('vm');
const ROOT = path.resolve(__dirname, '..'), RealDate = Date;
let passed = 0;
function test(name, run) { run(); passed++; console.log('PASS ' + name); }
function fixture(zone, now) {
  process.env.TZ = zone;
  const timestamp = new RealDate(now).getTime();
  class FixedDate extends RealDate { constructor(...args) { super(...(args.length ? args : [timestamp])); } static now() { return timestamp; } }
  const context = { console, Date: FixedDate, Store: { data: { questions: {}, mock: { rounds: [] } } }, esc: text => String(text) };
  context.window = context; vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/express.js'), 'utf8'), context);
  const source = fs.readFileSync(path.join(ROOT, 'app/js/views-stats.js'), 'utf8');
  const seam = 'return { render };'; assert.strictEqual(source.split(seam).length, 2);
  vm.runInContext(source.replace(seam, 'return { render, timeData, renderTime, renderQuizAccuracy };'), context);
  return { api: context.StatsView, records: context.Store.data, ts: text => new RealDate(text).getTime() };
}
const answered = (ts, ms, extra = {}) => ({ ts, items: [{ qid: 'AG-001', self: '本人回答', ms, ...extra }] });
const previousTZ = process.env.TZ;
try {
  test('Shanghai midnight separates adjacent local days even within one UTC day', () => {
    const f = fixture('Asia/Shanghai', '2026-09-30T00:30:00+08:00');
    assert.strictEqual(new RealDate().getTimezoneOffset(), -480);
    f.records.mock.rounds = [answered(f.ts('2026-09-30T00:10:00+08:00'), 60000), answered(f.ts('2026-09-29T23:50:00+08:00'), 120000)];
    const value = f.api.timeData();
    assert.strictEqual(value.streak, 2); assert.strictEqual(value.activeDays, 2);
    assert.strictEqual(value.perDay[29], 60000); assert.strictEqual(value.perDay[28], 120000);
    assert.strictEqual(value.totalMs, 180000);
  });
  test('DST fallback keeps thirty local dates, distinct days, and the earliest boundary', () => {
    const f = fixture('America/New_York', '2026-11-02T00:30:00-05:00');
    f.records.mock.rounds = [answered(f.ts('2026-11-02T00:10:00-05:00'), 1000),
      answered(f.ts('2026-11-01T23:45:00-05:00'), 2000), answered(f.ts('2026-10-31T23:45:00-04:00'), 3000),
      answered(f.ts('2026-10-04T00:00:00-04:00'), 4000), answered(f.ts('2026-10-03T23:59:00-04:00'), 999000)];
    const value = f.api.timeData();
    assert.strictEqual(value.streak, 3);
    assert.deepStrictEqual(Array.from(value.perDay.slice(-3)), [3000, 2000, 1000]);
    assert.strictEqual(value.perDay[0], 4000); assert.strictEqual(value.totalMs, 10000);
    const labels = [...f.api.renderTime().matchAll(/title="(\d+\/\d+)/g)].map(match => match[1]);
    assert.strictEqual(labels.length, 30); assert.strictEqual(new Set(labels).size, 30);
    assert.strictEqual(labels[0], '10/4'); assert.strictEqual(labels.at(-1), '11/2');
  });
  test('reference-only rounds neither add time nor fill an activity gap', () => {
    const f = fixture('Asia/Shanghai', '2026-09-30T15:00:00+08:00');
    f.records.mock.rounds = [{ ts: f.ts('2026-09-30T12:00:00+08:00'), items: [{ revealed: true, mark: 'ok', self: '', ms: 600000 }] },
      answered(f.ts('2026-09-28T12:00:00+08:00'), 1000)];
    let value = f.api.timeData(); assert.strictEqual(value.streak, 0); assert.strictEqual(value.totalMs, 1000); assert.strictEqual(value.activeDays, 1);
    f.records.mock.rounds = [
      { ts: f.ts('2026-09-30T12:00:00+08:00'), items: [{ revision: '本人修订', ms: 1000 }] },
      { ts: f.ts('2026-09-29T12:00:00+08:00'), items: [{ quizPicked: ['A'], quizCorrect: true, ms: 2000 }] },
      { ts: f.ts('2026-09-28T12:00:00+08:00'), items: [{ followups: [{ self: '本人追问' }], ms: 3000 }] }];
    value = f.api.timeData(); assert.strictEqual(value.streak, 3); assert.strictEqual(value.totalMs, 6000);
    assert(f.api.renderQuizAccuracy().includes('客观正确率 100%'));
  });
  test('question practice uses the same local day and invalid/future dates do not add activity', () => {
    const f = fixture('Asia/Shanghai', '2026-09-30T00:30:00+08:00');
    f.records.questions = { A: { lastPracticedAt: f.ts('2026-09-29T23:50:00+08:00') }, B: { lastPracticedAt: Infinity }, C: { lastPracticedAt: f.ts('2026-10-01T12:00:00+08:00') } };
    f.records.mock.rounds = [answered(Infinity, 100), answered(NaN, 100), answered(f.ts('2026-09-30T00:05:00+08:00'), Infinity)];
    const value = f.api.timeData(); assert.strictEqual(value.streak, 2); assert.strictEqual(value.activeDays, 2); assert.strictEqual(value.totalMs, 0);
  });
} finally { if (previousTZ === undefined) delete process.env.TZ; else process.env.TZ = previousTZ; }
console.log(`\n结果: ${passed} 通过, 0 失败`);
