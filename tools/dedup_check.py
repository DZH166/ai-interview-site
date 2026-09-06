# -*- coding: utf-8 -*-
"""题库去重预警:计算题目标题之间的字符 n-gram 相似度,标记高重合对。
用法:python tools/dedup_check.py [--file b5-xxx.json 只检查某文件与存量]
阈值:0.6 以上视为疑似重复(人工判断:同义合并还是实质不同的追问)。"""
import json, sys, io, re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

N = 3  # n-gram 长度
THRESH = 0.6


def norm(t):
    return re.sub(r"[\s,。;;:?？!！()（）\"'『』「」、]", "", str(t or "").lower())


def grams(t, n=N):
    s = norm(t)
    return {s[i:i + n] for i in range(max(0, len(s) - n + 1))} if len(s) >= n else {s}


def sim(a, b):
    ga, gb = grams(a), grams(b)
    if not ga or not gb:
        return 0.0
    return len(ga & gb) / min(len(ga), len(gb))


def main():
    only = None
    if "--file" in sys.argv:
        only = sys.argv[sys.argv.index("--file") + 1]
    qs = []
    for f in sorted((ROOT / "data" / "questions").glob("*.json")):
        for q in json.loads(f.read_text(encoding="utf-8")):
            qs.append((f.name, q["id"], q["title"]))
    flagged = 0
    for i in range(len(qs)):
        for j in range(i + 1, len(qs)):
            (fa, ia, ta), (fb, ib, tb) = qs[i], qs[j]
            if only and fa != only and fb != only:
                continue
            s = sim(ta, tb)
            if s >= THRESH:
                flagged += 1
                print(f"[{s:.2f}] {ia} ↔ {ib}\n    {ta}\n    {tb}")
    if not flagged:
        print(f"共 {len(qs)} 题,n-gram({N}) 相似度 ≥ {THRESH}:无预警")
    else:
        print(f"共 {len(qs)} 题,预警 {flagged} 对(≥ {THRESH},需人工判断:同义合并 / 实质不同保留)")


if __name__ == "__main__":
    main()
