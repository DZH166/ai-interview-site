# -*- coding: utf-8 -*-
"""内容修订 batch 2:LP-003 strict schema/refusal、LP-033 manyOf、PY-004 校验器顺序、
FD-007 论文链接、RG-070 换模型误导、RG-018 口述、python-backend.md 元组可哈希。
证据:pydantic 2.10.4 运行(校验器顺序 before→核心→after;model_json_schema 无 additionalProperties;
(1,2) 可哈希、([1],2) 不可哈希)。"""
import json, pathlib

QDIR = pathlib.Path('data/questions')

def load(fn): return json.loads((QDIR / fn).read_text(encoding='utf-8'))
def save(fn, arr): (QDIR / fn).write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
def patch(qid, fn, **updates):
    arr = load(fn)
    for q in arr:
        if q['id'] == qid:
            q.update(updates)
            print('patched', qid)
            break
    save(fn, arr)

# ============ LP-003:strict 需要额外配置;四类失败分开处理 ============
patch('LP-003', 'llm-prompt.json',
    example=("```python\n"
        "from typing import Literal\n"
        "from pydantic import BaseModel, ValidationError\n"
        "from openai import OpenAI\n"
        "client = OpenAI()\n"
        "\n"
        "class Order(BaseModel):\n"
        "    order_id: str\n"
        "    amount: float\n"
        "    channel: Literal[\"alipay\", \"wechat\"]   # 枚举用 Literal,strict 下受强制\n"
        "\n"
        "def extract(text: str) -> Order:\n"
        "    last_err = None\n"
        "    for _ in range(3):                      # 失败带错误重试\n"
        "        try:\n"
        "            # parse() 是官方 SDK helper:自动把 Pydantic 模型转成符合\n"
        "            # strict 要求的 schema(补 additionalProperties:false 等)。\n"
        "            # 注意:直接用 Order.model_json_schema() 是不行的——\n"
        "            # 本机 pydantic 2.10.4 实测它不带 additionalProperties:false,\n"
        "            # strict 会拒绝。不用 helper 时必须手动补全 schema。\n"
        "            resp = client.chat.completions.parse(\n"
        "                model=MODEL,\n"
        "                messages=[\n"
        "                    {\"role\": \"system\", \"content\": \"从文本抽取订单字段\"},\n"
        "                    {\"role\": \"user\", \"content\": text + (f\"\\n上次错误:{last_err}\" if last_err else \"\")},\n"
        "                ],\n"
        "                response_format=Order,\n"
        "            )\n"
        "            msg = resp.choices[0].message\n"
        "            refusal = getattr(msg, \"refusal\", None)\n"
        "            if refusal:                              # ①安全拒答:单独处理\n"
        "                raise ValueError(f\"模型拒答:{refusal}\")\n"
        "            if resp.choices[0].finish_reason == \"length\":   # ②截断\n"
        "                raise ValueError(\"输出被 max_tokens 截断\")\n"
        "            return msg.parsed                        # SDK 已解析并通过校验\n"
        "        except ValidationError as e:                 # ③schema 校验失败:回喂重试\n"
        "            last_err = str(e)\n"
        "        except ValueError as e:                      # 拒答/截断:业务分类处理\n"
        "            last_err = str(e)\n"
        "        except Exception as e:                       # ④API/schema 错误:另类告警\n"
        "            last_err = f\"API 错误:{e}\"\n"
        "    raise ValueError(\"结构化抽取三次失败\")\n"
        "```\n"
        "说明:此示例依赖付费 API,未真实调用;SDK 未安装时按所装版本对照官方文档。"
        "拒答/截断/校验失败/API 错误四类失败分开分类处理,是结构化输出工程化的关键。"),
    deep=("原理与分层(OpenAI 官方文档已核验):\n"
        "1) 提示词约束:schema 写进 prompt + few-shot 示例。任何模型可用,但遵循率取决于模型与 schema 复杂度,失败模式包括 markdown 包裹、字段改名、枚举拼错。\n"
        "2) JSON mode(格式 type: json_object):只约束『输出是合法 JSON』,不约束 schema。解决『半截 JSON/带 markdown』问题,不解决字段问题。\n"
        "3) Structured Outputs(json_schema + strict:true)或工具定义中的 strict:约束解码——生成阶段每一步只允许产出符合 schema 的 token,"
        "所以『枚举字段不会出现枚举外的值、必填字段一定在』(官方文档:确保遵循你提供的 JSON Schema)。"
        "注意官方列出的限制:部分 schema 关键字不支持;strict 要求所有对象 additionalProperties:false 且全部字段 required"
        "(本机实测:pydantic 的 model_json_schema() 不自动补 additionalProperties——要用官方 SDK 的 parse() helper 或手动补全);"
        "首次使用某 schema 有额外处理延迟。\n"
        "4) 四类失败分开处理(面试重点):①安全拒答——message.refusal 字段识别;②截断——finish_reason==length(max_tokens 不够);"
        "③schema/API 错误——请求层异常(不支持的关键字等);④业务校验失败——schema 合法但内容不对(金额为负等),服务端二次校验兜住。\n"
        "5) 服务端闭环:Pydantic 定义模型 → SDK helper 生成合规 schema → 调用 → 分类处理上述四类失败 → ValidationError 时把错误信息回喂重试(2~3 次)→ 仍失败降级(默认值/人工/换提示)。"),
    pitfalls=[
        "以为 JSON mode 能保证字段正确——它只保证『是 JSON』。",
        "把 model_json_schema() 的产物直接丢给 strict:true——缺少 additionalProperties:false 会被 API 拒绝(本机 pydantic 2.10.4 实测不自动带),要用 SDK 的 parse() helper 或手动补全。",
        "服务端不做二次校验,直接 json.loads 后用——schema 合法但内容错误照样进库;拒答(refusal)与截断(finish_reason)也不分类处理。",
        "重试时只重发原请求——要把校验错误信息附上,模型才有机会修正。",
        "枚举值和业务代码两处维护不一致——枚举以 Pydantic/单一来源生成。",
    ],
    check={
        "q": "两个问题:①strict 模式下,Pydantic 的 model_json_schema() 输出能直接当 json_schema 用吗?②模型返回了 message.refusal 非空,这说明 schema 哪里写错了?",
        "a": "①不能直接用——strict 要求每个对象 additionalProperties:false 且字段全部 required,pydantic 的 schema 生成器默认不带 additionalProperties(本机实测),要用官方 SDK 的 parse() helper 或手动补全。②refusal 非空不是 schema 错——它是安全拒答信号,和校验失败、截断、API 错误是四类不同的失败,要分开处理(拒答不该回喂重试,该转人工或改提示)。",
        "explain": "检验点:strict 的额外 schema 要求与四类失败的分类处理;把拒答当校验失败反复重试是常见工程事故。",
    },
    verify={"status": "verified", "checked_date": "2026-09-07",
        "note": "三档区别、strict 语义与限制、refusal/截断语义已对 OpenAI 官方文档核验;『model_json_schema 不带 additionalProperties』『校验器顺序』已在本机 pydantic 2.10.4 运行验证;代码示例未真实调用付费 API(SDK helper 写法以所装版本文档为准)。"},
)

