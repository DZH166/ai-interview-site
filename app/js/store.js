/* 用户记录存储:localStorage 持久化(收藏/状态/笔记/练习史/UI 状态)
   以及导入的扩展题库与文档。所有键使用 aiiv: 前缀。 */
'use strict';

const Store = (() => {
  const PREFIX = 'aiiv:';
  const KEY_RECORDS = PREFIX + 'records';
  const KEY_EXTRA = PREFIX + 'bank-extra';
  const KEY_USERDOCS = PREFIX + 'userdocs';

  const STATUS = [
    { id: '', label: '未练习', cls: 'st-none' },
    { id: 'weak', label: '还不熟', cls: 'st-weak' },
    { id: 'ok', label: '基本掌握', cls: 'st-ok' },
    { id: 'review', label: '待复习', cls: 'st-review' }
  ];

  function blank() {
    return {
      v: 2,
      questions: {},          // qid -> {status, fav, note, viewedAt, practiceCount, lastPracticedAt, lastResult}
      mock: { rounds: [] },   // 模拟面试轮次
      ui: { lastHash: '', browse: {}, docPos: {}, search: {} }
    };
  }

  let data = blank();

  function load() {
    try {
      const raw = localStorage.getItem(KEY_RECORDS);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          data = Object.assign(blank(), parsed);
          data.questions = parsed.questions || {};
          data.mock = parsed.mock && Array.isArray(parsed.mock.rounds) ? parsed.mock : { rounds: [] };
          data.ui = Object.assign(blank().ui, parsed.ui || {});
        }
      }
    } catch (e) {
      console.warn('记录读取失败,使用全新记录', e);
      data = blank();
    }
    return data;
  }

  const save = debounce(() => {
    try {
      data.ui.savedAt = Date.now();
      localStorage.setItem(KEY_RECORDS, JSON.stringify(data));
    } catch (e) {
      toast('保存失败:本地存储空间不足或被禁用', 'err');
    }
  }, 250);

  function rec(qid) {
    if (!data.questions[qid]) {
      data.questions[qid] = { status: '', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
    }
    return data.questions[qid];
  }

  function setStatus(qid, status) { rec(qid).status = status; save(); }
  function toggleFav(qid) { const r = rec(qid); r.fav = !r.fav; save(); return r.fav; }
  function setNote(qid, text) { rec(qid).note = text; save(); }
  function markViewed(qid) { const r = rec(qid); r.viewedAt = Date.now(); save(); }
  function markPracticed(qid, result) {
    const r = rec(qid);
    r.practiceCount = (r.practiceCount || 0) + 1;
    r.lastPracticedAt = Date.now();
    if (result) r.lastResult = result;
    save();
  }

  /* ---- 导入 / 导出 ---- */
  function exportRecords() {
    return JSON.stringify({ type: 'aiiv-records', exported_at: new Date().toISOString(), records: data }, null, 2);
  }

  /* 合并导入:true=成功;返回 {qMerged, roundsAdded} */
  function importRecords(jsonText) {
    const obj = JSON.parse(jsonText);
    const incoming = obj && obj.records ? obj.records : obj;
    if (!incoming || typeof incoming !== 'object' || !incoming.questions) {
      throw new Error('格式不正确:缺少 questions 字段');
    }
    let qMerged = 0, roundsAdded = 0;
    Object.keys(incoming.questions).forEach(qid => {
      const inc = incoming.questions[qid] || {};
      const cur = rec(qid);
      ['status', 'fav', 'note', 'viewedAt', 'practiceCount', 'lastPracticedAt', 'lastResult'].forEach(k => {
        if (inc[k] !== undefined && inc[k] !== null && inc[k] !== '' && inc[k] !== false) cur[k] = inc[k];
      });
      qMerged++;
    });
    const rounds = (incoming.mock && incoming.mock.rounds) || [];
    rounds.forEach(r => { data.mock.rounds.push(r); roundsAdded++; });
    data.mock.rounds.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    data.mock.rounds = data.mock.rounds.slice(0, 100);
    if (incoming.ui && incoming.ui.lastHash) data.ui.lastHash = incoming.ui.lastHash;
    save();
    return { qMerged, roundsAdded };
  }

  function clearAll() {
    data = blank();
    localStorage.removeItem(KEY_RECORDS);
    save();
  }

  /* ---- 扩展题库(导入的题目) ---- */
  function extraBankLoad() {
    try {
      const raw = localStorage.getItem(KEY_EXTRA);
      if (!raw) return [];
      const obj = JSON.parse(raw);
      return Array.isArray(obj.questions) ? obj.questions : [];
    } catch (e) { return []; }
  }
  function extraBankSave(questions) {
    try {
      localStorage.setItem(KEY_EXTRA, JSON.stringify({ v: 1, saved_at: Date.now(), questions }));
      return true;
    } catch (e) {
      toast('导入的题库过大,本地存储保存失败', 'err');
      return false;
    }
  }

  /* ---- 用户导入的文档 ---- */
  function userDocsLoad() {
    try {
      const raw = localStorage.getItem(KEY_USERDOCS);
      if (!raw) return [];
      const arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) { return []; }
  }
  function userDocsSave(arr) {
    try {
      localStorage.setItem(KEY_USERDOCS, JSON.stringify(arr));
      return true;
    } catch (e) {
      toast('导入的文档过大,本地存储保存失败(建议单篇 < 1MB)', 'err');
      return false;
    }
  }

  return {
    STATUS, load, save, rec, setStatus, toggleFav, setNote, markViewed, markPracticed,
    exportRecords, importRecords, clearAll,
    extraBankLoad, extraBankSave, userDocsLoad, userDocsSave,
    get data() { return data; }
  };
})();
