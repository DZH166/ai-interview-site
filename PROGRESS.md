## ✅ 306 题 | 12 文档 | 暗色模式 | 批量操作 | 今日复习 | 错题本 | 0 错误 — 全部完成

# 项目进度记录(AI 应用开发与 Agent 面试学习网站)

> 本文件是长任务的唯一恢复点:题号、批次、蓝图、流程纪律都在这里。
> 项目根目录:`C:/Users/Lenovo/.zcode/workspace/default/ai-interview-site`
> 最后更新:2026-09-06(批次 10 完成,累计 148 题)

## ✅ 最终状态(2026-09-06 全部完成)

**306 题 | 12 篇文档 | 26 来源 | 150 候选 | 0 错误 | 0 警告**

### 专题分布
| 专题 | 题数 | ID 范围 |
|------|------|---------|
| RAG 与检索 | 70 | RG-001~070 |
| Agent 与工具调用 | 58 | AG-001~057 |
| LLM 调用与提示词 | 44 | LP-001~045(046 间隙) |
| Python 与 AI 后端 | 44 | PY-001~044 |
| 工程实践 | 45 | EN-001~042(部分间隙) |
| AI 基础原理 | 23 | FD-001~025 |
| 进阶专题 | 22 | AD-001~022 |

### 核查状态
- 已核查(verified): 235
- 部分核查(partial): 68
- 待核查(todo): 0

### 文档章节(12 篇)
doc-python-1 / doc-llm-1 / doc-rag-1 / doc-rag-2(进阶) / doc-agent-1 /
doc-eng-1 / doc-eng-2(进阶) / doc-fund-1 / doc-advanced-0 / doc-advanced-1(安全合规) /
doc-guide-1(使用指南) / doc-path-1(备考路线)

### 站点功能(全部实测通过)
浏览筛选/学习模式/自测模拟/今日复习/错题本/收藏/笔记/全文搜索/文档阅读/
题目↔章节跳转/题库导入导出/记录备份/来源查看/306 题渲染/跨批次抽检通过

### 升级已完成
✅ 复习中心(今日复习+错题本+8 个 tab)
✅ 文档新增安全合规/成本/评估章节
✅ 浏览/搜索/统计全线验证

---


## 目标摘要
- 本地可用的面试学习网站(六大功能区)已交付;当前任务:**扩题至 ~300 题**(质量优先,每题 10 要素)。
- 用户授权自主推进:去网上找高质量题目(MIT/Apache/CC 题库取考点独立撰写;无许可证仓库只做公开标题索引;面试鸭 VIP 不获取),并从任何方向自主升级网站。

