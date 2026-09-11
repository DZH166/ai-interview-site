# -*- coding: utf-8 -*-
"""项目C:小型文档问答(本地检索,全部离线)

目标不是"演示四层失败",而是**真的把四层区分开**:
每一层的归因都必须由「数据状态 + 唯一固定配置」决定,并能被单元测试复现。

设计要点(与上一版的差别)
  1. **运行侧不判定「库里有没有」**。上一版在 answer() 里调用了一个查询关键词黑名单
     (knowledge_exists),于是"知识覆盖"这件事变成了字符串规则:往库里加一份
     《公司地址》文档后,问"公司地址在哪里?"仍然被判"库中没有"。
     现在运行侧只能报「证据不足」;「库里确实没有」这个结论只由评测侧的独立标注
     (coverage_oracle)得出——运行侧无从知道,也不该假装知道。
  2. **固定配置**。top_k / min_score 只存在于唯一的 CONFIG,四个层级全部在**同一份配置**
     下即可触达。上一版靠每个调用点手调 refuse_threshold/top_k 摆出层级,
     同一查询同一库能因为传参不同在 0/2 之间跳,学习者无法判断到底哪一层坏了。
  3. **第③层真的有检测器**。上一版源码里根本不存在 layer==3:证据被 top_k 裁掉后
     仍判为正常。现在检索侧显式报告「达标证据被预算裁掉了多少条」,归因第③层。
  4. **第④层校验真的看回答文本**。上一版看的是 broken_fake 这个开关
     (if len(evidence) > 1),单证据时故意不遵循证据的回答会被放行。
     现在 validate() 检查回答是否覆盖每一条给定证据,与是不是"错误 fake"无关——可以
     注入任意生成器来验证它是否被拦住。

四层定义(评测侧口径)
  ① 库里没有         → 检索无证据,且独立标注确认该主题不在库中
  ② 库里有但没检索到 → 检索无证据(或未达门槛),但独立标注确认库里确实有
  ③ 证据组织不完整   → 召回了达标证据,但被 top_k 预算裁掉,回答因此缺块
  ④ 生成不遵循证据   → 回答没有覆盖给定的证据(凭空作答 / 只复述其中一条)

运行:python projects/proj_c/mini_rag.py
"""
from __future__ import annotations
import re

# ---------------------------------------------------------------- 1) 唯一固定配置
# 全流程只认这一份配置:诊断、评测、演示都从这里取参数。
CONFIG = {
    "top_k": 2,        # 证据预算:最多把几条证据交给生成器
    "min_score": 2,    # 达标门槛:重合 2-gram 数 < 门槛的文档不算证据
}

# ---------------------------------------------------------------- 2) 知识库
# 5 段本地文档(内容为演示,但都可逐字核对)
DOCS = [
    {"id": "d1", "text": "退款政策:普通商品下单 7 天内可无理由退款;定制商品不支持无理由退款,需联系客服。"},
    {"id": "d2", "text": "发货时间:现货商品下单后 24 小时内发出;预售商品按页面标注时间发货。"},
    {"id": "d3", "text": "发票说明:支持电子普通发票,下单时填写抬头;需要开发票联系客服。"},
    {"id": "d4", "text": "会员权益:黑卡会员每月 2 张免运费券,生日当月双倍积分。"},
    {"id": "d5", "text": "售后换货:需要换货先联系客服;换货商品需保持包装完整,7 天内可申请。"},
]

# ---------------------------------------------------------------- 3) 可解释检索
_SPLIT = re.compile(r"[^\w\u4e00-\u9fff]+")


def tokenize(s: str):
    """极简分词:按标点/空白切开,每段取 2-gram(演示用;真实场景用分词器)。
    刻意保留"词形敏感"这个真实弱点——它正是第②层的成因。"""
    grams = []
    for part in _SPLIT.split(str(s or "")):
        if len(part) < 2:
            continue
        for i in range(len(part) - 1):
            grams.append(part[i:i + 2])
    return grams


