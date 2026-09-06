# -*- coding: utf-8 -*-
"""题库校验:重复编号、必要字段、类型枚举、关联存在性、乱码、代码块闭合。"""
import json, re, sys, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

QDIR = ROOT / "data" / "questions"
TOPICS = {t["id"] for t in json.loads((ROOT / "data" / "topics.json").read_text(encoding="utf-8"))}
TYPES = {"concept", "principle", "comparison", "code", "debug", "scenario"}
DIFFS = {"basic", "intermediate", "advanced"}
ID_RE = re.compile(r"^[A-Z]{2,4}-\d{3}$")

def find_mojibake(text):
    issues = []
    if "\ufffd" in text:
        issues.append("U+FFFD 替换符")
    if "锟斤拷" in text or "烫烫" in text:
        issues.append("GBK 乱码特征")
    for m in re.finditer(r"[\xc0-\xdf][\x80-\xbf]|Ã.|Â ", text):
        issues.append("疑似编码错转: " + m.group(0)[:8])
        break
    return issues

def main():
    errors, warns, questions = [], [], []
    for f in sorted(QDIR.glob("*.json")):
        try:
            data = json.loads(f.read_text(encoding="utf-8"))
        except json.JSONDecodeError as e:
            errors.append(f"{f.name}: JSON 语法错误 -> {e}")
            continue
        if not isinstance(data, list):
            errors.append(f"{f.name}: 顶层必须是数组")
            continue
        for q in data:
            tag = f"[{f.name}] {q.get('id', '<无ID>')}"
            for k in ("id", "topic", "type", "difficulty", "title", "answer", "plain",
                      "deep", "example", "interview", "followups", "pitfalls",
                      "check", "sources", "verify"):
                if k not in q or q[k] in (None, "", []):
                    errors.append(f"{tag}: 缺少必要字段 {k}")
            if not ID_RE.match(q.get("id", "")):
                errors.append(f"{tag}: 题号不符合 XX-NNN 规则")
            if q.get("topic") not in TOPICS:
                errors.append(f"{tag}: 未知专题 {q.get('topic')}")
            if q.get("type") not in TYPES:
                errors.append(f"{tag}: 未知题型 {q.get('type')}")
            if q.get("difficulty") not in DIFFS:
                errors.append(f"{tag}: 未知难度 {q.get('difficulty')}")
            for field in ("answer", "plain", "deep", "example", "interview"):
                v = q.get(field, "")
                if isinstance(v, str) and len(v) < 40:
                    errors.append(f"{tag}: 字段 {field} 过短({len(v)} 字)")
            if len(q.get("followups", [])) < 2:
                warns.append(f"{tag}: 追问少于 2 条")
            for fu in q.get("followups", []):
                if not fu.get("q") or not fu.get("a"):
                    errors.append(f"{tag}: followups 项缺少 q 或 a")
            chk = q.get("check", {})
            if not all(chk.get(k) for k in ("q", "a")):
                errors.append(f"{tag}: 理解检查缺少 q 或 a")
            if not q.get("pitfalls"):
                errors.append(f"{tag}: 缺少常见误区")
            if not q.get("sources"):
                errors.append(f"{tag}: 缺少出处")
            v = q.get("verify", {})
            if v.get("status") not in ("verified", "partial", "todo"):
                errors.append(f"{tag}: verify.status 非法")
            if not v.get("checked_date"):
                errors.append(f"{tag}: verify.checked_date 缺失")
            # 代码块闭合
            for field in ("deep", "example", "answer"):
                s = q.get(field, "")
                if isinstance(s, str) and s.count("```") % 2 != 0:
                    errors.append(f"{tag}: 字段 {field} 代码块 ``` 不闭合")
            # 乱码
            whole = json.dumps(q, ensure_ascii=False)
            moji = find_mojibake(whole)
            if moji:
                errors.append(f"{tag}: 疑似乱码 -> {moji[0]}")
            questions.append(q)
    ids = [q["id"] for q in questions]
    dup = {i for i in ids if ids.count(i) > 1}
    if dup:
        errors.append(f"重复题号: {sorted(dup)}")
    idset = set(ids)
    for q in questions:
        for r in q.get("related", []):
            if r not in idset:
                warns.append(f"{q['id']}: related 指向不存在的题 {r}")
        for d in q.get("doc_refs", []):
            if not d.startswith("doc-"):
                warns.append(f"{q['id']}: doc_refs 命名不符合 doc-* 约定: {d}")
    # 汇总
    lines = [f"校验时间: 2026-09-06",
             f"题目总数: {len(questions)}",
             f"错误: {len(errors)}", f"警告: {len(warns)}", ""]
    lines += ["ERROR " + e for e in errors] + ["WARN  " + w for w in warns]
    report = "\n".join(lines)
    print(report)
    (ROOT / "tests" / "validation-report.txt").write_text(report, encoding="utf-8")
    return 1 if errors else 0

if __name__ == "__main__":
    sys.exit(main())