# ============ LP-033:manyOf 不存在;95% 为示意值 ============
arr = load('b18-lp.json')
for q in arr:
    if q['id'] == 'LP-033':
        q['answer'] = q['answer'].replace(
            "②联合类型的处理——manyOf/anyOf 的支持差异(平台兼容性,RG-008 的能力矩阵思想),不可用时的降级(枚举+可选字段模拟)",
            "②联合类型的处理——各平台对 anyOf/oneOf 的支持不同(没有 manyOf 这个关键字;以各家官方『支持的关键字列表』为准,如 OpenAI 结构化输出支持 anyOf、不支持 oneOf,其他平台自行核对),不支持时的降级(枚举+可选字段模拟)")
        q['deep'] = q['deep'].replace(
            "2) 联合类型与兼容性:anyOf/oneOf 的平台支持差异(能力矩阵,LP-008 的矩阵维护);降级模式",
            "2) 联合类型与兼容性:JSON Schema 只有 anyOf/oneOf(没有 manyOf);各平台对它们的支持不同(能力矩阵,LP-008 的矩阵维护——以官方支持列表为准,不要照搬经验);降级模式")
        q['followups'][0]['a'] = ("判据:单步成功率(以你的评测集实测,下面数字均为示意)与端到端延迟的权衡——"
            "单步成功率低时多步通常占优:若拆后每步约 95%(示意假设,须实测)、两步串行约 0.95²≈0.90,可能仍高于原单步;但若单步本有 92%,拆两步反而更差——先测再拆。"
            "延迟敏感场景偏单步(一次调用);质量敏感场景偏多步(每步简单质量高)。"
            "还有一个维度:中间步骤的结果可复用(实体抽取结果多任务共享——多步的架构红利,EN-003 的缓存思想)。")
        q['check']['a'] = q['check']['a'].replace(
            "成功率:步 1 与步 2 各 95%+(简单 schema),对比原三级嵌套的频繁失败。",
            "预期成功率:简单 schema 的单步成功率通常显著高于深嵌套(具体数字以你的评测集实测为准——下面 95% 是示意值,不是实测结论):步 1 与步 2 若各 ~95%(示意),串行约 0.90,配合失败重试通常优于原三级嵌套的频繁失败。")
        q['verify'] = {"status": "partial", "checked_date": "2026-09-07",
            "note": "已修正:manyOf 不是 JSON Schema 关键字,anyOf/oneOf 的平台支持以官方文档为准;成功率为示意值已标注,非实测。"}
