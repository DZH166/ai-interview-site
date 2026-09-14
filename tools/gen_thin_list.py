# -*- coding: utf-8 -*-
"""生成剩余薄项工作清单(机器可读):python tools/gen_thin_list.py
   阈值与 content_audit.py 的 MIN_LEN/坑点数规则一致,只列清单不改阈值。"""
import io, sys, json, pathlib
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from content_audit import MIN_LEN, content_texts

ROOT = pathlib.Path(__file__).resolve().parent.parent
qs = []
for f in sorted((ROOT / 'data' / 'questions').glob('*.json')):
    for q in json.loads(f.read_text(encoding='utf-8')):
        q['_file'] = f.name
        qs.append(q)
out = {}
for q in qs:
    texts = content_texts(q)
    items = []
    for field, minimum in MIN_LEN.items():
        n = len(str(texts.get(field) or '').strip())
        if n and n < minimum:
            items.append({'field': field, 'len': n, 'min': minimum})
    pf = q.get('pitfalls') or []
    if len(pf) < 3:
        items.append({'field': 'pitfalls', 'len': len(pf), 'min': 3})
    if items:
        out[q['id']] = {'file': q.get('_file', ''), 'title': q.get('title', ''), 'items': items}
io.open(ROOT / 'delivery' / '内容修订工作清单.json', 'w', encoding='utf-8').write(
    json.dumps({'generated': '2026-09-14', 'note': 'MIN_LEN/坑点数阈值与 content_audit.py 一致;本清单供后续内容批次,不改阈值', 'count': len(out), 'questions': out},
               ensure_ascii=False, indent=1))
print('thin questions:', len(out))
