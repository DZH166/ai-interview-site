# -*- coding: utf-8 -*-
"""打包:把 data/ 下的题库、文档、来源打包成 app/data.js(window.APP_DATA)与
app/data/topics/ 分片,并输出交付统计。数据与界面分离:编辑请改 data/ 下源文件,
再运行本脚本。

拆分结构(Track E,改善首开时间):
  - app/data.js          薄壳:除 questions 全量字段外的一切 + questions_index
                         (id/topic/title/difficulty/type/format/tags),同步加载,
                         首屏列表/计数/简历页立即可用;
  - app/data/manifest.json  {hash, topics: {tid: {file, count}}},SW 预缓存,网络优先;
  - app/data/topics/<tid>.<hash>.json  该专题全量题目,文件名带内容哈希 → 不可变,
                         SW 缓存优先,运行时按需拉取(不进预缓存)。"""
import json, re, sys, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

def load_json(p):
    return json.loads(p.read_text(encoding="utf-8"))

def md_sections(md_text):
    """把 markdown 拆成 {level, text, id} 的标题列表,供目录与锚点用。
    与 app/js/markdown.js 保持一致:先剥离 ``` 代码块,再按顺序编号。"""
    text = re.sub(r"^```.*?^```", "", md_text, flags=re.M | re.S)
    secs, counter = [], [0]
    for line in text.splitlines():
        m = re.match(r"^(#{1,6})\s+(.*)$", line)
        if m:
            counter[0] += 1
            secs.append({"level": len(m.group(1)), "text": m.group(2).strip(),
                         "id": f"sec-{counter[0]}"})
    return secs

