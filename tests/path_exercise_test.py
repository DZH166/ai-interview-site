# -*- coding: utf-8 -*-
"""阶段练习的自动化验证(修复8/9):
1) 从 paths.json 提取阶段3/6 的展示代码原样运行,断言行为;
2) 阶段6 fake model 调用计数 >= 2、第二次收到工具结果、成功/失败/未知工具按规则终止;
3) 阶段2 两种写法都可行、size<=0 快速失败。
运行:python tests/path_exercise_test.py"""
import json, pathlib, re, subprocess, sys, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
sys.stdout.reconfigure(encoding='utf-8')

paths = json.loads((ROOT / 'data' / 'paths.json').read_text(encoding='utf-8'))['paths'][0]
stages = {s['id']: s for s in paths['stages']}

passed, failed = 0, 0
def ok(name, cond, detail=''):
    global passed, failed
    if cond: passed += 1; print('  PASS', name)
    else: failed += 1; print('  FAIL', name, detail or '')

def extract_code(stage):
    """paths.json 的 exercise.code 是裸代码;若带围栏则剥离"""
    code = stage['exercise']['code']
    m = re.search(r'```python\n([\s\S]*?)```', code)
    return m.group(1) if m else code

def run_py(code, timeout=20):
    with tempfile.NamedTemporaryFile('w', suffix='.py', delete=False, encoding='utf-8') as f:
        f.write(code)
        path = f.name
    env = {**__import__('os').environ, 'PYTHONIOENCODING': 'utf-8'}
    r = subprocess.run([sys.executable, path], capture_output=True, text=True, timeout=timeout, encoding='utf-8', env=env)
    return r

print('== 阶段2:两种推进写法都正确,size<=0 快速失败 ==')
s2 = stages['s2-python-iter']
code2 = extract_code(s2)
r2 = run_py(code2)
ok('阶段2 展示代码运行成功', r2.returncode == 0, r2.stderr[:200])
print('  [debug s2 stdout]:', r2.stdout[:160].replace('\n', '|'))
ok('range 版输出完整文本', '流式输出|的本质是|生成器' in r2.stdout)
ok('while 版输出完整文本', r2.stdout.count('流式输出|的本质是|生成器') >= 2)
ok('size=0 快速失败而非静默', 'size 必须为正' in r2.stdout)
# 独立反例:while 忘记推进 → 死循环(限时运行应超时)
deadlock = code2.replace('        i += size            # 忘记这行 → 死循环\n', '')
try:
    r2b = run_py(deadlock, timeout=8)
    ok('忘记推进索引确实死循环(反例验证)', r2b.returncode != 0, f'rc={r2b.returncode}')
except subprocess.TimeoutExpired:
    ok('忘记推进索引确实死循环(反例验证)', True)


print('== 阶段3:三种收尾对照展示代码 ==')
s3 = stages['s3-async-fastapi']
code3 = extract_code(s3)
r3 = run_py(code3)
ok('阶段3 展示代码运行成功', r3.returncode == 0, r3.stderr[:200])
ok('对照1:c 完成未被取消(孤儿任务)', '[main] 捕获: b 失败' in r3.stdout and r3.stdout.count('[c] 完成') >= 1)
ok('对照3:TaskGroup 取消 c', '[c] 被取消' in r3.stdout and 'ExceptionGroup' in r3.stdout)

print('== 阶段6:完整工具调用循环 ==')
s6 = stages['s6-agent-project']
code6 = extract_code(s6)
r6 = run_py(code6)
ok('阶段6 展示代码运行成功', r6.returncode == 0, r6.stderr[:200])
ok('天气问题:两轮(意图→执行→回传→终答)', '模型调用 2 次' in r6.stdout, r6.stdout)
ok('工具结果进入模型回答', '晴 25°C' in r6.stdout and '根据工具结果' in r6.stdout)
ok('无需工具的问题一轮直接回答', '模型调用 1 次' in r6.stdout)
# 变式:未知工具 → 回喂后正常结束,不把错误当答案
unknown = code6.replace("'get_weather': lambda city:", "'get_temp': lambda city:").replace(
    "{'tool': 'get_weather', 'args': {'city': '北京'}}", "{'tool': 'get_weather', 'args': {'city': '北京'}}")
# 更直接:替换 TOOLS 定义为空,验证未知工具路径
unknown2 = re.sub(r"TOOLS = \{[\s\S]*?\n\}", "TOOLS = {}", code6)
r6b = run_py(unknown2)
ok('未知工具:错误回传且循环按规则结束', r6b.returncode == 0 and '未知工具' in r6b.stdout, r6b.stdout[:200])
ok('未知工具:失败说明而非成功建议', '查询失败' in r6b.stdout and '适合出行' not in r6b.stdout, r6b.stdout[:200])
ok('未知工具:仍走两轮(回喂后终答)', '模型调用 2 次' in r6b.stdout)
# 变式:工具抛异常 → 包装回喂,不当最终答案
failing = code6.replace("'source': '示意数据'", "'source': '示意数据'").replace(
    "'get_weather': lambda city: {'city': city, 'weather': '晴 25°C', 'source': '示意数据'},",
    "'get_weather': lambda city: (_ for _ in ()).throw(RuntimeError('API 炸了')),")
r6c = run_py(failing)
ok('工具异常被包装回喂而非透传', r6c.returncode == 0 and '工具执行失败' in r6c.stdout, r6c.stdout[:200])
ok('工具异常:失败说明而非成功建议', '查询失败' in r6c.stdout and '适合出行' not in r6c.stdout, r6c.stdout[:200])
ok('成功路径:失败字样不出现(协议不误伤)', r6.returncode == 0 and '查询失败' not in r6.stdout)
# 死循环护栏:把模型替身改成永远要工具
always_tool = code6.replace(
    "    if '天气' in user_msg and not tool_msgs:",
    "    if True:").replace(
    "    if tool_msgs:",
    "    if False:")
r6d = run_py(always_tool)
ok('达到 max_rounds 有护栏终止', '达到最大轮次' in r6d.stdout, r6d.stdout[:200])

print(f'\n结果: {passed} 通过, {failed} 失败')
sys.exit(1 if failed else 0)