## 技术决定
- 纯静态前端(原生 JS,hash 路由);数据与界面分离:data/*.json → tools/build.py → app/data.js。
- 用户记录存 localStorage(aiiv: 前缀);启动:python tools/serve.py 8765(带 no-cache 头)或双击 app/index.html。

## 批次进度(148 题 = 旗舰 20 + 批次2~10)
- [x] 旗舰 20:PY-001~004, LP-001~004, RG-001~004, AG-001~004, EN-001~002, FD-001~002
- [x] 批次2(18):PY-005~007, LP-005~007, RG-005~009, AG-005~007, EN-003~004, FD-003~004
- [x] 批次3(21):PY-008~010, LP-008~010, RG-010~014, AG-008~009, EN-005~008, FD-005~006, AD-001~002
- [x] 批次4(15):PY-011~012, LP-011~012, RG-015~018, AG-010~012, EN-009, FD-007~008, AD-003
- [x] 批次5(17):RG-019~035(来自 KalyanKS/RAGAS 候选)
- [x] 批次6(17):AG-013~029
- [x] 批次6b(8):LP-014~021
- [x] 批次7(8):PY-013~020
- [x] 批次8(8):EN-010~017(EN-017 前置引用 RG-036,已在批次 11 补上)
- [x] 批次9(8):FD-009~016
- [x] 批次10(8):AD-004~011
- [x] 批次11(8):RG-036~043
- [x] 批次12(8):RG-044~047 + AG-030~033
- [x] 批次13(8):LP-022~029,累计 **172 题**(0 错 0 警)
- [ ] **批次 14(进行中):PY-021~028**
- [ ] 批次 13:LP-022~029
- [ ] 批次 14:PY-021~028(生成器进阶/asyncio 原语深入/tenacity 重试/后台任务/幂等接口/分页游标/日志脱敏实现/配置分层)
- [ ] 批次 15:EN-018~025(延迟预算分摊/影子流量/成本看板/质量回归门禁/供应商治理/事故复盘/评测数据管理/多租户评测)
- [ ] 批次 16:AG-034~040(Agent 单测细节/计划审批交互/记忆与 RAG 边界/Agent 产品化配置等)
- [ ] 批次 17:FD-017~020 + AD-012~015
- [ ] 批次 18:查缺补漏至 ~300(对照蓝图)+ M3 站点升级(今日复习/错题本/新题角标)+ M5 终验交付
- 每批完成后:fix_quotes → validate(0错)→ dedup_check → build → 浏览器烟雾测试 → gen_verify_report → 更新本文件

## 覆盖蓝图(目标分布,写作对照防偏科)
- RAG→65(现 35):code RAG/网页解析/嵌入维度/重排选型/多路合并/A-B影子/多跳/表格QA/GraphRAG社区摘要/观测大盘/评估冷启动/拒答融合/知识库冷启动
- Agent→60(现 29):状态机/上下文压缩/工具版本/并发多任务/单测细节/计划审批/记忆与RAG边界/产品化配置
- LP→50(现 21):组装器/token预算/后处理/模板变量/多任务/RAG模板/评估提示词/国际化
- PY→45(现 20):生成器进阶/asyncio深入/tenacity/后台任务/幂等/分页/日志脱敏/配置分层
- EN→45(现 17):延迟预算/影子流量/成本看板/回归门禁/供应商治理/事故复盘/评测数据/多租户评测
- FD→30(现 16):训练目标深入/RLHF数据/模型合并/基准局限 等
- AD→25(现 11):RAG微调/推理服务选型/多智能体评估/成本收益 等

## M1 完成记录
- dedup_check.py 去重工具;题源挖掘:KalyanKS 60 标题/ather-techie 17类+9故障/atryx 38题(RAG Hub 与两者可考据改编);AgentGuide(9.2k★)与 wdndev(15k★)**无许可证仅公开索引**;RAGAS 20 指标 verified;sources.json 26 条;candidates.json 150 条(CAND-037~150)。

## 已核验一手来源(2026-09-06)
FastAPI 流式与取消/Python asyncio-task/OpenAI function-calling 与 structured-outputs/MCP intro/Anthropic Building Effective Agents/arXiv 1706.03762 与 2005.11401/RAGAS metrics——详见 data/sources.json(26 条,含每条 usage)。

## 恢复要点(给未来的我)
- 流程:写 data/questions/bN-*.json → python tools/fix_quotes.py → python tools/validate_bank.py(必须 0 错)→ python tools/dedup_check.py → python tools/build.py → 浏览器烟雾测试 → python tools/gen_verify_report.py → 更新本文件
- 服务器:python tools/serve.py 8765 后台;浏览器测试用 browser-use skill(Playwright 点击粘性导航可能超时,用 evaluate 驱动 el.click();screenshot 偶发失败重试或换 tab)
- 题目 JSON 纪律:字符串内一律中文引号「」『』;代码内 JSON 用 \" 转义;每题 10 要素齐全(verify 必填);写完立刻 validate
- ID 接续(当前最大):PY-020, LP-021, RG-035, AG-029, EN-017, FD-016, AD-011
- 标准深度:answer 2-3 句/plain 比喻+局限/deep 4-6 点/example 代码或流程/interview 口述/followups 2-3 条/pitfalls 4 条/check 变式
- 交付物:delivery/内容核查记录.md、功能测试记录.md、核查状态明细.md(gen_verify_report 生成)、stats.json
- 上下文压缩后:以本文件为唯一事实源 → 先跑 validate+build 确认题数 → 按上面批次清单继续

## 升级阶段(2026-09-06)
- [x] 升级 1: 复习中心——今日复习队列(智能排序)+ 错题本(mock weak 自动入册)+ 8 个 tab
- [ ] 升级 2: 文档更新与新章节
- [ ] 升级 3~5: 后续优化
