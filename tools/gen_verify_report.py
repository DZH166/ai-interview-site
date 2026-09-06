# -*- coding: utf-8 -*-
"""生成全部题目的核查状态明细表(delivery/核查状态明细.md)。"""
import json, sys, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

topics = {t["id"]: t["name"] for t in json.loads((ROOT / "data" / "topics.json").read_text(encoding="utf-8"))}
types = {"concept": "概念", "principle": "原理", "comparison": "比较", "code": "代码", "debug": "排查", "scenario": "情境"}
diffs = {"basic": "基础", "intermediate": "进阶", "advanced": "高级"}
vmap = {"verified": "已核查", "partial": "部分核查", "todo": "待核查"}

rows = []
for f in sorted((ROOT / "data" / "questions").glob("*.json")):
    for q in json.loads(f.read_text(encoding="utf-8")):
        v = q.get("verify", {})
        src = "; ".join(s.get("name", "") for s in q.get("sources", [])[:2])
        rows.append((q["topic"], q["id"], q["title"], types.get(q["type"], q["type"]),
                     diffs.get(q["difficulty"], q["difficulty"]),
                     vmap.get(v.get("status"), "?"), v.get("checked_date", ""), src))

order = {tid: i for i, tid in enumerate(topics)}
rows.sort(key=lambda r: (order.get(r[0], 99), r[1]))

lines = ["# 核查状态明细(自动生成于 2026-09-06,tools/gen_verify_report.py)", "",
         f"共 {len(rows)} 题。状态定义见《内容核查记录.md》:已核查=结论对照一手来源或官方长期稳定语义;部分核查=核心机制稳定、具体数值/版本相关已标注。", ""]
cur = None
for r in rows:
    if r[0] != cur:
        cur = r[0]
        lines += ["", f"## {topics[cur]}", "", "| 题号 | 标题 | 题型 | 难度 | 核查状态 | 核查日期 | 主要来源 |", "|---|---|---|---|---|---|---|"]
    lines.append(f"| {r[1]} | {r[2]} | {r[3]} | {r[4]} | {r[5]} | {r[6]} | {r[7][:60]} |")
lines += ["", "每题的完整出处链接与核查说明,在网站题目页『出处与核查状态』区块中展示。"]

out = ROOT / "delivery" / "核查状态明细.md"
out.write_text("\n".join(lines), encoding="utf-8")
print(f"已生成 {out.name}:{len(rows)} 题")
