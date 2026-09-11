# -*- coding: utf-8 -*-
"""项目C 四层失败诊断的真实性测试(问题 G)

这些断言写的是「期望行为」:四层失败必须由**数据状态 + 固定配置**唯一决定,
并且必须能被真实诊断出来,而不是靠调用方逐题手调参数摆出来的。
在 e0adacb 基线上应当失败——失败即证据。阶段8 重建后应全部转绿。

运行:python tests/proj_c_layers_test.py
"""
import importlib.util
import inspect
import io
import json
import os
import sys

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

_passed = 0
_failed = 0
_failures = []


def ok(name, cond, detail=""):
    global _passed, _failed
    if cond:
        _passed += 1
        print("  PASS", name)
    else:
        _failed += 1
        _failures.append(name)
        print("  FAIL", name)
        if detail:
            print("    →", detail)


def load():
    path = os.path.join(ROOT, "projects", "proj_c", "mini_rag.py")
    spec = importlib.util.spec_from_file_location("mini_rag", path)
    m = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(m)
    return m


M = load()

# 运行侧必须暴露的接口(固定配置 + 可对照实验的库参数)
def has(fn):
    return callable(getattr(M, fn, None))


print("== 项目C 接口(运行侧 / 评测侧职责分离)==")
for fn in ("retrieve", "generate", "validate", "diagnose", "coverage_oracle", "evaluate"):
    ok("暴露 %s()" % fn, has(fn), "缺少函数 → 无法把四层归因做成可测试的行为")
ok("存在唯一固定配置 CONFIG", isinstance(getattr(M, "CONFIG", None), dict),
   "getattr(M,'CONFIG')=%r" % (getattr(M, "CONFIG", None),))

DOCS = list(getattr(M, "DOCS", []))
D5 = {"id": "d5", "text": "公司地址:上海市浦东新区张江路 100 号,工作日 9:00-18:00 接待。"}

# ---------- G-1 运行侧不得自行宣称「库里没有」 ----------
print("\n== G-1 「库里到底有没有」不能由运行侧的关键词表决定 ==")
if has("diagnose"):
    sig = inspect.signature(M.diagnose)
    ok("G-1 diagnose() 可换库(docs 参数)", "docs" in sig.parameters,
       "参数=%s → 无法做『同一问题、不同库』的对照实验" % list(sig.parameters))
    # 库里有该知识 → 必须能答出;且运行侧任何路径都不得声称「库里没有」
    try:
        r = M.diagnose("公司地址在哪里?", docs=DOCS + [D5])
        reason = str(r.get("reason", ""))
        ok("G-1a 库里存在该知识时必须答出(引用 d5)",
           r.get("outcome") == "answered" and "d5" in (r.get("citations") or []),
           "outcome=%r citations=%r reason=%r" % (r.get("outcome"), r.get("citations"), reason))
        ok("G-1b 运行侧不得出现「库里没有」式断言(它无从知道)",
           ("库里没有" not in reason) and ("库中没有" not in reason),
           "reason=%r → 运行侧把关键词表当成了知识覆盖判定" % reason[:70])
    except TypeError as e:
        ok("G-1a 库里存在该知识时必须答出(引用 d5)", False, "调用方式不兼容:%s" % e)
        ok("G-1b 运行侧不得出现「库里没有」式断言(它无从知道)", False, "同上")
else:
    ok("G-1a 库里存在该知识时必须答出(引用 d5)", False, "无 diagnose()")
    ok("G-1b 运行侧不得出现「库里没有」式断言(它无从知道)", False, "无 diagnose()")

# ---------- G-2 库外主题必须归因第①层(由独立 oracle 判定) ----------
print("\n== G-2 库外主题的层级归因(评测侧独立 oracle)==")
OUT_OF_LIB = ["公司年会在哪里办?", "你们支持比特币支付吗?", "怎么改绑手机号?"]
if has("coverage_oracle") and has("evaluate"):
    for q in OUT_OF_LIB:
        ok("G-2 oracle 判定「库里确实没有」: " + q, M.coverage_oracle(q) is False,
           "oracle 认为库里有 → 覆盖判定与库内容无关")
    rows = []
    try:
        rows = M.evaluate(verbose=False) if "verbose" in inspect.signature(M.evaluate).parameters else M.evaluate()
    except TypeError:
        rows = M.evaluate()
    if isinstance(rows, list):
        byq = {}
        for r in rows:
            if isinstance(r, dict) and "q" in r:
                byq[r["q"]] = r
        for q in OUT_OF_LIB:
            r = byq.get(q)
            ok("G-2 评测归因第①层: " + q,
               r is not None and r.get("layer") == 1,
               "评测行=%r → 库外主题被归因成「检索没命中」,会把学习者引向改检索而不是补文档"
               % (r.get("layer") if r else "缺该查询"))
    else:
        ok("G-2 evaluate() 返回逐条明细(含 layer)", False,
           "返回类型=%s → 评测表没有层级归因" % type(rows).__name__)
else:
    ok("G-2 评测侧具备独立 oracle 与逐条层级归因", False, "缺 coverage_oracle()/evaluate()")

# ---------- G-3 第③层必须真实存在检测器 ----------
print("\n== G-3 第③层(证据组织不完整)必须被真实检出 ==")
TWO_EVIDENCE_Q = "开发票和会员免运费怎么弄?"
src = open(os.path.join(ROOT, "projects", "proj_c", "mini_rag.py"), encoding="utf-8").read()
ok("G-3 源码中存在第③层的产出路径", ('"layer": 3' in src) or ("'layer': 3" in src),
   "源码里没有任何 layer=3 → 第③层只是打印对照,从未被系统诊断出来")
