# -*- coding: utf-8 -*-
"""项目C:小型文档问答(本地检索,全部离线)
流程:切分 → 可解释检索(词重合) → 证据组织+引用 → 拒答 → 小评测集。
运行:python projects/proj_c/mini_rag.py
"""
from __future__ import annotations
import re

# ---------- 1) 知识库:少量可核对的本地文档(内容为演示) ----------
DOCS = [
    {"id": "d1", "text": "退款政策:普通商品下单 7 天内可无理由退款;定制商品不支持无理由退款,需联系客服。"},
    {"id": "d2", "text": "发货时间:现货商品 24 小时内发出;预售商品按页面标注时间发货。"},
    {"id": "d3", "text": "发票说明:支持电子普通发票,下单时填写抬头;增值税专用发票需联系客服开具。"},
    {"id": "d4", "text": "会员权益:黑卡会员每月 2 张免运费券,生日当月双倍积分。"},
]

def tokenize(s: str):
    """极简分词:按标点与空白切,再取 2-gram(演示用;真实场景用 jieba/分词器)"""
    parts = re.split(r'[;:,。;:, ]+', s)
    grams = []
    for p in parts:
        for i in range(len(p) - 1):
            grams.append(p[i:i+2])
    return grams

# ---------- 2) 可解释检索:词重合打分(阶段5 练习的升级版) ----------
def search(query: str, docs=None, top_k: int = 2):
    docs = docs if docs is not None else DOCS
    q = set(tokenize(query))
    scored = []
    for d in docs:
        overlap = q & set(tokenize(d["text"]))
        scored.append({"doc": d, "score": len(overlap), "hit": sorted(overlap)[:5]})
    scored.sort(key=lambda x: -x["score"])
    return scored[:top_k]

# ---------- 3) 证据组织 + 引用 + 拒答 ----------
def answer(query: str, top_k: int = 2, refuse_threshold: int = 2):
    hits = search(query, top_k=top_k)
    strong = [h for h in hits if h["score"] >= refuse_threshold]
    if not strong:
        # 拒答:库里没有相关内容——如实说,不编造(RG-001 的 R/A/G 中 A 无证据时)
        return {"answer": None, "refused": True,
                "reason": f"知识库中没有与「{query}」相关的证据(最高分 {hits[0]['score'] if hits else 0})"}
    evidence = [f"[{h['doc']['id']}] {h['doc']['text']}" for h in strong]
    # 生成阶段(fake):真实场景由 LLM 基于 evidence 回答;这里拼接演示引用格式
    answer_text = f"根据知识库:{evidence[0]}"
    return {"answer": answer_text, "refused": False, "evidence": evidence,
            "citations": [h["doc"]["id"] for h in strong]}

# ---------- 4) 小评测集:每条标注期望(数据为演示) ----------
EVAL = [
    {"q": "买错了想退货,七天内可以吗?", "expect_doc": "d1", "should_refuse": False},
    {"q": "预售的商品什么时候发货?",     "expect_doc": "d2", "should_refuse": False},
    {"q": "电子发票怎么开?",             "expect_doc": "d3", "should_refuse": False},
    {"q": "黑卡会员有什么好处?",         "expect_doc": "d4", "should_refuse": False},
    {"q": "公司在哪个城市?",             "expect_doc": None, "should_refuse": True},   # 库里没有
]

def evaluate():
    print("== 评测(每次改动后重跑,RG-059 的最小版)==")
    recall_hits, correct = 0, 0
    for e in EVAL:
        r = answer(e["q"])
        if e["should_refuse"]:
            ok = r["refused"]
            correct += ok
            status = "PASS 拒答" if ok else "FAIL 该拒未拒"
        else:
            hit = (not r["refused"]) and e["expect_doc"] in r.get("citations", [])
            recall_hits += hit
            correct += hit
            status = "PASS 命中" if hit else "FAIL 未命中/误拒"
        print(f"  [{status}] {e['q']} → citations={r.get('citations') or '-'}")
    n_ans = sum(1 for e in EVAL if not e["should_refuse"])
    print(f"  检索 recall: {recall_hits}/{n_ans} | 含拒答总正确: {correct}/{len(EVAL)}")

def main():
    print("== 项目C:小型文档问答 ==\n")
    demo = [
        ("七天内能退货吗?", 2, 1),          # (query, top_k, 阈值):阈值 1 演示正常回答
        ("退货", 2, 1),                     # 故意模糊:观察证据不足
        ("隔壁城市有门店吗?", 2, 3),        # 库里没有 → 用高阈值演示拒答
    ]
    for q, k, thr in demo:
        r = answer(q, top_k=k, refuse_threshold=thr)
        print(f"Q: {q}  (阈值={thr})")
        if r["refused"]:
            print(f"  → 拒答({r['reason']})\n")
        else:
            print(f"  → {r['answer']}")
            print(f"  → 引用: {r['citations']}\n")
    evaluate()
    print("\n体会:①拒答要有证据分门槛(阈值=召回与误答的权衡);②top_k 是证据预算;③评测集让改动可对比(RG-059)。")

if __name__ == "__main__":
    main()
