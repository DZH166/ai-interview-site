/* 用户记录存储:localStorage 持久化(收藏/状态/笔记/练习史/UI 状态)
   以及导入的扩展题库与文档。所有键使用 aiiv: 前缀。
   导入采用「先整体校验、再原子写入」:任何坏备份不得半导入污染记录。 */
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
  const STATUS_IDS = STATUS.map(s => s.id);

  function blank() {
    return {
      v: 2,
      questions: {},          // qid -> {status, fav, note, viewedAt, practiceCount, lastPracticedAt, lastResult, _updatedAt}
      mock: { rounds: [], draft: null },   // 模拟面试轮次 + 未完成草稿
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
          data.questions = (parsed.questions && typeof parsed.questions === 'object') ? parsed.questions : {};
          data.mock = parsed.mock && Array.isArray(parsed.mock.rounds) ? parsed.mock : { rounds: [], draft: null };
          if (!Array.isArray(data.mock.rounds)) data.mock.rounds = [];
          if (!('draft' in data.mock)) data.mock.draft = null;
          data.ui = Object.assign(blank().ui, parsed.ui || {});
        }
      }
    } catch (e) {
      console.warn('记录读取失败,使用全新记录', e);
      data = blank();
    }
    return data;
  }

  const save = debounce(() => { saveNow(); }, 250);

  /* 同步落盘:自测草稿等不可丢失的数据直接写,不等防抖(刷新/关闭不打断) */
  function saveNow() {
    try {
      data.ui.savedAt = Date.now();
      localStorage.setItem(KEY_RECORDS, JSON.stringify(data));
    } catch (e) {
      toast('保存失败:本地存储空间不足或被禁用', 'err');
    }
  }

  function rec(qid) {
    if (!data.questions[qid]) {
      data.questions[qid] = { status: '', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
    }
    return data.questions[qid];
  }
  /* 记录级更新时间:合并导入时用于判定谁更新(见 importRecords 规则) */
  function touch(r) { r._updatedAt = Date.now(); }

  function setStatus(qid, status) { const r = rec(qid); r.status = status; touch(r); save(); }
  function toggleFav(qid) { const r = rec(qid); r.fav = !r.fav; touch(r); save(); return r.fav; }
  function setNote(qid, text) { const r = rec(qid); r.note = text; touch(r); save(); }
  function markViewed(qid) { const r = rec(qid); r.viewedAt = Date.now(); save(); }
  function markPracticed(qid, result) {
    const r = rec(qid);
    r.practiceCount = (r.practiceCount || 0) + 1;
    r.lastPracticedAt = Date.now();
    if (result) r.lastResult = result;
    touch(r);
    save();
  }

  /* ---- 备份导出 / 导入 ----
     备份范围:
       aiiv-records  个人记录(状态/收藏/笔记/轮次/草稿/UI)
       aiiv-library  导入题库 + 导入资料
       aiiv-full     两者合并(完整备份)
     记录合并规则(见 importRecords):
       fav 取或;计数/时间戳取较大;note/status 按记录级 _updatedAt 新者胜,
       备份无 _updatedAt 时只补空、不覆盖已有值(旧备份不会覆盖新笔记);
       轮次按稳定 ID 去重,重复导入幂等。 */

  function recordsPayload() {
    return { type: 'aiiv-records', v: 2, exported_at: new Date().toISOString(), records: data };
  }
  function libraryPayload() {
    return {
      type: 'aiiv-library', v: 1, exported_at: new Date().toISOString(),
      questions: extraBankLoad(),
      docs: userDocsLoad()
    };
  }
  function exportRecords() { /* 兼容旧调用:个人记录 */
    return JSON.stringify(recordsPayload(), null, 2);
  }
  function exportLibrary() {
    return JSON.stringify(libraryPayload(), null, 2);
  }
  function exportFull() {
    return JSON.stringify({
      type: 'aiiv-full', v: 1, exported_at: new Date().toISOString(),
      records: data, questions: extraBankLoad(), docs: userDocsLoad()
    }, null, 2);
  }

  /* 校验记录对象结构,返回错误列表(空数组=通过)。不修改任何状态。 */
  function validateRecordsObj(incoming) {
    const errs = [];
    if (!incoming || typeof incoming !== 'object' || Array.isArray(incoming)) {
      errs.push('记录必须是对象'); return errs;
    }
    if (!incoming.questions || typeof incoming.questions !== 'object' || Array.isArray(incoming.questions)) {
      errs.push('缺少 questions 字段'); return errs;
    }
    const isTs = v => typeof v === 'number' && isFinite(v) && v >= 0;
    Object.keys(incoming.questions).forEach(qid => {
      const r = incoming.questions[qid];
      if (!r || typeof r !== 'object' || Array.isArray(r)) { errs.push(`题目记录 ${qid}: 不是对象`); return; }
      if (r.status !== undefined && !STATUS_IDS.includes(r.status)) errs.push(`题目记录 ${qid}: status 非法(${JSON.stringify(r.status)})`);
      if (r.fav !== undefined && typeof r.fav !== 'boolean') errs.push(`题目记录 ${qid}: fav 必须是布尔`);
      if (r.note !== undefined && typeof r.note !== 'string') errs.push(`题目记录 ${qid}: note 必须是字符串`);
      ['viewedAt', 'practiceCount', 'lastPracticedAt', '_updatedAt'].forEach(k => {
        if (r[k] !== undefined && !isTs(r[k])) errs.push(`题目记录 ${qid}: ${k} 必须是非负数字`);
      });
      if (r.lastResult !== undefined && typeof r.lastResult !== 'string') errs.push(`题目记录 ${qid}: lastResult 必须是字符串`);
    });
    const mock = incoming.mock;
    if (mock !== undefined) {
      if (!mock || typeof mock !== 'object') errs.push('mock 必须是对象');
      else {
        if (mock.rounds !== undefined && !Array.isArray(mock.rounds)) errs.push('mock.rounds 必须是数组');
        (mock.rounds || []).forEach((rd, i) => {
          if (!rd || typeof rd !== 'object' || Array.isArray(rd)) { errs.push(`轮次 #${i}: 不是对象`); return; }
          if (!isTs(rd.ts)) errs.push(`轮次 #${i}: ts 必须是非负数字`);
          if (!Array.isArray(rd.items)) { errs.push(`轮次 #${i}: 缺少 items 数组`); return; }
          rd.items.forEach((it, j) => {
            if (!it || typeof it !== 'object' || !it.qid) errs.push(`轮次 #${i} 第 ${j + 1} 题: 缺少 qid`);
            else if (it.mark !== undefined && it.mark !== '' && !['weak', 'ok', 'review'].includes(it.mark)) errs.push(`轮次 #${i} 第 ${j + 1} 题: mark 非法`);
          });
        });
        if (mock.draft !== undefined && mock.draft !== null && (typeof mock.draft !== 'object' || Array.isArray(mock.draft))) {
          errs.push('mock.draft 必须是对象或 null');
        }
      }
    }
    if (incoming.ui !== undefined && (!incoming.ui || typeof incoming.ui !== 'object' || Array.isArray(incoming.ui))) {
      errs.push('ui 必须是对象');
    }
    return errs;
  }

  /* 轮次稳定 ID:内容哈希,重复导入幂等 */
  function roundId(rd) {
    if (rd.id) return String(rd.id);
    const basis = JSON.stringify([rd.ts, (rd.items || []).map(i => i.qid)]);
    let h = 5381;
    for (let i = 0; i < basis.length; i++) { h = ((h << 5) + h + basis.charCodeAt(i)) | 0; }
    return 'r' + rd.ts.toString(36) + '-' + (h >>> 0).toString(36);
  }

  /* 合并导入个人记录。失败 throw(状态不变);成功返回 {qMerged, roundsAdded, notesUpdated} */
  function importRecords(jsonText) {
    let obj;
    try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('不是合法的 JSON 文件'); }
    if (!obj || typeof obj !== 'object') throw new Error('格式不正确:应为备份 JSON 对象');
    if (obj.type && !['aiiv-records', 'aiiv-full'].includes(obj.type)) {
      throw new Error(`备份类型不匹配:${obj.type}(本入口接受 aiiv-records / aiiv-full)`);
    }
    if (obj.v !== undefined && obj.v !== 1 && obj.v !== 2) {
      throw new Error(`不支持的备份版本:v${obj.v}`);
    }
    const incoming = obj.records || obj; /* 兼容直接给 records 对象 */
    const errs = validateRecordsObj(incoming);
    if (errs.length) throw new Error('备份校验未通过,未做任何修改:' + errs.slice(0, 5).join(';') + (errs.length > 5 ? ` 等 ${errs.length} 项` : ''));

    /* 在副本上合并,校验+写入都成功才替换内存状态 */
    const merged = JSON.parse(JSON.stringify(data));
    merged.mock.rounds = merged.mock.rounds.slice();
    let qMerged = 0, roundsAdded = 0, notesUpdated = 0;

    Object.keys(incoming.questions).forEach(qid => {
      const inc = incoming.questions[qid];
      const cur = merged.questions[qid] ? JSON.parse(JSON.stringify(merged.questions[qid]))
        : { status: '', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
      const incAt = inc._updatedAt || 0, curAt = cur._updatedAt || 0;
      /* fav:布尔或,保留 false 的真实语义 */
      if (inc.fav === true) cur.fav = true;
      /* 计数与时间戳:取较大(重复导入幂等) */
      ['viewedAt', 'practiceCount', 'lastPracticedAt', '_updatedAt'].forEach(k => {
        if (typeof inc[k] === 'number' && inc[k] > (cur[k] || 0)) cur[k] = inc[k];
      });
      /* note:备份只补空;两者都有时按 _updatedAt 新者胜 */
      if (typeof inc.note === 'string' && inc.note !== '') {
        if (!cur.note) { cur.note = inc.note; notesUpdated++; }
        else if (incAt > curAt && inc.note !== cur.note) { cur.note = inc.note; notesUpdated++; }
      }
      /* status:同样新者胜;无时间戳时只补空 */
      if (inc.status !== undefined && inc.status !== '') {
        if (!cur.status) cur.status = inc.status;
        else if (incAt > curAt) cur.status = inc.status;
      }
      /* lastResult 跟随更新的练习时间 */
      if (inc.lastResult && (inc.lastPracticedAt || 0) > (cur.lastPracticedAt || 0)) cur.lastResult = inc.lastResult;
      merged.questions[qid] = cur;
      qMerged++;
    });

    const existIds = new Set(merged.mock.rounds.map(r => r.id || roundId(r)));
    (incoming.mock && incoming.mock.rounds || []).forEach(r => {
      const id = roundId(r);
      if (existIds.has(id)) return; /* 幂等:同轮次不重复 */
      const copy = JSON.parse(JSON.stringify(r));
      copy.id = id;
      merged.mock.rounds.push(copy);
      existIds.add(id);
      roundsAdded++;
    });
    merged.mock.rounds.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    merged.mock.rounds = merged.mock.rounds.slice(0, 100);
    /* 草稿:已有草稿优先(本机更可能新鲜),备份草稿仅在本地没有时恢复 */
    if (!merged.mock.draft && incoming.mock && incoming.mock.draft) merged.mock.draft = incoming.mock.draft;
    if (incoming.ui && typeof incoming.ui.lastHash === 'string' && incoming.ui.lastHash) merged.ui.lastHash = incoming.ui.lastHash;

    /* 原子写入:直接写 localStorage 成功后才替换内存 */
    try {
      merged.ui.savedAt = Date.now();
      localStorage.setItem(KEY_RECORDS, JSON.stringify(merged));
    } catch (e) {
      throw new Error('保存失败:本地存储空间不足或被禁用,导入未生效');
    }
    data = merged;
    return { qMerged, roundsAdded, notesUpdated };
  }

  /* 导入题库/资料备份。返回 {questionsAdded, docsAdded};失败 throw。 */
  function importLibrary(jsonText) {
    let obj;
    try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('不是合法的 JSON 文件'); }
    if (!obj || typeof obj !== 'object') throw new Error('格式不正确:应为备份 JSON 对象');
    if (obj.type && !['aiiv-library', 'aiiv-full', 'aiiv-bank'].includes(obj.type)) {
      throw new Error(`备份类型不匹配:${obj.type}(本入口接受 aiiv-library / aiiv-full / aiiv-bank)`);
    }
    const qs = obj.questions;
    const docs = obj.docs;
    if (qs === undefined && docs === undefined) throw new Error('备份中没有 questions / docs 数据');
    let questionsAdded = 0, docsAdded = 0;
    let newQ = null, newD = null;
    if (Array.isArray(qs)) {
      /* 与内置题库和已导入题库查重(store 不依赖 Data:直接读打包数据 + 扩展库) */
      const exist = new Set(((typeof window !== 'undefined' && window.APP_DATA && window.APP_DATA.questions) || []).map(q => q.id));
      extraBankLoad().forEach(q => exist.add(q.id));
      newQ = extraBankLoad().slice();
      qs.forEach(q => {
        if (!q || typeof q !== 'object' || !q.id || exist.has(q.id)) return;
        newQ.push(q); exist.add(q.id); questionsAdded++;
      });
    }
    if (Array.isArray(docs)) {
      const exist = new Set(userDocsLoad().map(d => d.id));
      newD = userDocsLoad().slice();
      docs.forEach(d => {
        if (!d || typeof d !== 'object' || !d.id || exist.has(d.id)) return;
        newD.push(d); exist.add(d.id); docsAdded++;
      });
    }
    /* 先写盘,成功才重建内存;后写失败时回滚先写的键,保证不半导入 */
    const prevDocsRaw = localStorage.getItem(KEY_USERDOCS);
    if (newD) {
      try { localStorage.setItem(KEY_USERDOCS, JSON.stringify(newD)); }
      catch (e) { throw new Error('保存失败:本地存储空间不足,导入未生效'); }
    }
    if (newQ) {
      try { localStorage.setItem(KEY_EXTRA, JSON.stringify({ v: 1, saved_at: Date.now(), questions: newQ })); }
      catch (e) {
        if (newD) {
          if (prevDocsRaw === null) localStorage.removeItem(KEY_USERDOCS);
          else localStorage.setItem(KEY_USERDOCS, prevDocsRaw);
        }
        throw new Error('保存失败:本地存储空间不足,导入未生效');
      }
    }
    return { questionsAdded, docsAdded };
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
    STATUS, load, save, saveNow, rec, setStatus, toggleFav, setNote, markViewed, markPracticed,
    exportRecords, exportLibrary, exportFull, importRecords, importLibrary, clearAll,
    extraBankLoad, extraBankSave, userDocsLoad, userDocsSave,
    get data() { return data; }
  };
})();
