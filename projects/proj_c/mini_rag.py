# -*- coding: utf-8 -*-
"""项目C:小型文档问答(本地检索,全部离线)
四层失败可区分:①库里没有 ②库里有但没检索到 ③检索到但证据组织错 ④生成不遵循证据。
含可触发变式实验:同义词盲区 / top-k 证据预算 / 评测报告逐条明细。
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
    """极简分词:按标点与空白切,再取 2-gram(演示用;真实场景用分词器)"""
    parts = re.split(r'[;:,。;:, ]+', s)
    grams = []
    for p in parts:
        for i in range(len(p) - 1):
            grams.append(p[i:i+2])
    return grams

# ---------- 2) 可解释检索 ----------
def search(query: str, docs=None, top_k: int = 2):
    docs = docs if docs is not None else DOCS
    q = set(tokenize(query))
    scored = []
    for d in docs:
        overlap = q & set(tokenize(d["text"]))
        scored.append({"doc": d, "score": len(overlap), "hit": sorted(overlap)[:5]})
    scored.sort(key=lambda x: -x["score"])
    return scored[:top_k]

# ---------- 3) 证据组织 + 引用 + 拒答(拒答原因区分四层) ----------
def answer(query: str, top_k: int = 2, refuse_threshold: int = 2):
    hits = search(query, top_k=top_k)
    best = hits[0]["score"] if hits else 0
    if best == 0:
        # 第①层:当前检索对任何文档零命中(可能是同义词盲区,不能断言库中没有)
        return {"answer": None, "refused": True, "layer": 2,
                "reason": f"当前检索未找到任何相关证据(全部 0 分)——可能是检索盲区(同义词/切分),不一定是知识库没有"}
    strong = [h for h in hits if h["score"] >= refuse_threshold]
    if not strong:
        # 第②层:有低分候选但没过证据门槛
        return {"answer": None, "refused": True, "layer": 2,
                "reason": f"检索到候选但证据不足(最高分 {best} < 门槛 {refuse_threshold})"}
    evidence = [f"[{h['doc']['id']}] {h['doc']['text']}" for h in strong]
    # 第④层(生成不遵循证据)在本 fake 中不发生:拼接即引用;真实 LLM 场景需评测守住
    return {"answer": f"根据知识库:{evidence[0]}", "refused": False, "layer": 0,
            "evidence": evidence, "citations": [h["doc"]["id"] for h in strong]}

# ---------- 4) 评测:逐条明细(query/目标/候选/采用/引用/结果) ----------
EVAL = [
    {"q": "买错了想退货,七天内可以吗?", "expect_doc": "d1", "should_refuse": False},
    {"q": "预售的商品什么时候发货?",     "expect_doc": "d2", "should_refuse": False},
    {"q": "电子发票怎么开?",             "expect_doc": "d3", "should_refuse": False},
    {"q": "黑卡会员有什么好处?",         "expect_doc": "d4", "should_refuse": False},
    {"q": "公司在哪个城市?",             "expect_doc": None, "should_refuse": True},   # 库里没有
]

def evaluate():
    print("== 评测(样例集 5 条,只证明流程;不代表系统一般正确率)==")
    recall_hits, correct = 0, 0
    for e in EVAL:
        r = answer(e["q"])
        cands = ",".join(h["doc"]["id"] for h in search(e["q"]))
        if e["should_refuse"]:
            ok = r["refused"]
            correct += ok
            print(f"  [{'PASS' if ok else 'FAIL'}] {e['q']} | 候选[{cands}] | 拒答({r.get('layer')}层): {r['reason'][:46]}")
        else:
            hit = (not r["refused"]) and e["expect_doc"] in r.get("citations", [])
            recall_hits += hit
            correct += hit
            print(f"  [{'PASS' if hit else 'FAIL'}] {e['q']} | 目标 {e['expect_doc']} | 候选[{cands}] | 采用 {r.get('citations')}")
    n = sum(1 for e in EVAL if not e["should_refuse"])
    print(f"  检索 recall: {recall_hits}/{n} | 含拒答总正确: {correct}/{len(EVAL)}")

# ---------- 5) 可触发的变式实验(改动前后差异真实发生) ----------
def experiments():
    print("\n== 变式实验:每项差异都可复现 ==")
    # 实验1:同义词盲区(②层触发)——『退货』与文档的『退款』在 2-gram 下仅共享『退』,阈值内不通过
    q = "如何退货"
    r = answer(q, refuse_threshold=2)
    print(f"[实验1 同义词盲区] Q: {q}")
    print(f"  → 拒答({r['layer']}层): {r['reason']}")
    print(f"  → 教学点:不能说『知识库没有』——d1 里就有退款政策,是当前词项检索没连上『退货→退款』。")
    # 实验1b:把『退货』改写为『退款』,同一条知识立刻命中——证明是检索盲区不是知识缺口
    r2 = search("退款", top_k=1)
    print(f"  → 对照(查询含『退款』二字): d1 得分 {r2[0]['score']}({','.join(r2[0]['hit'])} 重合)——同一条知识,检索词一变结果就变")
    # 实验2:top_k 证据预算(②层触发对比)——需要两块证据的问题
    q2 = "开发票和会员免运费怎么弄?"   # 需要 d3+d4 两块
    two = answer(q2, top_k=2, refuse_threshold=1)
    one = answer(q2, top_k=1, refuse_threshold=1)
    print(f"[实验2 top-k 证据预算] Q: {q2}")
    print(f"  → top_k=2: 引用 {two.get('citations')}(可答)")
    print(f"  → top_k=1: 引用 {one.get('citations', [])}(证据被预算裁掉——改动前后差异真实发生)")

def main():
    print("== 项目C:小型文档问答 ==\n")
    demo = [
        ("七天内能退货吗?", 2, 1),
        ("隔壁城市有门店吗?", 2, 3),
    ]
    for q, k, thr in demo:
        r = answer(q, top_k=k, refuse_threshold=thr)
        print(f"Q: {q}  (阈值={thr})")
        if r["refused"]:
            print(f"  → 拒答({r['layer']}层): {r['reason']}\n")
        else:
            print(f"  → {r['answer']}\n  → 引用: {r['citations']}\n")
    evaluate()
    experiments()
    print("\n四层失败对照:①库里没有=评测里『公司在哪个城市』;②没检索到/证据不足=同义词盲区实验;"
          "③证据组织错=多证据问题 top_k 不足;④生成不遵循=fake 不发生,真实 LLM 场景由评测守住。")

if __name__ == "__main__":
    main()