def retrieve(query, docs=None, config=None):
    """检索并**如实报告自己的状态**:
      hits            交给生成器的证据(score>0,按分降序,截到 top_k)
      strong          得分达标(min_score)的证据 —— 「够格当证据」的集合
      truncated       达标证据多于预算(有证据被 top_k 裁掉) → 第③层的依据
      dropped_strong  被裁掉的那些达标证据
      zero_score      经过打分但 0 分的文档:明确丢弃,不冒充"候选证据"
      best            最高分(用于判断"零召回"还是"未达门槛")
    """
    docs = DOCS if docs is None else docs
    config = CONFIG if config is None else config
    top_k = int(config.get("top_k", CONFIG["top_k"]))
    min_score = int(config.get("min_score", CONFIG["min_score"]))

    q = set(tokenize(query))
    scored, zero = [], []
    for d in docs:
        overlap = q & set(tokenize(d["text"]))
        row = {"doc": d, "score": len(overlap), "hit": sorted(overlap)[:5]}
        if row["score"] > 0:
            scored.append(row)
        else:
            zero.append(d["id"])
    scored.sort(key=lambda x: (-x["score"], x["doc"]["id"]))

    strong = [r for r in scored if r["score"] >= min_score]
    hits = scored[:top_k]
    dropped = strong[top_k:]
    return {
        "hits": hits,
        "strong": strong,
        "dropped_strong": dropped,
        "truncated": len(strong) > top_k,
        "zero_score": zero,
        "best": scored[0]["score"] if scored else 0,
        "config": {"top_k": top_k, "min_score": min_score},
        "query_terms": sorted(q)[:12],
    }


# ---------------------------------------------------------------- 4) 生成与校验
def generate(query, hits, config=None):
    """默认生成器:把拿到的每一条证据**逐条**纳入回答,并带 [dN] 引用。
    它是"遵循证据"的基线;第④层用一个故意不遵循的生成器来对照。"""
    evidence = ["[%s] %s" % (h["doc"]["id"], h["doc"]["text"]) for h in hits]
    if not evidence:
        return {"text": "", "citations": []}
    return {"text": "根据知识库:" + " ".join(evidence),
            "citations": [h["doc"]["id"] for h in hits]}


def validate(answer_text, hits):
    """独立校验:回答有没有覆盖**给定的每一条证据**。
    判据只看回答文本里有没有该证据的引用标记(或等价的可辨识片段),
    与"生成器是不是故意坏的"无关——所以它可以拦住任何来源的不遵循。"""
    text = str(answer_text or "")
    covered, missing = [], []
    for h in (hits or []):
        did = h["doc"]["id"]
        if ("[%s]" % did) in text:
            covered.append(did)
            continue
        # 退一步:回答里出现该文档足够多的显著片段,也算覆盖(容忍不带引用格式的回答)
        toks = tokenize(h["doc"]["text"])
        uniq = list(dict.fromkeys(toks))
        hit = sum(1 for t in uniq if t in text)
        if uniq and hit / len(uniq) >= 0.6:
            covered.append(did)
        else:
            missing.append(did)
    return {
        "ok": not missing,
        "covered": covered,
        "missing": missing,
        "reason": ("覆盖全部证据: %s" % ",".join(covered)) if not missing
                  else ("未覆盖证据: %s" % ",".join(missing)),
    }


