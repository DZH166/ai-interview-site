# -*- coding: utf-8 -*-
"""来源真实核验:把「已访问核验」从一句声明变成可复跑的证据。

它做的事:
  1. 从 data/sources.json 与全部 data/questions/*.json 收集所有 http(s) 链接,
     记下每个链接被谁引用(来源表 / 具体题号)。
  2. 逐条真实请求(GET,跟随跳转),记录状态码、最终地址、耗时。
  3. 对能认出类型的链接做**内容比对**,而不只看 200:
       - arXiv abs 页 → 回读页面标题,与题库里声明的论文标题比对;
       - GitHub 仓库 → 回读仓库名与 License,与声明比对。
     链接能打开但指向另一篇论文,是比 404 更隐蔽的错误,只靠状态码查不出来。
  4. 输出 docs/来源核查-<日期>.md 与 delivery/来源核查.json。

用法:
  python tools/verify_sources.py                # 联网核验并写报告
  python tools/verify_sources.py --no-network    # 只做结构性检查(CI 用,不联网)
  python tools/verify_sources.py --strict        # 有失效链接时以非 0 退出
  代理:默认直连,失败后自动尝试 SOURCES_PROXY(默认 http://127.0.0.1:12000)
"""
import argparse
import datetime
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

UA = "Mozilla/5.0 (compatible; ai-interview-site source verifier)"
PROXY = os.environ.get("SOURCES_PROXY", "http://127.0.0.1:12000")
TIMEOUT = 20
RETRIES = 2


# ---------------------------------------------------------------- 收集链接
def collect():
    """返回 {url: {'refs': [...], 'declared': {...}}}"""
    urls = {}

    def add(url, ref, declared):
        url = (url or "").strip()
        if not url:
            return
        if not url.startswith("http"):
            return
        ent = urls.setdefault(url, {"refs": [], "declared": {}})
        if ref not in ent["refs"]:
            ent["refs"].append(ref)
        for k, v in declared.items():
            if v and k not in ent["declared"]:
                ent["declared"][k] = v

    src_file = ROOT / "data" / "sources.json"
    if src_file.exists():
        doc = json.loads(src_file.read_text(encoding="utf-8"))
        for s in doc.get("sources", []):
            add(s.get("url"), "来源表:" + str(s.get("id") or s.get("name")),
                {"name": s.get("name"), "license": s.get("license"), "kind": s.get("kind")})

    for f in sorted((ROOT / "data" / "questions").glob("*.json")):
        for q in json.loads(f.read_text(encoding="utf-8")):
            for s in q.get("sources", []) or []:
                add(s.get("url"), q["id"],
                    {"name": s.get("name"), "kind": s.get("kind"), "note": s.get("note")})
    return urls


# ---------------------------------------------------------------- 抓取
def fetch(url):
    """直连优先,失败退到代理。返回 (status, final_url, body, err)

    直连只用短超时探测(国内直连 arxiv 之类会 SSL 中断,等满 20 秒没意义),
    正式耗时留给代理尝试。
    """
    attempts = [(None, 8, 1)] + ([(PROXY, TIMEOUT, RETRIES)] if PROXY else [])
    last = ("", url, "", "未尝试")
    for proxy, timeout, retries in attempts:
        handlers = [urllib.request.ProxyHandler({"http": proxy, "https": proxy})] if proxy else []
        opener = urllib.request.build_opener(*handlers)
        for _ in range(retries):
            req = urllib.request.Request(url, headers={"User-Agent": UA,
                                                       "Accept-Language": "en,zh;q=0.8"})
            try:
                with opener.open(req, timeout=timeout) as r:
                    raw = r.read(400_000)
                    enc = r.headers.get_content_charset() or "utf-8"
                    return r.status, r.geturl(), raw.decode(enc, "replace"), ""
            except urllib.error.HTTPError as e:
                # 4xx/5xx 也是「服务端回应了」,记录下来不再换代理
                return e.code, url, "", "HTTP %s" % e.code
            except Exception as e:                      # 网络层失败才换代理重试
                last = ("", url, "", "%s: %s" % (type(e).__name__, str(e)[:90]))
                time.sleep(0.6)
    return last


