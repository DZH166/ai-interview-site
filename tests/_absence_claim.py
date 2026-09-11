# -*- coding: utf-8 -*-
"""共用判定:一段诊断文本是否**越权断言**了「库里没有」。

背景(问题 G):
  「库里到底有没有这个知识」是运行侧**无从知道**的——它只能看到本次检索
  拿到的证据。所以运行侧的文案里可以**提到**这个结论,但必须是为了否定或
  悬置它(「这不等于『库里没有』,需与标注对照才能下结论」)。

  用 `"库里没有" not in reason` 这种裸字符串匹配来把关是错的:它会把
  诚实地否定该结论的文案判成越权,反过来放过了换一种说法的真越权文案
  (比如「该主题不在库中」)。这里改成看**语气**:命中短语必须被否定/悬置
  的词包住,否则算越权。

用法:
    from _absence_claim import asserts_absence
    bad, hits = asserts_absence(reason)
"""
import re

# 各种「库里没有」的说法
ABSENCE = re.compile(
    r"(库里没有|库中没有|库内没有|知识库(里|中)(没有|不存在)"
    r"|素材(里|中)(没有|不存在)|不在库中|库中不存在|不在知识库)"
)

# 否定 / 悬置语气:出现这些词说明说话人没有把上面的结论当成自己的断定
DISCLAIM = re.compile(
    r"(不等于|并不等于|不代表|不能据此|无法据此|不能说明|无法断定|不能断定"
    r"|不下.{0,8}结论|不下此结论|是否|需与|需要与|待与|无从"
    r"|对照.{0,8}(标注|判定|才能|之后)|要由.{0,8}(评测|标注|判定))"
)

# 命中短语前后各取多少字来判断语气
WINDOW = 16


def asserts_absence(text):
    """返回 (是否越权断言, 越权片段列表)。

    只有「没有否定语气包裹的『库里没有』式短语」才算越权。
    """
    s = str(text or "")
    flat = []
    for m in ABSENCE.finditer(s):
        win = s[max(0, m.start() - WINDOW): m.end() + WINDOW]
        if not DISCLAIM.search(win):
            flat.append(win.replace("\n", " ").strip())
    return (len(flat) > 0), flat


def describe(text):
    """给失败信息用的一句话说明。"""
    bad, hits = asserts_absence(text)
    if not bad:
        return "未越权(reason=%r)" % str(text)[:60]
    return "越权断言:%r ← reason=%r" % (hits[:2], str(text)[:70])
