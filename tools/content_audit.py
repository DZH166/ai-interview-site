# -*- coding: utf-8 -*-
"""内容审计:用可量化阈值找出真正薄弱的题目与失效的交叉引用。

不看「感觉够不够」,只看能算出来的东西:
  - 十要素缺不缺、够不够长(阈值写在 MIN_LEN,改阈值要说明理由)
  - 引用完整性:related / prerequisites / doc_refs 指向的 ID / 文档是否真实存在
  - 来源与核查状态:有没有来源、状态是否合法、核查日期是否过期
  - 占位符残留:TODO / 待补 / XXX / ???

用法:
  python tools/content_audit.py                # 打印摘要
  python tools/content_audit.py --report        # 额外写 docs/内容审计-<日期>.md
  python tools/content_audit.py --strict        # 有问题则非 0 退出
"""
import argparse
import datetime
import io
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

# 绝对下限:低于它才叫「一眼就答完了」,是硬伤。
# 取值来自题库真实分布(306 题):各字段最小值 answer=125 / plain=125 / deep=235 /
# example=76 / interview=142,总长最小 885。这里取在最小值之下留一点余量——
# 目的是拦住「一句话打发」的新增内容,而不是逼所有人把话说长。
# (早先按 150 卡 answer 会连报 6 条,而那 6 题的 deep 都在 500 字以上,属于阈值噪音。)
MIN_LEN = {"answer": 120, "plain": 100, "deep": 200, "example": 60, "interview": 120}
MIN_TOTAL = 800          # 五段总长下限
REL_PCT = 0.05           # 相对偏薄:总长低于全库 5% 分位
MIN_FOLLOWUPS = 2
MIN_PITFALLS = 3
STALE_DAYS = 45          # 核查日期超过这么多天算过期

# 占位符扫描是启发式的,必须按「整个词」匹配,否则 appendToDOM 里的 toDO 也会被抓。
# 少数命中是正当写法,列进 BENIGN 并写明理由——豁免要看得见,不能靠悄悄放过。
PLACEHOLDER = re.compile(r"(\bTODO\b|\bFIXME\b|待补充|待填写|待补|XXX+|\?\?\?|示例文本|lorem)", re.I)
BENIGN = [
    (re.compile(r"XXX\s*[((]", re.I), "脱敏写法,如 XXX(违禁品)"),
    (re.compile(r"[-_.a-z0-9]XXX", re.I), "脱敏写法,如 sk-XXXX"),
    (re.compile(r"待补充"), "业务语义(待补充材料),不是在说内容没写完"),
]


def quantile(sorted_vals, p):
    if not sorted_vals:
        return 0
    return sorted_vals[min(len(sorted_vals) - 1, int(len(sorted_vals) * p))]


# 数字型断言最容易被面试官追问出处,单独查一遍。
# 只盯「可被追问的量化说法」:百分比、倍数、量级词、具体年份。
NUM_CLAIM = re.compile(
    r"(\d+(?:\.\d+)?\s*%|\d+(?:\.\d+)?\s*倍|"
    r"\d+(?:\.\d+)?\s*(?:万|亿|M|k|K)\b|"
    r"20\d{2}\s*年|"
    r"\d+\s*(?:token|Token|tokens)\b)"
)
# 带这些词说明本来就说得含糊,不算硬断言
HEDGE = re.compile(r"(约|大约|通常|往往|一般|常见|量级|示意|概念级|比如|例如|经验|参考|"
                   r"不等|取决于|可能|最多|至少|上下|左右|数量级)")
FIRST_HAND = ("paper", "official", "official-docs", "official-blog", "repo", "benchmark")


def numeric_claims(text):
    """返回 (硬断言数, 命中样例)"""
    hard, hits = 0, []
    for m in NUM_CLAIM.finditer(str(text or "")):
        ctx = str(text)[max(0, m.start() - 40): m.end() + 40]
        if HEDGE.search(ctx):
            continue
        hard += 1
        if len(hits) < 3:
            hits.append(ctx.replace("\n", " ").strip()[:60])
    return hard, hits


def load_all():
    qs = []
    for f in sorted((ROOT / "data" / "questions").glob("*.json")):
        for q in json.loads(f.read_text(encoding="utf-8")):
            q["_file"] = f.name
            qs.append(q)
    return qs


