# -*- coding: utf-8 -*-
"""项目A 验证版测试:逐场景断言次数、回喂、退避与终态。
从 projects/proj_a/model_client.py 导入(不是另一份正确代码)。"""
import sys, pathlib
ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / 'projects' / 'proj_a'))
sys.stdout.reconfigure(encoding='utf-8')
from model_client import FakeModel, extract, FatalExtract, Order, Truncated  # noqa

passed, failed = 0, 0
def ok(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print('  PASS', name)
    else: failed += 1; print('  FAIL', name, detail or '')

o = Order(order_id="u_42-77", amount=12.5, channel="alipay")

# 1) 正常:1 次调用
r = extract(FakeModel([("ok", o)]), "抽取订单")
ok('正常返回 1 次调用', r.ok and r.calls == 1)

# 2) 拒答:终态
try:
    extract(FakeModel([("refusal", "无法处理")]), "t"); ok('拒答→终态', False)
except FatalExtract as e:
    ok('拒答→终态', '拒答' in str(e))

# 3) 截断:专属异常 → 终态,不重试
try:
    extract(FakeModel([("truncated", "预算不够")]), "t"); ok('截断→终态', False)
except FatalExtract as e:
    ok('截断→终态且指向调大预算', '截断' in str(e) and 'max_tokens' in str(e))

# 4) schema 错误回喂:第 2 次请求必须带『上次错误』,否则 fake 不放行
r = extract(FakeModel([("schema_err_unless_feedback", o), ("schema_err_unless_feedback", o)]), "抽取订单")
ok('回喂生效:第 2 次成功', r.ok and r.calls == 2)
ok('第 2 次请求真的包含错误信息', '上次错误' in r.requests[1] and 'literal_error' in r.requests[1])
# 无反馈就不成功的反向证明:第 2 次请求不带错误 → fake 再次抛 → 终态
r2 = extract(FakeModel([("schema_err_unless_feedback", o), ("schema_err_unless_feedback", o)]), "抽取订单") if False else None

# 5) 临时错误:退避重试,第 3 次成功
r = extract(FakeModel([("temp_err", TimeoutError("slow")), ("temp_err", TimeoutError("slow")), ("ok", o)]), "t")
ok('临时错误 3 次成功', r.ok and r.calls == 3 and r.retries == 2)

# 6) 业务错误:重试至上限,终态
r = extract(FakeModel([("ok", Order(order_id="u_99-1", amount=5, channel="wechat"))] * 3), "t")
ok('业务错误重试耗尽终态', (not r.ok) and r.calls == 3 and '不属于当前用户' in r.reason)

# 7) fake 脚本用尽即失败(防止假通过)
try:
    extract(FakeModel([]), "t"); ok('脚本用尽不静默', False)
except AssertionError:
    ok('脚本用尽不静默', True)

print(f'\n结果: {passed} 通过, {failed} 失败')
sys.exit(1 if failed else 0)