# ---------------------------------------------------------------- 5) 运行侧诊断
# 运行侧能报的层级:0 正常 / 2 证据不足 / 3 证据被预算裁剪 / 4 生成未遵循证据
# 运行侧**不报**第①层:它无从知道库里到底有没有这个知识——那需要外部标注。
def diagnose(query, docs=None, config=None, generator=None):
    config = CONFIG if config is None else config
    r = retrieve(query, docs=docs, config=config)
    gen = generator or generate
    base = {"query": query, "retrieval": r, "config": r["config"]}

    # 零召回或完全没有达标证据 → 证据不足,拒答(第②层的现象,但运行侧不下"库里没有"的结论)
    if not r["strong"]:
        why = ("检索零召回(所有文档得分 0)" if r["best"] == 0
               else "有候选但最高分 %d < 门槛 %d" % (r["best"], r["config"]["min_score"]))
        return dict(base, outcome="refused", refused=True, layer=2, answer=None, evidence=[], citations=[],
                    reason="证据不足,拒答:%s。这不等于「库里没有」——是否真的没有,"
                           "需要与标注对照才能下结论。" % why)

    out = gen(query, r["hits"], config)
    answer_text = out.get("text", "")
    v = validate(answer_text, r["hits"])
    evidence = ["[%s] %s" % (h["doc"]["id"], h["doc"]["text"]) for h in r["hits"]]
    citations = [h["doc"]["id"] for h in r["hits"]]

    # 第④层:回答没有覆盖给它的证据(凭空作答 / 只复述其中一条)
    if not v["ok"]:
        return dict(base, outcome="refused", refused=True, layer=4, answer=None, evidence=evidence,
                    citations=citations, validation=v,
                    reason="生成未遵循证据:%s(给定证据 %s)" % (v["reason"], ",".join(citations)))

    # 第③层:证据是达标的,但被 top_k 预算裁掉了 —— 回答必然缺块
    if r["truncated"]:
        dropped = ",".join(h["doc"]["id"] for h in r["dropped_strong"])
        return dict(base, outcome="answered", refused=False, layer=3, answer=answer_text, evidence=evidence,
                    citations=citations, validation=v, incomplete=True, dropped=dropped,
                    reason="证据组织不完整:达标证据 %d 条,预算 top_k=%d 只纳入 %d 条,"
                           "被裁掉的是 %s。该调预算或改切分/排序,而不是怪生成器。"
                           % (len(r["strong"]), r["config"]["top_k"], len(citations), dropped))

    return dict(base, outcome="answered", refused=False, layer=0, answer=answer_text, evidence=evidence,
                citations=citations, validation=v,
                reason="答出且回答覆盖全部给定证据")


# 兼容旧调用名(仅供外部按旧名引用;语义已改为上面的新实现)
def answer(query, docs=None, config=None, generator=None):
    return diagnose(query, docs=docs, config=config, generator=generator)


# ---------------------------------------------------------------- 6) 评测侧独立标注
# 这是**人工标注的 ground truth**,只在评测侧使用。运行侧绝不调用它。
# 未标注的查询不做猜测(抛错),避免"看起来知道其实在编"。
TRUTH = {
    "退款政策是什么":            {"in_library": True,  "docs": ["d1"]},
    "现货商品多久发货":          {"in_library": True,  "docs": ["d2"]},
    "开发票和会员免运费怎么弄":  {"in_library": True,  "docs": ["d3", "d4"]},
    "黑卡会员有什么权益":        {"in_library": True,  "docs": ["d4"]},
    "下单后要退款、要开发票、还要换货怎么办": {"in_library": True, "docs": ["d1", "d3", "d5"]},
    "如何退货":                  {"in_library": True,  "docs": ["d1"]},   # 库里有,但词形不同检索不到
    "七天内能退货吗":            {"in_library": True,  "docs": ["d1"]},   # 同上
    "公司在哪个城市":            {"in_library": False, "docs": []},
    "公司年会在哪里办":          {"in_library": False, "docs": []},
    "你们支持比特币支付吗":      {"in_library": False, "docs": []},
    "怎么改绑手机号":            {"in_library": False, "docs": []},
}


def _norm_key(s):
    """标注检索用的归一化:去掉首尾空白与句末标点(问号/句号不影响主题判定)。"""
    return re.sub(r"[?？。.!！\s]+$", "", str(s or "").strip())


def coverage_oracle(query):
    """库中是否真的存在该主题的知识(评测侧独立判定)。
    这是标注,不是规则:它不参与运行侧的任何判断。未标注的查询不猜(抛错)。"""
    t = TRUTH.get(_norm_key(query))
    if t is None:
        raise KeyError("该查询未做标注,oracle 不做猜测: %r" % query)
    return bool(t["in_library"])


def _first_only_generator(query, hits, config):
    """故障生成器①:只复述第一条证据,忽略其余。"""
    h = hits[0]
    return {"text": "根据知识库:[%s] %s" % (h["doc"]["id"], h["doc"]["text"]),
            "citations": [h["doc"]["id"]]}


def _hallucinating_generator(query, hits, config):
    """故障生成器②:凭空作答,内容与证据无关。"""
    return {"text": "根据知识库:本店支持 30 天无理由退款,并额外赠送 5 张免运费券。",
            "citations": [hits[0]["doc"]["id"]]}


