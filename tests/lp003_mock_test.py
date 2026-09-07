# -*- coding: utf-8 -*-
"""LP-003 展示代码的 mock 行为测试(无任何真实 API 调用)。
从 data/questions/llm-prompt.json 的 example 字段提取展示代码,
桩掉 openai client(异常类用真实 SDK),逐分支断言:
  1) 拒答 → 终态,只调用 1 次,不回喂重试;
  2) 截断(LengthFinishReasonError)→ 终态,不重试;
  3) 临时错误 → 退避重试至上限,成功后返回;
  4) schema 校验失败 → 回喂『上次错误』后重试成功,第二次请求带错误信息;
  5) 业务非法(amount<=0)→ 不入库,回喂重试至上限后终态;
  6) 合法结果 → 直接返回。
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

# ---------- mock 基建 ----------
from typing import Literal as _Literal

class Order(BaseModel):
    order_id: str
    amount: float = Field(gt=0)  # 仅用于 mock 里构造对象;展示代码本身不含 gt
    channel: Literal['alipay', 'wechat']

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

def make_resp(parsed=None, refusal=None):
    msg = types.SimpleNamespace(refusal=refusal, parsed=parsed)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

def run_extract(parse_impl):
    """在桩客户端下执行展示代码中的 extract,返回 (extract函数, 调用记录)。
    通过临时替换 sys.modules['openai'] 让展示代码的 `import openai` 与
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
        if real_module is not None: sys.modules['openai'] = real_module
    return ns['extract'], calls, ns

def validation_error():
    """用 pydantic 真实校验失败产生 ValidationError(mock 里 channel 非法)"""
    try:
        Order.model_validate({'order_id': 'A1', 'amount': 1, 'channel': 'cash'})
    except ValidationError as e:
        return e
    raise AssertionError('expected validation error')

dummy_completion = types.SimpleNamespace(usage=types.SimpleNamespace(total_tokens=0))

good_order = lambda **kw: Order(order_id='A1', amount=12.5, channel='alipay', **kw) if kw else Order(order_id='A1', amount=12.5, channel='alipay')

# ---------- 用例 ----------
print('== LP-003 mock 分支测试 ==')

# 1) 拒答:终态,1 次调用
extract, calls, _ = run_extract(lambda n, kw: make_resp(parsed=None, refusal='无法处理该内容'))
try:
    extract('订单文本')
    ok('拒答 → 终态异常', False, '未抛出')
except Exception as e:
    ok('拒答 → 终态异常', '拒答' in str(e) and type(e).__name__ == 'FatalExtract', f'{type(e).__name__}:{e}')
eq('拒答只调用 1 次', len(calls), 1)

# 2) 截断:SDK 异常 → 终态
extract, calls, _ = run_extract(lambda n, kw: (_ for _ in ()).throw(openai.LengthFinishReasonError(completion=dummy_completion)))
try:
    extract('订单文本')
    ok('截断 → 终态异常', False)
except openai.LengthFinishReasonError:
    ok('截断异常不被吞(原样透传)', False, '被转成其他异常?')
except Exception as e:
    ok('截断 → 终态异常', type(e).__name__ == 'FatalExtract' and 'LengthFinishReasonError' in str(e), f'{e}')
eq('截断只调用 1 次', len(calls), 1)

# 3) 临时错误:退避重试,第 3 次成功
extract, calls, _ = run_extract(lambda n, kw: (
    (lambda: (_ for _ in ()).throw(openai.APIConnectionError(request=None)))() if n <= 2 else make_resp(parsed=good_order())
))
r = extract('订单文本')
ok('临时错误重试后成功', r.amount == 12.5)
eq('临时错误共调用 3 次', len(calls), 3)

# 4) schema 校验失败:回喂后第二次成功;第二次请求带『上次错误』
extract, calls, _ = run_extract(lambda n, kw: (
    (_ for _ in ()).throw(validation_error()) if n == 1 else make_resp(parsed=good_order())
))
r = extract('订单文本')
ok('schema 失败回喂后成功', r.amount == 12.5)
eq('schema 失败共调用 2 次', len(calls), 2)
ok('第二次请求带回喂错误', '上次错误' in calls[1]['messages'][1]['content'] and 'literal_error' in str(calls[1]['messages'][1]['content']))

# 5) 业务非法(amount<=0):回喂重试至上限,终态;全程不返回非法对象
extract, calls, _ = run_extract(lambda n, kw: make_resp(parsed=Order(order_id='A1', amount=-3, channel='alipay')))
try:
    extract('订单文本')
    ok('业务非法 → 终态', False, '竟然返回了')
except Exception as e:
    ok('业务非法 → 终态', type(e).__name__ == 'FatalExtract' and 'amount' in str(e), f'{e}')
eq('业务非法重试至上限(3 次)', len(calls), 3)
ok('每次请求都带回喂错误', all('上次错误' in c['messages'][1]['content'] for c in calls[1:]))

# 6) 合法结果直接返回
extract, calls, _ = run_extract(lambda n, kw: make_resp(parsed=good_order()))
r = extract('订单文本')
ok('合法结果直接返回', r.order_id == 'A1' and r.channel == 'alipay')
eq('合法结果只调用 1 次', len(calls), 1)

print(f'\n结果: {passed} 通过, {failed} 失败')
sys.exit(1 if failed else 0)
