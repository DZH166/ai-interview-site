# -*- coding: utf-8 -*-
"""LP-003 展示代码的 mock 行为测试(无任何真实 API 调用)。
从 data/questions/llm-prompt.json 的 example 字段提取展示代码,
桩掉 openai client(异常类用真实 SDK),逐分支断言:
  1) 拒答 → 终态,只调用 1 次,不回喂重试;
  2) 截断(LengthFinishReasonError)→ 终态,不重试;
  3) 临时错误 → 退避重试至上限,成功后返回;
  4) schema 校验失败(枚举错)→ 回喂『上次错误』后重试成功;
  5) 数值约束(gt=0)→ 负金额在结构校验层被拒,进 ValidationError 分支;
  6) 业务规则(订单归属)→ schema 合法对象真正进入应用层校验分支,
     断言命中(终态消息含业务错误文本)、调用次数、回喂内容、终态;
  7) 合法结果 → 直接返回。
运行:python tests/lp003_mock_test.py"""
import json
import pathlib
import re
import sys
import types

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding='utf-8')

import openai  # 真实 SDK(仅用异常类)
from typing import Literal
from pydantic import BaseModel, ValidationError, Field

# ---------- 从题库字段提取展示代码 ----------
q = next(q for f in (ROOT / 'data' / 'questions').glob('*.json')
         for q in json.loads(f.read_text(encoding='utf-8')) if q['id'] == 'LP-003')
blocks = re.findall(r'```python\n([\s\S]*?)```', q['example'], re.S)
target = [b for b in blocks if 'def extract' in b]
assert len(target) == 1, f'期望 1 个展示代码块,得到 {len(target)}'
code = target[0]

passed, failed = 0, 0
def ok(name, cond, detail=''):
    global passed, failed
    if cond:
        passed += 1
        print('  PASS', name)
    else:
        failed += 1
        print('  FAIL', name, detail or '')

def eq(name, got, want):
    ok(name, got == want, f'got={got!r} want={want!r}')

# ---------- mock 基建 ----------
class Order(BaseModel):
    """与展示代码相同的模型:gt=0 数值约束 + Literal 枚举"""
    order_id: str
    amount: float = Field(gt=0)
    channel: Literal['alipay', 'wechat']

def make_resp(parsed=None, refusal=None):
    msg = types.SimpleNamespace(refusal=refusal, parsed=parsed)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

def run_extract(parse_impl):
    """在桩客户端下执行展示代码中的 extract,返回 (extract函数, 调用记录)。
    临时替换 sys.modules['openai'],让展示代码的 `import openai` 与
    `client = OpenAI()` 都落到桩上(异常类保持真实 SDK 类型)。"""
    calls = []
    def fake_parse(**kwargs):
        calls.append(kwargs)
        return parse_impl(len(calls), kwargs)
    fake_completions = types.SimpleNamespace(parse=fake_parse)
    fake_client = types.SimpleNamespace(chat=types.SimpleNamespace(completions=fake_completions))
    fake_module = types.ModuleType('openai')
    for attr in ['LengthFinishReasonError', 'ContentFilterFinishReasonError',
                 'APIConnectionError', 'RateLimitError', 'InternalServerError']:
        setattr(fake_module, attr, getattr(openai, attr))
    fake_module.OpenAI = lambda **kw: fake_client
    real_module = sys.modules.get('openai')
    sys.modules['openai'] = fake_module
    try:
        ns = {'__name__': 'lp003_displayed'}
        exec(compile(code, 'LP-003-displayed', 'exec'), ns)
    finally:
        if real_module is not None:
            sys.modules['openai'] = real_module
    return ns['extract'], calls, ns

def enum_error():
    """schema 校验失败:channel 非法(结构层)"""
    try:
        Order.model_validate({'order_id': 'u_42-77', 'amount': 1, 'channel': 'cash'})
    except ValidationError as e:
        return e
    raise AssertionError('expected validation error')

def gt_error():
    """数值约束失败:amount=-3 违反 gt=0(结构层,与真实 SDK parse 内部行为一致)"""
    try:
        Order.model_validate({'order_id': 'u_42-77', 'amount': -3, 'channel': 'alipay'})
    except ValidationError as e:
        return e
    raise AssertionError('expected gt validation error')

