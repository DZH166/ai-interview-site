# -*- coding: utf-8 -*-
"""B4:28 道无来源基础题的合法一手资料补证。
策略:官方文档/原始论文能直接支撑核心论断的 → 补具体来源页 + 核查要点 → verified;
来源只能支撑部分(其余为独立整理/实践)→ 补来源但保持 partial 并写明边界;
无合法对应来源的 → 保持 partial,不凑数。"""
import json, pathlib

D = pathlib.Path('data/questions')

def patch(qid, fn, sources, verify):
    p = D / fn
    arr = json.loads(p.read_text(encoding='utf-8'))
    for q in arr:
        if q['id'] == qid:
            q['sources'] = sources
            q['verify'] = verify
            print(qid, '→', verify['status'])
    p.write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')

def off(name, url, note): return {'kind': 'official', 'name': name, 'url': url, 'note': note}
def paper(name, url, note): return {'kind': 'paper', 'name': name, 'url': url, 'note': note}
def indep(note='独立整理'): return {'kind': 'independent', 'name': '独立整理', 'url': '', 'note': note}
VDATE = '2026-09-07'

# ---------- 升级 verified(官方文档/论文直接支撑核心论断,已逐题对照要点) ----------
patch('PY-026', 'b14-python.json',
    [off('PostgreSQL · LIMIT/OFFSET(跳过行仍被计算,深 offset 性能差)', 'https://www.postgresql.org/docs/current/queries-limit.html', '对照要点:OFFSET 行为与性能特征'),
     off('Stripe API · 游标分页(以对象位置为游标,稳定不重不漏)', 'https://docs.stripe.com/api/pagination', '对照要点:cursor 分页的稳定性设计'),
     indep('决策建议(用户翻页 vs 无限加载)为独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': '已对照 PostgreSQL OFFSET 语义与 Stripe 游标分页文档;性能结论(offset 丢弃已扫描行)与官方文档一致。'})

patch('PY-031', 'b17-python.json',
    [off('Pydantic · @validate_decorator(声明式运行时校验)', 'https://docs.pydantic.dev/latest/concepts/validation_decorator/', '对照要点:装饰器运行时校验的官方用法与前置条件'),
     off('Pydantic · 校验概念', 'https://docs.pydantic.dev/latest/concepts/validation/', '对照要点:模型校验语义'),
     indep('分层策略(静态为主、高风险边界才开运行时检查)为独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': '已对照 Pydantic 校验器装饰器官方文档;分层原则为独立整理(已标注)。'})

patch('PY-039', 'b25-eng-py.json',
    [off('Python 官方教程 · 关键字参数与 **kwargs 语义', 'https://docs.python.org/3/tutorial/controlflow.html#keyword-arguments', '对照要点:kwargs 打包/解包与形参匹配'),
     off('PEP 3102 · Keyword-Only Arguments', 'https://peps.python.org/pep-3102/', '对照要点:* 之后参数必须按关键字传递(互斥参数显式化的语言支撑)'),
     indep('重构手法(参数对象/拆函数)为独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': 'kwargs 语义与 keyword-only 参数已对照 Python 官方教程与 PEP 3102;重构手法为通行实践。'})

patch('PY-040', 'b25-eng-py.json',
    [off('Python 官方文档 · import 系统(模块缓存与部分初始化)', 'https://docs.python.org/3/reference/import.html', '对照要点:循环导入时模块可能处于部分初始化状态,属性访问失败'),
     indep('解法(下沉/依赖倒置/延迟导入)为独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': '循环导入的部分初始化行为已对照官方 import 系统文档;解法为通行实践(已标注)。'})

patch('PY-043', 'b25-eng-py.json',
    [off('Python 官方术语表 · duck typing / EAFP', 'https://docs.python.org/3/glossary.html#term-duck-typing', '对照要点:鸭子类型定义与 EAFP 风格'),
     off('Python 官方文档 · functools.singledispatch', 'https://docs.python.org/3/library/functools.html#functools.singledispatch', '对照要点:基于类型的分派官方设施'),
     indep('何时显式检查的判断清单为独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': '鸭子类型定义、EAFP、singledispatch 均已对照官方文档。'})

patch('FD-024', 'b30-final.json',
    [paper('Language Models are Few-Shot Learners(GPT-3, Brown 等 2020)——提出并实证 in-context learning', 'https://arxiv.org/abs/2005.14165', '对照要点:ICL 定义(few-shot 提示、无梯度更新)'),
     indep('机制解释(任务定位说)为主流假说的独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': 'ICL 定义与『无需梯度更新』已对照 GPT-3 论文;内部机制尚无定论,题目按主流假说表述并已标注。'})

patch('FD-016', 'b9-fund.json',
    [paper('BERT(Devlin 等 2018)——encoder-only 双向预训练', 'https://arxiv.org/abs/1810.04805', '对照要点:双向注意力、理解类任务'),
     paper('T5(Raffel 等 2019)——encoder-decoder 文本到文本统一框架', 'https://arxiv.org/abs/1910.10683', '对照要点:编码-解码结构与适用形态'),
     indep('三类分工与选型结论为独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': '三类架构的注意力形态与代表模型已对照 BERT/T5 原论文;『decoder-only 成为主流』为事实性概括(以主流开源模型规格为证)。'})

patch('FD-027', 'b31-final.json',
    [paper('InstructGPT(Ouyang 等 2022)——SFT+RLHF 训练指令跟随模型', 'https://arxiv.org/abs/2203.02155', '对照要点:从 base 到 instruct 的两阶段训练、对齐目标'),
     indep('选型结论(何时可用 base)为独立整理')],
    {'status': 'verified', 'checked_date': VDATE, 'note': 'instruct 模型的训练方式(SFT+RLHF)与 base 的续写行为已对照 InstructGPT 论文。'})

# ---------- 补来源但保持 partial(来源只支撑一部分;其余为实践整理) ----------
patch('PY-028', 'b14-python.json',
    [off('FastAPI · Bigger Applications(router 组织的官方方案)', 'https://fastapi.tiangolo.com/tutorial/bigger-applications/', '对照要点:APIRouter 的分层用法'),
     indep('service/repos 分层为通行实践,无官方规定')],
    {'status': 'partial', 'checked_date': VDATE, 'note': 'router 层组织已对照 FastAPI 官方文档;service/repos 的更细分层为通行实践(非官方规定)。'})

patch('LP-032', 'b18-lp.json',
    [off('Anthropic · System Prompts(角色设定的官方指引)', 'https://docs.anthropic.com/en/docs/build-with-claude/prompt-engineering/system-prompts', '对照要点:角色设定对输出风格/质量的官方建议'),
     indep('具体写法与『专家角色何时有效』为独立整理')],
    {'status': 'partial', 'checked_date': VDATE, 'note': '角色设定的存在与官方建议已对照 Anthropic 文档;效果幅度与写法细节为独立整理,以自测为准。'})

patch('FD-015', 'b9-fund.json',
    [off('HuggingFace · Tokenizer 总结(BPE 等算法)', 'https://huggingface.co/docs/transformers/tokenizer_summary', '对照要点:BPE 按频率合并的机制'),
     indep('多语言 token 效率差异的具体数字随分词器版本变化')],
    {'status': 'partial', 'checked_date': VDATE, 'note': 'BPE 机制已对照 HF 文档;多语言效率的具体倍数随分词器/词表版本变化,须以所用模型实测。'})

patch('FD-017', 'b23-fund-adv.json',
    [paper('Emergent Abilities of LLMs(Wei 等 2022)——涌现能力的提出', 'https://arxiv.org/abs/2206.07682', '对照要点:涌现能力的定义与度量争议'),
     paper('Are Emergent Abilities a Mirage?(Schaeffer 等 2023)——对涌现度量的质疑', 'https://arxiv.org/abs/2304.15004', '对照要点:指标选择造成的『涌现』假象'),
     indep('『为什么能涌现』的解释为开放问题的独立整理')],
    {'status': 'partial', 'checked_date': VDATE, 'note': '涌现能力的提出与质疑两篇论文已列为对照;『为什么能涌现』尚无定论,题目答案为机制假说整理——不要当成已证结论背诵。'})

patch('RG-067', 'b29-final.json',
    [off('Qdrant · Collections 与别名(不停服切换索引的机制)', 'https://qdrant.tech/documentation/concepts/collections/', '对照要点:别名指向切换实现零停机'),
     indep('重建时机判断与双写校验流程为独立整理')],
    {'status': 'partial', 'checked_date': VDATE, 'note': '别名切换机制已对照 Qdrant 文档(其他向量库能力自行核对);时机判断与流程为独立整理。'})

patch('EN-036', 'b22-eng.json',
    [off('Google · Rules of Machine Learning(ML 工程化最佳实践)', 'https://developers.google.com/machine-learning/guides/rules-of-ml', '对照要点:ML 系统从 demo 到生产的工程纪律'),
     indep('LLM 特有的鸿沟清单(评测/成本/护栏)为独立整理')],
    {'status': 'partial', 'checked_date': VDATE, 'note': 'ML 工程化纪律已对照 Rules of ML;LLM 特有项为独立整理。'})

print('B4 补证完成')