print('patched LP-033')
save('b18-lp.json', arr)

# ============ PY-004:校验器顺序精确化(before→核心→after,wrap 包裹)============
arr = load('python-backend.json')
for q in arr:
    if q['id'] == 'PY-004':
        q['deep'] = q['deep'].replace(
            "2) Pydantic v2 校验顺序:类型解析(coerce,字符串 \"5\"→int 5 视配置)→约束(Field 的 gt/le/max_length/pattern)→自定义 validator。",
            "2) Pydantic v2 的校验顺序按 validator 模式决定(本机 2.10.4 运行验证):mode='before' 的自定义校验器最先跑(拿到原始输入,可先做归一化)→ 核心校验(类型解析 coerce + Field 约束 gt/le/max_length/pattern)→ mode='after' 的自定义校验器(拿到通过核心校验的值;核心校验失败时 after 不执行);mode='wrap' 则包裹整个流程,前后都能插手。笼统说『类型→约束→自定义』只覆盖了默认 after 的情况。")
        q['verify'] = {"status": "verified", "checked_date": "2026-09-07",
            "note": "流式与取消语义已核验;Pydantic 校验器执行顺序(before→核心→after,核心失败时 after 不执行)已在本机 pydantic 2.10.4 运行验证;422 明细字段为框架长期稳定行为,使用时对照所装 FastAPI 版本文档。"}
    if q['id'] == 'PY-004':
        print('patched PY-004')
save('python-backend.json', arr)

# ============ FD-007:论文链接拆分(FlashAttention-2 ≠ GQA)============
arr = load('b4-agent-eng-fund.json')
for q in arr:
    if q['id'] == 'FD-007':
        q['sources'] = [
            {"kind": "paper", "name": "FlashAttention: Fast and Memory-Efficient Exact Attention(Dao 等, 2022)",
             "url": "https://arxiv.org/abs/2205.14135", "note": "原始 FlashAttention 论文"},
            {"kind": "paper", "name": "FlashAttention-2: Faster Attention with Better Parallelism(Dao, 2023)",
             "url": "https://arxiv.org/abs/2307.08691", "note": "此前误将本链接同时标注为 GQA 出处,已更正"},
            {"kind": "paper", "name": "GQA: Training Generalized Multi-Query Transformer(Ainslie 等, 2023)",
             "url": "https://arxiv.org/abs/2305.13245", "note": "GQA 原论文"},
            {"kind": "independent", "name": "独立整理", "url": "", "note": "瓶颈-方案对照为独立整理"},
        ]
        q['verify'] = {"status": "verified", "checked_date": "2026-09-07",
            "note": "已按 arXiv 编号逐一核对论文与主题的对应(2205.14135=FlashAttention,2307.08691=FlashAttention-2,2305.13245=GQA);概念解释为公开稳定知识。"}
    if q['id'] == 'FD-007':
        print('patched FD-007')
