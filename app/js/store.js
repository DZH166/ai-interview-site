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
      v: 3,
      questions: {},          // qid -> {status, fav, note, viewedAt, practiceCount, lastPracticedAt, lastResult, _updatedAt}
      mock: { rounds: [], draft: null },   // 模拟面试轮次 + 未完成草稿
      drillAttempts: {},                    // drillId -> [attempt];attempt 稳定归属不依赖题目
      ui: { lastHash: '', browse: {}, docPos: {}, search: {} }
    };
  }

  /* ---- 学习记录状态模型(专项尝试与项目运行共用同一套语义) ----
     持久状态只有三种,状态转换唯一,不存在「看起来像提交了其实没落盘」的中间态:

       draft      编辑中(击键自动落盘,刷新可恢复)
       completed  提交成功:计入完成次数与复习聚合
       abandoned  明确放弃:留痕但不计入完成,不参与「未解决」判定

     转换(唯一路径):
       draft --提交且写盘成功--> completed
       draft --提交且写盘失败--> 仍是 draft,附内存级 saveError,界面提供「重试保存」
       draft --放弃---------->  abandoned
       任意 --开始新尝试------>  新的空 draft(旧记录原样保留)

     写盘失败**不是**一种持久状态(失败就没有磁盘可写),因此它在内存里表示为
     「draft + saveError」,绝不把内存推进成 completed 让界面与磁盘分叉。 */
  const STATE = { DRAFT: 'draft', COMPLETED: 'completed', ABANDONED: 'abandoned' };
  const STATE_IDS = [STATE.DRAFT, STATE.COMPLETED, STATE.ABANDONED];
  const STATE_LABEL = { draft: '草稿', completed: '已完成', abandoned: '已放弃' };

  /* 记录时间:取 updatedAt 与 ts 的较大者。所有「最新一次」判定只走这一个函数,
     不依赖数组顺序(数组顺序会被导入/合并打乱)。 */
  function recTime(a) {
    if (!a || typeof a !== 'object') return -1;
    const u = typeof a.updatedAt === 'number' && isFinite(a.updatedAt) ? a.updatedAt : 0;
    const t = typeof a.ts === 'number' && isFinite(a.ts) ? a.ts : 0;
    return Math.max(u, t);
  }
  /* 时间相同按稳定身份排序,不让导入顺序决定「最新」。 */
  function compareRecords(a, b) {
    const time = recTime(a) - recTime(b);
    if (time) return time;
    const left = String(a && (a.attemptId || a.runId || a.id) || '');
    const right = String(b && (b.attemptId || b.runId || b.id) || '');
    return left < right ? -1 : left > right ? 1 : 0;
  }
  /* 最新的满足条件的记录,与历史排序使用同一套规则。 */
  function latestOf(list, pred) {
    let best = null;
    (list || []).forEach(a => {
      if (pred && !pred(a)) return;
      if (!best || compareRecords(a, best) >= 0) best = a;
    });
    return best;
  }
  /* 按时间升序排列的副本(历史回看、前后比较统一用它) */
  function sortedByTime(list) {
    return (list || []).slice().sort(compareRecords);
  }

  /* 数据版本号:任何写入都自增。搜索索引据此判断自己是否过期,
     不再依赖「每个调用点都记得重建索引」这条纪律。 */
  let rev = 0;
  function bumpRev() { rev++; }
  const invalidators = [];
  function onInvalidate(fn) { if (typeof fn === 'function') invalidators.push(fn); }
  function notifyInvalidate() { invalidators.slice().forEach(fn => { try { fn(); } catch (e) { /* 通知失败不影响数据 */ } }); }


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
          data.drillAttempts = (parsed.drillAttempts && typeof parsed.drillAttempts === 'object' && !Array.isArray(parsed.drillAttempts)) ? parsed.drillAttempts : {};
          /* 启动即迁移旧题目记录里的 drillTries(幂等) */
        }
      }
    } catch (e) {
      console.warn('记录读取失败,使用全新记录', e);
      data = blank();
    }
    migrateLegacyDrillTries();
    /* 旧版项目运行记录(无 runId)补齐确定性 ID,避免后续合并静默丢弃 */
    migrateLegacyRuns(data);
    return data;
  }

  const save = debounce(() => { saveNow(); }, 250);

  /* 最近一次写盘失败的原因(供界面显示真实反馈,而不是笼统的「保存失败」) */
  let lastSaveError = null;

  /* 同步落盘:自测草稿等不可丢失的数据直接写,不等防抖(刷新/关闭不打断)。
     返回布尔值(既有调用点用 `=== false` 判断);失败原因见 Store.lastSaveError。 */
  function saveNow() {
    try {
      data.ui.savedAt = Date.now();
      localStorage.setItem(KEY_RECORDS, JSON.stringify(data));
      lastSaveError = null;
      bumpRev();
      notifyInvalidate();   /* 数据变了:派生索引(全文检索)立即失效,按需重建 */
      return true;
    } catch (e) {
      lastSaveError = (e && e.name === 'QuotaExceededError')
        ? '本地存储空间已满(QuotaExceededError)'
        : ('本地存储不可用:' + ((e && e.message) || e));
      toast('保存失败:' + lastSaveError, 'err');
      return false;
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
       计数/时间戳取较大;note/status/fav 按记录级 _updatedAt 新者胜;
       无更新时间的本地初始值可以补齐,较新记录中的明确清空/取消不会被旧备份撤销;
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
  /* ---- 题目 schema 校验(共享数据层规则)----
     普通题库导入(MaintainView)、资料备份、完整备份、启动读取隔离
     全部使用同一份规则。返回 {errors, warnings};errors 非空的题不允许进入存储。 */
  const Q_ID_RE = /^[A-Z]{2,4}-\d{3}$/;
  const Q_TYPES = ['concept', 'principle', 'comparison', 'code', 'debug', 'scenario'];
  const Q_DIFFS = ['basic', 'intermediate', 'advanced'];
  const Q_VERIFY = ['verified', 'partial', 'todo'];
  /* 来源枚举以真实题库数据为事实基础(official-docs/official-blog/website 在库中广泛使用);
     迁移映射:website 与 web 同义,读取时归一,原始字段保留不丢 */
  const Q_SRC_KINDS = ['official', 'official-docs', 'official-blog', 'paper', 'repo', 'independent', 'web', 'website'];
  const MOJI_RE = /\ufffd|锟斤拷|烫烫|Ã[^\x00-\x7F]/;

  function topicIds() {
    return ((typeof window !== 'undefined' && window.APP_DATA && window.APP_DATA.topics) || []).map(t => t.id);
  }

  function validateQuestion(q, seen, existing) {
    const errs = [], warns = [];
    const push = m => errs.push(`${(q && q.id) || '?'}: ${m}`);
    if (!q || typeof q !== 'object' || Array.isArray(q)) { errs.push('题不是对象'); return { errs, warns }; }
    if (typeof q.id !== 'string' || !Q_ID_RE.test(q.id)) push('题号不符合 XX-NNN');
    if (seen.has(q.id)) push('编号重复(同批或已存在)');
    if (typeof q.id === 'string') seen.add(q.id);
    if (!Q_TYPES.includes(q.type)) push(`type 非法(${JSON.stringify(q.type ?? null)})`);
    if (!Q_DIFFS.includes(q.difficulty)) push(`difficulty 非法(${JSON.stringify(q.difficulty ?? null)})`);
    if (!topicIds().includes(q.topic)) push(`topic 非法(${JSON.stringify(q.topic ?? null)})`);
    ['title', 'answer', 'plain', 'deep', 'example', 'interview'].forEach(k => {
      if (typeof q[k] !== 'string' || !q[k].trim()) push(`缺字段或非文本 ${k}`);
    });
    if (q.prompt !== undefined && typeof q.prompt !== 'string') push('prompt 需为文本');
    if (!Array.isArray(q.tags) || !q.tags.length) push('tags 需为非空数组');
    else q.tags.forEach((t, i) => { if (typeof t !== 'string') push(`tags[${i}] 非文本`); });
    if (!Array.isArray(q.followups) || !q.followups.length) push('followups 需为非空数组');
    else q.followups.forEach((f, j) => { if (!f || !String(f.q || '').trim() || !String(f.a || '').trim()) push(`followups[${j}] 缺 q/a`); });
    if (!Array.isArray(q.pitfalls) || !q.pitfalls.length) push('pitfalls 需为非空数组');
    else q.pitfalls.forEach((p, j) => { if (typeof p !== 'string' || !p.trim()) push(`pitfalls[${j}] 非文本`); });
    if (!q.check || typeof q.check !== 'object' || !String(q.check.q || '').trim() || !String(q.check.a || '').trim()) push('check 缺 q/a');
    ['prerequisites', 'related', 'doc_refs'].forEach(k => {
      if (q[k] !== undefined && !Array.isArray(q[k])) push(`${k} 需为数组`);
    });
    if (!Array.isArray(q.sources) || !q.sources.length) push('缺 sources');
    else q.sources.forEach((s, j) => {
      if (!s || typeof s !== 'object') push(`sources[${j}] 非对象`);
      else {
        if (!Q_SRC_KINDS.includes(s.kind)) push(`sources[${j}].kind 非法(${JSON.stringify(s.kind ?? null)})`);
        if (typeof s.name !== 'string' || !s.name.trim()) push(`sources[${j}].name 缺失`);
        if (s.url !== undefined && s.url !== '' && !/^https?:\/\//.test(s.url)) push(`sources[${j}].url 需为 http(s) 链接`);
      }
    });
    if (!q.verify || typeof q.verify !== 'object' || !Q_VERIFY.includes(q.verify.status)) {
      push(`verify.status 非法(${JSON.stringify((q.verify || {}).status ?? null)})`);
    }
    if (MOJI_RE.test(JSON.stringify(q))) push('疑似乱码(锟斤拷/烫烫/替换符)');
    return { errs, warns };
  }

  /* 校验一批题目。existingIds:视为已存在的编号集合(默认当前全库)。 */
  function validateQuestions(arr, existingIds) {
    const existing = existingIds || new Set(
      (((typeof window !== 'undefined' && window.APP_DATA && window.APP_DATA.questions) || []).map(q => q.id))
        .concat(extraBankLoad().map(q => q.id))
    );
    const seen = new Set();
    const errors = [], warnings = [];
    (arr || []).forEach(q => {
      const { errs, warns } = validateQuestion(q, seen, existing);
      errors.push(...errs); warnings.push(...warns);
    });
    return { errors, warnings };
  }

  /* 校验导入资料(用户文档)条目 */
  function validateDoc(d) {
    if (!d || typeof d !== 'object' || Array.isArray(d)) return '资料条目不是对象';
    if (typeof d.id !== 'string' || !/^udoc-\d+$/.test(d.id)) return '资料 id 非法(需 udoc-数字)';
    if (typeof d.title !== 'string' || !d.title.trim()) return '资料缺 title';
    if (d.parsed === false) {
      if (d.text !== undefined && d.text !== '' && typeof d.text !== 'string') return '资料 text 需为字符串';
    } else if (typeof d.text !== 'string' || !d.text.trim()) return '资料缺正文 text';
    if (d.ts !== undefined && !(typeof d.ts === 'number' && isFinite(d.ts))) return '资料 ts 需为数字';
    return null;
  }

  /* ---- 启动隔离:历史坏扩展数据不进入内存,原始内容保留在隔离键,可导出修复 ---- */
  const KEY_QUARANTINE = PREFIX + 'quarantine';
  /* 隔离写入:返回 true=原文已安全保存到隔离区;false=保存失败(调用方必须保留原键)。
     幂等:相同 kind+raw 不重复入队(重复启动不会累积)。 */
  function quarantineAdd(kind, reason, raw) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(KEY_QUARANTINE) || '[]'); if (!Array.isArray(arr)) arr = []; } catch (e) { arr = []; }
    const fp = kind + '|' + (raw || '');
    if (arr.some(e => (e.kind + '|' + (e.raw || '')) === fp)) return true;
    arr.push({ kind, reason, raw, ts: Date.now() });
    try { localStorage.setItem(KEY_QUARANTINE, JSON.stringify(arr)); return true; }
    catch (e) { return false; }
  }
  /* 本轮加载的隔离失败状态(Data.init 每轮重置):供维护页提示与重试 */
  let loadIssues = { quarantineFailed: 0 };
  function resetLoadIssues() { loadIssues = { quarantineFailed: 0 }; }
  function quarantineCount() {
    try { const a = JSON.parse(localStorage.getItem(KEY_QUARANTINE) || '[]'); return Array.isArray(a) ? a.length : 0; }
    catch (e) { return 0; }
  }
  function quarantineExport() {
    try { return JSON.stringify({ type: 'aiiv-quarantine', v: 1, items: JSON.parse(localStorage.getItem(KEY_QUARANTINE) || '[]') }, null, 2); }
    catch (e) { return '[]'; }
  }
  /* 校验后的扩展题库加载:合法的返回,坏的移入隔离(保留原始),不进入内存 */
  function loadExtraBankSafe() {
    let raw = null;
    try { raw = localStorage.getItem(KEY_EXTRA); } catch (e) { return []; }
    if (!raw) return [];
    let obj = null, parseFailed = false;
    try { obj = JSON.parse(raw); } catch (e) { parseFailed = true; }
    if (parseFailed || !obj || !Array.isArray(obj.questions)) {
      const reason = parseFailed ? 'JSON 解析失败' : 'questions 字段缺失';
      /* 只有确认原文已安全进入隔离区,才允许清理原键;失败则原键原样保留 */
      if (quarantineAdd('bank-extra', reason, raw)) {
        try { localStorage.removeItem(KEY_EXTRA); } catch (e) { /* 保留原键 */ }
      } else {
        loadIssues.quarantineFailed++;
      }
      return [];
    }
    const seen = new Set(((typeof window !== 'undefined' && window.APP_DATA && window.APP_DATA.questions) || []).map(q => q.id));
    const qs = obj.questions;
    const good = [], bads = [];
    qs.forEach(q => {
      const { errs } = validateQuestion(q, new Set(), seen);
      if (errs.length) bads.push({ q, errs });
      else { good.push(q); seen.add(q.id); }
    });
    if (bads.length) {
      let allSaved = true;
      bads.forEach(({ q, errs }) => {
        if (!quarantineAdd('bank-extra', errs.slice(0, 3).join('; '), JSON.stringify(q))) allSaved = false;
      });
      /* 隔离全部成功才允许用合法子集重写原库;失败则原键保持原字节(下次启动幂等重试) */
      if (allSaved && good.length !== qs.length) {
        try { localStorage.setItem(KEY_EXTRA, JSON.stringify({ v: 1, saved_at: Date.now(), questions: good })); }
        catch (e) { allSaved = false; }
      }
      if (!allSaved) loadIssues.quarantineFailed++;
    }
    return good;
  }
  /* 校验后的用户资料加载(同上) */
  function loadUserDocsSafe() {
    let raw = null;
    try { raw = localStorage.getItem(KEY_USERDOCS); } catch (e) { return []; }
    if (!raw) return [];
    let arr = null, parseFailed = false;
    try { arr = JSON.parse(raw); } catch (e) { parseFailed = true; }
    if (parseFailed || !Array.isArray(arr)) {
      const reason = parseFailed ? 'JSON 解析失败' : '不是数组';
      if (quarantineAdd('userdocs', reason, raw)) {
        try { localStorage.removeItem(KEY_USERDOCS); } catch (e) { /* 保留原键 */ }
      } else {
        loadIssues.quarantineFailed++;
      }
      return [];
    }
    const good = [], bads = [];
    arr.forEach(d => {
      const err = validateDoc(d);
      if (err) bads.push({ d, err });
      else good.push(d);
    });
    if (bads.length) {
      let allSaved = true;
      bads.forEach(({ d, err }) => {
        if (!quarantineAdd('userdocs', err, JSON.stringify(d))) allSaved = false;
      });
      if (allSaved && good.length !== arr.length) {
        try { localStorage.setItem(KEY_USERDOCS, JSON.stringify(good)); }
        catch (e) { allSaved = false; }
      }
      if (!allSaved) loadIssues.quarantineFailed++;
    }
    return good;
  }
  /* 原始内容直接导出(隔离失败时用户仍可拿走原字节) */
  function rawExtrasExport() {
    return JSON.stringify({
      type: 'aiiv-raw-extras', v: 1, exported_at: new Date().toISOString(),
      bank_extra_raw: localStorage.getItem(KEY_EXTRA),
      userdocs_raw: localStorage.getItem(KEY_USERDOCS),
    }, null, 2);
  }

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
      if (r.contentRev !== undefined && typeof r.contentRev !== 'string') errs.push(`题目记录 ${qid}: contentRev 必须是字符串`);
      if (r.drillTries !== undefined) {
        if (!Array.isArray(r.drillTries)) { errs.push(`题目记录 ${qid}: drillTries 必须是数组`); }
        else r.drillTries.forEach((t, i) => {
          if (!t || typeof t !== 'object') { errs.push(`题目记录 ${qid}: drillTries[${i}] 非对象`); return; }
          if (typeof t.drillId !== 'string' || !t.drillId) errs.push(`题目记录 ${qid}: drillTries[${i}] 缺 drillId`);
          if (t.version !== undefined && !(typeof t.version === 'number' && t.version >= 1)) errs.push(`题目记录 ${qid}: drillTries[${i}].version 非法`);
          if (t.myAnswer !== undefined && typeof t.myAnswer !== 'string') errs.push(`题目记录 ${qid}: drillTries[${i}].myAnswer 非文本`);
          if (t.observed !== undefined && typeof t.observed !== 'string') errs.push(`题目记录 ${qid}: drillTries[${i}].observed 非文本`);
          if (t.selfRating !== undefined && t.selfRating !== '' && !['solved', 'partial', 'unsolved'].includes(t.selfRating)) errs.push(`题目记录 ${qid}: drillTries[${i}].selfRating 非法`);
          if (t.mistake !== undefined && typeof t.mistake !== 'string') errs.push(`题目记录 ${qid}: drillTries[${i}].mistake 非文本`);
          if (t.review !== undefined && typeof t.review !== 'string') errs.push(`题目记录 ${qid}: drillTries[${i}].review 非文本`);
          if (t.ts !== undefined && !(typeof t.ts === 'number' && t.ts >= 0)) errs.push(`题目记录 ${qid}: drillTries[${i}].ts 非法`);
        });
      }
      if (r.reviewReasons !== undefined) {
        const OK = ['concept', 'prereq', 'causal', 'exec', 'edge', 'expression'];
        if (!Array.isArray(r.reviewReasons) || r.reviewReasons.some(x => !OK.includes(x))) errs.push(`题目记录 ${qid}: reviewReasons 非法`);
      }
    });
    /* 顶层专项尝试(drillAttempts)校验 */
    if (incoming.drillAttempts !== undefined) {
      if (!incoming.drillAttempts || typeof incoming.drillAttempts !== 'object' || Array.isArray(incoming.drillAttempts)) {
        errs.push('drillAttempts 必须是对象');
      } else {
        Object.keys(incoming.drillAttempts).forEach(did => {
          const list = incoming.drillAttempts[did];
          if (!Array.isArray(list)) { errs.push(`drillAttempts.${did} 必须是数组`); return; }
          list.forEach((a, i) => validateAttempt(a).forEach(e => errs.push(`drillAttempts.${did}[${i}]: ${e}`)));
        });
      }
    }
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
      return errs;
    }
    const ui = incoming.ui || {};
    if (ui.pathProgress !== undefined) {
      if (!ui.pathProgress || typeof ui.pathProgress !== 'object' || Array.isArray(ui.pathProgress)) {
        errs.push('ui.pathProgress 必须是对象');
      } else {
        Object.keys(ui.pathProgress).forEach(sid => {
          const e = ui.pathProgress[sid];
          if (typeof e === 'number') return; /* 旧版形状 */
          if (!e || typeof e !== 'object') { errs.push(`pathProgress.${sid} 非法`); return; }
          if (e.done !== undefined && !(typeof e.done === 'number' && e.done >= 0)) errs.push(`pathProgress.${sid}.done 非法`);
          if (e.cancelled !== undefined && !(typeof e.cancelled === 'number' && e.cancelled >= 0)) errs.push(`pathProgress.${sid}.cancelled 非法`);
        });
      }
    }
    if (ui.docPos !== undefined && ui.docPos !== null && (typeof ui.docPos !== 'object' || Array.isArray(ui.docPos))) {
      errs.push('ui.docPos 必须是对象或 null');
    }
    if (ui.pathVersion !== undefined && typeof ui.pathVersion !== 'string') errs.push('ui.pathVersion 必须是字符串');
    return errs;
  }

  /* 专项尝试 attempt 结构校验 */
  function validateAttempt(a) {
    const errs = [];
    if (!a || typeof a !== 'object' || Array.isArray(a)) { errs.push('attempt 不是对象'); return errs; }
    if (typeof a.attemptId !== 'string' || !a.attemptId) errs.push('attempt 缺 attemptId');
    if (typeof a.drillId !== 'string' || !a.drillId) errs.push('attempt 缺 drillId');
    if (a.version !== undefined && !(typeof a.version === 'number' && a.version >= 1)) errs.push('attempt.version 非法');
    if (!STATE_IDS.includes(a.status)) errs.push('attempt.status 必须是 draft/completed/abandoned');
    ['myAnswer', 'observed', 'review'].forEach(k => {
      if (a[k] !== undefined && typeof a[k] !== 'string') errs.push(`attempt.${k} 必须是字符串`);
    });
    if (a.selfRating !== undefined && a.selfRating !== '' && !['solved', 'partial', 'unsolved'].includes(a.selfRating)) {
      errs.push('attempt.selfRating 非法');
    }
    if (a.ts !== undefined && !(typeof a.ts === 'number' && a.ts >= 0)) errs.push('attempt.ts 非法');
    if (a.updatedAt !== undefined && !(typeof a.updatedAt === 'number' && a.updatedAt >= 0)) errs.push('attempt.updatedAt 非法');
    return errs;
  }

  /* 迁移:旧格式 questions[qid].drillTries → drillAttempts(幂等;按 drillId+ts 去重)。返回迁移条数 */
  function migrateLegacyDrillTries(target) {
    const t0 = target || data;
    let moved = 0;
    Object.keys(t0.questions).forEach(qid => {
      const r = t0.questions[qid];
      if (!Array.isArray(r.drillTries) || !r.drillTries.length) return;
      r.drillTries.forEach(t => {
        if (!t || !t.drillId) return;
        const list = t0.drillAttempts[t.drillId] = t0.drillAttempts[t.drillId] || [];
        const key = t.ts || 0;
        if (list.some(x => (x.ts || 0) === key && x.myAnswer === (t.myAnswer || ''))) return;
        list.push({
          attemptId: 'at-' + (t.ts || Date.now()) + '-' + Math.random().toString(36).slice(2, 6),
          drillId: t.drillId, version: t.version || 1, status: 'completed',
          myAnswer: t.myAnswer || '', observed: t.observed || '', selfRating: t.selfRating || '',
          review: t.review || '', ts: t.ts || Date.now(), updatedAt: t.ts || Date.now(),
          _migratedFrom: qid,
        });
        moved++;
      });
      delete r.drillTries;   /* 迁出后删除旧字段(题目关联由尝试自身携带) */
    });
    return moved;
  }

  /* 轮次稳定 ID:内容哈希,重复导入幂等 */
  function roundId(rd) {
    if (rd.id) return String(rd.id);
    const basis = JSON.stringify([rd.ts, (rd.items || []).map(i => i.qid)]);
    let h = 5381;
    for (let i = 0; i < basis.length; i++) { h = ((h << 5) + h + basis.charCodeAt(i)) | 0; }
    return 'r' + rd.ts.toString(36) + '-' + (h >>> 0).toString(36);
  }
  /* 内容哈希(稳定、与数组下标无关):用于给缺 ID 的历史记录补齐确定性 ID */
  function contentHash(s) {
    let h = 5381;
    const str = String(s || '');
    for (let i = 0; i < str.length; i++) { h = ((h << 5) + h + str.charCodeAt(i)) | 0; }
    return (h >>> 0).toString(36);
  }

  /* 迁移:旧版(a1 之前)项目运行记录没有 runId,恢复时会被静默丢弃。
     这里按「项目 ID + 内容」生成确定性 runId 补齐:幂等、可重复导入、
     内容不同的历史记录各自独立。返回补齐条数。 */
  function migrateLegacyRuns(target) {
    const runs = (target && target.ui && target.ui.projectRuns) || {};
    let fixed = 0;
    Object.keys(runs).forEach(pid => {
      const list = runs[pid];
      if (!Array.isArray(list)) return;
      list.forEach(r => {
        if (!r || typeof r !== 'object' || r.runId) return;
        r.runId = 'run-legacy-' + contentHash([pid, r.ts || 0, r.runOutput || '', r.debug || '', r.todo || '', r.stepStatus || ''].join('\u0001'));
        r._legacy = true;
        r.ts = r.ts || r.updatedAt || 0;
        fixed++;
      });
    });
    return fixed;
  }


  /* ui 持久学习状态合并:阶段进度(含取消追溯)与阅读位置。
     本地为空才采用备份;两者都有时按阶段比较最新事件,同刻本地胜。 */
  function normStageEntry(e) {
    if (typeof e === 'number') return { done: e };
    return (e && typeof e === 'object') ? e : {};
  }
  function mergePathProgress(local, incoming) {
    local = local || {}; incoming = incoming || {};
    const out = {};
    new Set([...Object.keys(local), ...Object.keys(incoming)]).forEach(id => {
      const a = normStageEntry(local[id]), b = normStageEntry(incoming[id]);
      const ta = Math.max(a.done || 0, a.cancelled || 0);
      const tb = Math.max(b.done || 0, b.cancelled || 0);
      if (tb > ta) { if (Object.keys(b).length) out[id] = b; }
      else if (ta > 0 || Object.keys(a).length) { if (Object.keys(a).length) out[id] = a; }
    });
    return out;
  }

  /* ---- 项目草稿的合并规则(唯一、确定、可解释) ----
     草稿是「一个文档」,它的 updatedAt 是这份文档最后一次编辑的时间。因此按整份文档
     判定归属,而不是逐字段各自比较时间——逐字段比较会带来两个真实故障:
       ① 字段顺序会影响结果(先碰到 updatedAt 就把后续字段判成「不更新」);
       ② 备份里更旧的字段值会复活用户已经清空的内容。
     规则:
       - 本地没有该草稿 → 整份采用;
       - 备份 updatedAt 更新 → 整份采用(空串是有效值,代表用户明确清空);
       - 备份不更新或同刻 → 只补本地缺失(undefined)的键,绝不覆盖、绝不复活清空;
       - 未采用任何内容时不改动本地时间戳。 */
  function mergeProjectDrafts(merged, incomingDrafts, report) {
    if (!incomingDrafts || typeof incomingDrafts !== 'object') return;
    merged.ui.projectDrafts = merged.ui.projectDrafts || {};
    Object.keys(incomingDrafts).forEach(pid => {
      const inc = incomingDrafts[pid];
      if (!inc || typeof inc !== 'object' || Array.isArray(inc)) return;
      const cur = merged.ui.projectDrafts[pid];
      const incAt = typeof inc.updatedAt === 'number' ? inc.updatedAt : 0;
      if (!cur || typeof cur !== 'object') {
        merged.ui.projectDrafts[pid] = JSON.parse(JSON.stringify(inc));
        report.draftsAdopted++;
        return;
      }
      const curAt = typeof cur.updatedAt === 'number' ? cur.updatedAt : 0;
      if (incAt > curAt) {
        Object.keys(inc).forEach(k => { cur[k] = inc[k]; });
        report.draftsAdopted++;
        report.draftNotes.push(`${pid}: 采用备份(备份 ${incAt} > 本地 ${curAt})`);
      } else {
        let filled = 0;
        Object.keys(inc).forEach(k => { if (cur[k] === undefined) { cur[k] = inc[k]; filled++; } });
        report.draftsKept++;
        if (filled) report.draftNotes.push(`${pid}: 本地更新,仅补 ${filled} 个本机没有的字段`);
        else report.draftNotes.push(`${pid}: 本地更新,备份未采用(备份 ${incAt} ≤ 本地 ${curAt})`);
      }
    });
  }

  /* 项目运行历史的合并:先给缺 runId 的历史记录补齐确定性 ID,再按 runId 幂等。
     本地 A 不阻止备份 B 恢复;同 runId 时 updatedAt 新者胜。 */
  function mergeProjectRuns(merged, incomingRuns, report) {
    if (!incomingRuns || typeof incomingRuns !== 'object') return;
    merged.ui.projectRuns = merged.ui.projectRuns || {};
    Object.keys(incomingRuns).forEach(pid => {
      const incList = incomingRuns[pid];
      if (!Array.isArray(incList)) return;
      const local = merged.ui.projectRuns[pid] = merged.ui.projectRuns[pid] || [];
      incList.forEach(ir => {
        if (!ir || typeof ir !== 'object') return;
        if (!ir.runId) return;   /* 进入本函数前已调用 migrateLegacyRuns 补齐 */
        const at = local.findIndex(x => x && x.runId === ir.runId);
        if (at < 0) { local.push(JSON.parse(JSON.stringify(ir))); report.runsAdded++; return; }
        if ((ir.updatedAt || 0) > (local[at].updatedAt || 0)) local[at] = JSON.parse(JSON.stringify(ir));
      });
    });
  }

  function mergeUi(merged, incoming, report) {
    if (!merged.ui.projectRuns) merged.ui.projectRuns = {};
    if (!incoming.ui || typeof incoming.ui !== 'object') return;
    if (typeof incoming.ui.lastHash === 'string' && incoming.ui.lastHash) merged.ui.lastHash = incoming.ui.lastHash;
    if (incoming.ui.pathProgress !== undefined) {
      merged.ui.pathProgress = mergePathProgress(merged.ui.pathProgress, incoming.ui.pathProgress);
    }
    if (incoming.ui.docPos && typeof incoming.ui.docPos === 'object'
        && (!merged.ui.docPos || !merged.ui.docPos.docId)) {
      merged.ui.docPos = incoming.ui.docPos; /* 本地无阅读位置才采用 */
      report.docPosAdopted = true;
    } else if (incoming.ui.docPos && typeof incoming.ui.docPos === 'object') {
      report.docPosKept = true;
    }
    if (typeof incoming.ui.pathVersion === 'string' && incoming.ui.pathVersion && !merged.ui.pathVersion) {
      merged.ui.pathVersion = incoming.ui.pathVersion;
    }
    mergeProjectDrafts(merged, incoming.ui.projectDrafts, report);
    mergeProjectRuns(merged, incoming.ui.projectRuns, report);
    /* 其他 ui 偏好(drillsOpened 等):本地为空的键才采用备份,不覆盖本地已有 */
    Object.keys(incoming.ui).forEach(k => {
      if (['lastHash', 'pathProgress', 'docPos', 'pathVersion', 'savedAt', 'browse', 'search',
           'projectDrafts', 'projectRuns'].includes(k)) return;
      if (merged.ui[k] === undefined) merged.ui[k] = incoming.ui[k];
    });
  }

  /* 单条题目记录的合并规则(importRecords 与 importFull 共用同一份实现,
     避免两处各写一遍导致语义漂移)。
     规则:
       - 计数与时间戳取较大(重复导入幂等);
       - note/status/fav/contentRev:备份「明确存在」且备份记录更新(_updatedAt 更大)→ 采用,
         包括空串/false(明确清空语义);备份不更新(旧备份/同刻)→ 只补空,不覆盖已有值;
         字段缺失 → 完全不动本地值;
       - fav 旧备份特例:legacy 备份的 true 仍然恢复收藏(只增不减);
       - 复习原因按整套覆盖而非并集(并集会让已取消的原因永远复活);
       - 未采用任何值时**不提升** _updatedAt(不给没用上的数据盖新时间)。
     返回 {cur, noteChanged}。 */
  function mergeQuestionRecord(cur, inc) {
    const incAt = inc._updatedAt || 0, curAt = cur._updatedAt || 0;
    let adopted = false, noteChanged = false;
    ['viewedAt', 'practiceCount', 'lastPracticedAt'].forEach(k => {
      if (typeof inc[k] === 'number' && inc[k] > (cur[k] || 0)) { cur[k] = inc[k]; adopted = true; }
    });
    if (inc.note !== undefined) {
      if (incAt > curAt) { if (cur.note !== inc.note) { cur.note = inc.note; noteChanged = true; adopted = true; } }
      else if ((cur.note === undefined || (!curAt && !cur.note)) && inc.note) { cur.note = inc.note; noteChanged = true; adopted = true; }
    }
    if (inc.status !== undefined) {
      if (incAt > curAt) { if (cur.status !== inc.status) { cur.status = inc.status; adopted = true; } }
      else if ((cur.status === undefined || (!curAt && !cur.status)) && inc.status) { cur.status = inc.status; adopted = true; }
    }
    if (inc.fav !== undefined) {
      if (incAt > curAt) { if (cur.fav !== inc.fav) { cur.fav = inc.fav; adopted = true; } }
      else if (inc.fav === true && (cur.fav === undefined || (!curAt && !cur.fav))) { cur.fav = true; adopted = true; }
    }
    if (inc.lastResult && (inc.lastPracticedAt || 0) > (cur.lastPracticedAt || 0)) { cur.lastResult = inc.lastResult; adopted = true; }
    /* 旧字段 drillTries 原样带入(由 migrateLegacyDrillTries 统一迁移到顶层) */
    if (Array.isArray(inc.drillTries)) cur.drillTries = JSON.parse(JSON.stringify(inc.drillTries));
    if (inc.contentRev !== undefined && incAt > curAt && cur.contentRev !== inc.contentRev) { cur.contentRev = inc.contentRev; adopted = true; }
    else if (inc.contentRev !== undefined && !cur.contentRev && inc.contentRev) { cur.contentRev = inc.contentRev; adopted = true; }
    if (Array.isArray(inc.reviewReasons)) {
      if (incAt > curAt) {
        if (JSON.stringify(cur.reviewReasons || []) !== JSON.stringify(inc.reviewReasons)) {
          cur.reviewReasons = inc.reviewReasons; adopted = true;
        }
      } else if (cur.reviewReasons === undefined && inc.reviewReasons.length) {
        /* 仅「从未设置」才补;空数组=明确清空,旧备份不得复活 */
        cur.reviewReasons = inc.reviewReasons; adopted = true;
      }
    }
    if (adopted && incAt > (cur._updatedAt || 0)) cur._updatedAt = incAt;
    return { cur, noteChanged };
  }

  /* 合并一批题目记录(两个导入入口共用) */
  function mergeQuestions(merged, incomingQuestions, report) {
    Object.keys(incomingQuestions).forEach(qid => {
      const inc = incomingQuestions[qid];
      const cur = merged.questions[qid] ? JSON.parse(JSON.stringify(merged.questions[qid]))
        : { status: '', fav: false, note: '', viewedAt: 0, practiceCount: 0, lastPracticedAt: 0 };
      const r = mergeQuestionRecord(cur, inc);
      if (r.noteChanged) report.notesUpdated++;
      merged.questions[qid] = r.cur;
      report.qMerged++;
    });
  }

  /* 合并模拟面试轮次:按稳定 ID 去重,降序保留最近 100 轮 */
  function mergeRounds(merged, incomingMock, report) {
    const existIds = new Set((merged.mock.rounds || []).map(r => r.id || roundId(r)));
    ((incomingMock && incomingMock.rounds) || []).forEach(r => {
      const id = roundId(r);
      if (existIds.has(id)) return;
      const copy = JSON.parse(JSON.stringify(r));
      copy.id = id;
      merged.mock.rounds.push(copy);
      existIds.add(id);
      report.roundsAdded++;
    });
    merged.mock.rounds.sort((a, b) => (b.ts || 0) - (a.ts || 0));
    merged.mock.rounds = merged.mock.rounds.slice(0, 100);
    /* 草稿:已有草稿优先(本机更可能新鲜),备份草稿仅在本地没有时恢复 */
    if (!merged.mock.draft && incomingMock && incomingMock.draft) merged.mock.draft = incomingMock.draft;
  }

  /* 合并专项尝试:按 attemptId 幂等;两份都有时 updatedAt 新者胜 */
  function mergeAttempts(merged, incomingAttempts) {
    if (!incomingAttempts || typeof incomingAttempts !== 'object') return;
    Object.keys(incomingAttempts).forEach(did => {
      const incList = incomingAttempts[did];
      if (!Array.isArray(incList)) return;
      const local = merged.drillAttempts[did] = merged.drillAttempts[did] || [];
      incList.forEach(ia => {
        if (!ia || !ia.attemptId) return;
        const at = local.findIndex(x => x.attemptId === ia.attemptId);
        if (at < 0) { local.push(JSON.parse(JSON.stringify(ia))); return; }
        if ((ia.updatedAt || 0) > (local[at].updatedAt || 0)) local[at] = JSON.parse(JSON.stringify(ia));
      });
    });
  }

  /* 合并报告:让界面能说明「恢复了什么、跳过了什么、为什么」,而不是只报一个数字 */
  function newReport() {
    return { qMerged: 0, roundsAdded: 0, notesUpdated: 0,
             draftsAdopted: 0, draftsKept: 0, draftNotes: [], runsAdded: 0, runsMigrated: 0,
             docPosAdopted: false, docPosKept: false };
  }

  /* 合并导入个人记录。失败 throw(状态不变);成功返回合并报告 */
  function importRecords(jsonText) {
    let obj;
    try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('不是合法的 JSON 文件'); }
    if (!obj || typeof obj !== 'object') throw new Error('格式不正确:应为备份 JSON 对象');
    if (obj.type && !['aiiv-records'].includes(obj.type)) {
      throw new Error(obj.type === 'aiiv-full'
        ? '这是完整备份:请用「导入完整备份」入口,一次恢复记录+题库+资料'
        : `备份类型不匹配:${obj.type}(本入口接受 aiiv-records)`);
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
    if (!merged.ui.projectRuns) merged.ui.projectRuns = {};
    const report = newReport();
    /* 先给两份数据里缺 runId 的历史运行记录补齐确定性 ID,再合并 */
    report.runsMigrated = migrateLegacyRuns({ ui: { projectRuns: incoming.ui && incoming.ui.projectRuns } });

    mergeQuestions(merged, incoming.questions, report);
    mergeRounds(merged, incoming.mock, report);
    mergeAttempts(merged, incoming.drillAttempts);
    mergeUi(merged, incoming, report);

    /* 迁移:旧格式题目记录里的 drillTries → 顶层 drillAttempts(作用于待提交副本) */
    migrateLegacyDrillTries(merged);

    /* 原子写入:直接写 localStorage 成功后才替换内存 */
    try {
      merged.ui.savedAt = Date.now();
      localStorage.setItem(KEY_RECORDS, JSON.stringify(merged));
    } catch (e) {
      throw new Error('保存失败:本地存储空间不足或被禁用,导入未生效');
    }
    data = merged;
    bumpRev();
    notifyInvalidate();
    return report;
  }

  /* 导入题库/资料备份(整体校验→原子写入→回滚保护)。
     与普通题库导入不同:备份恢复是全有全无——任何一题/一篇资料不合法,整个文件拒绝。 */
  function importLibrary(jsonText) {
    let obj;
    try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('不是合法的 JSON 文件'); }
    if (!obj || typeof obj !== 'object') throw new Error('格式不正确:应为备份 JSON 对象');
    if (obj.type && !['aiiv-library', 'aiiv-full', 'aiiv-bank'].includes(obj.type)) {
      throw new Error(`备份类型不匹配:${obj.type}(本入口接受 aiiv-library / aiiv-full / aiiv-bank)`);
    }
    if (obj.v !== undefined && obj.v !== 1) throw new Error(`不支持的备份版本:v${obj.v}`);
    if (obj.type === 'aiiv-full') {
      throw new Error('这是完整备份:请用「导入完整备份」入口,一次恢复记录+题库+资料');
    }
    const qs = obj.questions, docs = obj.docs;
    if (qs === undefined && docs === undefined) throw new Error('备份中没有 questions / docs 数据');
    /* 整体校验:全部通过才继续(库内已有编号属于幂等恢复场景,跳过而非报错;同批内部重复是真错误) */
    if (qs !== undefined) {
      if (!Array.isArray(qs)) throw new Error('questions 需为数组');
      const hardErrors = [];
      const seen = new Set();
      qs.forEach(q => {
        const r = validateQuestion(q, seen, new Set());
        r.errs.forEach(e => { if (!e.includes('编号重复')) hardErrors.push(e); });
      });
      const batchSeen = new Set();
      qs.forEach(q => {
        if (q && typeof q.id === 'string') {
          if (batchSeen.has(q.id)) hardErrors.push(`${q.id}: 同批内编号重复`);
          batchSeen.add(q.id);
        }
      });
      if (hardErrors.length) {
        throw new Error('备份校验未通过,未做任何修改:' + hardErrors.slice(0, 5).join(';') + (hardErrors.length > 5 ? ` 等 ${hardErrors.length} 项` : ''));
      }
    }
    if (docs !== undefined) {
      if (!Array.isArray(docs)) throw new Error('docs 需为数组');
      const docErrs = docs.map(validateDoc).filter(Boolean);
      if (docErrs.length) throw new Error('备份校验未通过,未做任何修改:' + docErrs.slice(0, 5).join(';') + (docErrs.length > 5 ? ` 等 ${docErrs.length} 项` : ''));
    }
    let questionsAdded = 0, docsAdded = 0;
    let newQ = null, newD = null;
    if (Array.isArray(qs)) {
      const exist = new Set(((typeof window !== 'undefined' && window.APP_DATA && window.APP_DATA.questions) || []).map(q => q.id));
      extraBankLoad().forEach(q => exist.add(q.id));
      newQ = extraBankLoad().slice();
      qs.forEach(q => {
        if (!q || !q.id || exist.has(q.id)) return;
        newQ.push(q); exist.add(q.id); questionsAdded++;
      });
    }
    if (Array.isArray(docs)) {
      const exist = new Set(userDocsLoad().map(d => d.id));
      newD = userDocsLoad().slice();
      docs.forEach(d => {
        if (!d || !d.id || exist.has(d.id)) return;
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

  /* 完整备份恢复:一次事务恢复 记录+题库+资料。
     整体校验 → 三个键按序原子写入(后写失败回滚先写)→ 成功后调用方重建内存与索引。 */
  function importFull(jsonText) {
    let obj;
    try { obj = JSON.parse(jsonText); } catch (e) { throw new Error('不是合法的 JSON 文件'); }
    if (!obj || typeof obj !== 'object') throw new Error('格式不正确:应为备份 JSON 对象');
    if (obj.type !== 'aiiv-full') throw new Error(`备份类型不匹配:${obj.type || '(缺失)'}(本入口接受 aiiv-full)`);
    if (obj.v !== undefined && obj.v !== 1) throw new Error(`不支持的备份版本:v${obj.v}`);
    /* 记录部分 */
    const incoming = obj.records;
    if (!incoming || typeof incoming !== 'object') throw new Error('完整备份缺少 records');
    const recErrs = validateRecordsObj(incoming);
    if (recErrs.length) throw new Error('记录校验未通过:' + recErrs.slice(0, 5).join(';'));
    /* 题库/资料部分 */
    let newQ = null, newD = null, questionsAdded = 0, docsAdded = 0;
    if (obj.questions !== undefined) {
      if (!Array.isArray(obj.questions)) throw new Error('questions 需为数组');
      const hardErrors = [];
      const seen = new Set();
      obj.questions.forEach(q => {
        const r = validateQuestion(q, seen, new Set());
        r.errs.forEach(e => { if (!e.includes('编号重复')) hardErrors.push(e); });
      });
      const batchSeen = new Set();
      obj.questions.forEach(q => {
        if (q && typeof q.id === 'string') {
          if (batchSeen.has(q.id)) hardErrors.push(`${q.id}: 同批内编号重复`);
          batchSeen.add(q.id);
        }
      });
      if (hardErrors.length) throw new Error('题库校验未通过:' + hardErrors.slice(0, 5).join(';'));
      const exist = new Set(((typeof window !== 'undefined' && window.APP_DATA && window.APP_DATA.questions) || []).map(q => q.id));
      extraBankLoad().forEach(q => exist.add(q.id));
      newQ = extraBankLoad().slice();
      obj.questions.forEach(q => {
        if (!q || !q.id || exist.has(q.id)) return;
        newQ.push(q); exist.add(q.id); questionsAdded++;
      });
    }
    if (obj.docs !== undefined) {
      if (!Array.isArray(obj.docs)) throw new Error('docs 需为数组');
      const docErrs = obj.docs.map(validateDoc).filter(Boolean);
      if (docErrs.length) throw new Error('资料校验未通过:' + docErrs.slice(0, 5).join(';'));
      const exist = new Set(userDocsLoad().map(d => d.id));
      newD = userDocsLoad().slice();
      obj.docs.forEach(d => {
        if (!d || !d.id || exist.has(d.id)) return;
        newD.push(d); exist.add(d.id); docsAdded++;
      });
    }
    /* 在副本上合并记录(与 importRecords 共用同一份合并实现) */
    const merged = JSON.parse(JSON.stringify(data));
    if (!merged.ui.projectRuns) merged.ui.projectRuns = {};
    const report = newReport();
    report.runsMigrated = migrateLegacyRuns({ ui: { projectRuns: incoming.ui && incoming.ui.projectRuns } });

    mergeQuestions(merged, incoming.questions, report);
    mergeRounds(merged, incoming.mock, report);
    mergeAttempts(merged, incoming.drillAttempts);
    mergeUi(merged, incoming, report);

    migrateLegacyDrillTries(merged);

    /* 三键原子写入:失败回滚已写键 */
    const prev = {
      records: localStorage.getItem(KEY_RECORDS),
      extra: localStorage.getItem(KEY_EXTRA),
      docs: localStorage.getItem(KEY_USERDOCS),
    };
    const restore = (written) => {
      try {
        if (written.includes('docs')) { prev.docs === null ? localStorage.removeItem(KEY_USERDOCS) : localStorage.setItem(KEY_USERDOCS, prev.docs); }
        if (written.includes('extra')) { prev.extra === null ? localStorage.removeItem(KEY_EXTRA) : localStorage.setItem(KEY_EXTRA, prev.extra); }
        if (written.includes('records')) { prev.records === null ? localStorage.removeItem(KEY_RECORDS) : localStorage.setItem(KEY_RECORDS, prev.records); }
      } catch (e) { /* 回滚尽力而为 */ }
    };
    const written = [];
    try {
      merged.ui.savedAt = Date.now();
      localStorage.setItem(KEY_RECORDS, JSON.stringify(merged)); written.push('records');
      if (newQ) { localStorage.setItem(KEY_EXTRA, JSON.stringify({ v: 1, saved_at: Date.now(), questions: newQ })); written.push('extra'); }
      if (newD) { localStorage.setItem(KEY_USERDOCS, JSON.stringify(newD)); written.push('docs'); }
    } catch (e) {
      restore(written);
      throw new Error('保存失败:本地存储空间不足或写入中断,已回滚,导入未生效');
    }
    /* 全部写入成功:替换内存记录状态(题库/资料由调用方 init 重建) */
    data = merged;
    bumpRev();
    notifyInvalidate();
    return Object.assign(report, { questionsAdded, docsAdded });
  }

  /* 清空全部个人记录(不影响导入的题库与资料)。
     同步推进数据版本并通知订阅者(搜索索引据此失效)——否则会出现
     「清空后搜索仍能搜出已清空的笔记与尝试」这种界面与数据不一致。 */
  function clearAll() {
    data = blank();
    try { localStorage.removeItem(KEY_RECORDS); } catch (e) { /* 已无记录 */ }
    bumpRev();
    notifyInvalidate();
    save();
    return true;
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

  /* 来源 kind 归一:website 与 web 同义(迁移映射),其余原样保留 */
  function normalizeSourceKind(kind) { return kind === 'website' ? 'web' : kind; }

  return {
    STATUS, STATE, STATE_IDS, STATE_LABEL,
    load, save, saveNow, rec, setStatus, toggleFav, setNote, markViewed, markPracticed,
    exportRecords, exportLibrary, exportFull, importRecords, importLibrary, importFull, clearAll,
    validateQuestions, validateQuestion, normalizeSourceKind,
    quarantineCount, quarantineExport, rawExtrasExport, resetLoadIssues,
    validateAttempt, migrateLegacyDrillTries, migrateLegacyRuns,
    recTime, latestOf, sortedByTime, onInvalidate,
    get rev() { return rev; },
    get lastSaveError() { return lastSaveError; },
    get loadIssues() { return loadIssues; },
    extraBankLoad, extraBankSave, loadExtraBankSafe, userDocsLoad, userDocsSave, loadUserDocsSafe,
    get data() { return data; }
  };
})();
