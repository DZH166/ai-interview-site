# -*- coding: utf-8 -*-
"""修复5:LP-003 三层区分(schema 能力 / 平台子集 / 外部业务规则)。
运行验证(本机 pydantic 2.10.4):
- 仅 float:-3 通过(类型合法但缺数值约束)
- Field(gt=0):结构校验层拒绝;schema 产物含 exclusiveMinimum: 0
- 订单归属/库存等依赖外部状态,应用层查询校验
展示代码同步改:业务分支改为『订单归属当前用户』(真正依赖外部状态的规则);amount 用 Field(gt=0) 在 schema 层拒绝。"""
import json, pathlib

p = pathlib.Path('data/questions/llm-prompt.json')
arr = json.loads(p.read_text(encoding='utf-8'))
for q in arr:
    if q['id'] != 'LP-003':
        continue
    q['example'] = (
"结构化抽取的完整工程骨架(四类 API 失败分开处理 + 应用层业务校验;依赖 openai SDK 与付费 API,"
"**本例未经真实调用**,分支语义已用 mock 测试验证——tests/lp003_mock_test.py 从本字段提取代码、桩掉 client 后逐分支断言):\n"
"```python\n"
"import time\n"
"import openai\n"
"from openai import OpenAI\n"
"from typing import Literal\n"
"from pydantic import BaseModel, ValidationError, Field\n"
"\n"
"client = OpenAI()\n"
"MODEL = \"gpt-4o-mini\"   # 示意;以实际接入的模型为准\n"
"CURRENT_USER_ID = \"u_42\"   # 示意:会话里的当前登录用户\n"
"\n"
"class Order(BaseModel):\n"
"    order_id: str\n"
"    amount: float = Field(gt=0)              # 数值约束:schema 层即可拒绝负数\n"
"    channel: Literal[\"alipay\", \"wechat\"]     # 枚举用 Literal,strict 下受强制\n"
"\n"
"class FatalExtract(Exception):\n"
"    \"\"\"不可重试的终态:拒答 / 截断 / 内容过滤 / 重试耗尽\"\"\"\n"
"\n"
"def order_belongs_to_current_user(order_id: str) -> bool:\n"
"    \"\"\"外部状态查询(示意):真实实现查数据库。schema 管不了这类规则。\"\"\"\n"
"    return order_id.startswith(\"u_42-\")      # 示意规则:订单号带用户前缀\n"
"\n"
"MAX_RETRY = 2   # 「带新信息的重试」上限;临时网络错误另按退避重试\n"
"\n"
"def extract(text: str) -> Order:\n"
"    last_err = None\n"
"    backoff = 1\n"
"    for attempt in range(MAX_RETRY + 1):\n"
"        try:\n"
"            # parse() 是官方 SDK helper:自动生成符合 strict 要求的 schema\n"
"            # (补 additionalProperties:false 等;手写 model_json_schema() 缺这些会被 API 拒绝)\n"
"            resp = client.chat.completions.parse(\n"
"                model=MODEL,\n"
"                messages=[\n"
"                    {\"role\": \"system\", \"content\": \"从文本抽取订单字段\"},\n"
"                    {\"role\": \"user\", \"content\": text + (f\"\\n上次错误:{last_err}\" if last_err else \"\")},\n"
"                ],\n"
"                response_format=Order,\n"
"            )\n"
"        except (openai.LengthFinishReasonError, openai.ContentFilterFinishReasonError) as e:\n"
"            # 截断 / 内容过滤:parse() 直接抛 SDK 专属异常(不是返回后查 finish_reason)。\n"
"            # 重试条件没变,再试结果一样 → 终态。截断的正确修法是调大 max_tokens 预算。\n"
"            raise FatalExtract(f\"不可重试:{type(e).__name__}\") from e\n"
"        except (openai.APIConnectionError, openai.RateLimitError, openai.InternalServerError) as e:\n"
"            # 临时错误:退避后重试(条件随时间变化,重试有意义)\n"
"            last_err = f\"临时错误:{type(e).__name__}\"\n"
"            time.sleep(backoff)\n"
"            backoff *= 2\n"
"            continue\n"
"        except ValidationError as e:\n"
"            # schema 校验失败:回喂错误信息,重试有信息增量\n"
"            last_err = str(e)\n"
"            continue\n"
"        msg = resp.choices[0].message\n"
"        if getattr(msg, \"refusal\", None):\n"
"            # 拒答是有效终态:不是校验失败,不回喂重试(条件不变,重试必失败)。\n"
"            # 交人工 / 换提示词 / 改路由。\n"
"            raise FatalExtract(f\"模型拒答:{msg.refusal}\")\n"
"        order = msg.parsed\n"
"        if order is None:\n"
"            last_err = \"未返回结构化内容\"\n"
"            continue\n"
"        if not order_belongs_to_current_user(order.order_id):\n"
"            # 业务规则依赖外部状态(订单归属):schema/数值约束都表达不了,\n"
"            # 必须应用层查询校验。失败回喂一次,仍失败终态。\n"
"            last_err = f\"订单 {order.order_id} 不属于当前用户\"\n"
"            continue\n"
"        return order\n"
"    raise FatalExtract(f\"抽取失败(重试 {MAX_RETRY} 次后):{last_err}\")\n"
"```\n"
"三层校验的分工(本机 pydantic 2.10.4 运行验证):①schema 只写 `amount: float` 时,-3 合法通过"
"(类型对就行);②`Field(gt=0)` 后结构校验层拒绝,schema 产物含 `exclusiveMinimum: 0`——数值约束是 schema 表达力的一部分;"
"③『这笔订单是不是当前用户的』依赖数据库/会话状态,任何 schema 都表达不了,必须应用层查询。")
    q['deep'] = q['deep'].replace(
        "   ⑤ 业务校验失败——schema 合法但业务规则不满足(金额为负等):schema 表达不了跨字段/数值规则,单独校验、回喂或转人工,与类型校验是两回事。",
        "   ⑤ 业务规则失败——schema 合法但依赖外部状态的规则不满足(订单归属、库存、余额):这类规则任何 schema 都表达不了,必须应用层查询后校验,失败回喂一次或转人工。注意区分三层:schema 数值约束(exclusiveMinimum/gt=0,结构层可表达)、平台 schema 子集限制(某 API 支持哪些关键字,查官方文档)、外部业务规则(只能应用层)——不能把平台子集限制泛化成 schema 表达力的缺陷。")
    q['pitfalls'] = [p_ if not p_.startswith('把 float 这类类型校验当成业务校验的全部') else
        "把三层校验混为一谈——①数值约束(金额为正)schema 就能表达(exclusiveMinimum/Pydantic gt=0,本机实测);②某平台不支持某关键字是平台子集限制,不是 schema 表达力的缺陷;③订单归属/库存/余额这类依赖外部状态的规则才必须应用层校验。三层混谈会得出『schema 表达不了业务规则』的笼统错误结论。"
        for p_ in q['pitfalls']]
    q['check'] = {
        "q": "三个判断:①Order(amount=-3) 在『amount: float』的 schema 下能通过吗?怎么让它在结构校验层就被拒绝?②你所用平台的结构化输出不支持 exclusiveMinimum,这是 schema 表达力的缺陷吗?③『这笔订单是不是当前用户下的』为什么 schema 管不了?",
        "a": "①能通过——float 只约束类型,-3 是合法浮点数(本机实测);给字段加数值约束(gField(gt=0),schema 产物即 exclusiveMinimum: 0)后结构校验层直接拒绝。②不是。那是该平台支持的 JSON Schema 子集限制——JSON Schema 本身有数值约束关键字;换支持的版本/平台,或在应用层补数值检查,并按平台文档确认子集。③它依赖外部状态(订单归属存在数据库里):schema 是纯结构声明,管不了任何需要查询外部数据才能回答的问题;必须应用层查询后校验,失败按业务规则处理(回喂/转人工),而不是当作格式错误无限重试。",
        "explain": "检验点:三层边界——schema 能表达什么(exclusiveMinimum)、平台子集限制(查文档)、外部状态规则(应用层);以及『原样重试』只是无信息增量的失败才不该做,不是绝对定律。",
    }
    q['verify'] = {
        "status": "verified",
        "checked_date": "2026-09-07",
        "note": "三档区别、strict 语义与限制、refusal/截断语义已对 OpenAI 官方文档核验;『model_json_schema 不带 additionalProperties』已在本机 pydantic 2.10.4 运行验证;『float 放行 -3 / gt=0 拒绝且产物含 exclusiveMinimum』已本机运行验证;SDK 异常分支对照本机 openai 2.34.0 源码;展示代码分支由 tests/lp003_mock_test.py 桩客户端逐分支验证(mock,非真实 API 调用);平台子集限制以各平台官方文档为准。",
    }
    print('LP-003 rewritten (three-layer)')
p.write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