def order(**kw):
    base = {'order_id': 'u_42-77', 'amount': 12.5, 'channel': 'alipay'}
    base.update(kw)
    return Order(**base)

dummy_completion = types.SimpleNamespace(usage=types.SimpleNamespace(total_tokens=0))

def expect_fatal(fn):
    """执行并断言抛 FatalExtract(展示代码的终态异常),返回错误消息或错误描述"""
    try:
        fn()
        return None
    except Exception as e:
        if type(e).__name__ == 'FatalExtract':
            return str(e)
        return f'(非 FatalExtract 异常){type(e).__name__}:{e}'

print('== LP-003 mock 分支测试 ==')

# 1) 拒答:终态,1 次调用,不回喂
extract, calls, _ = run_extract(lambda n, kw: make_resp(parsed=None, refusal='无法处理该内容'))
msg = expect_fatal(lambda: extract('订单文本'))
ok('拒答 → 终态', msg is not None and '拒答' in msg, msg)
eq('拒答只调用 1 次', len(calls), 1)
ok('拒答不回喂错误信息', all('上次错误' not in c['messages'][1]['content'] for c in calls))

# 2) 截断:SDK 异常 → 终态
extract, calls, _ = run_extract(lambda n, kw: (_ for _ in ()).throw(openai.LengthFinishReasonError(completion=dummy_completion)))
msg = expect_fatal(lambda: extract('订单文本'))
ok('截断 → SDK 异常识别为终态', msg is not None and 'LengthFinishReasonError' in msg, msg)
eq('截断只调用 1 次', len(calls), 1)

# 3) 临时错误:退避重试,第 3 次成功
extract, calls, _ = run_extract(lambda n, kw: (
    (lambda: (_ for _ in ()).throw(openai.APIConnectionError(request=None)))() if n <= 2 else make_resp(parsed=order())
))
r = extract('订单文本')
ok('临时错误重试后成功', r.amount == 12.5)
eq('临时错误共调用 3 次', len(calls), 3)

# 4) schema 校验失败(枚举):回喂后第二次成功
extract, calls, _ = run_extract(lambda n, kw: (
    (_ for _ in ()).throw(enum_error()) if n == 1 else make_resp(parsed=order())
))
r = extract('订单文本')
ok('schema 失败回喂后成功', r.amount == 12.5)
eq('schema 失败共调用 2 次', len(calls), 2)
ok('第二次请求带回喂错误', '上次错误' in calls[1]['messages'][1]['content'] and 'channel' in str(calls[1]['messages'][1]['content']))

# 5) 数值约束(gt=0):负金额在结构校验层被拒 → ValidationError 分支
#    (真实 SDK 的 parse() 内部就是 model_parse_json,gt 违反在此抛 ValidationError)
extract, calls, _ = run_extract(lambda n, kw: (
    (_ for _ in ()).throw(gt_error()) if n <= 1 else make_resp(parsed=order())
))
r = extract('订单文本')
ok('数值约束(amount=-3)在结构校验层被拒', r.amount == 12.5 and len(calls) == 2)
ok('数值约束错误回喂内容含 greater_than 语义', 'greater' in calls[1]['messages'][1]['content'])

# 6) 业务规则(订单归属):schema 完全合法的对象 → 真正进入应用层分支
extract, calls, _ = run_extract(lambda n, kw: make_resp(parsed=order(order_id='u_99-1')))
msg = expect_fatal(lambda: extract('订单文本'))
ok('业务非法(订单非当前用户)→ 终态', msg is not None and '不属于当前用户' in msg, msg)
eq('业务非法重试至上限(3 次)', len(calls), 3)
ok('业务错误随重试回喂', all('不属于当前用户' in c['messages'][1]['content'] for c in calls[1:]))
ok('业务分支真实命中:错误由应用层校验产生(首请求无回喂)', '上次错误' not in calls[0]['messages'][1]['content'])

# 7) 合法结果直接返回
extract, calls, _ = run_extract(lambda n, kw: make_resp(parsed=order()))
r = extract('订单文本')
ok('合法结果直接返回', r.order_id == 'u_42-77' and r.channel == 'alipay')
eq('合法结果只调用 1 次', len(calls), 1)

print(f'\n结果: {passed} 通过, {failed} 失败')
sys.exit(1 if failed else 0)