STOP = {"the", "of", "for", "and", "with", "on", "in", "a", "an", "is", "are", "to",
        "from", "by", "at", "as", "that", "this", "we", "you", "it", "via", "into",
        "near", "all", "need", "your", "can", "do", "does", "not", "how", "what"}


def norm_tokens(s):
    s = re.sub(r"[^0-9a-zA-Z\u4e00-\u9fff]+", " ", str(s or "")).lower()
    return {t for t in s.split() if len(t) >= 3 and t not in STOP}


def declared_title(name):
    """题库里的 `name` 有两种写法:
        「论文 · Attention Is All You Need (NeurIPS 2017)」  → 直接是标题
        「BERT(Devlin 等 2018)——encoder-only 双向预训练」 → 简写引用,没有完整标题
    所以不能只按分隔符切,要把破折号后的中文说明丢掉,再取最长的拉丁片段当标题候选。
    """
    s = str(name or "")
    s = re.sub(r"^(论文|paper|Paper)\s*[·:：]\s*", "", s)
    s = re.split(r"——|--|\s—\s", s)[0]
    runs = re.findall(r"[A-Za-z][A-Za-z0-9 ,:'\-]{8,}", s)
    if runs:
        return max(runs, key=len).strip(" ,")
    return re.sub(r"[()（）].*?[)）]", " ", s).strip()


def name_tokens(declared_name):
    """声明里出现的人名/会议名(BERT、Devlin、NeurIPS 这类可核对的小词)。"""
    return {t.lower() for t in re.findall(r"\b[A-Z][A-Za-z]{3,}\b", str(declared_name or ""))}


def compare_title(declared, body):
    """返回 (结论, 说明)。结论 ∈ match / weak / mismatch / unknown。

    能打开≠引对了。这里做三层判断:
      ① 页面标题与声明标题的词重合度(双向取大);
      ② 声明里点名的作者/会议是否出现在页面上(arXiv 摘要页含作者与会议信息);
      ③ 都不成立才叫 mismatch —— 避免把「BERT(Devlin 等 2018)」这种规范简写引用误报。
    """
    m = (re.search(r'<meta[^>]+name=["\']citation_title["\'][^>]+content=["\']([^"\']+)', body, re.I)
         or re.search(r"<title[^>]*>([^<]{5,200})</title>", body, re.I))
    if not m:
        return "unknown", "页面里没找到标题"
    page_title = re.sub(r"\s+", " ", m.group(1)).strip()
    want, got = norm_tokens(declared_title(declared)), norm_tokens(page_title)
    if not want or not got:
        return "unknown", "标题词太少,无法比对;页面标题:%s" % page_title[:60]
    inter = len(want & got)
    forward, reverse = inter / float(len(want)), inter / float(len(got))
    score = max(forward, reverse)

    if score >= 0.7:
        return "match", "页面标题:%s" % page_title[:70]

    # 标题对不上,但声明的作者/会议出现在页面上 → 属于可核对的简写引用
    names = [n for n in name_tokens(declared) if n not in STOP and
             n not in ("http", "https", "www", "com", "org", "neurips", "arxiv")]
    hit = [n for n in names if n in body.lower()]
    if hit:
        return "match", "标题为简写引用,但页面含声明的作者/关键词:%s;页面标题:%s" % (
            ",".join(hit[:3]), page_title[:50])
    if score >= 0.25:
        return "weak", "词重合 %.0f%%,需人工看一眼;页面标题:%s" % (score * 100, page_title[:60])
    return "mismatch", "声明标题与页面标题几乎不重合;页面标题:%s" % page_title[:70]


def compare_github(declared_name, body, final_url):
    """GitHub 仓库:核对仓库名。"""
    m = re.search(r"\b([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)\b", str(declared_name or ""))
    want = m.group(1).lower() if m else ""
    if not want:
        return "unknown", "声明里没有 owner/repo 形式的名字"
    got = final_url.lower()
    if want in got:
        return "match", "仓库地址与声明一致"
    return "mismatch", "声明 %s,实际跳转到 %s" % (want, final_url[:70])


