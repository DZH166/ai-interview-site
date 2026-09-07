# -*- coding: utf-8 -*-
"""项目D:有状态的多轮工具调用 Agent(本地可运行,fake model)
在两轮循环上扩展:多个工具、会话状态、参数校验、重复动作检测、检查点恢复。
运行:python projects/proj_d/agent.py
"""
from __future__ import annotations
import json
import time

# ---------- 工具注册表:应用拥有执行权与校验(AG-002 的安全边界) ----------
TOOLS = {
    "get_weather": {"fn": lambda city: {"city": city, "weather": "晴", "temp_c": 25}, "params": {"city": str}},
    "c2f":         {"fn": lambda c: {"f": round(c * 9 / 5 + 32, 1)}, "params": {"c": (int, float)}},
    "save_report": {"fn": lambda text: {"saved_to": "/tmp/report.txt", "len": len(text)}, "params": {"text": str}},
}

def call_tool(name, args, state):
    """执行工具:校验参数 → 执行 → 记录状态。异常包装为 error 结果(不透传)。"""
    spec = TOOLS.get(name)
    if spec is None:
        return {"error": f"未知工具 {name}"}
    for pname, ptype in spec["params"].items():
        if pname not in args:
            return {"error": f"缺少参数 {pname}"}
        allowed = ptype if isinstance(ptype, tuple) else (ptype,)
        if not isinstance(args[pname], allowed):
            names = "/".join(t.__name__ for t in allowed)
            return {"error": f"参数 {pname} 类型应为 {names}"}
    try:
        result = spec["fn"](**args)
        state.setdefault("tool_calls", []).append({"name": name, "args": args})
        return result
    except Exception as e:                                   # 工具异常:包装回喂
        return {"error": f"工具执行失败:{e}"}

# ---------- 会话状态与检查点 ----------
def checkpoint(state, path="agent_state.json"):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)

def restore(path="agent_state.json"):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None

# ---------- fake model:按状态推进任务(规则替身;真实场景是 LLM) ----------
def model_turn(state):
    """根据已完成步骤决定下一步;演示『模型决策依赖历史』。"""
    done = {c["name"] for c in state.get("tool_calls", [])}
    if "get_weather" not in done:
        return {"tool": "get_weather", "args": {"city": "北京"}}
    if "c2f" not in done:
        temp = state["tool_calls"][0]["args"].get("city") and state.get("last_weather", {}).get("temp_c", 25)
        return {"tool": "c2f", "args": {"c": temp or 25}}
    if "save_report" not in done:
        f = state.get("last_weather", {}).get("f", 77)
        return {"tool": "save_report", "args": {"text": f"北京 {f}°F(报告已生成)"}}
    return {"final": f"任务完成:报告已保存。共执行 {len(done)} 个工具步骤。"}

MAX_ROUNDS = 8   # 护栏:防死循环(AG-043)

def run_agent(user_input: str, state=None, use_checkpoint=False):
    state = state or {"tool_calls": [], "last_weather": {}}
    print(f"用户: {user_input}")
    for rnd in range(1, MAX_ROUNDS + 1):
        decision = model_turn(state)
        if "final" in decision:
            print(f"模型(终答): {decision['final']}")
            return decision["final"]
        name, args = decision["tool"], decision["args"]
        # 重复动作检测:同一工具同参数不重复执行
        if any(c["name"] == name and c["args"] == args for c in state["tool_calls"]):
            state["last_weather"] = state.get("last_weather") or {}
            continue
        if name == "get_weather":
            r = call_tool(name, args, state)
            if "error" not in r:
                state["last_weather"] = r
        else:
            r = call_tool(name, args, state)
        print(f"  轮{rnd}: 模型点名 {name}({args}) → 应用执行 → {json.dumps(r, ensure_ascii=False)}")
        if use_checkpoint:
            checkpoint(state)
    print("模型(护栏): 达到最大轮次,已终止")
    return None

def main():
    print("== 项目D:有状态的工具调用 Agent ==\n")
    print("--- 正常多步任务 ---")
    final = run_agent("查北京天气,转成华氏度,生成报告", use_checkpoint=True)
    # 检查点恢复:模拟中断后从文件恢复状态继续
    saved = restore()
    print(f"\n检查点内容: {json.dumps(saved, ensure_ascii=False)[:90]}…")
    # 异常参数分支:模型点名了带错参数的工具
    print("\n--- 异常参数分支 ---")
    state = {"tool_calls": [], "last_weather": {}}
    r = call_tool("c2f", {"c": "hot"}, state)          # 类型错误
    print("  类型错误 →", json.dumps(r, ensure_ascii=False))
    r = call_tool("query_db", {}, state)               # 未知工具
    print("  未知工具 →", json.dumps(r, ensure_ascii=False))
    print("\n体会:")
    print("1) 模型点名、应用执行、状态在应用侧——三层边界画清(AG-002)。")
    print("2) 重复动作/异常参数/未知工具各有处理规则,不透传、不冒充成功。")
    print("3) 检查点让长任务可恢复;MAX_ROUNDS 是最后防线。")

if __name__ == "__main__":
    main()
