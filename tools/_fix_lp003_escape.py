# -*- coding: utf-8 -*-
"""修复 LP-003 example 里 f-string 的换行转义(\n 应为字面反斜杠+n)"""
import json, pathlib
p = pathlib.Path('data/questions/llm-prompt.json')
arr = json.loads(p.read_text(encoding='utf-8'))
for q in arr:
    if q['id'] == 'LP-003':
        ex = q['example']
        bad = 'f"' + '\n上次错误:'          # 被错误展开成真实换行
        good = 'f"\\n上次错误:'             # 代码里的字面 \n
        assert bad in ex, 'pattern not found'
        q['example'] = ex.replace(bad, good)
        print('fixed f-string escape')
p.write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
