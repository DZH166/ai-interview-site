# -*- coding: utf-8 -*-
"""按 paths.json 的阶段顺序重排各专题文档的「基础必学练习组」。
路径中的题按阶段顺序排列;未入路径的基础题附在末尾(选学标注)。"""
import json, pathlib, re, io, sys
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parent.parent
paths = json.loads((ROOT / 'data' / 'paths.json').read_text(encoding='utf-8'))
path = paths['paths'][0]

# 题号 -> 顺序位置(路径内)
order_map = {}
for si, s in enumerate(path['stages']):
    for qi, qid in enumerate(s['questions']):
        order_map[qid] = (si, qi)
optional = set(path.get('optional', {}).get('questions', []))

allq = {}
for f in (ROOT / 'data' / 'questions').glob('*.json'):
    for q in json.loads(f.read_text(encoding='utf-8')):
        allq[q['id']] = q

main_doc_topic = {'doc-python-1': 'python-backend', 'doc-llm-1': 'llm-prompt', 'doc-rag-1': 'rag',
                  'doc-agent-1': 'agent', 'doc-eng-1': 'engineering', 'doc-fund-1': 'fundamentals'}

def sort_key(qid):
    if qid in order_map: return (0, order_map[qid][0], order_map[qid][1])
    if qid in optional: return (2, 0, 0)
    return (1, 0, 0)  # 未入路径的基础题排中间(按题号)

for doc_id, topic in main_doc_topic.items():
    fp = next((ROOT / 'data' / 'docs').glob('*.md'))
    for f in (ROOT / 'data' / 'docs').glob('*.md'):
        head = f.read_text(encoding='utf-8')[:200]
        m = re.search(r'^id:\s*(\S+)', head, re.M)
        if m and m.group(1) == doc_id:
            md = f.read_text(encoding='utf-8')
            basics = [q for q in allq.values() if q['topic'] == topic and q['difficulty'] == 'basic']
            basics.sort(key=lambda q: sort_key(q['id']))
            lines = [f"## 基础必学练习组({len(basics)} 题)", '',
                     '顺序即建议学习顺序(按[学习路径](#/path)的阶段编排,先概念后应用)。每题都有直接答案、大白话与理解检查;'
                     '第一次学习建议先自己想再看答案。标 🔧 的题在路径练习里可直接运行代码。', '']
            for i, q in enumerate(basics):
                mark = '🔧 ' if q['id'] in order_map else ''
                tag = '(选学)' if q['id'] in optional else ''
                lines.append(f"{i+1}. {mark}[{q['id']}](#/study/{q['id']}) {q['title']} {tag}".rstrip())
            section = '\n'.join(lines) + '\n'
            # 替换已有 section
            pat = re.compile(r"## 基础必学练习组\(\d+ 题\)[\s\S]*?(?=\n## |\Z)")
            new_md = pat.sub(section.strip() + '\n', md) if pat.search(md) else md.rstrip() + '\n\n' + section
            f.write_text(new_md, encoding='utf-8', newline='\n')
            print('reordered', f.name, f'({len(basics)} 题;路径内 {sum(1 for q in basics if q["id"] in order_map)})')
            break
print('doc reorder done')
