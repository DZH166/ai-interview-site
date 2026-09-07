# -*- coding: utf-8 -*-
"""阶段1.2:阶段6 工具失败协议修正。
fake model 收到 tool 结果时区分成功/失败:失败结果进入失败说明,不输出成功建议。"""
import json, pathlib

p = pathlib.Path('data/paths.json')
data = json.loads(p.read_text(encoding='utf-8'))
for path in data['paths']:
    for s in path['stages']:
        if s['id'] != 's6-agent-project':
            continue
        ex = s['exercise']
        old = """def model_turn(messages):
    \"\"\"替身模型:按对话历史决定『调用工具』还是『给最终回答』。
    真实场景这一步是 LLM;这里用规则模拟,专注循环本身。\"\"\"
    user_msg = [m for m in messages if m['role'] == 'user'][-1]['content']
    tool_msgs = [m for m in messages if m['role'] == 'tool']
    if '天气' in user_msg and not tool_msgs:
        return {'type': 'tool_call', 'name': 'get_weather', 'args': {'city': '北京'}}
    if tool_msgs:
        return {'type': 'final', 'answer': '根据工具结果(' + tool_msgs[-1]['content'] + '),今天适合出行。'}
    return {'type': 'final', 'answer': '这个问题不需要工具,我直接回答。'}"""
        new = """def model_turn(messages):
    \"\"\"替身模型:按对话历史决定『调用工具』还是『给最终回答』。
    真实场景这一步是 LLM;这里用规则模拟,专注循环本身。
    结果协议:工具返回 {'error': ...} 视为失败——失败要如实说明或换路,不冒充成功。\"\"\"
    user_msg = [m for m in messages if m['role'] == 'user'][-1]['content']
    tool_msgs = [m for m in messages if m['role'] == 'tool']
    if '天气' in user_msg and not tool_msgs:
        return {'type': 'tool_call', 'name': 'get_weather', 'args': {'city': '北京'}}
    if tool_msgs:
        last = json.loads(tool_msgs[-1]['content'])
        if 'error' in last:   # 工具失败:如实告知失败与原因,不给成功建议
            return {'type': 'final', 'answer': '查询失败(' + last['error'] + '),没能拿到天气数据。'}
        return {'type': 'final', 'answer': '根据工具结果(' + json.dumps(last, ensure_ascii=False) + '),今天适合出行。'}
    return {'type': 'final', 'answer': '这个问题不需要工具,我直接回答。'}"""
        assert old in ex['code'], 'model_turn block not found'
        ex['code'] = ex['code'].replace(old, new)
        # 同步变式参考答案:补充失败协议
        v = ex['variant']
        if '②工具抛异常时' in v['question'] or True:
            v['reference'] = v['reference'].replace(
                "②不行。异常是给模型的信息,应该包装后回喂,让模型决定重试/换工具/向用户道歉;把内部错误文本直接透出,等于把堆栈暴露给用户。",
                "②不行。异常是给模型的信息,应该包装后回喂,让模型决定重试/换工具/向用户道歉;把内部错误文本直接透出,等于把堆栈暴露给用户。关键协议:模型收到 {'error': ...} 的工具结果时必须走失败说明(「查询失败…」),不能把含 error 的结果拼成成功建议——替身模型里这个分支就是为演示这一点的。")
        print('s6 result protocol patched')
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
