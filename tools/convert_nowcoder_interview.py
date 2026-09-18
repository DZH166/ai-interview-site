# -*- coding: utf-8 -*-
"""牛客面经/公司面试题 → 工作台转换器(阶段: 面经题库融合)。

来源: C:/ZcodeProject/Projects/nowcoder-questions/interview/*.json (6 份试卷, 154 题开放题)。

输出格式(新 format='qa' 问答题分支):
  id:       IVP-NNNN(公司卷) / IVN-NNNN(牛客面经)
  topic:    iv-company / iv-nowcoder-llm / iv-nowcoder-ml
  format:   'qa'
  type:     'qa'
  difficulty: basic(牛客无难度字段,如实不猜)
  title:    题干纯文本
  prompt:   题干(清洗后 markdown)
  answer:   参考答案(清洗后,官方/牛客参考答案逐字保留)
  sources:  来源标注
  verify:   partial + checked_date

清洗: 与 convert_nowcoder.py 相同(HTML 剥离/实体还原/无公式图片需处理)。
去重: id + 题干指纹。
"""
import glob
import html
import io
import json
import re
from pathlib import Path

# workspace 的 default 目录是指向 E:/ZcodeProject/Projects 的链接;
# 两个路径都可能有效,按存在性选择
_CANDIDATES = [
    Path(r'C:/Users/Lenovo/.zcode/workspace/default/nowcoder-questions/interview'),
    Path(r'E:/ZcodeProject/Projects/nowcoder-questions/interview'),
]
SRC = next((p for p in _CANDIDATES if p.exists()), _CANDIDATES[0])
OUT = Path(__file__).resolve().parent.parent / 'data' / 'questions'
CHECK_DATE = '2026-09-19'

PAPER_TOPIC = {
    '邮储银行2024AI岗面试题': 'iv-company',
    '2025年-华为-AI软件岗高频面试题': 'iv-company',
    '大模型基础-牛客面经八股': 'iv-nowcoder-llm',
    '大模型应用-牛客面经八股': 'iv-nowcoder-llm',
    '机器学习-牛客面经八股': 'iv-nowcoder-ml',
    '机器学习应用-牛客面经八股': 'iv-nowcoder-ml',
}
PREFIX = {'iv-company': 'IVP', 'iv-nowcoder-llm': 'IVL', 'iv-nowcoder-ml': 'IVM'}


def clean_text(s):
    if not s:
        return ''
    s = str(s)
    s = re.sub(r'<img[^>]*>', '[图](原题含图,离线不可显示)', s)
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</(p|div|li|h\d|tr)>', '\n', s, flags=re.I)
    s = re.sub(r'<li>', '- ', s, flags=re.I)
    s = html.unescape(s)
    s = re.sub(r'<[^>]+>', '', s)
    s = s.replace('\ufffd', '')   # 牛客源数据中的编码损失残留
    s = re.sub(r'[ \t\u00a0]+', ' ', s)
    s = re.sub(r' ?\n ?', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()


def main():
    seen_ids = set()
    seen_stems = {}
    counters = {}
    out_by_topic = {}
    skipped_dup = skipped_bad = 0
    for fp in sorted(SRC.rglob('*.json')):
        paper = json.loads(fp.read_text(encoding='utf-8'))
        if 'questions' not in paper:
            continue   # 跳过非试卷文件
        paper_name = paper.get('paperName') or fp.stem
        topic = PAPER_TOPIC.get(paper_name)
        if not topic:
            print('未知试卷,跳过:', paper_name)
            continue
        prefix = PREFIX[topic]
        for q in paper.get('questions', []):
            qid = q.get('id')
            stem = clean_text(q.get('content'))
            ref = clean_text(q.get('referenceAnswer'))
            if not stem or not ref:
                skipped_bad += 1
                continue
            if qid in seen_ids:
                skipped_dup += 1
                continue
            fingerprint = re.sub(r'\s+', '', stem)[:80]
            if fingerprint in seen_stems:
                skipped_dup += 1
                continue
            seen_ids.add(qid)
            seen_stems[fingerprint] = True
            counters[topic] = counters.get(topic, 0) + 1
            qid_str = f'{prefix}-{counters[topic]:04d}'
            out_by_topic.setdefault(topic, []).append({
                'id': qid_str,
                'topic': topic,
                'format': 'qa',
                'type': 'qa',
                'difficulty': 'basic',
                'title': re.sub(r'\s+', ' ', stem)[:80],
                'prompt': stem,
                'answer': ref,
                'tags': ['面经题库', paper_name],
                'sources': [{
                    'name': f'牛客面经 · {paper_name}',
                    'kind': 'web',
                    'note': '牛客网公开面经试卷,参考答案逐字保留;抓取于 ' + CHECK_DATE,
                }],
                'verify': {'status': 'partial', 'checked_date': CHECK_DATE,
                           'note': '问答题:题干与参考答案来自牛客公开面经,逐字保留;开放题格式,不做十要素叙述改写。'},
                'metadata': {'nowcoder_id': qid, 'paper': paper_name},
            })
    for topic, qs in sorted(out_by_topic.items()):
        fp = OUT / f'nk-{topic}.json'
        io.open(fp, 'w', encoding='utf-8', newline='').write(json.dumps(qs, ensure_ascii=False, indent=1) + '\n')
        print(f'{fp.name}: {len(qs)} 题')
    print(f'合计 {sum(len(v) for v in out_by_topic.values())} 题 | 跳过重复 {skipped_dup} | 跳过缺字段 {skipped_bad}')


if __name__ == '__main__':
    main()
