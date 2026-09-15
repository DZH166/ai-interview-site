# -*- coding: utf-8 -*-
"""重点标注审计:标注是人工写的,原文一改就可能对不上,必须能在提交前查出来。

查什么(全部可量化,不靠感觉):
  - 标注的题号 / 字段 / 级别是否合法
  - 每条标注的短语是否**真的逐字出现在该字段原文里**(标不上等于白标)
  - 短语里有没有 markdown 元字符(会被渲染吃掉,导致浏览器里对不上)
  - 同一字段内是否重叠或重复(渲染时后一条会被跳过)
  - 覆盖进度:哪些题还没标(不是错,是下一批的工作清单)

用法:
  python tools/highlight_audit.py              # 打印摘要
  python tools/highlight_audit.py --strict     # 有问题则非 0 退出(CI 用)
  python tools/highlight_audit.py --list-todo  # 列出还没标的题(按专题)
  python tools/highlight_audit.py --topic rag  # 只审某个专题
"""
import argparse
import glob
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

FIELDS = ("answer", "plain", "deep", "example", "interview")
LEVELS = ("key", "term", "warn")
# 这些字符会被 markdown 解析器吃掉,导致「原文有、渲染后对不上」
METACHARS = re.compile(r"[*`\[\]_|#<>\\]")
# 会被渲染器替换掉的排版写法(短语里出现就不可靠)
RISKY = re.compile(r"(--|\.\.\.|\(\d+\)\s*$)")
MAX_SPANS = 12          # 单题标注上限:重点太多等于没有重点


def load_bank():
    qs = {}
    for f in sorted((ROOT / "data" / "questions").glob("*.json")):
        for q in json.loads(f.read_text(encoding="utf-8")):
            q["_file"] = f.name
            qs[q["id"]] = q
    return qs


def load_highlights():
    out = {}
    hdir = ROOT / "data" / "highlights"
    if not hdir.exists():
        return out
    for f in sorted(hdir.glob("*.json")):
        rec = json.loads(f.read_text(encoding="utf-8"))
        for qid, item in (rec.get("questions") or {}).items():
            if qid in out:
                out[qid] = {"spans": out[qid]["spans"], "_dupfile": f.name}
            else:
                out[qid] = {"spans": item.get("spans") or [], "_file": f.name}
    return out


def check_spans(q, spans):
    """单题标注的逐条检查。抽出来是为了让 --selftest 能用合成数据验它真的会报错。
    返回 (errors, warns, stats) —— stats 为 (条数, {级别: 条数}, {字段: 条数})。"""
    errors, warns = [], []
    by_level, by_field = {}, {}
    if not spans:
        return ["spans 为空"], warns, (0, by_level, by_field)
    if len(spans) > MAX_SPANS:
        warns.append("%d 条标注 > 上限 %d,重点太多会失去重点" % (len(spans), MAX_SPANS))
    seen, occupied = {}, {}
    for i, s in enumerate(spans):
        tag = "#%d" % (i + 1)
        field, level = s.get("field"), s.get("level")
        text = s.get("text") or ""
        if field not in FIELDS:
            errors.append("%s: 字段非法 %r" % (tag, field)); continue
        if level not in LEVELS:
            errors.append("%s: 级别非法 %r" % (tag, level)); continue
        if not text.strip():
            errors.append("%s: 短语为空" % tag); continue
        body = str(q.get(field) or "")
        at = body.find(text)
        if at < 0:
            errors.append("%s: 短语对不上原文 → %r" % (tag, text[:40]))
            continue
        bad = METACHARS.search(text)
        if bad:
            errors.append("%s: 短语含 markdown 元字符 %r:%r" % (tag, bad.group(0), text[:30]))
        risky = RISKY.search(text)
        if risky:
            warns.append("%s: 短语含可能被替换的写法 %r:%r" % (tag, risky.group(0), text[:30]))
        key = (field, text)
        if key in seen:
            errors.append("%s: 与 %s 完全重复" % (tag, seen[key]))
        seen[key] = tag
        span_range = (at, at + len(text))
        for other, orange in occupied.get(field, []):
            if span_range[0] < orange[1] and span_range[1] > orange[0]:
                errors.append("%s: 与 %s 在原文中重叠,渲染时会被跳过" % (tag, other))
        occupied.setdefault(field, []).append((tag, span_range))
        by_level[level] = by_level.get(level, 0) + 1
        by_field[field] = by_field.get(field, 0) + 1
    if not any(s.get("why") for s in spans):
        warns.append("没有任何 why,以后无法判断这条重点为什么重要")
    return errors, warns, (len(spans), by_level, by_field)


