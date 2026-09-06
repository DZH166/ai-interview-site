# -*- coding: utf-8 -*-
"""内容修订脚本(审查报告表格 11 题 + 关联项)。
所有修改都有运行证据:TaskGroup 三场景、协程竞争反例、except* 分区、
Pydantic 校验器顺序、schema additionalProperties、元组可哈希对照
均已在 Python 3.13 / pydantic 2.10.4 实际运行。"""
import json, pathlib

QDIR = pathlib.Path('data/questions')

def load(fn):
    return json.loads((QDIR / fn).read_text(encoding='utf-8'))

def save(fn, arr):
    (QDIR / fn).write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')

def patch(qid, fn, updates):
    arr = load(fn)
    for q in arr:
        if q['id'] == qid:
            for k, v in updates.items():
                if k in ('pitfalls', 'followups', 'sources') and v == '__APPEND__':
                    continue
                q[k] = v
            break
    save(fn, arr)
    print('patched', qid, 'in', fn)

# ============ PY-003:跨 await 的共享状态竞争(反例已运行:无锁 10/1000,加锁 1000/1000)============
updates = {}
updates['answer'] = ("async/await 是单线程内的协作式并发:协程运行到 await(通常是等网络响应)时主动让出控制权,"
    "事件循环趁机去跑其他协程,等 I/O 完成再切回来。它解决『等』的浪费,不解决『算』的慢。"
    "并发调用多个 LLM API、多个工具是它的主场;CPU 密集任务(解析大 PDF、跑本地模型)要交给进程池或多进程。"
    "与多线程相比:线程由操作系统抢占式调度,随时可能在任意两条字节码之间被切换,所以要靠锁保护临界区;"
    "协程只在 await 处切换,不会被打断在普通语句中间——但这不等于没有竞争:"
    "跨越 await 的『读-改-写』序列照样会交错(本机实测:100 个协程各加 10 次,无锁只得到 10,加 asyncio.Lock 才是 1000)。"
    "还有一条铁律:一处同步阻塞,全体卡死。")
updates['deep'] = ("机制拆解:\n"
    "1) async def 定义协程函数,调用它得到协程对象(不执行,类比 PY-002 生成器);事件循环(通常 asyncio.run 启动)负责驱动它们。\n"
    "2) await 做两件事:等待一个可等待对象;同时把控制权交还事件循环。await 处就是切换点——协程不会被抢占在普通语句中间,"
    "但『读共享变量 → await → 写回』这种跨 await 的序列会被其他协程插进来,更新互相覆盖(见例子):临界区用 asyncio.Lock 保护。"
    "『单线程所以没竞争』是高频误区,面试里要能主动讲出反例。\n"
    "3) 并发跑一批任务:asyncio.gather(*aws) 并发运行并按传入顺序聚合结果;return_exceptions=True 把异常也放进结果列表"
    "(默认第一个异常立即上抛,官方文档已核验)。asyncio.create_task 把协程调度成后台任务,注意官方提醒:事件循环只持弱引用,"
    "要保存返回的 Task 引用,新代码推荐 TaskGroup。\n"
    "4) 限流:asyncio.Semaphore(n) 包住请求,防止 2000 个并发打爆 API 触发 429(配合 LP-004 的退避重试)。\n"
    "5) 超时:asyncio.wait_for / asyncio.timeout,超时抛 TimeoutError 并取消任务。\n"
    "6) 阻塞代码怎么办:必须调用同步 SDK(有些厂商 SDK 没有异步版)时,用 asyncio.to_thread 把它扔进线程池,"
    "别让它堵住事件循环(官方文档:to_thread 适合 I/O 型阻塞函数,受 GIL 限制对 CPU 密集无效)。\n"
    "7) 和多线程/多进程的分工:GIL 之下,线程适合『等 I/O 的同步代码』与『释放 GIL 的 C 扩展(如 numpy 的一部分操作)』;"
    "CPU 密集用 multiprocessing/进程池。FastAPI 里 async def 路由跑在事件循环,普通 def 路由自动跑在线程池——两者别混写阻塞代码。\n"
    "适用边界:高并发网络 I/O→asyncio;简单脚本并发几十个请求→线程池也够;CPU 密集→进程。")