if has("diagnose"):
    cfg = dict(getattr(M, "CONFIG", {}) or {})
    cfg.update({"top_k": 1, "min_score": 1})
    try:
        r = M.diagnose(TWO_EVIDENCE_Q, docs=DOCS, config=cfg)
        ok("G-3 证据被预算裁剪时必须归因第③层", r.get("layer") == 3,
           "layer=%r → 回答缺一块证据却被判为正常" % r.get("layer"))
    except TypeError as e:
        ok("G-3 证据被预算裁剪时必须归因第③层", False, "调用方式不兼容:%s" % e)

# ---------- G-4 第④层校验必须真的看回答文本 ----------
print("\n== G-4 第④层校验必须检查回答内容,而不是看一个开关 ==")
if has("validate"):
    hits = [{"doc": DOCS[0], "score": 3, "hit": ["退款"]}]
    bad = M.validate("今天天气不错,建议出门散步。", hits)
    ok("G-4a 单证据下,忽略证据的回答必须判为不遵循",
       isinstance(bad, dict) and bad.get("ok") is False,
       "validate()=%r → 单证据时放行,校验形同虚设" % (bad,))
    good = M.validate("根据知识库:[d1] 退款政策:普通商品下单 7 天内可无理由退款。", hits)
    ok("G-4b 遵循证据的回答必须判为通过", isinstance(good, dict) and good.get("ok") is True,
       "validate()=%r" % (good,))
if has("diagnose") and has("generate"):
    def ignoring_generator(query, hits, config):
        """故意只复述第一条证据、忽略其余(模拟第④层失败)"""
        return {"text": "根据知识库:[%s] %s" % (hits[0]["doc"]["id"], hits[0]["doc"]["text"]),
                "citations": [hits[0]["doc"]["id"]]}
    cfg = dict(getattr(M, "CONFIG", {}) or {})
    try:
        r1 = M.diagnose(TWO_EVIDENCE_Q, docs=DOCS, config=cfg, generator=ignoring_generator)
        ok("G-4c 双证据下忽略证据的回答必须归因第④层", r1.get("layer") == 4,
           "layer=%r" % r1.get("layer"))
        # 单证据:生成器仍不遵循(凭空作答)→ 也必须拦下
        def hallucinating_generator(query, hits, config):
            return {"text": "根据知识库:本店支持 30 天无理由退款并赠送运费券。",
                    "citations": [hits[0]["doc"]["id"]]}
        csig = inspect.signature(M.diagnose)
        if "generator" in csig.parameters:
            cfg1 = dict(cfg); cfg1.update({"top_k": 1, "min_score": 1})
            r2 = M.diagnose("七天内能退货吗?", docs=DOCS, config=cfg1, generator=hallucinating_generator)
            ok("G-4d 单证据下凭空作答也必须归因第④层", r2.get("layer") == 4,
               "layer=%r → 生成器答了证据里没有的内容却放行" % r2.get("layer"))
    except TypeError as e:
        ok("G-4c 双证据下忽略证据的回答必须归因第④层", False, "调用方式不兼容:%s" % e)

# ---------- G-5 检索结果不得把 0 分文档当候选 ----------
print("\n== G-5 0 分文档不得作为「候选证据」展示 ==")
if has("retrieve"):
    try:
        r = M.retrieve("公司在哪个城市?", docs=DOCS, config=dict(getattr(M, "CONFIG", {}) or {}))
        hits = r.get("hits", []) if isinstance(r, dict) else r
        zero = [h for h in hits if (h.get("score") or 0) <= 0]
        ok("G-5 0 分文档不出现在候选里(必须显式丢弃或标注)", len(zero) == 0,
           "候选含 0 分文档 %r → 评测表看起来「有召回」,实际是列表顺序" % [h["doc"]["id"] for h in zero])
    except TypeError as e:
        ok("G-5 0 分文档不出现在候选里", False, "调用方式不兼容:%s" % e)
elif has("search"):
    r = M.search("公司在哪个城市?")
    zero = [h for h in r if h.get("score", 0) <= 0]
    ok("G-5 0 分文档不出现在候选里(必须显式丢弃或标注)", len(zero) == 0,
       "候选含 0 分文档 %r" % [h["doc"]["id"] for h in zero])

# ---------- G-6 四层必须在同一固定配置下都能出现 ----------
print("\n== G-6 失败层级由数据状态与固定配置决定,不靠逐题手调参数 ==")
eval_set = getattr(M, "EVAL", [])
ok("G-6a 评测集不得携带逐题阈值", all(("refuse_threshold" not in e and "top_k" not in e) for e in eval_set),
   "评测条目里带了阈值 → 层级是被调用方摆出来的,不是数据决定的")
if has("evaluate") and has("coverage_oracle"):
    try:
        rows = M.evaluate()
        layers = set(r.get("layer") for r in rows if isinstance(r, dict))
        ok("G-6b 固定配置下四层均可被真实触达(评测集覆盖 0/1/2/3/4)", layers >= {0, 1, 2, 3, 4},
           "观测到的层级=%r → 有层级从未被真实诊断出来" % sorted(x for x in layers if x is not None))
    except Exception as e:
        ok("G-6b 固定配置下四层均可被真实触达(评测集覆盖 0/1/2/3/4)", False, "evaluate() 异常:%s" % e)

print("\n结果: %d 通过, %d 失败" % (_passed, _failed))
if _failed:
    print("失败项(基线缺陷证据):\n  - " + "\n  - ".join(_failures))
sys.exit(1 if _failed else 0)