def main():
    # fail-fast 本地校验:与 CI(validate.yml 跑 validate_bank.py)同一套规则,
    # 在打包前先跑一遍——坏数据不该等 CI 红了才发现,更不该被打进产物。
    # validate() 只返回问题清单不落盘;有错就退出,列出前 10 条。
    sys.path.insert(0, str(ROOT / "tools"))
    import validate_bank as _vb
    errors, _warns, _qs = _vb.validate()
    if errors:
        lines = ["题库校验未通过,已取消构建。前 %d 条错误:" % min(len(errors), 10)]
        lines += ["  - " + e for e in errors[:10]]
        if len(errors) > 10:
            lines.append(f"  …共 {len(errors)} 条错误,完整清单请运行 python tools/validate_bank.py")
        raise SystemExit("\n".join(lines))

    topics = load_json(ROOT / "data" / "topics.json")
    sources = load_json(ROOT / "data" / "sources.json")
    candidates = load_json(ROOT / "data" / "candidates.json")
    paths = load_json(ROOT / "data" / "paths.json")
    concepts = load_json(ROOT / "data" / "concepts.json")
    projects = load_json(ROOT / "data" / "projects.json")
    questions = []
    for f in sorted((ROOT / "data" / "questions").glob("*.json")):
        questions.extend(load_json(f))
    # 重点标注:按题号合并各专题文件,重复即报错(否则谁覆盖谁看不出来)
    highlights = {}
    hdir = ROOT / "data" / "highlights"
    if hdir.exists():
        for f in sorted(hdir.glob("*.json")):
            rec = load_json(f)
            for qid, item in (rec.get("questions") or {}).items():
                if qid in highlights:
                    raise SystemExit(f"重复的重点标注: {qid}(见 {f.name})")
                highlights[qid] = item
    docs = []
    for f in sorted((ROOT / "data" / "docs").glob("*.md")):
        text = f.read_text(encoding="utf-8")
        m = re.match(r"^---\s*\n(.*?)\n---\s*\n", text, re.S)
        meta, body = {}, text
        if m:
            for line in m.group(1).splitlines():
                if ":" in line:
                    k, _, v = line.partition(":")
                    meta[k.strip()] = v.strip()
            body = text[m.end():]
        docs.append({
            "id": meta.get("id", f.stem), "topic": meta.get("topic", ""),
            "title": meta.get("title", f.stem), "order": int(meta.get("order", "99")),
            "summary": meta.get("summary", ""), "md": body,
            "sections": md_sections(body),
        })
    docs.sort(key=lambda d: (d["order"], d["id"]))
    import hashlib as _hashlib
    content_hash = _hashlib.md5(json.dumps(
        {"questions": questions, "docs": docs}, ensure_ascii=False, sort_keys=True
    ).encode("utf-8")).hexdigest()[:12]
    data = {
        "content_hash": content_hash,   # 数据内容哈希:可复现,替代曾硬编码的假日期
        "topics": topics,
        # 全量 questions 不再进壳:3900 题占 11MB,同步加载拖死首开(Track E)。
        # 壳里只有 questions_index(id/topic/title/difficulty/type/format/tags),
        # 够浏览列表/计数/复习队列/统计热力表用;题干答案等全量字段走分片异步合并。
        "questions_index": [
            {k: q[k] for k in ("id", "topic", "title", "difficulty", "type", "format", "tags")
             if k in q}
            for q in questions
        ],        "docs": docs,
        "sources": sources,
        "candidates": candidates,
        "paths": paths,
        "concepts": concepts,
        "projects": projects,
        "highlights": highlights,
        "resume": load_json(ROOT / "data" / "resume-profile.json") if (ROOT / "data" / "resume-profile.json").exists() else {},
    }
    js = ("/* 由 tools/build.py 自动生成,请勿手改;编辑 data/ 后重新构建。\n"
          "   questions 全量字段在 app/data/topics/ 分片(按专题 + 内容哈希命名),\n"
          "   由 Data.init 异步合并进来;壳里只有 questions_index 供首屏列表。 */\n"
          "window.APP_DATA = " + json.dumps(data, ensure_ascii=False, indent=None,
                                            separators=(",", ":")) + ";\n")
    out = ROOT / "app" / "data.js"
    out.write_text(js, encoding="utf-8", newline="\n")

    # ---- 题库分片:每专题一个 JSON,文件名带内容哈希(不可变缓存的基础) ----
    # 先清空再重生成:专题增删/更名后,上一轮的旧文件不能留着误导 SW 运行时缓存
    # 与 Data 的 manifest 枚举 —— 陈旧分片 = 陈旧题目,清理是正确性要求不是整洁要求。
    topics_dir = ROOT / "app" / "data" / "topics"
    if topics_dir.exists():
        import shutil
        shutil.rmtree(topics_dir)
    topics_dir.mkdir(parents=True)
    by_topic_qs = {}
    for q in questions:
        by_topic_qs.setdefault(q["topic"], []).append(q)
    # 专题分组也参与哈希:同组题目以追加(非重排)方式稳定排序 —— build 的 questions
    # 本身来自 sorted(glob) 顺序拼接,天然确定,不需要额外排序(排序反而掩盖源顺序)。
    topic_manifest = {}
    for tid in sorted(by_topic_qs):
        qs = by_topic_qs[tid]
        # 文件内容哈希:与 content_hash 同源但独立 —— 只改某专题时,其余分片文件名
        # 不变,SW 运行时缓存的旧分片依然命中(不可变资产按内容寻址)。
        th = _hashlib.md5(json.dumps(
            {"topic": tid, "questions": qs}, ensure_ascii=False, sort_keys=True
        ).encode("utf-8")).hexdigest()[:12]
        fname = f"{tid}.{th}.json"
        payload = {"topic": tid, "hash": content_hash, "questions": qs}
        (topics_dir / fname).write_text(
            json.dumps(payload, ensure_ascii=False, indent=None, separators=(",", ":")),
            encoding="utf-8", newline="\n")
        topic_manifest[tid] = {"file": fname, "count": len(qs)}
    data_manifest = {"hash": content_hash, "topics": topic_manifest}
    (ROOT / "app" / "data" / "manifest.json").write_text(
        json.dumps(data_manifest, ensure_ascii=False, indent=None, separators=(",", ":")),
        encoding="utf-8", newline="\n")
    # Service Worker 缓存版本:对整个 app shell(数据+JS+CSS+图标)内容哈希盖章。
    # 任何被 SW 预缓存的文件变化都会生成新缓存名,用户下次访问即拿到新版,
    # 杜绝「改了 JS 但 SW 一直发旧缓存」。统一 LF 写入保证跨平台一致。
    import hashlib
    # 注意:不含 sw.js 自身(自引用会导致两次构建互相追尾、产物不可复现)
    shell_files = ["app/data.js", "app/index.html", "app/manifest.webmanifest",
                   "app/css/style.css",
                   "app/js/util.js", "app/js/srs.js", "app/js/store.js",
                   "app/js/markdown.js", "app/js/highlight.js",
                   "app/js/search.js", "app/js/common.js", "app/js/express.js",
                   "app/js/views-practice.js", "app/js/views-resume.js", "app/js/views-stats.js",
                   "app/js/views-knowledge.js", "app/js/views-review.js", "app/js/app.js"]
    h = hashlib.md5()
    for rel in shell_files:
        p = ROOT / rel
        if p.exists():
            # 归一化 CRLF→LF 后再哈希:工作树换行符差异(Windows autocrlf)
            # 不影响盖章,保证与 Linux CI 的构建产物逐字节一致
            h.update(rel.replace('/', '_').encode("utf-8"))
            h.update(p.read_bytes().replace(b"\r\n", b"\n"))
    stamp = h.hexdigest()[:12]
    sw = ROOT / "app" / "sw.js"
    sw.write_text(
        re.sub(r"const CACHE_VERSION = '[^']*';",
               f"const CACHE_VERSION = 'shell-{stamp}';",
               sw.read_text(encoding="utf-8")),
        encoding="utf-8", newline="\n")
    # manifest 描述里的题数与真实题库对齐(过去硬编码「349 题」,题库涨到 3900 也没人改)。
    # 顺序很关键:必须在算 stamp 之前改 manifest —— manifest 在 shell_files 哈希清单里,
    # 先章后改会导致「写 manifest → 戳与磁盘不符」,下次构建又追尾一次。
    manifest_path = ROOT / "app" / "manifest.webmanifest"
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    desc = manifest.get("description", "")
    new_desc = re.sub(r"\d+ 题", f"{len(questions)} 题", desc)
    if new_desc != desc:
        manifest["description"] = new_desc
        print(f"manifest 描述题数已更新: {desc.split(':')[0]} -> {len(questions)} 题")
    manifest_path.write_text(
        json.dumps(manifest, ensure_ascii=False, indent=2) + "\n",
        encoding="utf-8", newline="\n")
    # 统计
    by_topic, by_diff, by_status = {}, {}, {}
    for q in questions:
        by_topic[q["topic"]] = by_topic.get(q["topic"], 0) + 1
        by_diff[q["difficulty"]] = by_diff.get(q["difficulty"], 0) + 1
        st = q.get("verify", {}).get("status", "unknown")
        by_status[st] = by_status.get(st, 0) + 1
    stats = {
        "content_hash": content_hash,
        "questions_total": len(questions),
        "by_topic": by_topic, "by_difficulty": by_diff,
        "by_verify_status": by_status,
        "docs_total": len(docs),
        "sources_total": len(sources["sources"]),
        "candidates_total": len(candidates["candidates"]),
        "data_js_kb": round(out.stat().st_size / 1024, 1),
        # 拆分产物统计(Track E):壳 + 最大分片,监控首开加载量
        "topic_files": len(topic_manifest),
        "topics_total_kb": round(sum((topics_dir / m["file"]).stat().st_size for m in topic_manifest.values()) / 1024, 1),
        "largest_topic_kb": round(max((topics_dir / m["file"]).stat().st_size for m in topic_manifest.values()) / 1024, 1),
    }
    (ROOT / "delivery" / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))
    # 分片明细:每专题一行(专题 / 题数 / KB),肉眼核对拆分是否均衡
    for tid in sorted(topic_manifest):
        m = topic_manifest[tid]
        kb = (topics_dir / m["file"]).stat().st_size / 1024
        print(f"  topics/{m['file']}  {m['count']:>5} 题  {kb:8.1f} KB")

if __name__ == "__main__":
    main()
