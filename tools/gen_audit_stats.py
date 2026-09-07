# -*- coding: utf-8 -*-
"""核查统计生成器:从实际数据 + git 版本对比生成,不手写数字。
输出 delivery/核查统计.json 与控制台摘要。"""
import json, pathlib, subprocess, sys, io
sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')
ROOT = pathlib.Path(__file__).resolve().parent.parent
OLD = '0498044cfce2d56d444cdfe1f043662dd701a898'
QDIR = ROOT / 'data' / 'questions'

def load_current():
    out = {}
    for f in sorted(QDIR.glob('*.json')):
        for q in json.loads(f.read_text(encoding='utf-8')):
            out[q['id']] = q
    return out

def load_old():
    """从 git 对象读取 0498044 版本的题库"""
    out = {}
    files = subprocess.run(['git', 'ls-tree', '-r', '--name-only', OLD, 'data/questions'],
                           capture_output=True, text=True, cwd=ROOT).stdout.split()
    for fp in files:
        blob = subprocess.run(['git', 'show', f'{OLD}:{fp}'], capture_output=True, text=True, cwd=ROOT).stdout
        for q in json.loads(blob):
            out[q['id']] = q
    return out

def has_url(q):
    return any((s.get('url') or '').startswith('http') for s in (q.get('sources') or []))

cur, old = load_current(), load_old()
by_status = {'verified': 0, 'partial': 0, 'todo': 0}
verified_with_url = 0
partial_no_url = 0
partial_with_url = 0
basic_total = basic_no_url = 0
for q in cur.values():
    st = q.get('verify', {}).get('status', 'todo')
    by_status[st] = by_status.get(st, 0) + 1
    if st == 'verified' and has_url(q): verified_with_url += 1
    if st == 'partial':
        if has_url(q): partial_with_url += 1
        else: partial_no_url += 1
    if q.get('difficulty') == 'basic':
        basic_total += 1
        if not has_url(q): basic_no_url += 1

# 版本对比:核查状态迁移明细
up, down, detail_up, detail_down = [], [], [], []
for qid in sorted(set(cur) & set(old)):
    so = old[qid].get('verify', {}).get('status')
    sn = cur[qid].get('verify', {}).get('status')
    if so != sn:
        if sn == 'verified' and so in ('partial', 'todo'):
            up.append(qid); detail_up.append({'id': qid, 'from': so, 'to': sn})
        elif so == 'verified' and sn in ('partial', 'todo'):
            down.append(qid); detail_down.append({'id': qid, 'from': so, 'to': sn})
        else:
            down.append(qid); detail_down.append({'id': qid, 'from': so, 'to': sn})

stats = {
    'generated_at': str(__import__('datetime').date.today()),
    'baseline_commit': OLD,
    'total': len(cur),
    'structure_complete': len(cur),
    'verified_total': by_status['verified'],
    'verified_with_url_content_checked': verified_with_url,
    'partial_total': by_status['partial'],
    'partial_with_url_version_related_or_part': partial_with_url,
    'partial_no_source_yet': partial_no_url,
    'todo': by_status['todo'],
    'basic_total': basic_total,
    'basic_without_url': basic_no_url,
    'compare_vs_baseline': {
        'to_verified': len(up), 'list_up': detail_up,
        'away_from_verified': len(down), 'list_down_count': len(detail_down),
    },
}
(ROOT / 'delivery' / '核查统计.json').write_text(json.dumps(stats, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
print(json.dumps(stats, ensure_ascii=False, indent=1)[:1200])
print('...')
print('升级 verified 明细:', [d['id'] for d in detail_up])
print('降级明细数量:', len(detail_down), '(前10:', [d['id'] for d in detail_down[:10]], ')')
