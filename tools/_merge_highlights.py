# -*- coding: utf-8 -*-
"""把一批新标注合并进专题文件(写作流程用,不是校验工具)。

用法:python tools/_merge_highlights.py <专题> <片段.json>
片段.json 结构与本目录下其它标注文件一致,只含本批题号。
合并会拒绝覆盖已存在的题号——要改旧标注请直接编辑专题文件,避免手滑把既有成果冲掉。
"""
import io, json, sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")


def main():
    topic, frag = sys.argv[1], Path(sys.argv[2])
    target = ROOT / "data" / "highlights" / ("%s.json" % topic)
    add = json.loads(frag.read_text(encoding="utf-8"))
    new_qs = add.get("questions") or {}
    if not new_qs:
        raise SystemExit("片段里没有 questions")

    if target.exists():
        base = json.loads(target.read_text(encoding="utf-8"))
    else:
        base = {"topic": topic, "checked_date": add.get("checked_date", ""), "note": add.get("note", ""),
                "questions": {}}
    clash = sorted(set(base["questions"]) & set(new_qs))
    if clash:
        raise SystemExit("这些题号已存在,不覆盖:%s" % ", ".join(clash))
    base["questions"].update(new_qs)
    base["questions"] = {k: base["questions"][k] for k in sorted(base["questions"])}
    target.write_text(json.dumps(base, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    n = sum(len(v.get("spans") or []) for v in new_qs.values())
    print("合并进 %s:新增 %d 题 / %d 条;文件现有 %d 题"
          % (target.name, len(new_qs), n, len(base["questions"])))


if __name__ == "__main__":
    main()