save('b4-agent-eng-fund.json', arr)

# ============ RG-070:『证据占 75% 时换模型只能省 25%』误导修正 ============
arr = load('b29-final.json')
for q in arr:
    if q['id'] == 'RG-070':
        q['check'] = {
            "q": "老板说『每个回答要 $0.05,太贵了,换便宜的模型。』你的分析与建议?",
            "a": "先归因再动嘴:$0.05 按环节拆(证据 token × 生成模型输入单价 + 回答 token × 输出单价 + rerank/嵌入的调用费)。"
                "注意:证据 token 也按生成模型的『输入单价』计费——所以换更便宜的模型,输入和输出的单价都会变,并非『只能省证据之外的那部分』;"
                "正确的比较是把各方案写成『分段 token × 对应单价』的总账,同时评估质量(便宜模型对证据的利用率可能下降,召回内容被忽略,答案质量反而崩)。"
                "常见顺序:①先压缩无效证据(检索不相关的块是纯浪费,常与质量双赢);②再谈模型档位(用评测集对比候选模型的总成本与质量);③缓存命中摊薄重复问题。"
                "『换模型』是选项之一,不是第一手段也不是禁区——一切以分段计费的总账+质量评测为准。",
            "explain": "检验点:分段计费的归因意识(证据按输入单价计费,换模型影响全部生成侧费用)与『优化必须过质量评测』的纪律——任何『无损/必省』的口头承诺都要拿评测数据说话。",
        }
        q['plain'] = q['plain'].replace(
            "优化:减少食材浪费(证据压缩)、批量采购折扣(缓存)、小份菜(输出控制)。",
            "优化:减少食材浪费(证据压缩)、批量采购折扣(缓存)、小份菜(输出控制);换便宜的厨师(模型)也是一种选项——但食材钱(证据按输入单价计费)同样会按新厨师的标准重新算,要算总账再决定。")
        q['verify'] = {"status": "partial", "checked_date": "2026-09-07",
            "note": "已修正『证据占 75% 时换模型只能省 25%』的误导表述:证据 token 按生成模型输入单价计费,换模型影响输入+输出全部生成侧费用;『无损』类承诺已删除,改为以评测为准。为独立整理,分段计费方式以供应商价格文档为准。"}
    if q['id'] == 'RG-070':
        print('patched RG-070')
save('b29-final.json', arr)

# ============ RG-018:『我的经验』改为条件式 ============
arr = load('b4-rag.json')
for q in arr:
    if q['id'] == 'RG-018':
        q['interview'] = ("口述版:『RAG 成本大头是证据 token——所以第一刀不是换小模型,是控证据预算:top-k×块大小设上限、rerank 精选、块内精筛、去重。"
            "然后叠缓存(前缀+语义)和历史摘要化。建库成本单独按生命周期摊销。所有优化跑评测集确认质量不掉——"
            "「更精准的证据」通常同时改善成本和忠实度,是值得优先尝试的方向;如果你做过,用自己评测集的前后数据说话,没做过就讲清楚验证方案,别把没做过说成做过。』"
            "追问展开:证据预算怎么定、rerank 的成本收益、月账怎么拆给老板看。")
    if q['id'] == 'RG-018':
        print('patched RG-018')
save('b4-rag.json', arr)

# ============ python-backend.md:元组可哈希的条件 ============
p = pathlib.Path('data/docs/python-backend.md')
md = p.read_text(encoding='utf-8')
md = md.replace(
    "元组可哈希所以能当字典键,这个因果链要能自己讲出来。",
    "元组『元素全部可哈希』时才能当字典键——(1, 2) 可以,([1], 2) 不行(列表不可哈希会拖垮整个元组,本机实测 TypeError),这个因果链要能自己讲出来。")
p.write_text(md, encoding='utf-8', newline='\n')
print('patched python-backend.md')

print('batch 2 done')
