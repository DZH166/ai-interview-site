# -*- coding: utf-8 -*-
import io, json
from pathlib import Path
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent))
# 打印 SRC 解析结果(不 import 全模块,只读源码取路径)
import re
src = Path(__file__).resolve().parent.joinpath('convert_nowcoder_interview.py').read_text(encoding='utf-8')
m = re.search(r"_CANDIDATES = \[[\s\S]*?\]", src)
print('candidates block found:', bool(m))
# 直接手动执行转换核心:逐 paper 检查 clean_text 后的 stem/ref
import html
def clean_text(s):
    if not s:
        return ''
    s = str(s)
    s = s.replace('\r\n', '\n')
    s = s.replace('<br />', '\n').replace('<br>', '\n')
    s = html.unescape(s)
    s = re.sub(r'<[^>]+>', '', s)
    return s.strip()
import re
CAND = Path(r'C:/Users/Lenovo/.zcode/workspace/default/nowcoder-questions/interview')
for fp in sorted(CAND.rglob('*.json')):
    paper = json.loads(fp.read_text(encoding='utf-8'))
    pn = paper.get('paperName')
    for q in paper.get('questions', [])[:1]:
        stem = clean_text(q.get('content'))
        ref = clean_text(q.get('referenceAnswer'))
        print(fp.name, '| stem len:', len(stem), '| ref len:', len(ref), '| stem:', repr(stem[:40]))