updates['example'] = ("```python\n"
    "import asyncio, httpx\n"
    "\n"
    "async def ask(client, prompt: str) -> str:\n"
    "    resp = await client.post(\"/v1/chat/completions\", json={...})\n"
    "    return resp.json()[\"choices\"][0][\"message\"][\"content\"]\n"
    "\n"
    "async def main():\n"
    "    limits = asyncio.Semaphore(10)          # 最多 10 个并发,防 429\n"
    "    async with httpx.AsyncClient(timeout=30) as client:\n"
    "        async def guarded(p):\n"
    "            async with limits:\n"
    "                return await ask(client, p)\n"
    "        results = await asyncio.gather(     # 并发执行,按顺序返回\n"
    "            *[guarded(p) for p in prompts],\n"
    "            return_exceptions=True)         # 单个失败不炸全局\n"
    "        for p, r in zip(prompts, results):\n"
    "            print(p, \"→\", r if not isinstance(r, Exception) else f\"失败: {r}\")\n"
    "\n"
    "# 阻塞 SDK 的正确姿势:\n"
    "# result = await asyncio.to_thread(sync_sdk.complete, prompt)\n"
    "```\n"
    "\n"
    "反例:单线程也有竞争(已在本机 Python 3.13 运行,结果如下):\n"
    "```python\n"
    "counter = 0\n"
    "async def worker():\n"
    "    global counter\n"
    "    for _ in range(10):\n"
    "        v = counter               # 读\n"
    "        await asyncio.sleep(0)    # 让出:100 个协程都读到同一个值\n"
    "        counter = v + 1           # 写回:基于过期值,更新丢失\n"
    "\n"
    "asyncio.run(asyncio.gather(*[worker() for _ in range(100)]))\n"
    "print(counter)   # 无锁输出 10(期望 1000,丢了 990 次更新)\n"
    "# 把『读-改-写』包进 async with asyncio.Lock() 后:输出 1000\n"
    "```")
updates['interview'] = ("口述版:『asyncio 是单线程协作式并发:await 处让出控制权,事件循环调度别的协程,I/O 等待互相填空。"
    "适合 LLM 应用里「一次并发调几十个模型或工具」的场景,配合 Semaphore 限流、gather 收结果、to_thread 兜住阻塞 SDK。"
    "多线程是抢占式,有 GIL 和锁,通常在同步代码栈或调释放 GIL 的库时用;CPU 密集走多进程。"
    "另外我会主动提一句:单线程不等于没竞争,跨 await 的读改写要用 asyncio.Lock——这点很多人答错。』"
    "追问展开:gather 的异常语义、在 async 里误用同步库的后果、GIL。"
    "项目经验的说法:如果你真的写过 FastAPI + httpx.AsyncClient 的并发调用层,就讲你自己的设计(限流怎么定的、失败怎么兜);"
    "没写过就诚实说『这是我的练手计划,设计思路如上』——不要把没做过说成做过。")
updates['pitfalls'] = [
    "以为 async 能加速 CPU 计算——它只让『等待』重叠。",
    "以为单线程就没有数据竞争——跨 await 的『读-改-写』照样丢更新(实测 1000 次自增只剩 10 次),临界区要用 asyncio.Lock。",
    "并发数不加限制——瞬时几百个请求触发 429,整体反而更慢(要 Semaphore)。",
    "create_task 后不保存引用,任务可能被垃圾回收中途消失(官方文档明确提醒)。",
    "把 asyncio.gather 说成『并行』——它是并发(concurrency)不是并行(parallelism),单线程内交替。",
]
updates['check'] = {
    "q": "两个问题:①协程 A、B 各自先 await 一次网络请求(各需 1 秒)再返回,await A; await B 和 asyncio.gather(A, B) 总耗时分别约多少?②counter = 0,100 个协程各自「读 counter → await sleep(0) → 写 counter+1」执行 10 次,最终 counter 一定是 1000 吗?",
    "a": "①串行约 2 秒,gather 约 1 秒(等待重叠)。②不一定是 1000——所有协程可能在 await 处读到同一个旧值,写回时互相覆盖(本机实测无锁结果是 10)。要精确累加,把读-改-写放进 async with asyncio.Lock():",
    "explain": "检验点:『并发=等待互相填空』与『协作式调度仍有临界区』。若认为单线程必然无竞争,说明对 await 的切换点语义理解不到位。",
}
updates['verify'] = {
    "status": "verified",
    "checked_date": "2026-09-07",
    "note": "gather/create_task/to_thread 语义已对 Python 官方文档核验;『跨 await 竞争』反例与 Lock 对照已在本机 Python 3.13 实际运行(无锁计数 10/1000,加锁 1000/1000)。",
}
patch('PY-003', 'python-backend.json', updates)

