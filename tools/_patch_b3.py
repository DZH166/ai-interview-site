# -*- coding: utf-8 -*-
"""B3:跨字段原理残留清理(不只改数字,答案/口述/例子/追问/检查全部对齐)"""
import json, pathlib

def patch(qid, fn, replaces):
    p = pathlib.Path('data/questions') / fn
    arr = json.loads(p.read_text(encoding='utf-8'))
    for q in arr:
        if q['id'] != qid: continue
        hits = 0
        for key in ['answer', 'plain', 'deep', 'example', 'interview', 'followups', 'pitfalls', 'check']:
            if key not in q: continue
            s = json.dumps(q[key], ensure_ascii=False)
            orig = s
            for old, new in replaces:
                s = s.replace(old, new)
            if s != orig:
                q[key] = json.loads(s)
                hits += 1
        print(f"{qid}: 更新 {hits} 个字段")
    p.write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')

# ---- FD-026:新 token 的 Q/K/V 都要算,K/V 追加缓存;省的是历史重复计算 ----
patch('FD-026', 'b31-final.json', [
    ("生成第 N+1 个 token 时只需计算新 token 的 Q,与缓存的 K/V 做注意力,避免重算全部历史。",
     "生成下一个 token 时,只对**新 token 本身**计算一遍 Q/K/V(算出的 K/V 追加进缓存),再拿新 Q 与缓存里的全部历史 K/V 做注意力——省掉的是『对历史 token 重复计算 Q/K/V』,不是不算。"),
    ("每步只需计算新 token 的 Q 与缓存的 K/V 交互",
     "每步只对新 token 算一遍 Q/K/V(K/V 入缓存),拿新 Q 与缓存的历史 K/V 交互"),
    ("自回归生成避免重算历史",
     "自回归生成避免对历史 token 重复计算 Q/K/V(新 token 自己的 Q/K/V 每步都要算)"),
])

# ---- PY-038:分支执行取决于组内实际出现的类型;首错取消后未失败任务不再产生异常 ----
patch('PY-038', 'b25-eng-py.json', [
    ("且可多分支同时命中(不同类型的分支都执行)",
     "且分支执行取决于组内实际出现的类型(两类都出现时对应分支都会执行;若首个错误触发取消,尚未失败的任务不再产生异常)"),
    ("# 两类都出现 → 两个分支都执行",
     "# 哪个类型的子组存在,对应分支就执行(两类都有才都执行;首错取消后未失败的任务不产生异常)"),
    ("(部分匹配,多分支可同时命中,未匹配的继续传播)",
     "(部分匹配:出现了哪些类型哪些分支执行,未匹配的继续传播)"),
    ("多个 except* 分支可同时命中(不同类型);同一类型不能重复匹配",
     "出现了哪些类型,对应分支就执行(两类都出现才会都执行);同一类型不能重复匹配"),
    ("两个分支都执行(组内部分匹配的语义)",
     "两个分支都执行——前提是两类异常都已发生;若超时先发生并触发取消,尚未失败的任务不会产生参数错误"),
])

# ---- EN-009:口述补上 ×60 的分钟换算,与算式统一 ----
patch('EN-009', 'b4-agent-eng-fund.json', [
    ("峰值 QPS×单请求 token 对比供应商配额,峰值压在 60~70% 以下",
     "TPM 需求 = 峰值 QPS × 单请求 token × 60(供应商按分钟计),对比配额并把稳态压在配额 60~70% 以下"),
])

# ---- LP-033:无测量断言改为条件化设计假设 ----
patch('LP-033', 'b18-lp.json', [
    ("# 抽取任务:扁平版成功率显著更高(减少嵌套保持)",
     "# 抽取任务:扁平版通常更稳(是否『显著』取决于模型/任务/schema,以你的实测为准)"),
    ("扁平优先(深嵌套是质量延迟双杀,点路径扁平化)",
     "扁平优先(深嵌套常拖累质量与延迟——程度取决于模型与任务,要实测;点路径扁平化是常用手段)"),
])
print('B3 done')
