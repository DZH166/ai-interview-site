# -*- coding: utf-8 -*-
"""项目D:有状态的多轮工具调用 Agent(本地可运行,fake model)
在两轮循环上扩展:多个工具、会话状态、参数校验、重复动作检测、检查点恢复。
状态链:每步工具结果真实存入 state,后续步骤消费真实输出;缺失与 0 区别处理;
save_report 真实写文件;检查点支持中断后恢复续跑(不重复副作用)。
运行:python projects/proj_d/agent.py [city] [temp_c]
"""
from __future__ import annotations
import json
import os

STATE_PATH = "proj_d_state.json"
REPORT_PATH = os.path.join("projects", "proj_d", "report.txt")

# ---------- 工具注册表:应用拥有执行权与校验(AG-002 的安全边界) ----------
TOOLS = {
    "get_weather": {"fn": lambda city, temp_c=None: {"city": city, "weather": "晴", "temp_c": temp_c},
                    "params": {"city": str}},
    "c2f":         {"fn": lambda c: {"f": round(c * 9 / 5 + 32, 1)}, "params": {"c": (int, float)}},
    "save_report": {"fn": lambda text: _save_report(text), "params": {"text": str}},
}

def _save_report(text: str):
    """真实写文件(项目输出目录),返回证据供断言"""
    with open(REPORT_PATH, "w", encoding="utf-8") as f:
        f.write(text)
    return {"saved_to": REPORT_PATH, "len": len(text)}

def call_tool(name, args, state):
    """执行工具:校验参数 → 执行 → 结果由调用方写状态。异常包装为 error(不透传)。"""
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
        return spec["fn"](**args)
    except Exception as e:
        return {"error": f"工具执行失败:{e}"}

# ---------- 会话状态与检查点 ----------
def checkpoint(state, path=STATE_PATH):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(state, f, ensure_ascii=False)

def restore(path=STATE_PATH):
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except FileNotFoundError:
        return None

# ---------- fake model:决策只依赖 state 中真实存在的结果 ----------
def model_turn(state):
    """每一步的输入都取自 state 里上一步的真实输出(不是默认值)。"""
    done = {c["name"] for c in state.get("tool_calls", [])}
    if "get_weather" not in done:
        return {"tool": "get_weather", "args": {"city": state["city"]}}
    if "c2f" not in done:
        w = state.get("weather")
        if not w or "temp_c" not in w or w["temp_c"] is None:
            # 缺失温度:如实报告缺数据,不用默认值掩盖信息链断裂
            return {"final": "天气数据缺少温度字段,无法换算。"}
        return {"tool": "c2f", "args": {"c": w["temp_c"]}}
    if "save_report" not in done:
        conv = state.get("converted")
        if not conv or "f" not in conv:
            return {"final": "缺少换算结果,无法生成报告。"}
        return {"tool": "save_report", "args": {"text": f"{state['city']} {conv['f']}°F(报告已生成)"}}
    return {"final": f"任务完成:报告已写入 {REPORT_PATH}。共执行 {len(state[chr(34)+chr(34)] if False else state.get(chr(116)+chr(111)+chr(111)+chr(108)+chr(95)+chr(99)+chr(97)+chr(108)+chr(108)+chr(115), []))} 个工具步骤。"}

MAX_ROUNDS = 8   # 护栏:防死循环(AG-043)

def run_agent(user_input: str, state=None, use_checkpoint=False, log=print):
    """state 需含 city;weather/converted/save 由各步真实结果填充。"""
    state = state or {"city": "北京", "tool_calls": [], "weather": None, "converted": None, "report": None}
    log(f"用户: {user_input}")
    for rnd in range(1, MAX_ROUNDS + 1):
        decision = model_turn(state)
        if "final" in decision:
            log(f"模型(终答): {decision['final']}")
            state["final"] = decision["final"]
            return decision["final"]
        name, args = decision["tool"], decision["args"]
        if any(c["name"] == name and c["args"] == args for c in state["tool_calls"]):
            continue   # 重复动作:跳过不重复执行
        r = call_tool(name, args, state)
        # 结果真实进入状态:每次成功调用都记录(供 done 判断),并按工具写入对应槽位
        if "error" not in r:
            state["tool_calls"].append({"name": name, "args": args})
            if name == "get_weather":
                state["weather"] = r
            elif name == "c2f":
                state["converted"] = r
            elif name == "save_report":
                state["report"] = r
        log(f"  轮{rnd}: 模型点名 {name}({args}) → 应用执行 → {json.dumps(r, ensure_ascii=False)}")
        if use_checkpoint:
            checkpoint(state)
    log("模型(护栏): 达到最大轮次,已终止")
    return None

