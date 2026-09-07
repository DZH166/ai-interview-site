# -*- coding: utf-8 -*-
"""修复1+2:隔离失败保原文 / 来源枚举兼容真实题库 / website 归一映射"""
import pathlib

p = pathlib.Path('app/js/store.js')
src = p.read_text(encoding='utf-8')

# ---------- 1) 来源枚举扩展到真实题库全集 ----------
old1 = "const Q_SRC_KINDS = ['official', 'paper', 'repo', 'independent', 'web'];"
new1 = ("/* 来源枚举以真实题库数据为事实基础(official-docs/official-blog/website 在库中广泛使用);\n"
        "     迁移映射:website 与 web 同义,读取时归一,原始字段保留不丢 */\n"
        "  const Q_SRC_KINDS = ['official', 'official-docs', 'official-blog', 'paper', 'repo', 'independent', 'web', 'website'];")
assert old1 in src
src = src.replace(old1, new1)

# ---------- 2) quarantineAdd:幂等 + 明确返回结果 ----------
old2 = """  const KEY_QUARANTINE = PREFIX + 'quarantine';
  function quarantineAdd(kind, reason, raw) {
    let arr = [];
    try { arr = JSON.parse(localStorage.getItem(KEY_QUARANTINE) || '[]'); if (!Array.isArray(arr)) arr = []; } catch (e) { arr = []; }
    arr.push({ kind, reason, raw, ts: Date.now() });
    try { localStorage.setItem(KEY_QUARANTINE, JSON.stringify(arr)); } catch (e) { /* 隔离写入失败不影响主流程 */ }
  }"""
new2 = """  const KEY_QUARANTINE = PREFIX + 'quarantine';
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
  function resetLoadIssues() { loadIssues = { quarantineFailed: 0 }; }"""
assert old2 in src
src = src.replace(old2, new2)

# ---------- 3) loadExtraBankSafe:失败保原键 ----------
old3 = """    let obj;
    try { obj = JSON.parse(raw); } catch (e) {
      quarantineAdd('bank-extra', 'JSON 解析失败', raw);
      localStorage.removeItem(KEY_EXTRA);
      return [];
    }
    const qs = Array.isArray(obj && obj.questions) ? obj.questions : null;
    if (!qs) {
      quarantineAdd('bank-extra', 'questions 字段缺失', raw);
      localStorage.removeItem(KEY_EXTRA);
      return [];
    }
    const seen = new Set(((typeof window !== 'undefined' && window.APP_DATA && window.APP_DATA.questions) || []).map(q => q.id));
    const good = [];
    let dirty = false;
    qs.forEach(q => {
      const { errs } = validateQuestion(q, new Set(), seen);
      if (errs.length) {
        quarantineAdd('bank-extra', errs.slice(0, 3).join('; '), JSON.stringify(q));
        dirty = true;
      } else {
        good.push(q);
        seen.add(q.id);
      }
    });
    if (dirty) {
      try { localStorage.setItem(KEY_EXTRA, JSON.stringify({ v: 1, saved_at: Date.now(), questions: good })); } catch (e) { /* 保持原样 */ }
    }
    return good;
  }"""
new3 = """    let obj = null, parseFailed = false;
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
  }"""
assert old3 in src
src = src.replace(old3, new3)

# ---------- 4) loadUserDocsSafe 同样处理 ----------
old4 = """    let arr;
    try { arr = JSON.parse(raw); } catch (e) {
      quarantineAdd('userdocs', 'JSON 解析失败', raw);
      localStorage.removeItem(KEY_USERDOCS);
      return [];
    }
    if (!Array.isArray(arr)) {
      quarantineAdd('userdocs', '不是数组', raw);
      localStorage.removeItem(KEY_USERDOCS);
      return [];
    }
    const good = [];
    let dirty = false;
    arr.forEach(d => {
      const err = validateDoc(d);
      if (err) { quarantineAdd('userdocs', err, JSON.stringify(d)); dirty = true; }
      else good.push(d);
    });
    if (dirty) {
      try { localStorage.setItem(KEY_USERDOCS, JSON.stringify(good)); } catch (e) { /* 保持原样 */ }
    }
    return good;
  }"""
new4 = """    let arr = null, parseFailed = false;
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
  }"""
assert old4 in src
src = src.replace(old4, new4)

# ---------- 5) 导出接口 ----------
old5 = """  return {
    STATUS, load, save, saveNow, rec, setStatus, toggleFav, setNote, markViewed, markPracticed,
    exportRecords, exportLibrary, exportFull, importRecords, importLibrary, importFull, clearAll,
    validateQuestions, validateQuestion,
    quarantineCount, quarantineExport,
    extraBankLoad, extraBankSave, loadExtraBankSafe, userDocsLoad, userDocsSave, loadUserDocsSafe,
    get data() { return data; }
  };"""
new5 = """  /* 来源 kind 归一:website 与 web 同义(迁移映射),其余原样保留 */
  function normalizeSourceKind(kind) { return kind === 'website' ? 'web' : kind; }

  return {
    STATUS, load, save, saveNow, rec, setStatus, toggleFav, setNote, markViewed, markPracticed,
    exportRecords, exportLibrary, exportFull, importRecords, importLibrary, importFull, clearAll,
    validateQuestions, validateQuestion, normalizeSourceKind,
    quarantineCount, quarantineExport, rawExtrasExport, resetLoadIssues,
    get loadIssues() { return loadIssues; },
    extraBankLoad, extraBankSave, loadExtraBankSafe, userDocsLoad, userDocsSave, loadUserDocsSafe,
    get data() { return data; }
  };"""
assert old5 in src
src = src.replace(old5, new5)

p.write_text(src, encoding='utf-8', newline='\n')
print('store.js patched')