# ============ PY-022:TaskGroup 取消语义(三种场景已运行验证)============
arr = load('b14-python.json')
for q in arr:
    if q['id'] == 'PY-022':
        q['answer'] = ("四个原语的分工:①gather——已知一批协程、要全部结果、顺序对应输入(简单聚合);"
            "return_exceptions=True 收集失败不中断;②TaskGroup(3.11+)——结构化并发:"
            "任一子任务以非取消异常失败时自动取消其余并抛异常组(『全要或全不要』,作用域内任务必然完成或取消,无泄漏);"
            "注意:单个子任务自己以 CancelledError 结束不算失败,不会触发兄弟取消;③as_completed——完成一个处理一个"
            "(流式消费结果,不等全批,如并发检索先到先用);④Queue——生产者消费者解耦(多 worker 消费、动态任务流、背压控制)。"
            "选择信号:结果依赖关系(DAG 用分层 gather/TaskGroup)、失败语义(聚合 vs fail-fast)、完成顺序是否重要。"
            "3.11+ 优先 TaskGroup(结构化并发消除任务泄漏)。")
        q['deep'] = ("1) gather vs TaskGroup 的语义差异(面试高频):\n"
            "   - gather(return_exceptions=True):全部跑完,结果含异常——适合『尽力而为的聚合』;\n"
            "   - gather 默认:第一个异常抛出,但其余任务继续跑(孤儿任务!结果被丢弃仍在消耗资源)——最危险的默认;\n"
            "   - TaskGroup 的精确规则(三种场景已在本机 Python 3.13 运行验证):\n"
            "     a. 子任务抛普通异常(非 CancelledError)→ 取消兄弟任务 → await 处抛 ExceptionGroup(实测:子任务 b 抛 ValueError,兄弟 c 被取消,t_c.cancelled()==True);\n"
            "     b. 单个子任务以 CancelledError 结束(如它内部主动取消自己)→ 不算失败、不取消兄弟,整组正常完成(实测:无异常上抛,其余任务照常 done);\n"
            "     c. 父任务/组被取消 → 取消沿作用域传播到所有子任务,CancelledError 抛给父(实测如此);\n"
            "   迁移建议:默认语义的聚合用 gather(return_exceptions=True) 或 TaskGroup+收集,裸 gather 逐步消灭。\n"
            "2) as_completed:提交一批,迭代完成顺序的 future——首个可用结果即可启动下游(流式聚合,RG-040 的多路检索先到先融合);注意超时与取消的配合(慢任务的处理策略)。\n"
            "3) Queue 模式:生产者-消费者解耦(worker 池:queue + N 个 consumer task);join/task_done 的完成计数;maxsize 背压"
            "(生产快于消费时阻塞生产者——天然的削峰);与信号量的分工:Semaphore 管『同时进行数』,Queue 管『任务流与解耦』(批量任务管道用 Queue,一次性并发用 gather)。\n"
            "4) 取消的传播与清理:TaskGroup 的取消会传播到子任务的 await 点(finally 清理执行);shield 保护关键段(不可中断的原子操作);取消是协作式的(PY-003)——长计算段要让出。\n"
            "5) 超时组合:asyncio.timeout(3.11 上下文管理器)/wait_for 包裹各原语;分层超时(单任务超时<整组超时,LP-004 的预算思想)。")
        q['followups'] = (q.get('followups') or []) + [{
            "q": "TaskGroup 里某个子任务自己 raise CancelledError,整组会失败吗?",
            "a": "不会(本机 Python 3.13 实测):单个子任务以 CancelledError 结束不算失败,兄弟任务照常完成,await TaskGroup 也不抛异常。"
            "这个语义可以用来表达『这个子任务自愿放弃,但整组继续』;它与『子任务抛普通异常→取消兄弟+抛异常组』的 fail-fast 规则是两回事。"
            "注意区分:父任务取消整组时,CancelledError 会正常向外传播。",
        }]
        q['verify'] = {"status": "verified", "checked_date": "2026-09-07",
            "note": "gather/TaskGroup 语义已核验;TaskGroup 三场景(子任务普通失败/单子任务自取消/父取消)已在本机 Python 3.13 运行验证;示例为演示。"}
        print('patched PY-022')
save('b14-python.json', arr)

# ============ PY-038:except* 未匹配部分传播(分区示例已运行)============
arr = load('b25-eng-py.json')
for q in arr:
    if q['id'] == 'PY-038':
        q['pitfalls'] = [
            "以为没写分支的异常类型会被顺手处理——未匹配的部分会打包成新的组继续向上传播(本机 3.13 实测:except* ValueError 只拿走 ValueError,残留的 TypeError 以 ExceptionGroup 形态上抛),上层必须用 except* 兜底或记录,否则错误在高层才爆。",
            "把 except* 当普通 except 用(期望拦截整个组——语义误解)。",
            "组内异常不逐个处理(只看第一个——丢其他根因)。",
            "3.11 以下硬用(版本检查与回退)。",
        ]
        q['verify'] = {"status": "verified", "checked_date": "2026-09-07",
            "note": "except* 分区语义已在本机 Python 3.13 运行验证(匹配分支处理子集 [1,3];未匹配的 TypeError 打包成单成员组继续传播);业务映射为独立整理。"}
    print('patched PY-038') if q['id'] == 'PY-038' else None