def selftest():
    """反向对照:好标注必须过,坏标注必须被抓。改过匹配规则后要还能认出来。"""
    q = {"answer": "Transformer 是完全靠注意力处理序列的架构;推理是自回归的逐 token 过程。",
         "deep": "注意力本身对顺序完全无敏感。"}
    cases = [
        ("正常标注放行",
         [{"field": "answer", "level": "key", "text": "完全靠注意力处理序列的架构", "why": "定义"}],
         False),
        ("短语对不上原文要报错",
         [{"field": "answer", "level": "key", "text": "完全靠注意处理序列", "why": "x"}],
         True),
        ("含 markdown 元字符要报错",
         [{"field": "answer", "level": "key", "text": "****", "why": "x"}],
         True),
        ("同字段重叠要报错",
         [{"field": "deep", "level": "key", "text": "注意力本身对顺序", "why": "x"},
          {"field": "deep", "level": "term", "text": "对顺序完全无敏感", "why": "x"}],
         True),
        ("同字段完全重复要报错",
         [{"field": "deep", "level": "key", "text": "注意力本身", "why": "x"},
          {"field": "deep", "level": "term", "text": "注意力本身", "why": "x"}],
         True),
        ("级别非法要报错",
         [{"field": "answer", "level": "important", "text": "完全靠注意力", "why": "x"}],
         True),
        ("字段非法要报错",
         [{"field": "title", "level": "key", "text": "完全靠注意力", "why": "x"}],
         True),
    ]
    bad = []
    for name, spans, should_fail in cases:
        errors, _w, _s = check_spans(q, spans)
        if bool(errors) != should_fail:
            bad.append("%s → 期望%s,实际 %r" % (name, "报错" if should_fail else "放行", errors))
    if bad:
        print("自检失败:")
        for b in bad:
            print("  " + b)
        return False
    print("标注审计器自检通过:%d 个用例(好标注放行 / 6 类坏标注全部命中)" % len(cases))
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--list-todo", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--topic", default="")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(0 if selftest() else 1)

    bank = load_bank()
    hl = load_highlights()

    errors, warns = [], []
    total_spans = 0
    by_level = {}
    by_field = {}

    for qid, rec in sorted(hl.items()):
        if qid not in bank:
            errors.append("%s: 标注了不存在的题号(见 %s)" % (qid, rec.get("_file", "?")))
            continue
        if rec.get("_dupfile"):
            errors.append("%s: 在多个标注文件里重复出现(另见 %s)" % (qid, rec["_dupfile"]))
            continue
        e, w, (n, bl, bf) = check_spans(bank[qid], rec["spans"])
        errors.extend("%s%s" % (qid, x) for x in e)
        warns.extend("%s%s" % (qid, x) for x in w)
        total_spans += n
        for k, v in bl.items():
            by_level[k] = by_level.get(k, 0) + v
        for k, v in bf.items():
            by_field[k] = by_field.get(k, 0) + v

    # ---- 覆盖进度
    topics = {}
    for qid, q in bank.items():
        t = q["topic"]
        topics.setdefault(t, {"total": 0, "done": 0, "spans": 0})
        topics[t]["total"] += 1
        if qid in hl:
            topics[t]["done"] += 1
            topics[t]["spans"] += len(hl[qid]["spans"])

    print("题库 %d 题 / 已标注 %d 题(%.0f%%) / 标注 %d 条"
          % (len(bank), len(hl), 100.0 * len(hl) / max(1, len(bank)), total_spans))
    print("按级别:%s" % json.dumps(by_level, ensure_ascii=False))
    print("按字段:%s" % json.dumps(by_field, ensure_ascii=False))
    print()
    print("进度(按专题):")
    for t in sorted(topics, key=lambda k: -topics[k]["total"]):
        s = topics[t]
        if args.topic and t != args.topic:
            continue
        print("  %-16s %3d/%3d 题   %4d 条" % (t, s["done"], s["total"], s["spans"]))

    if args.list_todo:
        print()
        print("还没标注的题:")
        for t in sorted(topics):
            todo = [qid for qid, q in sorted(bank.items()) if q["topic"] == t and qid not in hl]
            if args.topic and t != args.topic:
                continue
            if todo:
                print("  %-16s %3d 题:%s%s" % (t, len(todo), ", ".join(todo[:12]),
                                              " …" if len(todo) > 12 else ""))

    print()
    print("错误 %d 条 / 提醒 %d 条" % (len(errors), len(warns)))
    for e in errors[:40]:
        print("  ERROR " + e)
    if len(errors) > 40:
        print("  …还有 %d 条" % (len(errors) - 40))
    for w in warns[:20]:
        print("  WARN  " + w)

    if args.strict and errors:
        sys.exit(1)


if __name__ == "__main__":
    main()
