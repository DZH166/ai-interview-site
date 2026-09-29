/* Real Data module: on-demand loading, partial failure, retry, re-init and isolation. */
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const code = fs.readFileSync(path.join(__dirname, '../app/js/common.js'), 'utf8');
const manifest = { hash: 'test', topics: { agent: { file: 'agent.abc.json', count: 1 }, rag: { file: 'rag.def.json', count: 1 } } };
function fixture(fetcher) {
  const calls = [];
  const ctx = vm.createContext({ console, setTimeout, clearTimeout, URL,
    window: { APP_DATA: { content_hash: 'test', questions_index: [
      { id: 'A', topic: 'agent', title: 'Agent' }, { id: 'R', topic: 'rag', title: 'RAG' }
    ], topics: [{ id: 'agent' }, { id: 'rag' }], docs: [] } },
    Store: { loadIssues: {}, resetLoadIssues() { this.loadIssues = {}; }, loadExtraBankSafe: () => [], loadUserDocsSafe: () => [] },
    fetch: async url => { calls.push(url); return fetcher(url); }
  });
  vm.runInContext(code + '\nglobalThis.api = Data;', ctx);
  ctx.api.init();
  return { data: ctx.api, calls, ctx };
}
const response = data => ({ ok: true, json: async () => data, clone: () => response(data) });
(async () => {
  let failures = 0;
  async function check(name, fn) { try { await fn(); console.log('PASS', name); } catch (e) { failures++; console.error('FAIL', name, e.message); } }
  await check('init is index-only and makes no background downloads', () => {
    const { data, calls } = fixture(async () => response(manifest));
    assert.equal(data.allQuestions().length, 2); assert.equal(calls.length, 0);
  });
  await check('one topic is sufficient; unrelated topics are not fetched', async () => {
    const { data, calls } = fixture(async url => response(url.includes('manifest') ? manifest : { questions: [{ id: 'A', topic: 'agent', answer: 'ready' }] }));
    await data.ensureQuestion('A');
    assert.equal(data.question('A').answer, 'ready');
    assert(!calls.some(x => x.includes('rag.def')));
    data.init(); assert.equal(data.question('A').answer, 'ready'); assert.equal(data.allQuestions().length, 2);
  });
  await check('failed manifest preserves index and is retryable', async () => {
    let fail = true;
    const { data } = fixture(async url => { if (fail) throw Error('503'); return response(url.includes('manifest') ? manifest : { questions: [{ id: 'A', topic: 'agent', answer: 'recovered' }] }); });
    await assert.rejects(data.ensureQuestion('A'));
    data.init(); assert.equal(data.allQuestions().length, 2); assert.equal(data.questionsLoaded(), false);
    fail = false; await data.ensureQuestion('A'); assert.equal(data.question('A').answer, 'recovered');
  });
  await check('successful topics remain usable after another topic fails', async () => {
    const { data } = fixture(async url => { if (url.includes('rag.def')) throw Error('offline'); return response(url.includes('manifest') ? manifest : { questions: [{ id: 'A', topic: 'agent', answer: 'ready' }] }); });
    const result = await data.ensureTopics(['agent', 'rag']);
    assert.equal(result.errors.length, 1); assert.equal(data.question('A').answer, 'ready');
    assert.equal(data.question('R').title, 'RAG'); assert.equal(data.questionsLoaded(), false);
  });
  await check('concurrent requests share a fetch and loaded topics emit incremental events', async () => {
    const { data, calls } = fixture(async url => response(url.includes('manifest') ? manifest : { questions: [{ id: 'A', topic: 'agent', answer: 'ready' }] }));
    const events = []; const off = data.onContentChange(e => events.push(e));
    await Promise.all([data.ensureQuestion('A'), data.ensureQuestion('A')]); off();
    assert.equal(calls.filter(x => x.includes('agent.abc')).length, 1);
    assert.equal(events.filter(e => e.kind === 'questions').length, 1);
  });
  await check('a foreground question moves ahead of queued background topics without duplication', async () => {
    const names = ['first', 'second', 'third', 'rag'];
    const releases = {}, requested = [];
    const { data, ctx } = fixture(async url => {
      const id = url.split('/').pop().split('.')[0]; requested.push(id);
      await new Promise(resolve => { releases[id] = resolve; });
      return response({ questions: [{ id, topic: id, answer: id }] });
    });
    ctx.window.APP_DATA.questions_index = names.map(id => ({ id, topic: id, title: id }));
    ctx.window.APP_DATA.manifest = { topics: Object.fromEntries(names.map(id => [id, { file: id + '.json' }])) };
    data.init(); const background = data.ensureTopics(names);
    while (requested.length < 2) await new Promise(resolve => setTimeout(resolve, 1));
    const foreground = data.ensureQuestion('rag'); releases.first();
    while (requested.length < 3) await new Promise(resolve => setTimeout(resolve, 1));
    assert.equal(requested[2], 'rag'); releases.rag(); releases.second();
    while (!releases.third) await new Promise(resolve => setTimeout(resolve, 1));
    releases.third(); await background; await foreground;
    assert.equal(requested.filter(id => id === 'rag').length, 1);
  });
  if (failures) process.exitCode = 1;
})();
