# -*- coding: utf-8 -*-
"""项目A:可靠的模型调用层(本地可运行,fake model;真实 API 仅作可选替换)
六种场景:正常 / 拒答(终态) / 截断(终态) / 临时错误(退避重试) / schema 错误(回喂重试) / 业务错误(终态)
运行:python projects/proj_a/model_client.py
"""
from __future__ import annotations
import json
import logging
import time
from dataclasses import dataclass, field
from typing import Literal, Optional

from pydantic import BaseModel, Field, ValidationError

# ---------- 结构化日志(PY-009 的字段纪律) ----------
log = logging.getLogger("model_client")
logging.basicConfig(level=logging.INFO, format='{"ts":"%(asctime)s","event":"%(message)s"}')

# ---------- 数据结构:调用结果的三种终态 ----------
@dataclass
class CallResult:
    ok: bool
    value: Optional["Order"] = None
    reason: str = ""          # 终态原因(拒答/截断/重试耗尽/…)
    calls: int = 0
    retries: int = 0

class Order(BaseModel):
    order_id: str
    amount: float = Field(gt=0)              # 数值约束:schema 层拒绝负数(本机 pydantic 2.10.4)
    channel: Literal["alipay", "wechat"]

class FatalExtract(Exception):
    """不可重试的终态"""

# ---------- fake model:可脚本化返回各场景 ----------
@dataclass
class FakeModel:
    script: list = field(default_factory=list)   # 每次调用依次弹出
    calls: int = 0

    def parse(self, **kwargs):
        self.calls += 1
        if not self.script:
            raise AssertionError("fake model script 用尽")
        item = self.script.pop(0)
        kind = item[0]
        if kind == "ok":
            return _resp(parsed=item[1])
        if kind == "refusal":
            return _resp(refusal=item[1])
        if kind == "schema_err":
            raise item[1]
        if kind == "temp_err":
            raise item[1]
        raise AssertionError(f"未知脚本项 {kind}")

def _resp(parsed=None, refusal=None):
    import types
    msg = types.SimpleNamespace(refusal=refusal, parsed=parsed)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

# ---------- 业务规则:外部状态,应用层校验 ----------
def order_belongs_to_current_user(order_id: str) -> bool:
    return order_id.startswith("u_42-")   # 示意规则

# ---------- 主实现 ----------
MAX_RETRY = 2
BACKOFF = 0.01   # 演示用;真实环境指数退避

def extract(model, text: str) -> CallResult:
    last_err = None
    retries = 0
    for attempt in range(MAX_RETRY + 1):
        try:
            # 真实 API 时这里换成 client.chat.completions.parse(...)(LP-003)
            resp = model.parse(model="fake", messages=[{"role": "user", "content": text}])
        except (ValidationError,) as e:
            last_err = f"schema 校验失败:{e}"; retries += 1
            log.info(f"retry schema: {e}")
            time.sleep(BACKOFF); continue
        except (ConnectionError, TimeoutError) as e:
            last_err = f"临时错误:{e}"; retries += 1
            log.info(f"retry temp: {e}")
            time.sleep(BACKOFF * (2 ** retries)); continue
        msg = resp.choices[0].message
        if getattr(msg, "refusal", None):
            raise FatalExtract(f"模型拒答:{msg.refusal}")          # 终态:回喂不改变触发条件
        order = msg.parsed
        if order is None:
            last_err = "未返回结构化内容"; retries += 1; continue
        if not order_belongs_to_current_user(order.order_id):
            last_err = f"订单 {order.order_id} 不属于当前用户"       # 业务规则:应用层
            retries += 1; continue
        return CallResult(ok=True, value=order, calls=model.calls, retries=retries)
    return CallResult(ok=False, reason=last_err, calls=model.calls, retries=retries)

# ---------- 六场景演示 ----------
def _enum_error():
    """构造真实的 ValidationError(channel 非法)"""
    try:
        Order.model_validate({"order_id": "u_42-77", "amount": 1, "channel": "cash"})
    except ValidationError as e:
        return e
    raise AssertionError("expected validation error")

def main():
    o = Order(order_id="u_42-77", amount=12.5, channel="alipay")
    scenarios = [
        ("正常返回",        FakeModel([("ok", o)]),                              "u_42-77 单"),
        ("拒答(终态)",     FakeModel([("refusal", "无法处理该内容")]),           "1 次调用即终止"),
        ("schema 错误回喂", FakeModel([("schema_err", _enum_error()),
                                      ("ok", o)]),                             "第 2 次成功"),
        ("临时错误退避",     FakeModel([("temp_err", TimeoutError("upstream slow")),
                                      ("temp_err", TimeoutError("upstream slow")),
                                      ("ok", o)]),                             "第 3 次成功"),
    ]
    print("== 项目A:可靠的模型调用层 ==\n")
    for name, model, note in scenarios:
        try:
            r = extract(model, "抽取订单")
            print(f"[{name}] ok={r.ok} calls={r.calls} retries={r.retries} {note}")
        except FatalExtract as e:
            print(f"[{name}] 终态: {e} ({note})")
    # 业务错误(终态:重试耗尽)
    m = FakeModel([("ok", Order(order_id="u_99-1", amount=5, channel="wechat"))] * 3)
    r = extract(m, "抽取订单")
    print(f"[业务错误(非当前用户)] ok={r.ok} reason={r.reason} calls={r.calls}")
    # 截断(终态):真实 SDK 抛 LengthFinishReasonError;fake 用 refusal 同级的终态演示略(见 LP-003)
    print("\n体会:哪类重试有信息增量(schema/临时),哪类没有(拒答);业务规则为什么必须在应用层。")

if __name__ == "__main__":
    main()
