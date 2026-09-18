# -*- coding: utf-8 -*-
"""根据简历内容和题库匹配结果,生成 data/resume-profile.json"""
import json, io
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
raw = json.loads(Path(ROOT / 'delivery' / 'resume-match-raw.json').read_text(encoding='utf-8'))

def ids(area):
    return [m['id'] for m in raw.get(area, [])]

profile = {
  "version": 1,
  "name": "董照红",
  "role": "AI Agent / 大模型应用开发实习生",
  "updated": "2026-09-19",
  "sections": [
    {
      "id": "proj-codewright",
      "name": "Codewright Agent",
      "subtitle": "从零实现的终端 AI 编程助手",
      "type": "project",
      "techTags": ["Python", "ReAct", "MCP", "Multi-Agent", "SWE-bench"],
      "description": "从零实现的轻量级 Coding Agent,不依赖现成框架,由 ReAct 驱动 LLM 自主完成代码检索、文件编辑、命令执行与错误修复。五层架构:交互/引擎/工具/记忆/安全。",
      "groups": [
        {
          "name": "Agent Loop 与 ReAct 范式",
          "resumePoint": "实现流式多轮决策、工具结果回灌、JSON Schema 校验、停止条件与 max_steps 兜底",
          "questionIds": ids('agent_loop')[:15],
          "mustKnow": True
        },
        {
          "name": "上下文与记忆管理",
          "resumePoint": "设计工具结果 Token 预算与两层渐进式压缩,支撑 8 小时以上连续会话;JSONL 持久化与跨会话记忆",
          "questionIds": ids('agent_memory')[:10],
          "mustKnow": True
        },
        {
          "name": "MCP 扩展与工具描述优化",
          "resumePoint": "实现工具描述延迟加载,百级工具场景 Token 占用降低 85%;Slash Command、Skill、Hook 扩展",
          "questionIds": ids('agent_mcp')[:8],
          "mustKnow": True
        },
        {
          "name": "安全与权限设计",
          "resumePoint": "五层权限确认与审计机制,权限弹窗 30→5 次;Git Worktree 隔离多 Agent",
          "questionIds": ids('agent_security')[:10],
          "mustKnow": True
        },
        {
          "name": "Agent 评测体系",
          "resumePoint": "构建 SWE-bench-Live 20 题子集与上下文保留用例;信息保留率 17%→100%",
          "questionIds": ids('agent_eval')[:5],
          "mustKnow": False
        },
        {
          "name": "多 Agent 协作",
          "resumePoint": "Git Worktree 隔离多 Agent 并行修改",
          "questionIds": ids('agent_multi')[:8],
          "mustKnow": False
        },
        {
          "name": "失败恢复与错误修复",
          "resumePoint": "Agent 在多步执行中失败怎么办",
          "questionIds": ids('agent_fail')[:3],
          "mustKnow": True
        }
      ]
    },
    {
      "id": "proj-suzhi",
      "name": "溯知 RAG 知识库引擎",
      "subtitle": "可追溯 RAG 知识库引擎",
      "type": "project",
      "techTags": ["Python", "FastAPI", "BGE", "FAISS", "BM25", "RRF"],
      "description": "分层架构 FastAPI 服务,支持异构文档解析(含 OCR)、混合检索(BGE+FAISS / Jieba+BM25 / RRF)、置信度拒答与章节页码溯源、版本化索引热切换。",
      "groups": [
        {
          "name": "文档切块与滑窗策略",
          "resumePoint": "结构化层级分块与滑窗重叠(Overlap)策略",
          "questionIds": ids('rag_chunk')[:15],
          "mustKnow": True
        },
        {
          "name": "混合检索链路(BGE+FAISS / Jieba+BM25 / RRF)",
          "resumePoint": "结合语义向量召回与关键词召回,经 RRF 倒数排名融合重排",
          "questionIds": ids('rag_hybrid')[:10] + ids('rag_vector')[:15],
          "mustKnow": True
        },
        {
          "name": "精准溯源与置信度拒答",
          "resumePoint": "设置置信度阈值实现低相关主动拒答,响应带文档名、章节及页码溯源",
          "questionIds": ids('rag_source')[:8],
          "mustKnow": True
        },
        {
          "name": "重排优化",
          "resumePoint": "RRF 倒数排名融合重排,提升专业术语检索召回率",
          "questionIds": ids('rag_rerank')[:8],
          "mustKnow": True
        },
        {
          "name": "异构文档解析与 OCR",
          "resumePoint": "支持 Markdown、TXT、PDF、DOCX 及扫描图本地 OCR 提取",
          "questionIds": ids('rag_doc')[:3],
          "mustKnow": False
        },
        {
          "name": "RAG 评测与质量监控",
          "resumePoint": "评测集冷启动、检索质量漂移监控",
          "questionIds": ids('rag_eval')[:6],
          "mustKnow": False
        },
        {
          "name": "RAG 生产化与热切换",
          "resumePoint": "版本化索引机制,支持后台无感重建与安全热切换,构建失败自动回滚",
          "questionIds": ids('rag_prod')[:5],
          "mustKnow": False
        }
      ]
    },
    {
      "id": "proj-valotactics",
      "name": "ValoTactics-Agent",
      "subtitle": "面向 FPS 电竞的多模态战术推演系统",
      "type": "project",
      "techTags": ["Python", "LangGraph", "Pydantic v2", "Chroma", "FastAPI", "Redis", "Streamlit"],
      "description": "基于 LangGraph 编排多分支有向状态图,结合多模态 RAG 实现精准点位推荐,Redis 缓存预加载与流式输出将首字响应压至 1.5s。",
      "groups": [
        {
          "name": "LangGraph 状态机编排",
          "resumePoint": "编排多分支有向状态图,解耦三大状态流;Schema-First 设计,Pydantic v2 强类型契约",
          "questionIds": ids('langgraph')[:3],
          "mustKnow": True
        },
        {
          "name": "多模态 RAG 与反制检索",
          "resumePoint": "「地图-英雄-机制」多级元数据过滤方案,多模态向量库,零幻觉精准点位推荐",
          "questionIds": ids('rag_vector')[:10],
          "mustKnow": True
        },
        {
          "name": "高并发与低时延优化",
          "resumePoint": "FastAPI + asyncio 异步架构,Redis 热缓存预加载,流式输出首字响应 1.5s",
          "questionIds": ids('backend_fastapi')[:5] + ids('backend_async')[:3],
          "mustKnow": True
        }
      ]
    },
    {
      "id": "internship",
      "name": "实习经历",
      "subtitle": "AI 应用开发实习",
      "type": "internship",
      "techTags": ["Prompt Engineering", "知识库", "RPA"],
      "description": "电商垂直知识库构建、Prompt 工程与会话调优、AI+RPA 账目自动化、业务辅助工具落地。",
      "groups": [
        {
          "name": "Prompt 工程与会话调优",
          "resumePoint": "重构 System Prompt 与动态上下文拼接策略,降低幻觉提升采纳率",
          "questionIds": ids('prompt_eng')[:10] + ids('prompt_halluc')[:2],
          "mustKnow": True
        },
        {
          "name": "电商垂直知识库构建",
          "resumePoint": "数百篇异构文档清洗切块,配置向量库索引,端到端问答调优",
          "questionIds": ids('rag_chunk')[:8] + ids('rag_vector')[:8],
          "mustKnow": True
        },
        {
          "name": "上下文与多轮对话管理",
          "resumePoint": "多轮对话中答非所问与上下文丢失问题的评测与修复",
          "questionIds": ids('prompt_context')[:4],
          "mustKnow": True
        }
      ]
    },
    {
      "id": "skills-base",
      "name": "专业技能",
      "subtitle": "技术底座",
      "type": "skill",
      "techTags": ["Python", "FastAPI", "Redis", "LLM"],
      "description": "Python 后端开发、LLM 上下文管理、幻觉治理。",
      "groups": [
        {
          "name": "LLM 上下文窗口管理",
          "resumePoint": "理解上下文窗口、Token 计费与截断策略",
          "questionIds": ids('llm_context')[:10],
          "mustKnow": True
        },
        {
          "name": "幻觉治理",
          "resumePoint": "理解幻觉成因与缓解手段(RAG / 提示词 / 事后校验)",
          "questionIds": ids('llm_halluc')[:5],
          "mustKnow": True
        }
      ]
    }
  ]
}

out = ROOT / 'data' / 'resume-profile.json'
io.open(out, 'w', encoding='utf-8', newline='').write(json.dumps(profile, ensure_ascii=False, indent=1) + '\n')
total_q = sum(len(g['questionIds']) for s in profile['sections'] for g in s['groups'])
print(f'resume-profile.json written: {len(profile["sections"])} sections, {total_q} question refs')
