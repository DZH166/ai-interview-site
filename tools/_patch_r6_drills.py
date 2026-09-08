# -*- coding: utf-8 -*-
"""阶段1.1:修正阶段1 前两题错误参考答案。
事实依据(本机 Python 3.13.9 实测,tests/behavior-tests.js 固化):
1) t=('a',['x']); t[1] += ['y'] → TypeError('tuple' object does not support item assignment),
   但列表已被原地修改为 ['x','y'](先 list.__iadd__ 成功,再 tuple 槽位赋值失败),print 未执行。
   t += ('b',) 是变量重绑定,产生新元组,不抛 TypeError。
   依据:https://docs.python.org/3/faq/programming.html#why-does-a-tuple-i-item-raise-an-exception-when-the-addition-works
2) count_words(['x','x']):第二次循环 counters.get(w) 返回上次写入的 int(len),
   对 int 调 append → AttributeError: 'int' object has no attribute 'append'。
   不是『逻辑能算对但写法绕』。"""
import json, pathlib

p = pathlib.Path('data/paths.json')
data = json.loads(p.read_text(encoding='utf-8'))
for path in data['paths']:
    for s in path['stages']:
        if s['id'] != 's1-python-core':
            continue
        d0 = s['drills'][0]
        assert 't[1] += ' in d0['q']
        d0['reference'] = (
            "实际运行(Python 3.13.9 实测):抛 TypeError: 'tuple' object does not support item assignment,"
            "**并且 print 不会执行**;但异常前 t 已经变成 ('a', ['x', 'y'])——列表被改了!\n"
            "拆解 t[1] += ['y'] 这一步:①先对 t[1](那个列表)执行原地扩展 __iadd__,成功,列表变成 ['x','y'];"
            "②再把结果赋回 t[1] 槽位——元组槽位不可写,这里抛 TypeError。副作用已经发生,所以异常后列表是新的。"
            "这是 Python 官方 FAQ 专门解释的行为。\n"
            "对照:t += ('b',) 不抛异常——它不修改旧元组,而是构造新元组 ('a', ['x'], 'b') 并重新绑定变量 t。\n"
            "记忆:**元组冻结的是自己的槽位,不冻结槽位里指向的对象**。")
        d0['reason'] = (
            "两方向都会预测错:预测『正常输出新列表』的人以为 += 只碰列表;预测『抛异常且一切不变』的人不知道"
            "异常前原地修改已生效。正确模型:原地修改成功 → 槽位赋值失败 → 异常 + 副作用残留。"
            "与 PY-001 的可哈希讨论同源:含可变元素的元组,可哈希性也靠元素。")

        d1 = s['drills'][1]
        assert 'count_words' in d1['q']
        d1['q'] = (
            "这段函数对不重复的输入『看起来』能工作,但输入重复词会直接崩。找出原因并修复:\n"
            "def count_words(words):\n"
            "    counters = {}\n"
            "    for w in words:\n"
            "        c = counters.get(w, [])\n"
            "        c.append(1)\n"
            "        counters[w] = len(c)\n"
            "    return counters\n"
            "用 count_words(['x', 'x']) 验证你的结论。")
        d1['reference'] = (
            "实测:count_words(['x']) 返回 {'x': 1}(看起来对);count_words(['x', 'x']) 抛 "
            "AttributeError: 'int' object has no attribute 'append'。\n"
            "原因:第一轮 get(w, []) 给新列表,append 后 counters[w] = len(c) 把**整数 1** 写回字典;"
            "第二轮同一个词 get(w, []) 拿到的是**默认值新列表**,append 后写回 len=2——单元素词没问题?"
            "不,真正崩在第二轮:get 拿到的是上次写入的 **int 1**(键已存在,默认值不生效),对 int 调 append → AttributeError。\n"
            "修复(规范):counters[w] = counters.get(w, 0) + 1 —— 计数场景值就是数字,直接累加;\n"
            "或 collections.Counter(words) 一行;若真要用列表累计,则 counters.setdefault(w, []).append(1),"
            "最后取 len——但别把 int 和 list 混在同一个值的类型上。")
        d1['reason'] = (
            "误区:『重复词第二次走默认值 []』——不,键已存在时 get 返回**存储的值**(上次写的 int),默认值只在键不存在时用。"
            "值的类型在循环里发生了变化(list→int),这是自我埋雷。修复后用 ['x','x'] 和 ['a','b','a'] 各跑一遍确认。")
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
print('drills 0/1 corrected')