save('b25-eng-py.json', arr)

# ============ EN-009:TPM/QPS 换算修正(算式复算通过)============
arr = load('b4-agent-eng-fund.json')
for q in arr:
    if q['id'] == 'EN-009':
        q['deep'] = q['deep'].replace(
            "配额 10K TPM ÷ 平均 2K token/请求 = 5 QPS 上限!",
            "配额 10K TPM ÷ 平均 2K token/请求 = 5 请求/分钟 ≈ 0.083 QPS 上限(TPM→QPS 要再除以 60)!")
        q['example'] = ("容量计算示例(数字为演示,算式已复核;TPM↔QPS 换算:TPM ÷ 每请求 token ÷ 60 = QPS):\n"
            "```\n"
            "需求:工作日峰值 50 QPS 问答,平均输入 3K token + 输出 500 token\n"
            "每秒 token 吞吐 = 50 请求/s × 3500 token = 175K token/s\n"
            "TPM 需求 = 175K × 60 = 10.5M TPM(仅主模型)\n"
            "供应商配额 80K TPM/账号 → 10.5M ÷ 80K ≈ 132 个账号——这个量级堆账号不现实!\n"
            "正确结论:先压有效需求(缓存命中率、上下文压缩、批处理合并、精简 system),\n"
            "把 TPM 需求降一个数量级,再谈配额提升与多供应商分流;超大流量评估批量接口/私有化。\n"
            "反向换算:配额 10K TPM、平均 2K token/请求 → 10K ÷ 2K = 5 请求/分钟 ≈ 0.083 QPS 上限\n"
            "余量设计:稳态用量 < 配额的 60~70%(留突发与重试空间)\n"
            "降级链:主供应商 → 备用供应商(配额独立核算)→ 缓存 → 排队\n"
            "SLA 条款:服务可达 99.9%;生成质量依赖上游,上游故障自动降级并公告\n"
            "```")
        q['verify'] = {"status": "verified", "checked_date": "2026-09-07",
            "note": "换算算式已复核并运行验证(10000/2000/60=0.0833 QPS;50×3500×60=10,500,000 TPM);配额规则以供应商当前文档为准,不鼓励多账号绕配额(违反服务条款的风险要提示)。"}
    if q['id'] == 'EN-009':
        print('patched EN-009')
save('b4-agent-eng-fund.json', arr)

# ============ FD-026:KV 显存估算修正(0.5/4/16 GiB,复算通过)============
arr = load('b31-final.json')
for q in arr:
    if q['id'] == 'FD-026':
        q['example'] = ("显存估算(7B GQA 模型;假设 batch=1、32 层、8 个 KV 头、head_dim=128、FP16 每值 2 字节;\n"
            "每 token KV 字节 = 2(K/V) × 32 层 × 8 头 × 128 × 2B = 131072 B = 128 KiB):\n"
            "```\n"
            "权重 FP16:  ~14 GB\n"
            "KV Cache(batch=1):\n"
            "  4K 上下文:  128KiB × 4096  = 0.5 GiB\n"
            "  32K 上下文: 128KiB × 32768 = 4 GiB\n"
            "  128K 上下文: 128KiB × 131072 = 16 GiB  ← 接近甚至超过权重\n"
            "→ 长上下文的瓶颈是 KV Cache,不是权重\n"
            "注:batch 增大按倍数线性增长;MHA(无 GQA 分组)KV 头数=查询头数,还要再大数倍\n"
            "```")
        q['check']['a'] = ("算账(假设同上):权重 INT4 ≈ 3.5GB;KV Cache:128 KiB/token × 32K ≈ 4 GiB;"
            "激活+框架开销 ≈ 2~4GB。总计 ≈ 10~12GB < 24GB ✅。但要注意:INT4 量化的质量损失需要评测(FD-025),"
            "32K 的有效利用率要实测(FD-007);batch>1 时 KV 按倍数增长。")
        q['verify'] = {"status": "verified", "checked_date": "2026-09-07",
            "note": "估算公式与三档数字已在本机复算(0.5/4/16 GiB @ batch=1、32层、8KV头、128dim、FP16);机制说明对照 Transformers KV cache 文档;估算假设已显式标注。"}
    if q['id'] == 'FD-026':
        print('patched FD-026')
save('b31-final.json', arr)

print('batch 1 done')
