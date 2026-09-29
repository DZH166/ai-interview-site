'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const ROOT = path.resolve(__dirname, '..');
const env = {
  console, setTimeout, clearTimeout, performance,
  Store: { rev: 1 }, Markdown: { sections: text => text ? [{ id: 'body', title: '', buf: [text] }] : [] },
  esc: text => String(text)
};
vm.createContext(env);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/search.js'), 'utf8') + '\nglobalThis.search = Search;', env);
const search = env.search;
let passed = 0;
const check = (name, fn) => { fn(); passed++; console.log('  PASS', name); };
const context = questions => ({ contentVersion: 'v1', questions, docs: [], records: { questions: {} } });

(async () => {
  const initial = context([{ id: 'A', topic: 'agent', title: 'needle', answer: 'answer-only' }]);
  initial.docs = [{ id: 'D', topic: 'rag', title: 'needle', md: 'document-only' }];
  search.build(initial);
  check('strict and partial search preserve scope/topic', () => {
    assert.equal(search.query('needle absent', { scope: 'note', topic: 'pi-agent' }).length, 0);
    assert.equal(search.query('needle absent', { scope: 'q', topic: 'rag' }).length, 0);
    assert(search.query('needle absent', { scope: 'doc', topic: 'rag' }).every(r => r.unit.kind === 'doc'));
  });
  const legacy = context([{ id: 'A', topic: 'agent', title: 'active' }]);
  legacy.contentVersion = 'v2';
  legacy.legacyQuestions = [{ id: 'OLD', topic: 'rag', title: '旧题原文', answer: 'archived explanation' }];
  legacy.records.questions.OLD = { note: 'personal legacy needle', fav: true };
  search.build(legacy);
  check('record-linked archived note is searchable without active-bank membership', () => {
    const hit = search.query('personal legacy needle', { scope: 'note' });
    assert.equal(hit.length, 1); assert.equal(hit[0].unit.qid, 'OLD');
    assert.equal(legacy.questions.length, 1);
  });
  legacy.records.mock = { rounds: [{ id: 'round-1', items: [{ qid: 'OLD', title: '原题快照',
    self: 'original-phrase', revision: 'revised-phrase', questionSnapshot: { topic: 'rag' },
    followups: [{ id: 'f1', q: 'why', self: 'followup-phrase' }] }] }] };
  search.build(legacy);
  check('original/revision/followup search retain round identity and topic filters', () => {
    for (const term of ['original-phrase', 'revised-phrase', 'followup-phrase']) {
      const hits = search.query(term, { topic: 'rag' });
      assert.equal(hits.length, 1); assert.equal(hits[0].unit.roundId, 'round-1');
      assert.equal(search.query(term + ' absent', { topic: 'agent' }).length, 0);
      assert.equal(search.query(term, { scope: 'note' }).length, 0);
    }
    assert.equal(search.query('revised-phrase')[0].unit.field, 'revision');
    legacy.records.mock.rounds = []; search.build(legacy);
    assert.equal(search.query('revised-phrase').length, 0);
  });
  const bulk = context(Array.from({ length: 400 }, (_, i) => ({ id: 'Q' + i, topic: 'agent', title: 'title-' + i, answer: 'body-' + i })));
  bulk.contentVersion = 'bulk';
  search.build(bulk);
  check('large bank exposes titles before finishing body index', () => {
    assert(search.query('title-399').some(r => r.unit.qid === 'Q399'));
    assert(search.stats().pending > 0);
  });
  await search.whenIdle();
  check('body becomes searchable after bounded batches', () => {
    assert(search.query('body-399').some(r => r.unit.qid === 'Q399'));
    assert.equal(search.stats().pending, 0);
  });
  search.build({ ...bulk, contentVersion: 'obsolete' });
  search.build({ ...context([{ id: 'NEW', title: 'replacement' }]), contentVersion: 'new' });
  await search.whenIdle();
  check('older batches cannot resurrect removed content', () => {
    assert.equal(search.query('body-399').length, 0);
    assert(search.query('replacement').some(r => r.unit.qid === 'NEW'));
  });
  console.log(`\n${passed} passed`);
})().catch(error => { console.error(error); process.exitCode = 1; });
