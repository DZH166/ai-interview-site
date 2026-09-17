# -*- coding: utf-8 -*-
"""牛客选择题 → 工作台题库转换器(阶段1)。

输出格式(新 format='quiz' 选择题分支,独立于既有 10 要素叙述题):
  id:        QZ-<专题前缀>-NNNN(4位,便于 3000+ 题)
  topic:     映射后的专题 id
  format:    'quiz'
  qtype:     single | multi
  type:      'quiz'(沿用 type 字段,render/validate 按 format 分支)
  difficulty: 全部 basic(牛客无难度字段,如实不猜)
  title:     题干纯文本(HTML 清洗)
  prompt:    题干(清洗后的 markdown,含 LaTeX)
  options:   [{label:'A', text:..., right:true/false}]
  answer:    正确选项拼接(A/B/C…)
  plain:     官方解析(清洗后)
  knowledgeTags → tags
  sources:   牛客(标注来源与抓取日期)
  verify:    partial + checked_date

清洗规则:
  - &nbsp;/&amp;/&lt;/&gt;/&quot; 实体还原;<br> → 换行;其余 HTML 标签剥离(内容里有
    div/span/p 等牛客编辑器残留,markdown 渲染器会转义展示,必须清掉);
  - nowcoder 公式图片 <img src=".../equation?tex=URL编码的LaTeX"> → 还原为 $LaTeX$;
  - 连续空行压缩;前后空白修剪。

去重:questionId 全局唯一;跨分类重复(21 条)按首个出现分类保留,其余跳过。
"""
import glob
import hashlib
import html
import io
import json
import re
import urllib.parse
from pathlib import Path

SRC = Path(r'E:/ZcodeProject/Projects/nowcoder-questions')
OUT = Path(r'E:/简历/项目迭代/ai-interview-site/data/questions')
CHECK_DATE = '2026-09-16'

# 分类 → 专题映射(新专题 quiz-*;Agent/RAG/提示词 并入已有专题)
TOPIC_MAP = {
    'Agent.json': 'agent',
    'RAG.json': 'rag',
    '提示词工程.json': 'llm-prompt',
    '大模型概念.json': 'quiz-llm',
    '大模型开发.json': 'quiz-llm-dev',
    '微调.json': 'quiz-finetune',
    '推理优化.json': 'quiz-inference',
    '机器学习基础.json': 'quiz-ml',
    '深度学习基础.json': 'quiz-dl',
    '数据挖掘.json': 'quiz-ml',
    '概率论与数理统计.json': 'quiz-math',
    '线性代数.json': 'quiz-math',
    '计算机视觉.json': 'quiz-cv',
}
PREFIX = {
    'agent': 'AGQ', 'rag': 'RGQ', 'llm-prompt': 'LPQ',
    'quiz-llm': 'LBQ', 'quiz-llm-dev': 'LDQ', 'quiz-finetune': 'FTQ',
    'quiz-inference': 'INQ', 'quiz-ml': 'MLQ', 'quiz-dl': 'DLQ',
    'quiz-math': 'MAQ', 'quiz-cv': 'CVQ',
}

def clean_text(s):
    """牛客 HTML → 干净 markdown 文本。"""
    if not s:
        return ''
    s = String(s) if False else str(s)

    def unescape_entity(m):
        return html.unescape(m.group(0))

    # 1) 公式图片 → $latex$(URL 解码)
    def equation(m):
        src = m.group(1)
        tex = urllib.parse.unquote(src.split('tex=', 1)[-1])
        tex = tex.replace('<br />', ' ').replace('<br>', ' ').replace('\n', ' ')
        tex = html.unescape(re.sub(r'<[^>]+>', '', tex))  # tex 内残留标签剥掉
        tex = re.sub(r'\s+', ' ', tex).strip()
        return ' $' + tex + '$ '
    s = re.sub(r'<img[^>]+src="([^"]*/equation\?tex=[^"]+)"[^>]*>', equation, s)
    # 剩余非公式图片:剥掉(牛客图床外链离线不可用,如实丢弃,题干仍可读)
    s = re.sub(r'<img[^>]*>', '[图](原题含图,离线不可显示)', s)
    # 2) 换行与块级标签
    s = re.sub(r'<br\s*/?>', '\n', s, flags=re.I)
    s = re.sub(r'</(p|div|li|h\d|tr)>', '\n', s, flags=re.I)
    s = re.sub(r'<(li)>', '- ', s, flags=re.I)
    # 3) 实体
    s = html.unescape(s)
    # 4) 剥掉全部剩余标签
    s = re.sub(r'<[^>]+>', '', s)
    # 5) 空白规整:行内空白压缩,保留换行;连续空行压成一
    s = re.sub(r'[ \t\u00a0]+', ' ', s)
    s = re.sub(r' ?\n ?', '\n', s)
    s = re.sub(r'\n{3,}', '\n\n', s)
    return s.strip()

