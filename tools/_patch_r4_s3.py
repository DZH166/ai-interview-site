# -*- coding: utf-8 -*-
"""阶段1.3:paths.json 阶段3 的对照例子替换为三种收尾的完整可运行代码,
轨迹为 tests/_r13_gather_traces.py 在 Python 3.13.9 的实测输出。"""
import json, pathlib

p = pathlib.Path('data/paths.json')
data = json.loads(p.read_text(encoding='utf-8'))
for path in data['paths']:
    for s in path['stages']:
        if s['id'] != 's3-async-fastapi':
            continue
        s['exercise'] = {
            "name": "迷你练习:b 失败后,a 和 c 的三种结局(本地可运行,无需网络)",
            "code": (
"import asyncio\n"
"\n"
"async def worker(name, delay, fail=False):\n"
"    print(f'[{name}] 开始')\n"
"    try:\n"
"        await asyncio.sleep(delay)\n"
"        if fail:\n"
"            raise RuntimeError(name + ' 失败')\n"
"        print(f'[{name}] 完成')\n"
"        return name\n"
"    except asyncio.CancelledError:\n"
"        print(f'[{name}] 被取消')\n"
"        raise\n"
"\n"
"# 对照1:gather + main 捕获异常 → 兄弟不被取消,继续跑完(孤儿结果被丢弃)\n"
"async def case1():\n"
"    t = asyncio.gather(worker('a', 0.05), worker('b', 0.1, fail=True), worker('c', 0.2))\n"
"    try:\n"
"        await t\n"
"    except RuntimeError as e:\n"
"        print('[main] 捕获:', e)\n"
"    await asyncio.sleep(0.2)   # 证明 a/c 仍在后台跑完\n"
"\n"
"# 对照3:TaskGroup → 首错取消兄弟,异常打包成 ExceptionGroup\n"
"async def case3():\n"
"    try:\n"
"        async with asyncio.TaskGroup() as tg:\n"
"            tg.create_task(worker('a', 0.05))\n"
"            tg.create_task(worker('b', 0.1, fail=True))\n"
"            tg.create_task(worker('c', 0.3))\n"
"    except* RuntimeError as eg:\n"
"        print('[main] ExceptionGroup:', [str(x) for x in eg.exceptions])\n"
"\n"
"async def main():\n"
"    await case1()\n"
"    await case3()\n"
"\n"
"asyncio.run(main())\n"
"\n"
"# 对照2(单独保存为 case2.py):异常逃出 main → asyncio.run 收尾时取消残留\n"
"# async def main():\n"
"#     await asyncio.gather(worker('a', 0.05), worker('b', 0.1, fail=True), worker('c', 0.3))\n"
"# asyncio.run(main())   # RuntimeError 传出,运行器取消 c(轨迹里 c 被取消)\n"),
            "variant": {
                "question": "①b 失败时,a、c 在三种写法下各是什么结局?②『gather 不取消兄弟』等于『脚本里一定后台跑完』吗?③为什么 case2 里 c 被取消了?",
                "reference": "①对照1(gather+捕获):a 完成、c 也完成(没被取消,但 gather 早已抛出,它们的结果被丢弃——孤儿任务);对照3(TaskGroup):c 被取消(打印『被取消』),异常打包成 ExceptionGroup;对照2(异常逃出 main):asyncio.run 的运行器收尾时取消残留任务,c 被取消。②不等于——『不取消兄弟』只描述 gather 自身语义;脚本结束时 asyncio.run 会收尾取消残留任务。真正的『后台跑完』需要 main 自己捕获异常并继续等待(对照1)。③因为 main 没有捕获 RuntimeError,异常穿透到 asyncio.run;运行器退出前会取消事件循环里仍在跑的任务——所以 c 的『被取消』来自运行器收尾,不是 gather。三种收尾的差异:谁在取消(没人/gather 不取消+TaskGroup 取消/运行器收尾),失败后任务『已完成/被取消/仍等待』取决于此。",
                "reason": "实测轨迹(Python 3.13.9,tests/_r13_gather_traces.py):对照1 打印 a 完成→c 完成(b 失败但没人取消它们);对照3 打印 c 被取消+ExceptionGroup;对照2 打印 c 被取消。若在 worker 里用 time.sleep 而不是 asyncio.sleep,事件循环被堵死,取消永远无法送达——对照全部失真。",
                "run": "保存对照1+3 为 gather_demo.py 后 python gather_demo.py;对照2 单独保存 case2.py 运行。全程 asyncio.sleep,仅标准库。"
            }
        }
        print('s3 exercise rewritten')
p.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8', newline='\n')