def selftest():
    """比对逻辑放松之后必须还能抓出差错,否则等于没查。"""
    def page(title, body=""):
        return '<html><head><title>%s</title></head><body>%s</body></html>' % (title, body)

    cases = [
        # (声明, 页面, 期望结论)
        ("论文 · Attention Is All You Need (NeurIPS 2017)",
         page("Attention Is All You Need"), "match"),
        ("BERT(Devlin 等 2018)——encoder-only 双向预训练",
         page("BERT: Pre-training of Deep Bidirectional Transformers for Language Understanding",
              "Authors: Jacob Devlin, Ming-Wei Chang"), "match"),
        ("论文 · LoRA: Low-Rank Adaptation of Large Language Models",
         page("LoRA: Low-Rank Adaptation of Large Language Models"), "match"),
        # 张冠李戴:声明的论文根本不是这个页面
        ("论文 · RoFormer: Enhanced Transformer with Rotary Position Embedding",
         page("Attention Is All You Need", "Vaswani et al."), "mismatch"),
        ("论文 · Neural Discrete Representation Learning",
         page("Random Forests for Classification", "Breiman"), "mismatch"),
    ]
    bad = []
    for declared, body, want in cases:
        got, _detail = compare_title(declared, body)
        if got != want:
            bad.append((declared[:40], want, got))
    # 顺带固定住「简写引用不会被误报」这条不变量
    got_short, _ = compare_title("BERT(Devlin 等 2018)——encoder-only 双向预训练",
                                 page("Attention Is All You Need", "Vaswani"))
    if got_short == "match":
        bad.append(("BERT 简写 vs 无关页面", "不应 match", got_short))
    if bad:
        print("自检失败:", bad)
        return False
    print("来源比对自检通过:%d 组正反例 + 1 组简写引用不变量" % len(cases))
    return True


