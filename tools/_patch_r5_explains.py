# -*- coding: utf-8 -*-
"""阶段3 批次3:为 4 道进阶题补 check.explain(检验点)。"""
import json, pathlib

EXPLAINS = {
    'EN-031': ('检验点:超窗处理的三层完整性——自动检测(预算检查器)→诚实告知而非截断硬上→给出带代价标注的选项'
               '(分段摘要的精度损失)。只答『截断后送模型』说明没考虑摘要级分析与用户预期。'),
    'EN-032': ('检验点:流式与结构化的冲突解法——按章节粒度设计分帧协议(section 边界事件),'
               '而不是把整份 JSON 等齐再渲染。能提出 section_end 触发渲染说明理解了渐进性来自协议设计。'),
    'FD-009': ('检验点:外推区与训练分布的区别(31K 位置对 A 是外推、对 B 是分布内),同时保留『结论必须实测』的'
               '分寸——外推质量与训练技巧强相关,不能只背公式。'),
    'RG-062': ('检验点:trace 驱动的归因顺序——先确认单请求劣化(候选数/输入长度)再看系统负载(并发/争抢),'
               '处置对因(限候选/控块长/扩容)而不是全局加机器。'),
}

for f in sorted(pathlib.Path('data/questions').glob('*.json')):
    arr = json.loads(f.read_text(encoding='utf-8'))
    hit = False
    for q in arr:
        if q['id'] in EXPLAINS:
            q['check']['explain'] = EXPLAINS[q['id']]
            hit = True
    if hit:
        f.write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
        print('patched in', f.name)