GENERATORS = {"default": None, "first_only": _first_only_generator,
              "hallucinating": _hallucinating_generator}

# 评测集:每条带独立标注(required)与期望层级。**不含任何逐条阈值**——
# 四层必须在同一份 CONFIG 下全部触达。
EVAL = [
    {"q": "退款政策是什么", "required": ["d1"], "expect_layer": 0, "generator": "default",
     "note": "单证据正常作答"},
    {"q": "现货商品多久发货", "required": ["d2"], "expect_layer": 0, "generator": "default",
     "note": "单证据正常作答"},
    {"q": "开发票和会员免运费怎么弄", "required": ["d3", "d4"], "expect_layer": 0,
     "generator": "default", "note": "两证据都在预算内,逐条纳入"},
    {"q": "下单后要退款、要开发票、还要换货怎么办", "required": ["d1", "d3", "d5"],
     "expect_layer": 3, "generator": "default", "note": "三条达标证据 > top_k=2:证据被预算裁掉"},
    {"q": "如何退货", "required": ["d1"], "expect_layer": 2, "generator": "default",
     "note": "库里确有退款政策,但『退货』与『退款』在 2-gram 下只共享一个字"},
    {"q": "七天内能退货吗", "required": ["d1"], "expect_layer": 2, "generator": "default",
     "note": "同上:词形不同就漏,是检索问题不是知识缺口"},
    {"q": "公司在哪个城市", "required": [], "expect_layer": 1, "generator": "default",
     "note": "库里真的没有(独立标注确认)"},
    {"q": "公司年会在哪里办", "required": [], "expect_layer": 1, "generator": "default",
     "note": "库里真的没有"},
    {"q": "你们支持比特币支付吗", "required": [], "expect_layer": 1, "generator": "default",
     "note": "库里真的没有"},
    {"q": "怎么改绑手机号", "required": [], "expect_layer": 1, "generator": "default",
     "note": "库里真的没有"},
    {"q": "开发票和会员免运费怎么弄", "required": ["d3", "d4"], "expect_layer": 4,
     "generator": "first_only", "note": "故障生成器:只复述第一条 → 校验必须拦住"},
    {"q": "现货商品多久发货", "required": ["d2"], "expect_layer": 4,
     "generator": "hallucinating", "note": "故障生成器:凭空作答,单证据也必须被拦住"},
]


def attribute_layer(case, r):
    """评测侧的层级归因:只有这里才允许下「库里没有」的结论。
    运行侧给出现象(拒答/答出/是否被预算裁掉),标注给出事实(库里到底有没有)。"""
    in_lib = coverage_oracle(case["q"])
    if r["refused"]:
        if not in_lib:
            return 1
        return r["layer"]            # 2 或 4
    return r["layer"]                # 0 或 3


def evaluate(verbose=True):
    """逐条明细评测:query / 标注 / 实际候选 / 采用 / 层级归因 / 是否正确。"""
    rows = []
    if verbose:
        print("== 评测(样例集 %d 条,只证明流程;不代表系统一般正确率)==" % len(EVAL))
    for case in EVAL:
        gen = GENERATORS.get(case.get("generator", "default"))
        r = diagnose(case["q"], docs=DOCS, config=CONFIG, generator=gen)
        layer = attribute_layer(case, r)
        row = {
            "q": case["q"], "layer": layer, "expect_layer": case["expect_layer"],
            "correct": layer == case["expect_layer"],
            "refused": r["refused"], "citations": r.get("citations", []),
            "required": case["required"],
            "retrieval_best": r["retrieval"]["best"],
            "candidates": [(h["doc"]["id"], h["score"]) for h in r["retrieval"]["hits"]],
            "dropped_strong": [h["doc"]["id"] for h in r["retrieval"]["dropped_strong"]],
            "generator": case.get("generator", "default"),
            "note": case.get("note", ""),
            "reason": r["reason"],
        }
        rows.append(row)
        if verbose:
            mark = "PASS" if row["correct"] else "FAIL"
            print("  [%s] %s" % (mark, case["q"]))
            print("        标注 required=%s | 候选 %s | 采用 %s | 层级 实际=%d 期望=%d"
                  % (case["required"] or "无(库外)", row["candidates"], row["citations"],
                     layer, case["expect_layer"]))
            print("        判定:%s" % row["reason"][:78])
    if verbose:
        ok_n = sum(1 for r in rows if r["correct"])
        print("  层级归因正确: %d/%d" % (ok_n, len(rows)))
        seen = sorted(set(r["layer"] for r in rows))
        print("  本次真实触达的层级: %s" % seen)
    return rows


