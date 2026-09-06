# -*- coding: utf-8 -*-
"""内容修订 batch 3:
1. RG-055/RG-064 语义去重:RG-064 改写为「上线后漂移监控」新情境,保留旧 ID;
2. AG-001/AG-002 互相前置成环修复;
3. 全库前置成环扫描;
4. 捏造经历扫描(interview 字段的我/我们第一人称经历);
5. 无证据夸大词扫描(必考/高频/真题/大厂/保证)。
输出迁移映射与扫描报告到 delivery/。"""
import json, pathlib, re

QDIR = pathlib.Path('data/questions')
mapping = []

def load(fn): return json.loads((QDIR / fn).read_text(encoding='utf-8'))
def save(fn, arr): (QDIR / fn).write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')

# ---------- 1) RG-055 / RG-064 语义合并 ----------
arr = load('b29-final.json')
for q in arr:
    if q['id'] == 'RG-064':
        old_title = q['title']
        # 改写为实质不同的情境:上线后的漂移监控(nightly),CI 门禁部分留在 RG-055
        q['title'] = "上线后的检索质量漂移怎么发现?nightly 评测与监控怎么建?"
        q['answer'] = ("CI 门禁(提交时的评测,RG-055)管住『变更引入的回归』,但线上质量还会因为『数据与查询漂移』悄悄下滑,"
            "这类漂移要靠独立的监控体系:①漂移信号——查询分布漂移(新话题/新问法占比)、索引-数据漂移(源文档更新了而索引没重建,"
            "RG-067)、检索结果质量信号(线上点击/采纳率下降、空结果率上升);②nightly 评测——每晚对评测集全量跑检索指标"
            "(recall/MRR)+ 抽样端到端,与基线对比,回归超阈值即告警;③gold set 的持续维护——从线上真实 query 里筛选"
            "新的标注样本(评测集不更新,慢慢测不到真实场景);④归因流程——告警后按环节定位:是索引过期、语料变更、"
            "还是查询分布变了(不同根因对应不同修复)。CI 与监控的关系:CI 是『改代码时的门』,监控是『没人改代码时的哨兵』,两者缺一不可。")
        q['plain'] = ("CI 像『出厂检验』:每次改了配方,出厂前查一遍;监控像『市场回访』:产品卖出去之后,用户反馈和退货率变了要有人盯。"
            "RAG 上线后,就算你一行代码没改,世界也会变——用户开始问新话题(查询漂移),公司的文档悄悄更新了(数据漂移),"
            "检索质量就在你看不见的时候往下掉。所以要有一个每晚自动跑的体检(nightly 评测)加上线上的仪表盘(质量信号),"
            "掉下去能报警、能定位是哪个环节的问题。比喻局限:体检报告(nightly)是滞后的,点击率这类线上信号更实时——两层信号配合用。")
        q['deep'] = ("1) 漂移的三类来源与信号:\n"
            "   - 查询漂移:线上 query 的聚类/主题分布随时间变化(新业务、热点事件)——旧评测集覆盖不到;信号:新查询占比、已知意图覆盖率下降;\n"
            "   - 数据漂移:知识库源文档更新而索引滞后(RG-067 的更新机制缺失)或语料本身语义变化;信号:索引新鲜度指标、文档变更量 vs 重建量;\n"
            "   - 质量漂移:检索结果的相关性下降;信号:线上空结果率、点击位置分布(用户越来越往下翻=相关性变差)、采纳率。\n"
            "2) nightly 评测的设计:评测集=固定 gold set(回归对比的锚)+ 新增样本(覆盖漂移);指标与 CI 同口径(recall/MRR,RG-014)保证可比;"
            "固定索引快照与参数(与 RG-055 相同的控制变量纪律);结果落库,形成质量时间序列——没有时间序列就发现不了缓慢下滑。\n"
            "3) 告警与归因:阈值用相对回归(较 7 天均值下降>5% 即告警——阈值按业务噪声水平调);告警后的归因顺序:索引新鲜度→语料变更→查询分布→管线参数;"
            "避免『狼来了』:告警要附回归明细(哪些 query 掉了、掉到哪),可执行而非只有分数(RG-055 的报告纪律)。\n"
            "4) gold set 的运营:从线上 query 采样→人工标注(每周固定额度)→新老样本分桶统计(老样本测回归,新样本测覆盖);"
            "标注一致性抽查(双人标注)。评测集本身漂移(标注标准随时间变化)也要被监控。\n"
            "5) 与 CI 的分工:RG-055 的 L0/L1/L2 管『变更门禁』(分钟到小时,阻断合并);nightly+监控管『运行期健康』(天级+实时信号)——"
            "两套共同构成质量保障闭环,共用评测集与指标定义但触发条件不同。")
        q['example'] = ("nightly 漂移监控的最小实现(示意):\n"
            "```\n"
            "# 每晚定时任务(cron/GitHub Actions schedule)\n"
            "1. 拉取评测集:gold_set_v7(含上月新增的 30 条线上真实 query 标注)\n"
            "2. 固定快照:对昨晚的索引快照跑全量检索评测 recall/MRR\n"
            "3. 对比基线:与近 7 天均值比\n"
            "   recall@5: 0.86 → 0.79(-8.1%)  超阈值(-5%)→ 告警\n"
            "4. 归因辅助:输出 Top-20 回归 query 清单\n"
            "   其中 14 条集中在新话题『跨境退款』→ 查询漂移信号\n"
            "5. 处置:该话题补 20 条标注进 gold set;\n"
            "   源文档已更新但索引未重建 → 触发 RG-067 的重建流程\n"
            "```\n"
            "线上实时信号(仪表盘):空结果率、首条点击占比、逐条答案的采纳率——掉线即查。")
        q['pitfalls'] = [
            "只有 CI 门禁没有运行期监控——没人改代码的日子,质量随数据/查询漂移悄悄下滑,一个月后才发现。",
            "评测集一年不更新——新业务 query 永远测不到,nightly 跑得再勤也是在测去年世界。",
            "nightly 指标与 CI 口径不一致(评测集/参数/索引版本不同)——数字不可比,回归判断失真。",
            "告警只有总分没有明细——收到报警的人不知道从哪查起,告警被逐渐忽略。",
        ]
        q['check'] = {
            "q": "这周没人动过 RAG 管线的任何代码和配置,但用户反馈『答非所问变多了』。你的排查顺序?",
            "a": "没人改代码≠质量没变——按漂移来源排查:①索引新鲜度:源文档是否更新而索引没重建(对照文档变更记录与索引时间,RG-067);"
            "②查询分布:最近新 query 的主题聚类,是否出现评测集没覆盖的新话题(对照线上 query 日志);"
            "③质量信号:空结果率/点击分布的变化时间点,缩小到具体日期后对当天语料/流量变更;④nightly 评测的回归明细:哪些 query 掉了、它们的共性是什么。"
            "修复对因下药:索引过期→重建;查询漂移→补标注+扩评测集;语料语义变化→重审分块策略。",
            "explain": "检验点:『没改代码也会漂移』的意识与按环节归因的顺序,而不是上来就调参数。",
        }
        q['followups'] = [
            {"q": "nightly 评测和 CI 里的评测有什么区别?为什么两个都要?",
             "a": "触发条件与目的不同:CI 评测(RG-055)由代码/配置变更触发,目的是『别把坏的合进去』;nightly 由时间触发,目的是『世界变了要发现』"
             "(数据漂移、查询漂移不需要你改代码就会发生)。共用评测集与指标定义保证数字可比;CI 是门,nightly 是哨,合起来才是闭环。"},
            {"q": "线上质量信号里,哪些最值得优先建?",
             "a": "性价比排序:①空结果率/低分结果率(实现最简单,检索失效的直接信号);②答案采纳率或点击位置分布(贴近真实质量);"
             "③用户负反馈(点踩/重问率)——噪声大但置信度高。先有信号再谈阈值:每个信号都要有基线期数据,否则告警阈值是拍脑袋。"},
        ]
        q['tags'] = ['RAG', '评测', '监控', '漂移', '运维']
        mapping.append({"old_id": "RG-064", "old_title": old_title, "action": "改写为新情境(上线后漂移监控)",
            "merged_into": "RG-055(CI 门禁部分)", "note": "旧 ID 与用户记录(收藏/状态/笔记/轮次)原样保留,自动跟随新内容;旧题的 CI 门禁要点已并入 RG-055"})
    if q['id'] == 'RG-055':
        # 吸收 RG-064 原有的『nightly』一句,明确分工,保证合并不留断层
        q['answer'] = q['answer'].replace(
            "nightly",
            "nightly 的运行期漂移监控与 CI 门禁的分工见 RG-064(新情境)")
        q['related'] = sorted(set((q.get('related') or []) + ['RG-064']))