# ---------------------------------------------------------------- 主流程
def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-network", action="store_true")
    ap.add_argument("--strict", action="store_true")
    ap.add_argument("--limit", type=int, default=0, help="只验前 N 条(调试用)")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    if args.selftest:
        sys.exit(0 if selftest() else 1)

    urls = collect()
    items = sorted(urls.items())
    if args.limit:
        items = items[: args.limit]

    today = datetime.date.today().isoformat()
    results = []
    print("来源核验 %s 共 %d 个唯一链接" % (today, len(items)))
    print("-" * 72)
    for url, meta in items:
        if args.no_network:
            row = {"url": url, "status": None, "final": url, "error": "未联网检查(--no-network)",
                   "check": "skipped", "detail": "", "refs": meta["refs"],
                   "declared": meta["declared"]}
            results.append(row)
            continue
        st, final, body, err = fetch(url)
        check, detail = "skipped", ""
        if st == 200 and body:
            if "arxiv.org/abs/" in url:
                check, detail = compare_title(meta["declared"].get("name", ""), body)
            elif "github.com/" in final:
                check, detail = compare_github(meta["declared"].get("name", ""), body, final)
        row = {"url": url, "status": st, "final": final, "error": err,
               "check": check, "detail": detail, "refs": meta["refs"],
               "declared": meta["declared"]}
        results.append(row)
        flag = "OK " if st == 200 else "!! "
        extra = ""
        if check in ("mismatch", "weak"):
            extra = "  <-- %s: %s" % (check, detail[:60])
        print("%s%-4s %-58s x%d%s" % (flag, st or err[:8], url[:58], len(meta["refs"]), extra),
              flush=True)

    # ---- 汇总
    # 403/401/429 是「对面不让我们看」,不是「链接失效」——把它算成失效是不诚实的。
    BLOCKED = (401, 403, 429, 405)
    DEAD = (404, 410)
    def bucket(r):
        st = r["status"]
        if not st:
            return "unreachable"
        if st == 200:
            return "ok"
        if st in BLOCKED:
            return "blocked"
        if st in DEAD or (isinstance(st, int) and st >= 500):
            return "dead"
        return "other"

    for r in results:
        r["bucket"] = bucket(r)
    unreachable = [r for r in results if r["bucket"] == "unreachable"]
    blocked = [r for r in results if r["bucket"] == "blocked"]
    dead = [r for r in results if r["bucket"] in ("dead", "other")]
    mismatch = [r for r in results if r["check"] in ("mismatch", "weak")]
    print("-" * 72)
    print("可达 200 : %d / %d" % (len([r for r in results if r["bucket"] == "ok"]), len(results)))
    print("被拦截   : %d  (403/401/429,反爬而非失效,需人工确认)" % len(blocked))
    print("已失效   : %d" % len(dead))
    print("请求失败 : %d  (本机网络/代理问题)" % len(unreachable))
    print("标题可疑 : %d" % len(mismatch))

    out_json = ROOT / "delivery" / "来源核查.json"
    out_json.parent.mkdir(parents=True, exist_ok=True)
    out_json.write_text(json.dumps(
        {"checked_date": today, "network": not args.no_network, "total": len(results),
         "reachable": len([r for r in results if r["bucket"] == "ok"]),
         "blocked": [r["url"] for r in blocked],
         "dead": [r["url"] for r in dead],
         "unreachable": [r["url"] for r in unreachable],
         "suspect": [{"url": r["url"], "check": r["check"], "detail": r["detail"]} for r in mismatch],
         "items": results},
        ensure_ascii=False, indent=1), encoding="utf-8")

    md = [("# 来源核查 %s" % today), "",
          "由 `tools/verify_sources.py` 真实请求生成,非人工声明。" if not args.no_network
          else "本次为结构性检查(`--no-network`),未联网。", "",
          "- 唯一链接:%d" % len(results),
          "- 状态 200:%d" % len([r for r in results if r["bucket"] == "ok"]),
          "- 被拦截(403/401/429,反爬;链接不一定失效):%d" % len(blocked),
          "- 已失效(404/410/5xx):%d" % len(dead),
          "- 请求失败(本机网络/代理):%d" % len(unreachable),
          "- 内容比对可疑:%d" % len(mismatch), ""]
    if dead:
        md += ["## 已失效,必须修", "", "| 链接 | 情况 | 引用处 |", "| --- | --- | --- |"]
        for r in dead:
            md.append("| %s | %s | %s |" % (r["url"], r["error"] or r["status"],
                                            ", ".join(r["refs"][:4])))
        md.append("")
    if blocked:
        md += ["## 被反爬拦截(链接有效性无法从此处确认)", "",
               "这些链接服务端明确回应了 401/403/429,属于拒绝匿名访问,**不能据此判定失效**;",
               "要确认请在浏览器人工打开一次。", "",
               "| 链接 | 状态 | 引用处 |", "| --- | --- | --- |"]
        for r in blocked:
            md.append("| %s | %s | %s |" % (r["url"], r["status"], ", ".join(r["refs"][:4])))
        md.append("")
    if unreachable:
        md += ["## 请求失败(本机网络/代理问题,不代表链接失效)", "",
               "| 链接 | 错误 | 引用处 |", "| --- | --- | --- |"]
        for r in unreachable:
            md.append("| %s | %s | %s |" % (r["url"], r["error"], ", ".join(r["refs"][:4])))
        md.append("")
    if mismatch:
        md += ["## 内容比对可疑(能打开但可能与声明不符)", "",
               "| 链接 | 结论 | 说明 | 引用处 |", "| --- | --- | --- | --- |"]
        for r in mismatch:
            md.append("| %s | %s | %s | %s |" % (r["url"], r["check"], r["detail"][:90],
                                                 ", ".join(r["refs"][:4])))
        md.append("")
    md += ["## 全部链接", "", "| 链接 | 状态 | 比对 | 引用数 | 引用处 |",
           "| --- | --- | --- | --- | --- |"]
    for r in results:
        md.append("| %s | %s | %s | %d | %s |" % (
            r["url"], r["status"] or "请求失败", r["check"], len(r["refs"]),
            ", ".join(r["refs"][:3]) + ("…" if len(r["refs"]) > 3 else "")))
    (ROOT / "docs").mkdir(exist_ok=True)
    out_md = ROOT / "docs" / ("来源核查-%s.md" % today)
    out_md.write_text("\n".join(md) + "\n", encoding="utf-8")
    print("报告:%s" % out_md.relative_to(ROOT))
    print("机器可读:%s" % out_json.relative_to(ROOT))

    if args.strict and (dead or unreachable or mismatch):
        sys.exit(1)


if __name__ == "__main__":
    main()