# ---------------------------------------------------------------- 7) 参数敏感性(对照实验)
def sensitivity():
    """参数敏感性对照。**不是四层的来源**——四层在固定 CONFIG 下就能全部触达;
    这里只是让你看清"改预算会改变什么",以及为什么要把它固定成常量。"""
    print("\n== 参数敏感性对照(与四层归因无关:四层用固定 CONFIG 就能触达)==")
    q = "下单后要退款、要开发票、还要换货怎么办"
    for tk in (1, 2, 3, 5):
        r = diagnose(q, docs=DOCS, config={"top_k": tk, "min_score": CONFIG["min_score"]})
        print("  top_k=%d → 层级 %d | 采用 %s | %s"
              % (tk, r["layer"], r.get("citations"), r["reason"][:52]))
    print("  ↑ 同一问题同一知识库,层级随预算变化——所以预算必须钉死在 CONFIG 里,")
    print("    否则『到底哪一层坏了』就变成了传参说了算,而不是数据说了算。")
    q2 = "如何退货"
    print("\n  同义词盲区(第②层成因,与预算无关):")
    r2 = diagnose(q2, docs=DOCS, config=CONFIG)
    print("    Q: %s → 层级 %d | %s" % (q2, r2["layer"], r2["reason"][:60]))
    r2b = retrieve("退款", docs=DOCS, config=CONFIG)
    print("    对照:查询改成『退款』 → d1 得分 %d(重合 %s)——同一条知识,换个词就命中"
          % (r2b["hits"][0]["score"], ",".join(r2b["hits"][0]["hit"])))
    print("    结论:这是词项检索的盲区,不是知识库缺口。该做的是改检索(分词/同义词/向量),")
    print("          不是往库里再抄一份退款政策。")


# ---------------------------------------------------------------- 8) 入口
def main():
    print("== 项目C:小型文档问答(四层失败可真实诊断)==\n")
    print("固定配置 CONFIG = %s\n" % CONFIG)

    print("-- 运行侧演示(它只报现象,不下『库里有没有』的结论)--")
    for q in ["退款政策是什么", "如何退货", "公司在哪个城市", "下单后要退款、要开发票、还要换货怎么办"]:
        r = diagnose(q)
        tag = "拒答" if r["refused"] else "回答"
        print("Q: %s" % q)
        print("  → %s(运行侧判定:第 %d 层 %s)" % (tag, r["layer"], r["reason"][:64]))
        if not r["refused"]:
            print("  → 引用: %s" % r["citations"])
        print()

    print("-- 第④层对照:同一问题换成「故意不遵循证据」的生成器 --")
    r4 = diagnose("开发票和会员免运费怎么弄", generator=GENERATORS["first_only"])
    print("  拦截结果: 第 %d 层 | %s" % (r4["layer"], r4["reason"][:70]))
    r4b = diagnose("现货商品多久发货", generator=GENERATORS["hallucinating"])
    print("  单证据凭空作答: 第 %d 层 | %s" % (r4b["layer"], r4b["reason"][:70]))

    print()
    evaluate()
    sensitivity()

    print("\n四层口径(评测侧):")
    print("  ① 库里没有        —— 独立标注确认该主题不在库中(运行侧无权下这个结论)")
    print("  ② 库里有但没检索到 —— 检索无证据/未达门槛,而标注确认库里有")
    print("  ③ 证据组织不完整  —— 达标证据被 top_k 预算裁掉,回答因此缺块")
    print("  ④ 生成不遵循证据  —— 回答没有覆盖给定的证据(校验按回答文本判定)")


if __name__ == "__main__":
    main()
