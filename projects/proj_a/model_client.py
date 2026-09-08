# -*- coding: utf-8 -*-
"""项目A:可靠的模型调用层(本地可运行,fake model;真实 API 仅作可选替换)
目标层级:最小教学骨架(本文件)→ 验证版(六场景有断言,tests 可跑)→ 可选工程扩展(真实 API/限流/结构化日志)。
**复制本文件不等于生产可用**;真实接入要点见文末。

六场景:正常 / 拒答(终态) / 截断(终态) / 临时错误(退避重试) / schema 错误(回喂重试,请求真的变化) / 业务错误(终态)
运行:python projects/proj_a/model_client.py
验证:python tests/proj_a_test.py
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

# ---------- 数据结构 ----------
@dataclass
class CallResult:
    ok: bool
    value: Optional["Order"] = None
    reason: str = ""
    calls: int = 0
    retries: int = 0
    requests: list = field(default_factory=list)   # 每次发出的 user 消息(供断言回喂生效)

class Order(BaseModel):
    order_id: str
    amount: float = Field(gt=0)
    channel: Literal["alipay", "wechat"]

class FatalExtract(Exception):
    """不可重试的终态"""

class Truncated(Exception):
    """截断:parse() 对应 openai.LengthFinishReasonError;重试不改变条件,必须调大预算"""

# ---------- fake model:脚本化 + 校验「回喂后请求真的变化」 ----------
@dataclass
class FakeModel:
    script: list = field(default_factory=list)
    calls: int = 0
    requests: list = field(default_factory=list)

    def parse(self, **kwargs):
        self.calls += 1
        self.requests.append(kwargs["messages"][-1]["content"])
        if not self.script:
            raise AssertionError("fake model script 用尽")
        kind, payload = self.script.pop(0)
        if kind == "ok":
            return _resp(parsed=payload)
        if kind == "refusal":
            return _resp(refusal=payload)
        if kind == "truncated":
            raise Truncated(payload)
        if kind == "schema_err":
            raise payload
        if kind == "temp_err":
            raise payload
        if kind == "schema_err_unless_feedback":
            # 教学用:第二次请求若带『上次错误』信息才成功——证明回喂真的改变了请求
            if "上次错误" in self.requests[-1]:
                return _resp(parsed=payload)
            raise _enum_error()
        raise AssertionError(f"未知脚本项 {kind}")

def _resp(parsed=None, refusal=None):
    import types
    msg = types.SimpleNamespace(refusal=refusal, parsed=parsed)
    return types.SimpleNamespace(choices=[types.SimpleNamespace(message=msg)])

def _enum_error():
    try:
        Order.model_validate({"order_id": "u_42-77", "amount": 1, "channel": "cash"})
    except ValidationError as e:
        return e
    raise AssertionError("expected validation error")

def order_belongs_to_current_user(order_id: str) -> bool:
    return order_id.startswith("u_42-")   # 示意规则(外部状态查询)

# ---------- 主实现:回喂把校验错误带进下一次请求 ----------
MAX_RETRY = 2
BACKOFF = 0.01

def extract(model, text: str) -> CallResult:
    last_err = None
    retries = 0
    user_content = text
    for attempt in range(MAX_RETRY + 1):
        try:
            resp = model.parse(model="fake",
                               messages=[{"role": "user", "content": user_content}])
        except Truncated as e:
            # 终态:重试不携带新信息;正确修法是调大 max_tokens 预算后重新调用
            raise FatalExtract(f"输出被截断({e});应调大 max_tokens 预算,而不是重试")
        except (ValidationError,) as e:
            last_err = f"schema 校验失败:{e}"
            user_content = f"{text}\n上次错误:{e}"     # ★ 回喂:下一次请求真的变了
            retries += 1
            log.info(f"retry schema: {e}")
            time.sleep(BACKOFF); continue
        except (ConnectionError, TimeoutError) as e:
            last_err = f"临时错误:{e}"
            retries += 1
            log.info(f"retry temp: {e}")
            time.sleep(BACKOFF * (2 ** retries)); continue
        msg = resp.choices[0].message
        if getattr(msg, "refusal", None):
            raise FatalExtract(f"模型拒答:{msg.refusal}")
        order = msg.parsed
        if order is None:
            last_err = "未返回结构化内容"
            user_content = f"{text}\n上次错误:{last_err}"
            retries += 1; continue
        if not order_belongs_to_current_user(order.order_id):
            last_err = f"订单 {order.order_id} 不属于当前用户"
            user_content = f"{text}\n上次错误:{last_err}"   # 业务错误也回喂
            retries += 1; continue
        return CallResult(ok=True, value=order, calls=model.calls,
                          retries=retries, requests=model.requests)
    return CallResult(ok=False, reason=last_err, calls=model.calls,
                      retries=retries, requests=model.requests)

# ---------- 演示 ----------
def main():
    o = Order(order_id="u_42-77", amount=12.5, channel="alipay")
    print("== 项目A:可靠的模型调用层(最小教学骨架)==\n")
    scenarios = [
        ("正常返回",       FakeModel([("ok", o)])),
        ("拒答(终态)",    FakeModel([("refusal", "无法处理该内容")])),
        ("截断(终态)",    FakeModel([("truncated", "max_tokens 到达")])),
        ("schema 回喂",    FakeModel([("schema_err_unless_feedback", o),
                                     ("schema_err_unless_feedback", o)])),
        ("临时错误退避",   FakeModel([("temp_err", TimeoutError("upstream slow")),
                                     ("temp_err", TimeoutError("upstream slow")),
                                     ("ok", o)])),
        ("业务错误(终态)", FakeModel([("ok", Order(order_id="u_99-1", amount=5, channel="wechat"))] * 3)),
    ]
    for name, model in scenarios:
        try:
            r = extract(model, "抽取订单")
            if r.ok:
                extra = f"回喂生效(第2次带错误)" if "上次错误" in (r.requests[1] if len(r.requests) > 1 else "") else ""
                print(f"[{name}] ok=True calls={r.calls} retries={r.retries} {extra}")
            else:
                print(f"[{name}] 终态: {r.reason}(重试 {r.retries} 次)")
        except FatalExtract as e:
            print(f"[{name}] 终态: {e}")
    print("\n目标层级:本文件=最小教学骨架;python tests/proj_a_test.py=验证版(逐场景断言);"
          "真实 API/限流/结构化日志=可选工程扩展。复制本文件不等于生产可用。")

if __name__ == "__main__":
    main()