save('b29-final.json', arr)

# ---------- 2) AG-001 / AG-002 前置成环修复 ----------
arr = load('agent.json')
for q in arr:
    if q['id'] == 'AG-001':
        q['prerequisites'] = []          # 概念入口题,不需要前置
        q['related'] = sorted(set((q.get('related') or []) + ['AG-002']))
        print('AG-001 prerequisites -> []')
    if q['id'] == 'AG-002':
        q['prerequisites'] = ['AG-001']  # 学习顺序:先懂 Agent/工作流,再抠工具调用机制
        print('AG-002 prerequisites -> [AG-001]')
save('agent.json', arr)

# ---------- 3) 全库前置成环扫描 ----------
all_q = {}
for f in QDIR.glob('*.json'):
    for q in json.loads(f.read_text(encoding='utf-8')):
        all_q[q['id']] = q
def find_cycles():
    cycles, visited = [], set()
    def dfs(qid, path):
        if qid in path:
            i = path.index(qid)
            cycles.append(path[i:] + [qid]); return
        if qid in visited or qid not in all_q: return
        visited.add(qid)
        for nxt in all_q[qid].get('prerequisites', []):
            dfs(nxt, path + [qid])
    for qid in all_q: dfs(qid, [])
    return cycles
cycles = find_cycles()
print('前置成环:', cycles if cycles else '无')

# ---------- 4) 捏造经历扫描 ----------
fabricated = []
pat = re.compile(r'(我实际|我的经验|我们团队|我负责|我在公司|我上个|我做过|我参与过|我们项目)')
for qid, q in sorted(all_q.items()):
    hits = pat.findall(q.get('interview', '') or '')
    if hits:
        fabricated.append((qid, hits))
print('含第一人称经历的题:', fabricated if fabricated else '无')

# ---------- 5) 无证据夸大词扫描 ----------
boast = []
pat2 = re.compile(r'(必考|高频|真题|大厂|保证通过|百分之百)')
for qid, q in sorted(all_q.items()):
    hay = q.get('title', '') + q.get('answer', '')[:200]
    hits = pat2.findall(hay)
    if hits:
        boast.append((qid, hits, q.get('title', '')[:40]))
print('含夸大词的题:', boast if boast else '无')

# ---------- 迁移映射落盘 ----------
out = pathlib.Path('delivery')
(out / 'RG-055-RG-064合并与迁移映射.json').write_text(
    json.dumps(mapping, ensure_ascii=False, indent=2), encoding='utf-8', newline='\n')
print('mapping saved')
print('batch 3 done')
