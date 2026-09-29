'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '..');
const git = args => execFileSync('git', args, { cwd: ROOT, encoding: 'utf8', maxBuffer: 30 * 1024 * 1024 });
const archive = JSON.parse(fs.readFileSync(path.join(ROOT, 'data/legacy-questions.json'), 'utf8'));
const files = git(['ls-tree', '-r', '--name-only', archive.baseline, '--', 'data/questions']).trim().split('\n');
const original = files.filter(f => f.endsWith('.json')).flatMap(f => JSON.parse(git(['show', archive.baseline + ':' + f])));
const active = fs.readdirSync(path.join(ROOT, 'data/questions')).filter(f => f.endsWith('.json'))
  .flatMap(f => JSON.parse(fs.readFileSync(path.join(ROOT, 'data/questions', f), 'utf8')));
const ids = new Set(active.map(q => q.id));
assert.deepStrictEqual(archive.questions, original.filter(q => !ids.has(q.id)));
assert.equal(archive.questions.length, 254);
assert(!archive.questions.some(q => ids.has(q.id)));
console.log('  PASS 254 archived source objects exactly match removed baseline IDs');
const old = archive.questions[0];
const records = { questions: { [old.id]: { note: '原始个人笔记', status: 'weak', fav: true } }, mock: { rounds: [{ items: [{ qid: old.id, mark: 'weak' }] }] } };
const env = { console, Store: { data: records, rec: id => records.questions[id] || {} },
  Data: { allQuestions: () => active, legacyQuestions: () => archive.questions },
  SRS: { suggestable: () => false } };
vm.createContext(env);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'app/js/views-review.js'), 'utf8') + '\nglobalThis.review = ReviewView;', env);
assert(env.review.getTodayQueue().some(q => q.id === old.id));
assert(env.review.getMistakes().some(q => q.id === old.id));
assert.equal(active.length, ids.size);
assert.equal(records.questions[old.id].note, '原始个人笔记');
console.log('  PASS archived question remains in personal review/mistake queues without changing active bank or records');