def label_of(i):
    return chr(ord('A') + i)

def convert_question(q, topic, prefix, seq):
    stem = clean_text(q.get('content'))
    analysis = clean_text(q.get('analysis'))
    answers = q.get('answers') or []
    options = []
    right_labels = []
    for i, a in enumerate(answers):
        lab = label_of(i)
        options.append({'label': lab, 'text': clean_text(a.get('content')), 'right': bool(a.get('right'))})
        if a.get('right'):
            right_labels.append(lab)
    if not stem or not options or not right_labels:
        return None
    if not analysis:
        analysis = '牛客题库未提供本題解析;正确项如上标注。'
    tags = [t for t in (q.get('knowledgeTags') or []) if t]
    tags.append('牛客题库')
    qtype = 'multi' if q.get('type') == 2 else 'single'
    qid = f'{prefix}-{seq:04d}'
    return {
        'id': qid,
        'topic': topic,
        'format': 'quiz',
        'type': 'quiz',
        'qtype': qtype,
        'difficulty': 'basic',
        'title': re.sub(r'\s+', ' ', stem).strip()[:80],
        'prompt': stem,
        'options': options,
        'answer': '、'.join(right_labels) + '\n\n' + analysis,
        'plain': analysis,
        'tags': tags,
        'sources': [{
            'name': '牛客人工智能题库(官方解析随题)',
            'kind': 'web',
            'note': '牛客网公开题库,含官方解析;抓取于 ' + CHECK_DATE,
        }],
        'verify': {'status': 'partial', 'checked_date': CHECK_DATE,
                   'note': '选择题:题干/选项/官方解析来自牛客公开题库,逐字保留;格式为选择题分支,不做十要素叙述改写。'},
        'metadata': {'nowcoder_id': q['questionId'], 'src_file': q.get('_src', '')},
    }

def main():
    # 全局 questionId 去重(21 条跨分类重复:保留首次出现)
    seen = {}
    ordered_files = sorted(glob.glob(str(SRC / '*.json')))
    per_topic_counter = {}
    out_all = []
    skipped_dup = skipped_bad = 0
    for fp in ordered_files:
        name = Path(fp).name
        if name == '_idx.json' or name not in TOPIC_MAP:
            continue
        topic = TOPIC_MAP[name]
        prefix = PREFIX[topic]
        for q in json.loads(io.open(fp, encoding='utf-8').read()):
            qid = q.get('questionId')
            if qid in seen:
                skipped_dup += 1
                continue
            seen[qid] = name
            per_topic_counter[topic] = per_topic_counter.get(topic, 0) + 1
            conv = convert_question(q, topic, prefix, per_topic_counter[topic])
            if conv is None:
                skipped_bad += 1
                per_topic_counter[topic] -= 1
                continue
            out_all.append(conv)
    # 按专题分文件
    by_topic = {}
    for q in out_all:
        by_topic.setdefault(q['topic'], []).append(q)
    for topic, qs in sorted(by_topic.items()):
        fp = OUT / f'nk-{topic}.json'
        io.open(fp, 'w', encoding='utf-8', newline='').write(json.dumps(qs, ensure_ascii=False, indent=1) + '\n')
        print(f'{fp.name}: {len(qs)} 题')
    print(f'合计 {len(out_all)} 题 | 跳过跨分类重复 {skipped_dup} | 跳过缺字段 {skipped_bad}')

if __name__ == '__main__':
    main()