def main():
    import sys
    city = sys.argv[1] if len(sys.argv) > 1 else "北京"
    temp_c = None
    if len(sys.argv) > 2:
        try:
            temp_c = float(sys.argv[2])
            if temp_c == int(temp_c):
                temp_c = int(temp_c)
        except ValueError:
            temp_c = None

    print("== 项目D:有状态的工具调用 Agent ==\n")
    if os.path.exists(REPORT_PATH):
        os.remove(REPORT_PATH)

    print("--- 完整链:天气(含温度)→ 换算 → 报告(真实写文件)---")
    state = {"city": city, "tool_calls": [], "weather": None, "converted": None, "report": None,
             "weather_raw": {"city": city, "weather": "晴", "temp_c": temp_c} if temp_c is not None else None}
    # 用注入的 weather_raw 模拟 get_weather 的返回(命令行演示模式)
    if state["weather_raw"]:
        state["weather"] = state.pop("weather_raw")
        state["tool_calls"].append({"name": "get_weather", "args": {"city": city}})
        print(f"  (预置) get_weather → {json.dumps(state['weather'], ensure_ascii=False)}")
    final = run_agent(f"查{city}天气,转成华氏度,生成报告", state, use_checkpoint=True)
    if os.path.exists(REPORT_PATH):
        with open(REPORT_PATH, encoding="utf-8") as f:
            print(f"  [证据] {REPORT_PATH} 内容: {f.read()}")

    print("\n--- 变化输入:0°C(0 是合法值,不得当缺失)---")
    state0 = {"city": city, "tool_calls": [{"name": "get_weather", "args": {"city": city}}],
              "weather": {"city": city, "weather": "晴", "temp_c": 0},
              "converted": None, "report": None}
    f0 = run_agent("查天气并生成报告", state0)
    print(f"  0°C → {f0}(应为 32.0°F)")

    print("\n--- 变化输入:温度缺失(不得用默认值掩盖)---")
    stateN = {"city": city, "tool_calls": [{"name": "get_weather", "args": {"city": city}}],
              "weather": {"city": city, "weather": "阴", "temp_c": None},
              "converted": None, "report": None}
    fN = run_agent("查天气并生成报告", stateN)
    print(f"  缺温度 → {fN}(应如实说明缺数据)")

    print("\n--- 检查点恢复:中途停止后续跑(不重复副作用)---")
    st = {"city": city, "tool_calls": [], "weather": {"city": city, "weather": "晴", "temp_c": 10},
          "converted": None, "report": None}
    # 第 1 步后存档
    st["tool_calls"].append({"name": "get_weather", "args": {"city": city}})
    st["weather"] = {"city": city, "weather": "晴", "temp_c": 10}
    checkpoint(st)
    print(f"  检查点已保存(完成 get_weather)")
    resumed = restore()
    if os.path.exists(REPORT_PATH):
        os.remove(REPORT_PATH)
    final2 = run_agent("续跑", resumed, use_checkpoint=True)
    calls_after = len(resumed["tool_calls"])
    print(f"  恢复后新调用 {calls_after - 1} 次(应为 2:c2f+save_report,不重复 get_weather)")
    print(f"  恢复续跑终答: {final2}")

    print("\n体会:")
    print("1) 每步输入来自上一步的真实结果(state.weather/converted),没有默认值兜底。")
    print("2) 0 与『缺失』是两回事:0°C 合法参与换算;缺温度如实报错。")
    print("3) save_report 真实写文件;检查点续跑不重复已完成的工具调用。")

if __name__ == "__main__":
    main()
