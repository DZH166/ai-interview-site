# -*- coding: utf-8 -*-
"""项目B:流式响应与取消(本地可运行,fake 流)
观察:chunk 边界 / chunk≠token / 取消发生在 await 点 / finally 资源清理。
运行:python projects/proj_b/stream_demo.py
"""
from __future__ import annotations
import asyncio
import time

# ---------- 同步生成器版:逐块输出(非流式语义的对照) ----------
def stream_sync(text: str, size: int = 7):
    """把一段『模型的完整回答』切成 chunk 逐个 yield。
    注意:这里的 chunk 是我们切的,与模型的 token 不是一回事。"""
    consumed = 0
    try:
        for i in range(0, len(text), size):
            chunk = text[i:i + size]
            consumed += len(chunk)
            time.sleep(0.02)          # 模拟网络/生成的间隔(同步阻塞!)
            yield chunk
    finally:
        print(f"  [同步] 清理执行:已输出 {consumed} 字符(即使中途停止也会执行)")

# ---------- 异步版:真流式 + 取消传播(PY-004 的取消语义) ----------
async def stream_async(text: str, size: int = 7):
    consumed = 0
    try:
        for i in range(0, len(text), size):
            await asyncio.sleep(0.03)          # 取消只在这里(aWAIT 点)生效
            chunk = text[i:i + size]
            consumed += len(chunk)
            yield chunk
    except asyncio.CancelledError:
        print(f"  [异步] 感知取消(在 await 点),已输出 {consumed} 字符")
        raise                                   # 取消必须继续传播
    finally:
        print(f"  [异步] 清理执行:资源已释放(已输出 {consumed} 字符)")

async def consume_with_cancel(gen, cancel_after: float):
    task = asyncio.ensure_future(_drain(gen))
    await asyncio.sleep(cancel_after)
    task.cancel()
    try:
        await task
    except asyncio.CancelledError:
        print(f"  [消费者] {cancel_after}s 后主动取消")

async def _drain(gen):
    n = 0
    async for chunk in gen:
        n += len(chunk)
        print(f"    收到: {chunk}")
    print(f"  [消费者] 流自然结束,共 {n} 字符")

def main():
    answer = "流式输出的本质是生成器:模型每生成一段就推送一块,前端逐块渲染。"
    print("== 项目B:流式响应与取消 ==\n")

    print("--- 场景1:同步生成器,自然结束 ---")
    for chunk in stream_sync(answer):
        print(f"    收到: {chunk}")

    print("\n--- 场景2:异步流,自然结束 ---")
    asyncio.run(_drain(stream_async(answer)))

    print("\n--- 场景3:异步流,中途取消(0.08s) ---")
    asyncio.run(consume_with_cancel(stream_async(answer), cancel_after=0.08))

    print("\n体会:")
    print("1) chunk 是我们切的块,与模型的 token 不是一回事——chunk 数≠token 数。")
    print("2) 同步阻塞(time.sleep)期间取消信号无法送达;asyncio.sleep 的 await 点才会。")
    print("3) finally/except CancelledError 是清理的唯一可靠位置——对应 PY-004 的取消语义。")

if __name__ == "__main__":
    main()
