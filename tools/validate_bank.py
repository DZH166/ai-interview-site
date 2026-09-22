# -*- coding: utf-8 -*-
"""题库校验:重复编号、必要字段、类型枚举、关联存在性、乱码、代码块闭合。"""
import json, re, sys, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

# 校验入口做成函数(build.py 要在构建前以 fail-fast 方式程序化调用同一套规则);
# 副作用(stdout 重包装、报告落盘)全部收进函数体,保持 import 无副作用。
QDIR = ROOT / "data" / "questions"
TYPES = {"concept", "principle", "comparison", "code", "debug", "scenario", "quiz", "qa"}
DIFFS = {"basic", "intermediate", "advanced"}
ID_RE = re.compile(r"^[A-Z]{2,4}-\d{3,4}$")

def find_mojibake(text):
    issues = []
    if "\ufffd" in text:
        issues.append("U+FFFD 替换符")
    if "锟斤拷" in text or "烫烫" in text:
        issues.append("GBK 乱码特征")
    for m in re.finditer(r"[\xc0-\xdf][\x80-\xbf]|Ã.|Â ", text):
        issues.append("疑似编码错转: " + m.group(0)[:8])
        break
    return issues

def validate():
    """执行全部校验,返回 (errors, warns, questions)。CI 与 build.py 共用此入口。"""
    try:
        topics = json.loads((ROOT / "data" / "topics.json").read_text(encoding="utf-8"))
    except FileNotFoundError:
        topics = []
    TOPICS = {t["id"] for t in topics}
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
            # 选择题分支(quiz):题干/选项/正确项/解析/来源/核查,与叙述题十要素分开校验
            if q.get("format") == "qa":
                for k in ("id", "topic", "type", "difficulty", "title", "prompt",
                          "answer", "sources", "verify"):
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
                if len(str(q.get("answer", "")).strip()) < 40:
                    warns.append(f"{tag}: 参考答案过短(<40 字)")
                v = q.get("verify", {})
                if v.get("status") not in ("verified", "partial", "todo"):
                    errors.append(f"{tag}: verify.status 非法")
                if not v.get("checked_date"):
                    errors.append(f"{tag}: verify.checked_date 缺失")
                for field in ("prompt", "answer"):
                    sv = q.get(field, "")
                    if isinstance(sv, str) and sv.count("```") % 2 != 0:
                        errors.append(f"{tag}: 字段 {field} 代码块 ``` 不闭合")
                whole = json.dumps(q, ensure_ascii=False)
                moji = find_mojibake(whole)
                if moji:
                    errors.append(f"{tag}: 疑似乱码 -> {moji[0]}")
                questions.append(q)
                continue
            if q.get("format") == "quiz":
                for k in ("id", "topic", "type", "difficulty", "title", "prompt",
                          "options", "answer", "plain", "sources", "verify"):
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
                if q.get("qtype") not in ("single", "multi"):
                    errors.append(f"{tag}: qtype 非法(需 single/multi)")
                opts = q.get("options") or []
                if len(opts) < 2:
                    errors.append(f"{tag}: 选项少于 2 个")
                if not any(o.get("right") for o in opts):
                    errors.append(f"{tag}: 没有正确选项")
                labels = [o.get("label") for o in opts]
                if labels != [chr(ord("A") + i) for i in range(len(opts))]:
                    errors.append(f"{tag}: 选项标号非 A 连续序")
                for o in opts:
                    if not str(o.get("text", "")).strip():
                        errors.append(f"{tag}: 选项 {o.get('label')} 文本为空")
                if len(str(q.get("answer", "")).strip()) < 40:
                    warns.append(f"{tag}: 解析过短(<40 字,牛客未提供或简短)")
                if not q.get("sources"):
                    errors.append(f"{tag}: 缺少出处")
                v = q.get("verify", {})
                if v.get("status") not in ("verified", "partial", "todo"):
                    errors.append(f"{tag}: verify.status 非法")
                if not v.get("checked_date"):
                    errors.append(f"{tag}: verify.checked_date 缺失")
                for field in ("prompt", "answer", "plain"):
                    sv = q.get(field, "")
                    if isinstance(sv, str) and sv.count("```") % 2 != 0:
                        errors.append(f"{tag}: 字段 {field} 代码块 ``` 不闭合")
                whole = json.dumps(q, ensure_ascii=False)
                moji = find_mojibake(whole)
                if moji:
                    errors.append(f"{tag}: 疑似乱码 -> {moji[0]}")
                questions.append(q)
                continue
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
    return errors, warns, questions

def main():
    if sys.stdout.encoding and sys.stdout.encoding.lower() != "utf-8":
        sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
    errors, warns, questions = validate()
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
