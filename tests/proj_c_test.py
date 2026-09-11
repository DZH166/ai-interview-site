# -*- coding: utf-8 -*-
"""项目C 四层失败实验断言:从项目真实入口(mini_rag.answer)验证。"""
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'projects' / 'proj_c'))
sys.stdout.reconfigure(encoding='utf-8')
from mini_rag import answer, knowledge_exists  # noqa

passed, failed = 0, 0
def ok(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print('  PASS', name)
    else: failed += 1; print('  FAIL', name, detail or '')

# 第①层:库中没有 → 拒答 layer=1
r = answer('公司在哪个城市?', refuse_threshold=3)
ok('第①层 库中没有:拒答且 layer=1', r['refused'] and r['layer'] == 1, str(r.get('layer')))

# 第②层:库里有但检索漏(同义词盲区)→ 拒答 layer=2
r2 = answer('如何退货', refuse_threshold=2)
ok('第②层 检索漏:拒答且 layer=2', r2['refused'] and r2['layer'] == 2, str(r2.get('layer')))
ok('第②层 oracle 确认库里有', knowledge_exists('如何退货'))

# 第③层:多证据问题 top_k=1 → 回答缺发票部分
r3 = answer('开发票和会员免运费怎么弄?', top_k=1, refuse_threshold=1)
ok('第③层 top_k=1 回答缺发票', '发票' not in (r3.get('answer') or ''))
r3b = answer('开发票和会员免运费怎么弄?', top_k=2, refuse_threshold=1)
ok('第③层 top_k=2 回答覆盖发票', '发票' in (r3b.get('answer') or ''))

# 第④层:broken fake 只复述第一条 → 校验拦截 layer=4
r4 = answer('开发票和会员免运费怎么弄?', top_k=2, refuse_threshold=1, broken_fake=True)
ok('第④层 错误 fake 被拦截 layer=4', r4.get('layer') == 4, str(r4))

# 原有拒答与正常回答不回退
r5 = answer('七天内能退货吗?', top_k=2, refuse_threshold=1)
ok('正常回答不回退', (not r5['refused']) and 'd1' in r5['citations'])

print('')
print('结果: %d 通过, %d 失败' % (passed, failed))
sys.exit(1 if failed else 0)