def doc_ids():
    """文档 ID 写在 data/docs/*.md 的 front-matter `id:` 里(与 build.py 同一套规则)。

    直接拿文件名当 ID 会把 doc-agent-1 判成不存在,是审计工具自己的错。
    """
    out = set()
    for f in sorted((ROOT / "data" / "docs").glob("*.md")):
        text = f.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
        did = f.stem
        if m:
            for line in m.group(1).splitlines():
                k, _, v = line.partition(":")
                if k.strip() == "id" and v.strip():
                    did = v.strip()
        out.add(did)
    return out


def load_ids():
    """收集全部可用 ID,顺带返回学习路径结构供跨引用检查。"""
    ids = set()
    for f in sorted((ROOT / "data" / "questions").glob("*.json")):
        for q in json.loads(f.read_text(encoding="utf-8")):
            ids.add(q["id"])
    paths = json.loads((ROOT / "data" / "paths.json").read_text(encoding="utf-8"))
    drill_ids = set()
    stage_ids = set()
    drills_total = 0
    for p in paths.get("paths", []):
        for s in p.get("stages", []) or []:
            if s.get("id"):
                stage_ids.add(p.get("id", "") + "/" + s["id"])
            for d in s.get("drills", []) or []:
                drills_total += 1
                if d.get("id"):
                    drill_ids.add(d["id"])
            if s.get("exercise") and s["exercise"].get("name"):
                pass
    projs = json.loads((ROOT / "data" / "projects.json").read_text(encoding="utf-8"))
    for p in projs.get("projects", []):
        if p.get("id"):
            ids.add(p["id"])
    dids = doc_ids()
    print("题库 %d 题 / 专项练习 %d 个 / 阶段 %d / 项目 %d / 文档 %d"
          % (len(ids - drill_ids), drills_total, len(stage_ids),
             len(projs.get("projects", [])), len(dids)))
    return ids, drill_ids, dids, paths


def audit_paths(paths, q_ids, d_ids, drill_ids):
    """学习路径是给学生实际走的路,引用断了就是「点进去空白」,必须当硬问题。"""
    out = []
    for p in paths.get("paths", []):
        pid = p.get("id", "?")
        for s in p.get("stages", []) or []:
            where = "%s/%s" % (pid, s.get("id", "?"))
            for q in s.get("questions", []) or []:
                if q not in q_ids:
                    out.append(("断", where, "stage.questions", "指向不存在的题目:%s" % q))
            for d in s.get("docs", []) or []:
                if d not in d_ids:
                    out.append(("断", where, "stage.docs", "指向不存在的文档:%s" % d))
            for d in s.get("drills", []) or []:
                for k in ("id", "q", "reference", "reason"):
                    if not str(d.get(k) or "").strip():
                        out.append(("缺", where, "drill." + k, "练习缺字段(题面摘要:%s)"
                                    % str(d.get("q") or "")[:20]))
            ex = s.get("exercise") or {}
            if ex:
                for k in ("name", "code"):
                    if not str(ex.get(k) or "").strip():
                        out.append(("缺", where, "exercise." + k, "阶段练习缺字段"))
                va = ex.get("variant") or {}
                for k in ("question", "reference"):
                    if not str(va.get(k) or "").strip():
                        out.append(("缺", where, "exercise.variant." + k, "变式缺字段"))
            if not (s.get("questions") or []):
                out.append(("薄", where, "stage.questions", "阶段没挂任何题目"))
    return out


