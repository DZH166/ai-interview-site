# -*- coding: utf-8 -*-
"""修复3:备份合并纳入 ui.pathProgress(含取消追溯)与 ui.docPos(阅读位置)。
规则:
- pathProgress 形状 {stageId: {done?: ts, cancelled?: ts}}(旧版 stageId: number 迁移为 {done: n});
  按阶段比较最新事件(done vs cancelled),晚者胜;同刻本地胜(设备数据优先)。
  取消不再删除条目——写入 cancelled 时间,保留 done 作追溯。
- docPos 单槽:本地为空则采用备份,否则保留本地(阅读位置是设备本地最近状态)。
- pathVersion:路径定义指纹,本地为空才采用。
"""
import pathlib

p = pathlib.Path('app/js/store.js')
src = p.read_text(encoding='utf-8')

# 1) 通用 ui 合并助手 + 校验放宽(允许 pathProgress/docPos/pathVersion)
old_v = """    if (incoming.ui !== undefined && (!incoming.ui || typeof incoming.ui !== 'object' || Array.isArray(incoming.ui))) {
      errs.push('ui 必须是对象');
    }
    return errs;"""
new_v = """    if (incoming.ui !== undefined && (!incoming.ui || typeof incoming.ui !== 'object' || Array.isArray(incoming.ui))) {
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
    return errs;"""
assert old_v in src
src = src.replace(old_v, new_v)

# 2) ui 合并助手(供 importRecords / importFull 共用)
helper = """
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
  function mergeUi(merged, incoming) {
    if (!incoming.ui || typeof incoming.ui !== 'object') return;
    if (typeof incoming.ui.lastHash === 'string' && incoming.ui.lastHash) merged.ui.lastHash = incoming.ui.lastHash;
    if (incoming.ui.pathProgress !== undefined) {
      merged.ui.pathProgress = mergePathProgress(merged.ui.pathProgress, incoming.ui.pathProgress);
    }
    if (incoming.ui.docPos && typeof incoming.ui.docPos === 'object'
        && (!merged.ui.docPos || !merged.ui.docPos.docId)) {
      merged.ui.docPos = incoming.ui.docPos; /* 本地无阅读位置才采用 */
    }
    if (typeof incoming.ui.pathVersion === 'string' && incoming.ui.pathVersion && !merged.ui.pathVersion) {
      merged.ui.pathVersion = incoming.ui.pathVersion;
    }
  }
"""
anchor = "  /* 合并导入个人记录。失败 throw(状态不变);成功返回 {qMerged, roundsAdded, notesUpdated} */"
assert anchor in src
src = src.replace(anchor, helper + "\n" + anchor)

# 3) importRecords 的 ui 段改用 mergeUi
old_ir = "    if (incoming.ui && typeof incoming.ui.lastHash === 'string' && incoming.ui.lastHash) merged.ui.lastHash = incoming.ui.lastHash;"
new_ir = "    mergeUi(merged, incoming);"
assert old_ir in src
src = src.replace(old_ir, new_ir)

# 4) importFull 的 ui 段同样
old_if = "    if (incoming.ui && typeof incoming.ui.lastHash === 'string' && incoming.ui.lastHash) merged.ui.lastHash = incoming.ui.lastHash;"
cnt = src.count(old_if)
if cnt == 1:
    src = src.replace(old_if, new_if)
else:
    # importFull 里是独立一行(与上一步替换后的不同上下文),再找一次
    assert old_if not in src, 'unexpected duplicates'
p.write_text(src, encoding='utf-8', newline='\n')
print('patched; lastHash sites now:', src.count("mergeUi(merged, incoming);"))
