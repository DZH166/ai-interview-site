---
id: doc-ai-series-1
topic:
title: 小林 AI 系列：融合索引
order: 10
summary: 将98个备课选题映射到既有与新增问题，保留题号、学习记录及技术纠错边界。
---

# 小林 AI 系列融合

2026-09-12备课提取，2026-09-13融合。98个参考选题映射到85道站内题，其中新增13题；重合内容按原题号补充。本站使用独立表述，不复制网站面试对话、图片或整篇答案。

资料中的项目经历与性能比例不是用户已验证成果。重点技术结论结合一手资料校正，尚未运行的实验仍是建议。

## Agent

| 参考序号 | 知识点 | 站内入口 | 对照来源 |
|---|---|---|---|
| 1 | Agent与模型 | [AG-001](#/study/AG-001) | [原资料](https://xiaolinnote.com/ai/agent/1_whatisagent.html) |
| 2 | 运行组成 | [AG-013](#/study/AG-013) | [原资料](https://xiaolinnote.com/ai/agent/2_components.html) |
| 3 | 流程与工具 | [AG-001](#/study/AG-001) | [原资料](https://xiaolinnote.com/ai/agent/3_workflow_tools.html) |
| 4 | 执行范式 | [AG-015](#/study/AG-015) | [原资料](https://xiaolinnote.com/ai/agent/4_patterns.html) |
| 5 | ReAct反馈 | [AG-015](#/study/AG-015) | [原资料](https://xiaolinnote.com/ai/agent/5_react.html) |
| 6 | 规划和反思比较 | [AG-015](#/study/AG-015) | [原资料](https://xiaolinnote.com/ai/agent/6_three_patterns.html) |
| 7 | 任务拆分 | [AG-007](#/study/AG-007) | [原资料](https://xiaolinnote.com/ai/agent/7_tasksplit.html) |
| 8 | 记忆职责 | [AG-005](#/study/AG-005) | [原资料](https://xiaolinnote.com/ai/agent/8_memory.html) |
| 9 | 记忆存取 | [AG-023](#/study/AG-023) | [原资料](https://xiaolinnote.com/ai/agent/9_memory_storage.html) |
| 10 | 多Agent | [AG-008](#/study/AG-008) | [原资料](https://xiaolinnote.com/ai/agent/10_multiagent.html) |
| 11 | 单多Agent选型 | [AG-008](#/study/AG-008) | [原资料](https://xiaolinnote.com/ai/agent/11_single_multi.html) |
| 12 | 记忆压缩 | [AG-031](#/study/AG-031) | [原资料](https://xiaolinnote.com/ai/agent/12_memcompress.html) |
| 13 | 框架与自研 | [AG-010](#/study/AG-010) | [原资料](https://xiaolinnote.com/ai/agent/13_handcode.html) |
| 14 | 规划能力 | [AG-007](#/study/AG-007) | [原资料](https://xiaolinnote.com/ai/agent/14_planning.html) |
| 15 | 反思证据 | [AG-016](#/study/AG-016) | [原资料](https://xiaolinnote.com/ai/agent/15_reflection.html) |
| 16 | 协作与交接 | [AG-021](#/study/AG-021) | [原资料](https://xiaolinnote.com/ai/agent/16_collab.html) |
| 17 | 上下文装配 | [AG-050](#/study/AG-050) | [原资料](https://xiaolinnote.com/ai/agent/17_context_engineering.html) |
| 18 | 会话与恢复 | [AG-030](#/study/AG-030) | [原资料](https://xiaolinnote.com/ai/agent/18_session_state.html) |
| 19 | Agent评估 | [AG-012](#/study/AG-012) | [原资料](https://xiaolinnote.com/ai/agent/19_evaluation.html) |
| 20 | 循环稳定性 | [AG-013](#/study/AG-013) | [原资料](https://xiaolinnote.com/ai/agent/20_loop_stability.html) |
| 21 | 链路延迟 | [AG-024](#/study/AG-024) | [原资料](https://xiaolinnote.com/ai/agent/21_agent_latency_trace.html) |
| 22 | 失联与并发写 | [AG-033](#/study/AG-033) | [原资料](https://xiaolinnote.com/ai/agent/22_multi_agent_resilience.html) |
| 23 | 完成声明 | [AG-058](#/study/AG-058) | [原资料](https://xiaolinnote.com/ai/agent/23_task_hallucination.html) |
| 24 | 数据库访问 | [RG-017](#/study/RG-017) | [原资料](https://xiaolinnote.com/ai/agent/24_database_security.html) |

## RAG

| 参考序号 | 知识点 | 站内入口 | 对照来源 |
|---|---|---|---|
| 1 | RAG流程 | [RG-001](#/study/RG-001) | [原资料](https://xiaolinnote.com/ai/rag/1_whatisrag.html) |
| 2 | RAG能力边界 | [RG-001](#/study/RG-001) | [原资料](https://xiaolinnote.com/ai/rag/2_rag_problems.html) |
| 3 | RAG与微调 | [AD-001](#/study/AD-001) | [原资料](https://xiaolinnote.com/ai/rag/3_rag_vs_finetune.html) |
| 4 | 切分与存储 | [RG-002](#/study/RG-002) | [原资料](https://xiaolinnote.com/ai/rag/4_chunking.html) |
| 5 | 语义边界 | [RG-023](#/study/RG-023) | [原资料](https://xiaolinnote.com/ai/rag/5_semantic_cuts.html) |
| 6 | Embedding选型 | [RG-051](#/study/RG-051) | [原资料](https://xiaolinnote.com/ai/rag/6_embedding.html) |
| 7 | 向量表示 | [RG-003](#/study/RG-003) | [原资料](https://xiaolinnote.com/ai/rag/7_embedding_algos.html) |
| 8 | 向量数据库 | [RG-008](#/study/RG-008) | [原资料](https://xiaolinnote.com/ai/rag/8_vectordb.html) |
| 9 | 容量与性能口径 | [RG-008](#/study/RG-008) | [原资料](https://xiaolinnote.com/ai/rag/9_vectordb_practice.html) |
| 10 | 在线链路 | [RG-001](#/study/RG-001) | [原资料](https://xiaolinnote.com/ai/rag/10_online_workflow.html) |
| 11 | 稀疏与稠密检索 | [RG-006](#/study/RG-006) | [原资料](https://xiaolinnote.com/ai/rag/11_retrieval_types.html) |
| 12 | 查询改写 | [RG-007](#/study/RG-007) | [原资料](https://xiaolinnote.com/ai/rag/12_query_rewrite.html) |
| 13 | 多路融合 | [RG-040](#/study/RG-040) | [原资料](https://xiaolinnote.com/ai/rag/13_multi_retrieval.html) |
| 14 | 分阶段优化 | [RG-020](#/study/RG-020) | [原资料](https://xiaolinnote.com/ai/rag/14_retrieval_opt.html) |
| 15 | 复杂RAG | [RG-013](#/study/RG-013) | [原资料](https://xiaolinnote.com/ai/rag/15_advanced_paradigms.html) |
| 16 | 图检索适用性 | [RG-044](#/study/RG-044) | [原资料](https://xiaolinnote.com/ai/rag/16_graph_db.html) |
| 17 | 引用与幻觉 | [RG-011](#/study/RG-011) | [原资料](https://xiaolinnote.com/ai/rag/17_hallucination.html) |
| 18 | 评测分工 | [RG-029](#/study/RG-029)、[RG-009](#/study/RG-009) | [原资料](https://xiaolinnote.com/ai/rag/18_evaluation.html) |
| 19 | 持续更新 | [RG-014](#/study/RG-014) | [原资料](https://xiaolinnote.com/ai/rag/19_dynamic_update.html) |
| 20 | 落地难点 | [RG-004](#/study/RG-004) | [原资料](https://xiaolinnote.com/ai/rag/20_hardest_parts.html) |
| 21 | 知识冲突 | [RG-071](#/study/RG-071) | [原资料](https://xiaolinnote.com/ai/rag/21_knowledge_conflict.html) |

## 工具与协议

| 参考序号 | 知识点 | 站内入口 | 对照来源 |
|---|---|---|---|
| 1 | 工具调用闭环 | [AG-002](#/study/AG-002) | [原资料](https://xiaolinnote.com/ai/tools/1_function_calling.html) |
| 2 | 工具学习 | [LP-046](#/study/LP-046) | [原资料](https://xiaolinnote.com/ai/tools/2_llm_tool_learning.html) |
| 3 | 工具训练评测 | [LP-046](#/study/LP-046) | [原资料](https://xiaolinnote.com/ai/tools/3_fc_training.html) |
| 4 | MCP定位 | [AG-004](#/study/AG-004)、[AG-019](#/study/AG-019) | [原资料](https://xiaolinnote.com/ai/tools/4_what_is_mcp.html) |
| 5 | MCP架构 | [AG-018](#/study/AG-018) | [原资料](https://xiaolinnote.com/ai/tools/5_mcp_components.html) |
| 6 | FC与MCP | [AG-004](#/study/AG-004) | [原资料](https://xiaolinnote.com/ai/tools/6_mcp_vs_fc.html) |
| 7 | 接入选择 | [AG-018](#/study/AG-018) | [原资料](https://xiaolinnote.com/ai/tools/7_fc_vs_mcp_usage.html) |
| 8 | 兼容问题定位 | [AG-018](#/study/AG-018) | [原资料](https://xiaolinnote.com/ai/tools/8_reasoning_no_mcp.html) |
| 9 | Agent Skills | [AG-059](#/study/AG-059) | [原资料](https://xiaolinnote.com/ai/tools/9_skill.html) |
| 10 | Skill与MCP | [AG-059](#/study/AG-059) | [原资料](https://xiaolinnote.com/ai/tools/10_mcp_vs_skill.html) |
| 11 | 三种机制 | [AG-059](#/study/AG-059) | [原资料](https://xiaolinnote.com/ai/tools/11_fc_skill_mcp.html) |
| 12 | A2A协作 | [AG-060](#/study/AG-060) | [原资料](https://xiaolinnote.com/ai/tools/12_a2a_protocol.html) |
| 13 | MCP传输 | [AG-011](#/study/AG-011) | [原资料](https://xiaolinnote.com/ai/tools/13_mcp_transport.html) |
| 14 | 事件流与双向连接 | [LP-005](#/study/LP-005) | [原资料](https://xiaolinnote.com/ai/tools/14_sse_vs_websocket.html) |
| 15 | 实时媒体 | [LP-047](#/study/LP-047) | [原资料](https://xiaolinnote.com/ai/tools/15_webrtc_vs_ws.html) |
| 16 | 模型网关 | [EN-014](#/study/EN-014) | [原资料](https://xiaolinnote.com/ai/tools/16_llm_gateway.html) |
| 17 | 工具路由 | [AG-061](#/study/AG-061) | [原资料](https://xiaolinnote.com/ai/tools/17_tool_routing.html) |
| 18 | 工具故障 | [AG-014](#/study/AG-014) | [原资料](https://xiaolinnote.com/ai/tools/18_tool_reliability.html) |

## 训练、推理与模型工程

| 参考序号 | 知识点 | 站内入口 | 对照来源 |
|---|---|---|---|
| 1 | 模型与NLP分类 | [FD-025](#/study/FD-025) | [原资料](https://xiaolinnote.com/ai/llm/what_is_llm.html) |
| 2 | Transformer结构 | [FD-016](#/study/FD-016) | [原资料](https://xiaolinnote.com/ai/llm/transformer_architecture.html) |
| 3 | 注意力优化层次 | [FD-007](#/study/FD-007) | [原资料](https://xiaolinnote.com/ai/llm/mha_mqa_gqa_flash_attention.html) |
| 4 | 位置信息 | [FD-009](#/study/FD-009) | [原资料](https://xiaolinnote.com/ai/llm/position_encoding.html) |
| 5 | 分词 | [FD-005](#/study/FD-005) | [原资料](https://xiaolinnote.com/ai/llm/tokenizer.html) |
| 6 | 训练配方 | [FD-013](#/study/FD-013) | [原资料](https://xiaolinnote.com/ai/llm/llm_training.html) |
| 7 | 缩放与涌现 | [FD-014](#/study/FD-014)、[FD-017](#/study/FD-017)、[FD-024](#/study/FD-024) | [原资料](https://xiaolinnote.com/ai/llm/scaling_law_emergence.html) |
| 8 | 微调路线 | [AD-001](#/study/AD-001)、[AD-005](#/study/AD-005) | [原资料](https://xiaolinnote.com/ai/llm/finetuning.html) |
| 9 | LoRA形状 | [AD-004](#/study/AD-004)、[AD-001](#/study/AD-001) | [原资料](https://xiaolinnote.com/ai/llm/lora.html) |
| 10 | 后训练范围 | [FD-013](#/study/FD-013)、[AD-008](#/study/AD-008) | [原资料](https://xiaolinnote.com/ai/llm/post_training.html) |
| 11 | DPO与PPO | [AD-003](#/study/AD-003)、[AD-008](#/study/AD-008) | [原资料](https://xiaolinnote.com/ai/llm/dpo_vs_ppo.html) |
| 12 | 解码策略 | [FD-012](#/study/FD-012) | [原资料](https://xiaolinnote.com/ai/llm/decoding_strategies.html) |
| 13 | 采样配置 | [LP-001](#/study/LP-001) | [原资料](https://xiaolinnote.com/ai/llm/temperature_top_p_top_k.html) |
| 14 | 缓存两本账 | [FD-026](#/study/FD-026)、[EN-001](#/study/EN-001) | [原资料](https://xiaolinnote.com/ai/llm/kv_cache_prompt_caching.html) |
| 15 | 量化比较 | [AD-002](#/study/AD-002) | [原资料](https://xiaolinnote.com/ai/llm/quantization.html) |
| 16 | 提示设计 | [LP-006](#/study/LP-006) | [原资料](https://xiaolinnote.com/ai/llm/prompt_engineering.html) |
| 17 | CoT边界 | [LP-018](#/study/LP-018) | [原资料](https://xiaolinnote.com/ai/llm/cot.html) |
| 18 | 幻觉处理 | [FD-002](#/study/FD-002) | [原资料](https://xiaolinnote.com/ai/llm/hallucination.html) |
| 19 | MoE成本 | [FD-010](#/study/FD-010) | [原资料](https://xiaolinnote.com/ai/llm/moe.html) |
| 20 | 推理引擎能力 | [AD-024](#/study/AD-024)、[AD-014](#/study/AD-014)、[AD-011](#/study/AD-011) | [原资料](https://xiaolinnote.com/ai/llm/deployment_frameworks.html) |
| 21 | 能力评估 | [FD-020](#/study/FD-020) | [原资料](https://xiaolinnote.com/ai/llm/evaluation_metrics.html) |
| 22 | 模型选择 | [LP-008](#/study/LP-008) | [原资料](https://xiaolinnote.com/ai/llm/model_selection.html) |
| 23 | 有效上下文 | [FD-028](#/study/FD-028) | [原资料](https://xiaolinnote.com/ai/llm/23_long_context_lost_middle.html) |

## LangChain 与 LangGraph

| 参考序号 | 知识点 | 站内入口 | 对照来源 |
|---|---|---|---|
| 1 | 框架选型 | [AG-010](#/study/AG-010) | [原资料](https://xiaolinnote.com/ai/langchain/agent_frameworks.html) |
| 2 | Runnable与LCEL | [LC-001](#/study/LC-001) | [原资料](https://xiaolinnote.com/ai/langchain/chain.html) |
| 3 | 架构分工 | [LC-001](#/study/LC-001) | [原资料](https://xiaolinnote.com/ai/langchain/langchain_architecture.html) |
| 4 | 创建Agent | [LC-002](#/study/LC-002) | [原资料](https://xiaolinnote.com/ai/langchain/build_agent.html) |
| 5 | 注册工具 | [LC-002](#/study/LC-002) | [原资料](https://xiaolinnote.com/ai/langchain/tool_registration.html) |
| 6 | 框架记忆 | [AG-005](#/study/AG-005)、[AG-023](#/study/AG-023) | [原资料](https://xiaolinnote.com/ai/langchain/memory.html) |
| 7 | LlamaIndex边界 | [AG-010](#/study/AG-010) | [原资料](https://xiaolinnote.com/ai/langchain/langchain_vs_llamaindex.html) |
| 8 | Java生态 | [LC-005](#/study/LC-005) | [原资料](https://xiaolinnote.com/ai/langchain/langchain4j.html) |
| 9 | 编排控制层次 | [AG-022](#/study/AG-022) | [原资料](https://xiaolinnote.com/ai/langchain/langchain_vs_langgraph.html) |
| 10 | 中断与恢复 | [LC-003](#/study/LC-003) | [原资料](https://xiaolinnote.com/ai/langchain/langgraph_advantages.html) |
| 11 | v1迁移 | [LC-004](#/study/LC-004) | [原资料](https://xiaolinnote.com/ai/langchain/version_evolution.html) |
| 12 | 研究流程 | [LC-006](#/study/LC-006) | [原资料](https://xiaolinnote.com/ai/langchain/deep_research.html) |
