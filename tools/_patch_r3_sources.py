# -*- coding: utf-8 -*-
"""修复7:14 道无 URL 基础题的尽力补证。
可对应官方文档的 → 补来源+核对要点;纯实践主题 → 保持 partial 并把待核查写具体。"""
import json, pathlib

D = pathlib.Path('data/questions')

def patch(qid, sources, verify):
    for f in sorted(D.glob('*.json')):
        arr = json.loads(f.read_text(encoding='utf-8'))
        hit = False
        for q in arr:
            if q['id'] == qid:
                q['sources'] = sources
                q['verify'] = verify
                hit = True
        if hit:
            (D / f.name).write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
            print(qid, '→', verify['status'])
            return

def off(name, url, note): return {'kind': 'official-docs', 'name': name, 'url': url, 'note': note}
def indep(note='独立整理'): return {'kind': 'independent', 'name': '独立整理', 'url': '', 'note': note}
VD = '2026-09-07'

# --- 可对应官方文档的 5 道 ---
patch('LP-036',
    [off('OpenAI · Structured Outputs 常见问题(截断/refusal/不支持的关键字)', 'https://platform.openai.com/docs/guides/structured-outputs', '对照要点:格式错误的平台侧成因'),
     off('JSON Schema · 非法 JSON 与修复(repair)的社区讨论基准', 'https://json-schema.org/learn/miscellaneous-integration', '对照要点:schema 与解析失败的分层'),
     indep('repair 策略清单(剥离 markdown 围栏、json_repair、回喂重试)为独立整理')],
    {'status': 'partial', 'checked_date': VD, 'note': '格式错误的平台成因已对照 OpenAI 文档;repair 策略为工程实践整理,各策略成功率以自建评测为准。'})

patch('LP-038',
    [off('OpenAI · 内容审核与拒答行为(refusal 字段说明)', 'https://platform.openai.com/docs/guides/structured-outputs#refusals', '对照要点:平台会主动拒答,应用要给兜底话术'),
     indep('拒答话术模板与『诚实的不确定』三要素为独立整理')],
    {'status': 'partial', 'checked_date': VD, 'note': '平台拒答机制已对照官方文档;话术设计为产品实践整理,无统一官方规范。'})

patch('LP-044',
    [off('OpenAI · Structured Outputs 设计指引(字段越简单越好)', 'https://platform.openai.com/docs/guides/structured-outputs', '对照要点:官方对 schema 复杂度的建议'),
     indep('『哪些字段该要』的业务判断为独立整理')],
    {'status': 'partial', 'checked_date': VD, 'note': 'schema 复杂度建议已对照官方文档;字段取舍的业务准则为独立整理。'})

patch('FD-025',
    [off('Google ML 入门 · 生成式 vs 判别式模型的概念区分', 'https://developers.google.com/machine-learning/generative-ai', '对照要点:两类模型的建模范式差异'),
     indep('对 LLM 选型的映射(P0 生成/P1 理解)为独立整理')],
    {'status': 'partial', 'checked_date': VD, 'note': '范式区分已对照 Google ML 课程;映射到 LLM 应用选型的准则为独立整理。'})

patch('RG-059',
    [off('RAGAS · 评估指标与结果分析(官方文档)', 'https://docs.ragas.io/en/stable/', '对照要点:指标口径与可视化起点'),
     indep('『看分布不看均分』的分析清单为独立整理')],
    {'status': 'partial', 'checked_date': VD, 'note': '指标体系已对照 RAGAS 文档;可视化分析清单为独立整理。'})

# --- 纯实践主题(9 道):保持 partial,待核查写具体 ---
practical = {
    'LP-029': '多语言提示词策略:待核查项=官方多语言基准(如 MGSM)与厂商多语言指引的对照',
    'LP-034': 'experiment log 记录法:待核查项=与 ML 实验管理(如 W&B/MLflow 字段)的通行做法对照',
    'EN-033': '期望管理:待核查项=人机交互文献(setpoint/expectation)的引用',
    'EN-040': 'LLM API 设计:待核查项=OpenAI/Anthropic API 形状(流式/批处理/错误码)的对照',
    'EN-041': '产品评审清单:待核查项=成熟 AI 团队公开的评审 checklist',
    'EN-042': '知识传承:待核查项=团队工程实践(ADR/文档文化)的通行做法',
    'AG-056': 'Agent UAT:待核查项=UAT 通行流程与 Agent 场景的结合点',
    'AG-058': '任务完成报告:待核查项=可观测性文献(如 LangSmith trace 字段)对照',
    'LP-043': '术语一致性:待核查项=本地化行业标准(术语库/TB)与提示词结合的公开案例',
}
for qid, todo in practical.items():
    patch(qid,
        [indep('独立整理(工程/产品实践主题,无单一官方来源页')],
        {'status': 'partial', 'checked_date': VD, 'note': f'实践类主题,内容为独立整理;{todo}。不填首页链接凑数。'})
print('done')