def selftest():
    """检查器自身的反向对照:动手改过匹配规则后,必须还认得出真占位符。"""
    should_hit = ["这里 TODO: 补充真实数据", "FIXME 待改", "示例文本占位", "??? 没写"]
    should_miss = ["appendToDOM(pending)  // 把缓冲渲染进 DOM",
                   "用户输入:「怎么制作 XXX(违禁品)」", "key = 'sk-XXXX-XXXX'",
                   "2 笔缺少发票,已标记待补充(详见「待补充」sheet)"]
    bad = [t for t in should_hit if not PLACEHOLDER.search(t)]
    if bad:
        print("自检失败:认不出真占位符 %r" % bad)
        return False
    wrong = []
    for t in should_miss:
        for m in PLACEHOLDER.finditer(t):
            ctx = t[max(0, m.start() - 30): m.end() + 30]
            if not any(rx.search(ctx) for rx, _ in BENIGN):
                wrong.append((t, m.group(0)))
    if wrong:
        print("自检失败:把正常写法当成占位符 %r" % wrong)
        return False
    print("审计器自检通过:%d 个真占位符全部命中,%d 个正常写法全部豁免"
          % (len(should_hit), len(should_miss)))
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--report", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--selftest", action="store_true")
    ap.add_argument("--list-nosource", action="store_true",
                    help="列出没有任何可打开来源页的题目(待补来源的工作清单)")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(0 if selftest() else 1)

    today = datetime.date.today()
    qs = load_all()
    ids, drill_ids, doc_ids_set, paths = load_ids()
    known = ids | drill_ids

    problems = []          # (级别, 题号/范围, 问题, 明细)
    warnings = []

    # ---- 逐题检查
    totals = {}
    for q in qs:
        total = sum(len(str(q.get(k) or "")) for k in MIN_LEN)
        totals[q.get("id")] = total
        if total < MIN_TOTAL:
            problems.append(("薄", q.get("id", "?"), "总长",
                             "%d 字 < 下限 %d,四段加起来都撑不满一题" % (total, MIN_TOTAL)))

    for q in qs:
        qid = q.get("id", "?")
        for k, need in MIN_LEN.items():
            v = str(q.get(k) or "").strip()
            if not v:
                problems.append(("缺", qid, k, "字段缺失或为空"))
            elif len(v) < need:
                warnings.append(("薄", qid, k, "%d 字 < 下限 %d" % (len(v), need)))
        fu = q.get("followups") or []
        if len(fu) < MIN_FOLLOWUPS:
            warnings.append(("薄", qid, "followups", "只有 %d 条追问" % len(fu)))
        for i, f in enumerate(fu):
            if not str(f.get("q") or "").strip() or not str(f.get("a") or "").strip():
                problems.append(("缺", qid, "followups[%d]" % i, "追问的 q/a 不完整"))
        pf = q.get("pitfalls") or []
        if len(pf) < MIN_PITFALLS:
            warnings.append(("薄", qid, "pitfalls", "只有 %d 条坑点" % len(pf)))
        chk = q.get("check") or {}
        for k in ("q", "a", "explain"):
            if not str(chk.get(k) or "").strip():
                problems.append(("缺", qid, "check." + k, "检验题三件套不完整"))
        if not (q.get("tags") or []):
            problems.append(("缺", qid, "tags", "没有标签"))
        if not (q.get("doc_refs") or []):
            warnings.append(("薄", qid, "doc_refs", "没有挂文档"))
        for r in q.get("related") or []:
            if r not in known:
                problems.append(("断", qid, "related", "指向不存在的 ID:%s" % r))
            if r == qid:
                problems.append(("断", qid, "related", "指向自己"))
        for r in q.get("prerequisites") or []:
            if r not in known:
                problems.append(("断", qid, "prerequisites", "指向不存在的 ID:%s" % r))
        for r in q.get("doc_refs") or []:
            if r not in doc_ids_set:
                problems.append(("断", qid, "doc_refs", "指向不存在的文档:%s" % r))
        srcs = q.get("sources") or []
        if not srcs:
            problems.append(("缺", qid, "sources", "一条来源都没有"))

        # 数字断言 vs 一手来源
        hard, hits = numeric_claims(" ".join(str(q.get(k) or "") for k in MIN_LEN))
        has_first_hand = any((s.get("kind") or "") in FIRST_HAND and (s.get("url") or "").startswith("http")
                             for s in srcs)
        if hard >= 3 and not has_first_hand:
            warnings.append(("数", qid, "数字断言",
                             "%d 处可被追问的量化说法,但没有一手来源;例:%s" % (hard, hits[0] if hits else "")))
        elif hard >= 6:
            warnings.append(("数", qid, "数字断言", "%d 处量化说法,建议逐条对一次出处" % hard))
        v = q.get("verify") or {}
        if v.get("status") not in ("verified", "partial", "todo"):
            problems.append(("缺", qid, "verify.status", "状态非法:%r" % v.get("status")))
        cd = str(v.get("checked_date") or "")
        if not cd:
            problems.append(("缺", qid, "verify.checked_date", "没有核查日期"))
        else:
            try:
                d = datetime.date.fromisoformat(cd)
                if (today - d).days > STALE_DAYS:
                    warnings.append(("旧", qid, "verify.checked_date",
                                     "%s,已 %d 天" % (cd, (today - d).days)))
            except ValueError:
                problems.append(("缺", qid, "verify.checked_date", "日期格式不对:%s" % cd))
        for k in ("answer", "plain", "deep", "example", "interview"):
            text = str(q.get(k) or "")
            for m in PLACEHOLDER.finditer(text):
                ctx = text[max(0, m.start() - 30): m.end() + 30].replace("\n", " ")
                if any(rx.search(ctx) for rx, _why in BENIGN):
                    continue
                warnings.append(("占", qid, k, "疑似占位符 %r:%s" % (m.group(0), ctx.strip())))

    # ---- 相对偏薄:总长落在全库 5% 分位以下(阈值来自数据,不是拍脑袋)
    cut = quantile(sorted(totals.values()), REL_PCT)
    for qid, total in sorted(totals.items(), key=lambda kv: kv[1])[:12]:
        if total < cut:
            warnings.append(("薄", qid, "总长", "%d 字 < 全库 %d%% 分位 %d,是相对最薄的几道"
                             % (total, int(REL_PCT * 100), cut)))

    # ---- 跨题检查
    seen = {}
    for q in qs:
        t = str(q.get("title") or "").strip()
        seen.setdefault(t, []).append(q.get("id"))
    dup = {t: v for t, v in seen.items() if len(v) > 1}
    for t, v in dup.items():
        problems.append(("重", ",".join(v), "title", "标题完全重复:%s" % t[:40]))

    oid = [q.get("id") for q in qs]
    if len(oid) != len(set(oid)):
        problems.append(("重", "-", "id", "题号不唯一"))

    # ---- 学习路径的引用完整性
    path_issues = audit_paths(paths, ids, doc_ids_set, drill_ids)
    for lvl, where, field, msg in path_issues:
        (problems if lvl in ("断", "缺") else warnings).append((lvl, where, field, msg))

    # ---- 没有可打开来源的题:这是**已知缺口清单**,不是判定「内容错」
    nosource = [q for q in qs
                if not any((s.get("url") or "").startswith("http")
                           for s in (q.get("sources") or []))]
    if args.list_nosource:
        print("\n没有任何可打开来源页的题目:%d / %d" % (len(nosource), len(qs)))
        by_topic = {}
        for q in nosource:
            by_topic.setdefault(q.get("topic", "?"), []).append(q.get("id"))
        for t in sorted(by_topic):
            print("  %-14s %3d 题:%s" % (t, len(by_topic[t]),
                                         ", ".join(by_topic[t][:10]) +
                                         ("…" if len(by_topic[t]) > 10 else "")))

    print("题目总数:%d" % len(qs))
    print("硬问题 %d 条,提醒 %d 条" % (len(problems), len(warnings)))
    for lvl, qid, field, msg in problems[:40]:
        print("  [%s] %-10s %-18s %s" % (lvl, qid, field, msg))
    if len(problems) > 40:
        print("  …还有 %d 条" % (len(problems) - 40))
    thin = [w for w in warnings if w[0] == "薄"]
    if thin:
        print("内容偏薄(前 20):")
        for lvl, qid, field, msg in thin[:20]:
            print("  [%s] %-10s %-18s %s" % (lvl, qid, field, msg))
    stale = [w for w in warnings if w[0] == "旧"]
    print("核查日期过期:%d 条" % len(stale))

    if args.report:
        md = ["# 内容审计 %s" % today.isoformat(), "",
              "由 `tools/content_audit.py` 按固定阈值生成。阈值:%s" % json.dumps(MIN_LEN),
              "", "- 题目总数:%d" % len(qs),
              "- 硬问题:%d" % len(problems), "- 提醒:%d" % len(warnings), ""]
        md += ["## 硬问题", "", "| 级别 | 题号 | 字段 | 说明 |", "| --- | --- | --- | --- |"]
        for lvl, qid, field, msg in problems:
            md.append("| %s | %s | %s | %s |" % (lvl, qid, field, msg))
        md += ["", "## 提醒", "", "| 级别 | 题号 | 字段 | 说明 |", "| --- | --- | --- | --- |"]
        for lvl, qid, field, msg in warnings:
            md.append("| %s | %s | %s | %s |" % (lvl, qid, field, msg))
        out = ROOT / "docs" / ("内容审计-%s.md" % today.isoformat())
        out.write_text("\n".join(md) + "\n", encoding="utf-8")
        print("报告:%s" % out.relative_to(ROOT))

    if args.strict and problems:
        sys.exit(1)


if __name__ == "__main__":
    main()
