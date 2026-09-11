# -*- coding: utf-8 -*-
"""项目C 四层失败断言:从项目真实入口验证四层**都真实可诊断**。

与上一版的差别(上一版本身就是问题的载体):
  - 上一版用 `answer('公司在哪个城市?', refuse_threshold=3)` 断言运行侧给出 layer=1,
    等于把「库里有没有」交给查询关键词规则去决定;现在第①层只由评测侧的独立标注给出。
  - 上一版靠逐题手调 top_k / refuse_threshold 摆出第③层;现在四层在同一份固定
    CONFIG 下即可触达,参数敏感性只作为对照单独展示。
  - 上一版第④层看 broken_fake 开关;现在换成注入任意"不遵循证据"的生成器,
    由 validate() 按回答文本判定,与故障是怎么造出来的无关。
"""
import sys, pathlib
HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parent
sys.path.insert(0, str(ROOT / 'projects' / 'proj_c'))
sys.path.insert(0, str(HERE))
sys.stdout.reconfigure(encoding='utf-8')
from _absence_claim import asserts_absence  # noqa
from mini_rag import (  # noqa
    CONFIG, DOCS, diagnose, retrieve, validate, coverage_oracle, evaluate,
    GENERATORS, TRUTH,
)

passed, failed = 0, 0


def ok(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1; print('  PASS', name)
    else:
        failed += 1; print('  FAIL', name, detail or '')


# ---- 第①层:库里没有 —— 归因只发生在评测侧 ----
print('== 第①层:库里没有(评测侧独立标注)==')
r1 = diagnose('公司在哪个城市?')
_bad1, _hits1 = asserts_absence(r1['reason'])
ok('运行侧只报「证据不足」,不下「库里没有」的结论',
   r1['refused'] and r1['layer'] == 2 and not _bad1,
   'layer=%r 越权片段=%r reason=%r' % (r1['layer'], _hits1[:1], r1['reason'][:70]))
ok('运行侧的文案里出现「库里没有」时,必须是否定/悬置语气(不是裸断言)',
   ('库里没有' in r1['reason']) and not _bad1,
   'reason=%r' % (r1['reason'][:70],))
ok('评测侧独立标注确认该主题不在库中', coverage_oracle('公司在哪个城市?') is False)
rows = {str(r['q']).strip().rstrip('?？。'): r for r in evaluate(verbose=False)}
ok('评测表把库外主题归因第①层', rows.get('公司在哪个城市', {}).get('layer') == 1,
   str(rows.get('公司在哪个城市')))
for q in ('公司年会在哪里办', '你们支持比特币支付吗', '怎么改绑手机号'):
    ok('库外主题归因第①层: %s' % q, rows.get(q, {}).get('layer') == 1, str(rows.get(q)))

# ---- 第②层:库里有,但检索没命中 ----
print('== 第②层:库里有但检索漏(词形盲区)==')
ok('独立标注确认库里确实有退款政策', coverage_oracle('如何退货') is True)
r2 = diagnose('如何退货')
ok('运行侧拒答且归因第②层', r2['refused'] and r2['layer'] == 2, str(r2.get('layer')))
ok('评测表归因第②层', rows.get('如何退货', {}).get('layer') == 2, str(rows.get('如何退货')))
hit = retrieve('退款', docs=DOCS, config=CONFIG)['hits']
ok('对照:换成「退款」立刻命中 d1', bool(hit) and hit[0]['doc']['id'] == 'd1',
   str([(h['doc']['id'], h['score']) for h in hit]))

# ---- 第③层:达标证据被证据预算裁掉 ----
print('== 第③层:证据组织不完整(预算裁剪)==')
Q3 = '下单后要退款、要开发票、还要换货怎么办'
r3 = diagnose(Q3)
ok('运行侧真实检出第③层(而不是判为正常)', r3['layer'] == 3, 'layer=%s' % r3.get('layer'))
ok('第③层给出被裁掉的证据', bool(r3.get('dropped')), str(r3.get('dropped')))
ok('评测表归因第③层', rows.get(Q3, {}).get('layer') == 3, str(rows.get(Q3)))
ok('源码中存在第③层产出路径',
   'layer=3' in (ROOT / 'projects' / 'proj_c' / 'mini_rag.py').read_text(encoding='utf-8'))

# ---- 第④层:生成不遵循证据(注入故障生成器,按回答文本判定)----
print('== 第④层:生成不遵循证据 ==')
Q4 = '开发票和会员免运费怎么弄'
r4 = diagnose(Q4, generator=GENERATORS['first_only'])
ok('多证据时只复述第一条 → 拦下并归因第④层', r4['refused'] and r4['layer'] == 4,
   'layer=%s' % r4.get('layer'))
r4b = diagnose('现货商品多久发货', generator=GENERATORS['hallucinating'])
ok('单证据凭空作答也必须被拦下(旧版此处放行)', r4b['refused'] and r4b['layer'] == 4,
   'layer=%s refused=%s' % (r4b.get('layer'), r4b.get('refused')))
ok('校验直接看回答文本,与故障来源无关',
   validate('今天天气不错,建议出门散步。', [{'doc': DOCS[0]}])['ok'] is False)

# ---- 正常路径不回退 ----
print('== 正常路径不回退 ==')
r5 = diagnose('退款政策是什么')
ok('正常回答不回退', (not r5['refused']) and r5['layer'] == 0 and 'd1' in r5['citations'],
   str(r5.get('citations')))
r6 = diagnose('开发票和会员免运费怎么弄')
ok('两证据都在预算内 → 逐条纳入', (not r6['refused']) and set(r6['citations']) == {'d3', 'd4'},
   str(r6.get('citations')))

# ---- 四层在同一固定配置下全部触达 ----
print('== 固定配置下的层级覆盖 ==')
layers = set(r['layer'] for r in evaluate(verbose=False))
ok('四层(0/1/2/3/4)在唯一 CONFIG 下全部真实触达', layers >= {0, 1, 2, 3, 4},
   '实际触达 %s' % sorted(layers))
ok('评测集不含逐题阈值(EVAL 条目只有标注与期望)',
   all('top_k' not in e and 'refuse_threshold' not in e for e in
       __import__('mini_rag').EVAL))
ok('oracle 是标注而非规则(未标注查询不猜)',
   all('in_library' in v for v in TRUTH.values()))

print('')
print('结果: %d 通过, %d 失败' % (passed, failed))
sys.exit(1 if failed else 0)
