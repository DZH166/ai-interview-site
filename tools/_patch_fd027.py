# -*- coding: utf-8 -*-
"""修复4:FD-027 不按名称推断固定训练流程与轮次能力。
事实依据(一手):
- InstructGPT 论文(arXiv 2203.02155):SFT→RLHF 训练出来,名字仍叫 Instruct —— 名称≠训练阶段。
- Meta Llama-3.1-Instruct 模型卡:官方对话模型,名称 Instruct 且支持多轮对话 —— 名称≠单轮。
核心修正:Base=预训练基座(能力边界清晰);Instruct/Chat 是各提供方的产品/能力命名,可重叠,
不是互斥训练阶段;训练流程与能力(单轮/多轮)必须看模型卡/训练说明/chat template,不能按名字推断。"""
import json, pathlib

p = pathlib.Path('data/questions/b31-final.json')
arr = json.loads(p.read_text(encoding='utf-8'))
for q in arr:
    if q['id'] == 'FD-027':
        q['answer'] = ("先分清稳定的事实与命名现实:①Base model(基座)——只做了预训练(下一 token 预测),没有对齐训练:"
            "它不是『不会回答』,而是会『续写任何文本』(你问它问题,它可能续写更多问题而不是回答)。这一条是训练目标决定的,可靠。"
            "②Instruct / Chat——这两个词是不同提供方的**产品或能力命名**,不是一组互斥的训练阶段标签:名字带 Instruct 的模型"
            "完全可能既做了 SFT 又做了 RLHF/DPO,也完全可能支持多轮对话(InstructGPT 论文里 SFT+RLHF 训出来的模型就叫 Instruct;"
            "Meta 官方的 Llama-3.1-Instruct 是支持多轮的对话模型)。选型的正确姿势:别按名字猜——去读具体模型的模型卡/训练说明,"
            "确认训练流程、是否针对多轮对话优化、用什么 chat template;自托管时拿 Base 直接当助手用是最常见的翻车。")
        q['plain'] = ("Base 像一个『读了所有书但没上过班』的人:知识渊博,但你问『帮我发邮件』,他可能接着念『……的邮件模板如下』而不是真发。"
            "这个比喻是稳的——预训练目标决定了 Base 的续写行为。"
            "而 Instruct 和 Chat 的关系像『客服专员』和『客户服务主管』两个头衔:不同公司的头衔含义不一样,有的公司两者是同一套培训,有的不同——"
            "**光看头衔猜不出一个人会不会接待多轮投诉**,要看他的岗位说明(模型卡)。比喻局限:头衔比喻提醒你『命名是提供方起的,不是行业标准』,"
            "能力以模型卡为准。")
        q['deep'] = ("1) 稳定的部分(可按训练目标推断):Base 的行为=续写。预训练目标是『给定上文预测下一个 token』,"
            "所以它天生是补全引擎:few-shot 续写、代码补全是它的主场;没有安全对齐与格式遵循训练,直接上生产有风险。\n"
            "2) 命名的现实(不能按名字推断):『Instruct』『Chat』是各提供方的产品/能力命名,行业没有统一标准。两个一手反例:\n"
            "   - InstructGPT(Ouyang 等 2022):训练流程是 SFT→RLHF,结果模型名叫 **Instruct**——可见名字与训练阶段不对应;\n"
            "   - Meta Llama-3.1-Instruct 模型卡:官方定位就是**对话模型**,名字带 Instruct 但明确支持多轮对话——名字≠单轮。\n"
            "3) 查证的方法(面试可以主动说):选型时读**模型卡/官方训练说明**确认三件事——①训练流程(SFT?RLHF/DPO?);"
            "②是否针对多轮对话优化;③chat template(提示词格式怎么包)。Hugging Face 模型卡通常给了 system prompt 格式与示例。\n"
            "4) 常见翻车场景(仍然成立):拿 Base 当助手用(它续写问题不回答问题);拿 Base 做安全敏感场景(无安全对齐);"
            "自托管时没按官方 chat template 包提示词(模型行为异常,排查半天其实是格式)。\n"
            "5) 面试表达的分寸:能讲出『名字≠能力,查模型卡』这个层次,比背『Instruct 单轮、Chat 多轮』的过时结论强——后者是早期社区口径,"
            "与当前主流模型事实不符。")
        q['example'] = ("两个一手反例(证明『名字推不出流程/轮次』):\n"
            "```text\n"
            "反例 1:InstructGPT(arXiv 2203.02155)\n"
            "  训练流程:SFT → RLHF(两阶段都对齐了)\n"
            "  模型名字:InstructGPT —— 如果『Instruct=SFT、Chat=RLHF』的命名公式成立,\n"
            "  它应该叫 ChatGPT;但历史恰恰相反:先有 InstructGPT,名字没随训练阶段走。\n"
            "\n"
            "反例 2:Meta Llama-3.1-8B-Instruct(官方模型卡)\n"
            "  官方定位:对话模型(多轮),模型卡直接给出多轮对话模板(system/user/assistant 角色)。\n"
            "  名字带 Instruct,但它是 Meta 官方的 Chat 形态产品。\n"
            "```\n"
            "结论:判断一个模型的对话能力,读它的模型卡与 chat template,不要读名字。")
        q['interview'] = ("口述版:『Base model 我能讲得很死:它是纯预训练的续写引擎——这是训练目标决定的,few-shot 补全、当微调基座是它的正确用法,"
            "直接当助手用会翻车。Instruct 和 Chat 我会谨慎:这两个是提供方的产品命名,不是互斥训练阶段——InstructGPT 走了 SFT+RLHF 还叫 Instruct,"
            "Llama-3.1-Instruct 是官方多轮对话模型。所以选型时我习惯去读模型卡:确认训练流程、多轮支持和 chat template,不按名字猜。』"
            "追问展开:Base 的正确用法、怎么从模型卡确认对话能力、chat template 不匹配的坑。")
        q['followups'] = [
            {"q": "名字带 Instruct 的模型是不是一定只能单轮?",
             "a": "不是。Llama-3.1-Instruct 就是官方多轮对话模型——名字与轮次能力没有必然关系。正确做法:看模型卡里是否提供多轮对话模板(system/user/assistant)、官方示例是否为对话场景。判断依据是官方文档,不是名字;把『Instruct 单轮』当成淘汰依据会错杀很多好模型。"},
            {"q": "用 Base 模型做 few-shot 补全有用吗?",
             "a": "有用且是 Base 的正确用法:few-shot 示例引导模型续写出正确格式的输出(文本补全模式)。限制:无安全对齐(可能输出有害内容)、输出控制靠提示词工程。适合文本补全、代码补全、有明确示例的格式化生成任务。"},
            {"q": "chat template 是什么?为什么自托管时经常踩坑?",
             "a": "chat template 是把多轮对话(system/user/assistant 消息)拼成模型训练时所见文本格式的模板——每个模型各不相同(有的用 <|im_start|>,有的用 Llama 的 [INST])。自托管推理时不用官方模板包提示词,模型等于在看『没见过的格式』,行为会明显异常(复读、不停止、答非所问)。用 transformers 的 tokenizer.apply_chat_template 或推理框架的对应选项,别手拼。"},
        ]
        q['pitfalls'] = [
            "拿 Base 模型当助手用(它续写问题而不是回答问题)。",
            "按名字推断能力——以为 Instruct 必然单轮、Chat 必然多轮;InstructGPT(SFT+RLHF 却叫 Instruct)和 Llama-3.1-Instruct(官方多轮对话模型)都是反例。能力要看模型卡。",
            "Base 模型无安全对齐就上生产(有害内容风险)。",
            "自托管时不按官方 chat template 拼提示词(行为异常,排查半天其实是格式问题)。",
        ]
        q['check'] = {
            "q": "三个判断:①同事说『名字带 Instruct 的模型只能单轮,咱们要多轮所以排除它』——你怎么回应?②Base 模型为什么不适合直接当助手?③你在 Hugging Face 上看到一个新模型,怎么快速确认它能不能做多轮对话?",
            "a": "①这个推断不可靠:名字与训练阶段/轮次能力没有必然关系(InstructGPT 走了 SFT+RLHF 仍叫 Instruct;Llama-3.1-Instruct 是官方多轮对话模型)。应该去读该模型的模型卡确认多轮支持,而不是按名字排除。②Base 的训练目标是『续写上文』:你问它问题,它可能续写更多问题;且没有安全对齐。它适合当微调基座和补全引擎。③看模型卡:是否提供多轮对话模板与示例(角色消息结构)、官方推荐的 chat template、训练说明里是否提及对话优化。三处都查过再下结论。",
            "explain": "检验点:Base 的行为由训练目标决定(可推断);Instruct/Chat 的能力由具体模型决定(必须查模型卡,不按名字猜)。",
        }
        q['sources'] = [
            {"kind": "paper", "name": "InstructGPT(Ouyang 等 2022):SFT→RLHF 训练,名字仍为 Instruct", "url": "https://arxiv.org/abs/2203.02155", "note": "一手反例:名称不对应训练阶段"},
            {"kind": "official-docs", "name": "Meta Llama-3.1-8B-Instruct 模型卡:官方多轮对话模型", "url": "https://huggingface.co/meta-llama/Llama-3.1-8B-Instruct", "note": "一手反例:名字带 Instruct 且支持多轮对话"},
            {"kind": "independent", "name": "独立整理", "url": "", "note": "选型检查清单(读模型卡三件事)为独立整理"},
        ]
        q['verify'] = {
            "status": "verified",
            "checked_date": "2026-09-07",
            "note": "Base 的续写行为由预训练目标决定(对照 InstructGPT 论文的 base 模型描述);『名称不对应训练阶段/轮次』已用 InstructGPT 论文与 Llama-3.1-Instruct 模型卡两个一手来源核对。能力判断以模型卡为准的方法论为独立整理。",
        }
        print('FD-027 rewritten')
p.write_text(json.dumps(arr, ensure_ascii=False, indent=1) + '\n', encoding='utf-8', newline='\n')
