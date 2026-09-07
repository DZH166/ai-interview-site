# -*- coding: utf-8 -*-
"""打包:把 data/ 下的题库、文档、来源打包成 app/data.js(window.APP_DATA),
并输出交付统计。数据与界面分离:编辑请改 data/ 下源文件,再运行本脚本。"""
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
    topics = load_json(ROOT / "data" / "topics.json")
    sources = load_json(ROOT / "data" / "sources.json")
    candidates = load_json(ROOT / "data" / "candidates.json")
    paths = load_json(ROOT / "data" / "paths.json")
    questions = []
    for f in sorted((ROOT / "data" / "questions").glob("*.json")):
        questions.extend(load_json(f))
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
    data = {
        "generated_at": "2026-09-07",
        "topics": topics,
        "questions": questions,
        "docs": docs,
        "sources": sources,
        "candidates": candidates,
        "paths": paths,
    }
    js = ("/* 由 tools/build.py 自动生成,请勿手改;编辑 data/ 后重新构建。 */\n"
          "window.APP_DATA = " + json.dumps(data, ensure_ascii=False, indent=None,
                                            separators=(",", ":")) + ";\n")
    out = ROOT / "app" / "data.js"
    out.write_text(js, encoding="utf-8", newline="\n")
    # Service Worker 缓存版本:对整个 app shell(数据+JS+CSS+图标)内容哈希盖章。
    # 任何被 SW 预缓存的文件变化都会生成新缓存名,用户下次访问即拿到新版,
    # 杜绝「改了 JS 但 SW 一直发旧缓存」。统一 LF 写入保证跨平台一致。
    import hashlib
    # 注意:不含 sw.js 自身(自引用会导致两次构建互相追尾、产物不可复现)
    shell_files = ["app/data.js", "app/index.html", "app/manifest.webmanifest",
                   "app/css/style.css",
                   "app/js/util.js", "app/js/store.js", "app/js/markdown.js",
                   "app/js/search.js", "app/js/common.js", "app/js/views-practice.js",
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
    # 统计
    by_topic, by_diff, by_status = {}, {}, {}
    for q in questions:
        by_topic[q["topic"]] = by_topic.get(q["topic"], 0) + 1
        by_diff[q["difficulty"]] = by_diff.get(q["difficulty"], 0) + 1
        st = q.get("verify", {}).get("status", "unknown")
        by_status[st] = by_status.get(st, 0) + 1
    stats = {
        "built_at": "2026-09-06",
        "questions_total": len(questions),
        "by_topic": by_topic, "by_difficulty": by_diff,
        "by_verify_status": by_status,
        "docs_total": len(docs),
        "sources_total": len(sources["sources"]),
        "candidates_total": len(candidates["candidates"]),
        "data_js_kb": round(out.stat().st_size / 1024, 1),
    }
    (ROOT / "delivery" / "stats.json").write_text(
        json.dumps(stats, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(stats, ensure_ascii=False, indent=2))

if __name__ == "__main__":
    main()
