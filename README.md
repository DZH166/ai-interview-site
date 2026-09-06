# AI 面试学习站(AI 应用开发与 Agent 方向)

![validate-bank](https://github.com/DZH166/ai-interview-site/actions/workflows/validate.yml/badge.svg)

一个**纯本地、离线可用**的中文面试学习网站:题库练习 + 文档阅读检索 + 模拟面试,个人记录保存在本机浏览器。面向 AI 应用开发 / Agent 方向的实习与校招。

**在线访问(GitHub Pages):<https://dzh166.github.io/ai-interview-site/>** —— 无需安装任何东西,打开即用;个人学习记录保存在你自己的浏览器里,不会上传。

**安装为桌面/手机应用(PWA):** 用 Chrome / Edge 打开上面的在线地址,地址栏右侧点「安装」;手机上用浏览器菜单里的「添加到主屏幕」。安装后**完全离线可用**,306 题与文档全部缓存在本地。

**发现题目有错?** [提一个纠错 issue](https://github.com/DZH166/ai-interview-site/issues/new?template=question-feedback.yml),附上题号即可,会尽快核实修正。题库数据在每次推送时由 CI 自动校验(要素完整性、重复度、构建一致性)。

## 快速开始

**方式一(推荐):本地服务器**

双击 `start.bat`(Windows),浏览器会自动打开 `http://127.0.0.1:8765`。关闭窗口即停止服务。

也可以手动运行:

```
python tools/serve.py 8765
```

**方式二:直接打开**

双击 `app/index.html` 也能使用。注意:不同浏览器/打开方式下 localStorage 记录互不共享,且部分浏览器对 file:// 的限制更多,建议固定使用方式一。

> 需要安装 Python(3.8+);无 Python 时用方式二,功能基本可用。

## 两种使用方式

1. **练习**(交互):按专题/难度/题型/状态筛选题目 → 题目先出现,答案分层展开(直接答案 → 大白话 → 原理拆解 → 例子 → 面试表达 → 追问 → 误区 → 理解检查 → 出处核查);手动标记掌握状态;写个人笔记(参与搜索)。
2. **文档阅读**:按专题组织的原理章节,可连续阅读;章节内的知识点可直接跳到对应练习;全文检索覆盖章节、题干、答案、解析与你的笔记,点击结果直达段落。

另有:自测/模拟面试(先写后看)、复习中心(收藏/待复习/笔记/历史轮次)、维护页(题库导入导出+校验、记录备份、来源与许可)。

## 目录结构

```
ai-interview-site/
├── start.bat              一键启动(Windows)
├── README.md              本文件
├── NOTICE.md              署名与许可证说明
├── PROGRESS.md            构建进度与恢复点
├── app/                   网站本体(index.html + css + js + data.js)
├── data/                  数据源(与界面分离)
│   ├── topics.json        专题定义
│   ├── questions/*.json   题库(按专题分文件)
│   ├── docs/*.md          阅读章节(Markdown)
│   ├── sources.json       来源与许可证清单
│   └── candidates.json    候选题目索引(仅标题)
├── tools/
│   ├── serve.py           本地服务器(no-cache,推荐)
│   ├── build.py           打包 data/ → app/data.js,输出统计
│   ├── validate_bank.py   题库校验(重复/字段/乱码/代码块)
│   └── fix_quotes.py      题库 JSON 引号修复(历史工具)
├── delivery/              内容核查记录 / 功能测试记录 / stats.json
├── examples/              个人记录备份示例(可直接测试导入)
└── tests/                 校验报告输出
```

## 日常操作

| 想做什么 | 怎么做 |
|----------|--------|
| 加题目 | 在 `data/questions/对应专题.json` 里按现有格式追加,然后 `python tools/validate_bank.py` 校验,再 `python tools/build.py` 重新打包 |
| 改章节 | 编辑 `data/docs/*.md`,重新 build |
| 备份记录 | 维护页 →「导出记录」;换设备用「导入记录」合并 |
| 加自己的资料 | 文档阅读页 →「导入 MD / TXT / JSON」(PDF 会明确提示不支持解析并保留文件条目) |
| 加题库(不改源码) | 维护页 →「导入题库 JSON」(自动校验,只追加,不动你的记录) |

## 质量说明

- 每道题都有:考察点标注、直接答案、大白话解释(含比喻局限)、原理拆解、具体例子、面试表达、常见追问、常见误区、理解检查、出处与核查状态(已核查/版本相关)。
- 题目解析为结合官方文档的**独立整理**,未搬运任何付费或受限内容;开源题库仅作考点参考,署名见 `NOTICE.md`。
- 实际统计见 `delivery/stats.json`(由 build.py 生成);功能验证见 `delivery/功能测试记录.md`。
- 题库会持续分批扩充,已做的标记不会因题库更新而丢失(导入题库只追加,不覆盖记录)。
