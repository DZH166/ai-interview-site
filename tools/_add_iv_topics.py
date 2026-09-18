# -*- coding: utf-8 -*-
import json, io

f = 'data/topics.json'
topics = json.load(io.open(f, encoding='utf-8'))
NEW = [
 {'id': 'iv-company', 'short': 'IVP', 'order': 18, 'name': '公司面经(题库)', 'desc': '牛客面经:邮储银行、华为等公司 AI 岗真实面试题,含参考答案。问答格式。'},
 {'id': 'iv-nowcoder-llm', 'short': 'IVL', 'order': 19, 'name': '面经·大模型(题库)', 'desc': '牛客面经八股:大模型基础与应用开放题,含参考答案。问答格式。'},
 {'id': 'iv-nowcoder-ml', 'short': 'IVM', 'order': 20, 'name': '面经·机器学习(题库)', 'desc': '牛客面经八股:机器学习基础与应用开放题,含参考答案。问答格式。'},
]
have = {t['id'] for t in topics}
added = 0
for t in NEW:
    if t['id'] not in have:
        topics.append(t)
        added += 1
with io.open(f, 'w', encoding='utf-8', newline='') as fh:
    fh.write(json.dumps(topics, ensure_ascii=False, indent=2) + '\n')
print('added:', added)

# 立即读回验证
topics2 = json.load(io.open(f, encoding='utf-8'))
iv_ids = [t['id'] for t in topics2 if t['id'].startswith('iv')]
print('immediately after write, iv topics:', iv_ids)
