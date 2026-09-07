---
id: doc-python-1
topic: python-backend
title: Python 与 AI 后端基础:学习地图
order: 1
summary: 从数据结构到异步并发,再到 FastAPI 的校验与流式响应——AI 应用后端岗最常被问到的 Python 知识,按"是什么/为什么/怎么用"串成一条线。
---

Python 在 AI 应用开发里的角色很明确:**把模型能力包装成稳定的服务**。这一章沿着"数据结构 → 生成器 → 并发 → Web 框架"的主线展开,每一节都对应题库里的具体题目,读完可以跳到题目里做理解检查。

## 先把容器选对

列表(list)与元组(tuple)的区别是入门必考题,但它的价值不是背结论,而是建立"**可变性决定语义**"的思维:内容会变的集合用列表,位置携带含义的固定结构用元组。元组『元素全部可哈希』时才能当字典键——(1, 2) 可以,([1], 2) 不行(列表不可哈希会拖垮整个元组,本机实测 TypeError),这个因果链要能自己讲出来。扩展一步:namedtuple/dataclass 解决"按位置取值可读性差"的问题,而 Pydantic 是 dataclass 的"校验加强版"——这是 FastAPI 的基石。

→ 对应练习:[PY-001](#/study/PY-001)

## 生成器:惰性是流式时代的核心武器

函数里出现 `yield`,它就变成生成器:调用不执行,取值才执行到下一个 yield 暂停。三句话记住价值:**内存 O(1)、首值快、天然表达流水线**。AI 场景里两处必用:大日志/大文件逐行处理;LLM 逐 token 流式输出——后端拿到的就是模型的生成器,我们再把它逐块推给前端。

理解生成器的"暂停/恢复"执行模型,也是理解 asyncio 的前置:协程本质上是"可暂停的函数",await 就是 yield 的升级版。

→ 对应练习:[PY-002](#/study/PY-002)

## 异步并发:让"等待"互相填空

AI 后端 80% 的时间在等网络:等模型吐 token、等向量库返回、等第三方 API。asyncio 的全部意义就是让这些等待重叠——协程在 await 处让出控制权,事件循环去跑别的任务。要建立三个条件反射:

1. **async 不加速计算**,只重叠等待;CPU 密集走多进程;
2. **一处同步阻塞,全体卡死**——async 函数里禁止 time.sleep / requests,用 asyncio.to_thread 兜底;
3. **并发要有闸门**——Semaphore 限流,gather(return_exceptions=True) 收结果,别把上游打成 429。

→ 对应练习:[PY-003](#/study/PY-003)

## FastAPI:声明式校验 + 流式响应

FastAPI 的两个卖点正好对应两道高频题:

- **参数校验**:Pydantic 模型声明请求体,框架在进入业务函数前完成校验,失败返回 422 与字段级错误明细。你的业务函数永远拿到干净数据——这是"把错误拦在门口"的架构思想。
- **流式响应**:StreamingResponse 包住生成器,配合 SSE 的 `data: ...\n\n` 帧格式实现打字机效果。两个工程坑要心里有数:纯同步段没有 await 时取消不了;nginx 默认缓冲会破坏流式体验。

→ 对应练习:[PY-004](#/study/PY-004)

## 学到什么程度算够

实习/校招应用岗的及格线:能讲清生成器与异步的执行模型、能在 FastAPI 里写出带校验的流式接口、知道 GIL 与线程/进程的分工边界。更深的(事件循环实现、ASGI 规范)属于加分项,别在基础不牢时去啃。
## 基础必学练习组(22 题)

顺序即建议学习顺序(按[学习路径](#/path)的阶段编排,先概念后应用)。每题都有直接答案、大白话与理解检查;第一次学习建议先自己想再看答案。标 🔧 的题在路径练习里可直接运行代码。

1. 🔧 [PY-001](#/study/PY-001) Python 里列表(list)和元组(tuple)有什么区别?什么时候用哪个?
2. 🔧 [PY-042](#/study/PY-042) Python 的 deepcopy 与引用语义:什么时候会踩『改了一个全变了』?
3. 🔧 [PY-044](#/study/PY-044) Python 的切片(slicing)与不可变序列的操作要点?常见错误?
4. 🔧 [PY-041](#/study/PY-041) Python 的字符串格式化:f-string、format、% 的选择与 f-string 的陷阱?
5. 🔧 [PY-033](#/study/PY-033) Python 的可变默认参数陷阱:default mutable argument 为什么危险?正确写法?
6. 🔧 [PY-005](#/study/PY-005) Python 的异常处理怎么写才算规范?AI 后端里 try/except 常见 misuse 有哪些?
7. 🔧 [PY-039](#/study/PY-039) Python 的函数签名设计:参数太多时怎么重构?kwargs 的使用边界?
8. 🔧 [PY-043](#/study/PY-043) Python 的鸭子类型实践:什么时候该显式检查类型(type/isinstance)?
9. 🔧 [PY-002](#/study/PY-002) 什么是生成器(generator)?为什么处理大文件和 LLM 流式输出时要用它?
10. 🔧 [PY-012](#/study/PY-012) 上下文管理器和 with 语句是什么?__enter__/__exit__ 怎么工作?
11. 🔧 [PY-020](#/study/PY-020) Python 类型标注和 mypy 静态检查对 AI 后端项目有什么实际价值?
12. 🔧 [PY-031](#/study/PY-031) Python 的装饰器参数校验和运行时类型检查(Runtime Validation)在边界层怎么做?
13. 🔧 [PY-040](#/study/PY-040) Python 的模块循环依赖怎么避免?架构上的 import 纪律?
14. 🔧 [PY-026](#/study/PY-026) 列表分页用 offset 还是游标(cursor)?深分页的性能问题怎么解?
15. 🔧 [PY-023](#/study/PY-023) 重试库(tenacity)怎么用?比手写重试循环好在哪、坑在哪?
16. 🔧 [PY-011](#/study/PY-011) pytest 单元测试怎么写?fixture、mock 什么时候用?
17. 🔧 [PY-009](#/study/PY-009) 生产环境的日志应该怎么打?LLM 应用的日志和普通服务有什么不同?
18. 🔧 [PY-010](#/study/PY-010) API 密钥和配置应该怎么管理?为什么不能硬编码在代码里?
19. 🔧 [PY-017](#/study/PY-017) Redis 在 AI 后端里最常用的五种用法是什么?各自要注意什么?
20. 🔧 [PY-036](#/study/PY-036) 怎么组织 Python 项目的环境配置与多环境差异(dev/staging/prod)?
21. 🔧 [PY-028](#/study/PY-028) LLM 后端项目的代码分层怎么组织?router/service/repository 的边界怎么划?
22. [PY-032](#/study/PY-032) Python 的上下文管理变量(contextvars)是什么?为什么 FastAPI 的日志要靠它?
