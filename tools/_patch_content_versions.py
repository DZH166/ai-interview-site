# -*- coding: utf-8 -*-
"""C2:为实质修订过的题打 content_version 标记(驱动『内容有更新,建议重做』提醒)。
只有实质改变题意/答案结论的修订才标记;错别字级修订不打。"""
import json, pathlib

D = pathlib.Path('data/questions')
REVISIONS = {
    'PY-003': {'rev': '2026-09-07', 'summary': '修正「单线程无数据竞争」的说法:跨 await 的读改写仍会竞争;例子补了完整可运行的竞争反例与 Lock 对照。',
               'changes': ['答案与原理:明确临界区与 asyncio.Lock', '例子:新增两个可直接运行的脚本(实测输出 10 / 1000)', '口述:捏造经历改为条件式模板']},
    'PY-004': {'rev': '2026-09-07', 'summary': 'Pydantic 校验顺序按 before/after/wrap 模式精确化(原「类型→约束→自定义」只覆盖默认 after)。',
               'changes': ['原理:校验器执行顺序已在本机运行验证']},
    'PY-022': {'rev': '2026-09-07', 'summary': 'TaskGroup 语义精确化:只有「非取消异常失败」才取消兄弟;单子任务自取消不影响整组(三种场景已实测)。',
               'changes': ['答案/原理:区分三类取消场景', '新增追问:子任务自取消会怎样']},
    'PY-026': {'rev': '2026-09-07', 'summary': '补 PostgreSQL/Stripe 官方来源并核对(offset 丢弃已扫描行、游标稳定性);高频表述改为常见场景。',
               'changes': ['来源补证与状态升级 verified']},
    'PY-038': {'rev': '2026-09-07', 'summary': '修正 except* 误区:未匹配异常不会静默丢失而是打包继续传播;分支执行取决于实际发生的类型。',
               'changes': ['误区/答案/检查题对齐分区语义(本机实测)']},
    'LP-003': {'rev': '2026-09-07', 'summary': '结构化输出代码按五类失败重写:拒答是终态不重试、截断走 SDK 异常、临时错误退避重试、业务校验与类型校验分离。',
               'changes': ['例子代码全部分支经 mock 测试验证', 'strict 需 additionalProperties 的说明与 SDK helper 用法']},
    'LP-033': {'rev': '2026-09-07', 'summary': '删除不存在的 manyOf 关键字;无测量的成功率断言改为条件化设计假设(以实测为准)。',
               'changes': ['答案/原理/追问/检查题一致修订']},
    'EN-009': {'rev': '2026-09-07', 'summary': '容量换算修正:TPM→QPS 需再除以 60(原相差 60 倍);例题全部重算,口述单位统一。',
               'changes': ['答案/原理/例子/口述按分钟换算统一']},
    'FD-026': {'rev': '2026-09-07', 'summary': 'KV 显存三档修正为 0.5/4/16 GiB(原翻倍);澄清新 token 的 Q/K/V 都要计算、省的是历史重复计算。',
               'changes': ['答案/口述/例子/检查题对齐']},
    'FD-007': {'rev': '2026-09-07', 'summary': '论文来源拆分更正:FlashAttention / FlashAttention-2 / GQA 各附正确 arXiv 链接。',
               'changes': ['来源修正(原一个链接冒充多个来源)']},
    'RG-070': {'rev': '2026-09-07', 'summary': '修正「证据占 75% 时换模型只能省 25%」的误导:证据也按生成模型输入单价计费,换模型影响全部生成侧费用;删除无损承诺。',
               'changes': ['检查题/大白话重写为分段计费口径']},
    'RG-064': {'rev': '2026-09-07', 'summary': '本题已改写:原「检索评估进 CI」与 RG-055 重复,现聚焦「上线后漂移监控与 nightly 评测」;CI 门禁内容并入 RG-055。旧笔记与记录保留。',
               'changes': ['题目情境实质改变,建议重做']},
}

count = 0
for f in sorted(D.glob('*.json')):
    arr = json.loads(f.read_text(encoding='utf-8'))
    changed = False
    for q in arr:
        if q['id'] in REVISIONS and 'content_version' not in q:
            q['content_version'] = REVISIONS[q['id']]
            changed = True
            count += 1
    if changed:
        (D / f.name).write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
print('标记 content_version:', count)
