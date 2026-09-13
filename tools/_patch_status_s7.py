# -*- coding: utf-8 -*-
import io
f = "docs/当前状态表.md"
s = io.open(f, encoding='utf-8').read()
old = "> 最新内容批次（2026-09-13）：**数字断言清偿**"
new = """> 最新功能增量（2026-09-14）：**记录可靠性与练习闭环**(任务书阶段0~7)——8项审查问题全部关闭
> (跨页写回循环/旧DOM覆盖/清空复活/完成草稿复活/SRS撤销复活/到期文案/追问身份/追问导出资格),
> 搜索静态层按内容版本失效,我的追问回答可检索并深链到具体轮次。
> 性能实测(349题,本机Chromium):全量重建 5.3ms / 动态重建 5.5ms / 查询中位 1.6ms——
> 倒排索引与 Worker 无必要。状态详见[问题状态表](问题状态表-记录可靠性.md)。
> 前一内容批次：**数字断言清偿**"""
assert s.count(old) == 1
io.open(f, 'w', encoding='utf-8', newline='').write(s.replace(old, new, 1))
print('ok')
