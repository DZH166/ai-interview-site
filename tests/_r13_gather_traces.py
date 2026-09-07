# -*- coding: utf-8 -*-
"""阶段1.3 证据:三种收尾对照,全部用 asyncio.sleep,trace 打印开始/完成/失败/取消。
运行:python tests/_r13_gather_traces.py"""
import asyncio, sys
sys.stdout.reconfigure(encoding='utf-8')

async def worker(name, delay, fail=False):
    print(f'[{name}] 开始')
    try:
        await asyncio.sleep(delay)
        if fail:
            raise RuntimeError(name + ' 失败')
        print(f'[{name}] 完成')
        return name
    except asyncio.CancelledError:
        print(f'[{name}] 被取消')
        raise

async def case1_capture_and_wait():
    """对照1:main 捕获异常,继续等待其余任务(gather 默认:异常上抛但兄弟仍在跑)"""
    print('=== 对照1:捕获异常并等待兄弟跑完 ===')
    t = asyncio.gather(worker('a', 0.05), worker('b', 0.1, fail=True), worker('c', 0.2))
    try:
        await t
    except RuntimeError as e:
        print('[main] 捕获:', e, '→ 其他任务仍在后台')
    # 手动等待兄弟跑完(证明它们没被取消)
    await asyncio.sleep(0.2)
    print()

def case2_runner_cleanup():
    """对照2:异常逃出 main → asyncio.run 收尾时取消残留任务。
    注意:asyncio.run 不能嵌套在其他协程里,所以这是普通函数。"""
    print('=== 对照2:异常逃出 main,运行器收尾取消残留 ===')
    async def main():
        await asyncio.gather(worker('a', 0.05), worker('b', 0.1, fail=True), worker('c', 0.3))
    try:
        asyncio.run(main())
    except RuntimeError:
        print('[main] 异常传出 asyncio.run;运行器已取消残留任务(见 c 的取消轨迹)')
    print()

async def case3_taskgroup():
    """对照3:TaskGroup 首错取消兄弟,异常打包"""
    print('=== 对照3:TaskGroup fail-fast ===')
    try:
        async with asyncio.TaskGroup() as tg:
            tg.create_task(worker('a', 0.05))
            tg.create_task(worker('b', 0.1, fail=True))
            tg.create_task(worker('c', 0.3))
    except* RuntimeError as eg:
        print('[main] ExceptionGroup:', [str(x) for x in eg.exceptions])
    print()

async def main():
    await case1_capture_and_wait()
    await case3_taskgroup()

asyncio.run(main())
case2_runner_cleanup()
