# tools/ 工具集

以下命令均从仓库根目录执行。本轮交付与性能结论以 [当前状态表](../docs/当前状态表.md) 为准；测试入口存在不代表已经通过最终验收。

## 构建与本地加载

```powershell
python tools/build.py
python tools/serve.py 8765
```

浏览器打开 `http://127.0.0.1:8765/index.html`。服务器默认只绑定本机，端口已占用时换一个；浏览器回归会自行启动隔离服务器，不需要复用日常学习窗口。

`build.py` 将 `data/` 的活动题、旧题存档、训练单元和文档构建为 `app/data.js` 索引、`app/data/manifest.json`、内容哈希分片，并更新 `app/sw.js` 的缓存戳。请修改源数据后构建并一并提交生成物，不手改哈希分片。CI 会检查入口、清单、全部分片及缓存戳，新增但未提交的分片也会被发现。

构建还会按各文件内容更新 `app/index.html` 中 JS、CSS、`data.js` 的版本查询，并将相同的精确 URL 写入 Service Worker 预缓存。这样旧 Worker 控制下的第一次刷新也能加载匹配的新脚本；不能手动删除查询参数或只缓存无版本路径。修改这些脚本后同样需要构建并提交 `index.html` 与 `sw.js`。先生成逐文件版本、再计算整个页面缓存戳，连续构建应一致。

页面启动时仅加载索引；进入题目才读取其所属专题，进入文档才读取文档资源。全文搜索会主动加载题库与文档，先显示标题命中，再逐步补齐正文命中。开发调用可使用 `Data.ensureQuestion(id)`、`Data.ensureTopics(ids)`、`Data.ensureDoc(id)`；`Data.questionsReady()` 是显式全库加载，`ensureTopics` 的部分失败需检查返回的 `errors`，不能把 Promise 完成当作所有正文成功。

需要全文索引结果的测试，应先等待目标内容，再调用 `Search.build(...)` 并等待 `Search.whenIdle()`。题目索引元数据不能当成完整题目快照保存。

离线使用前在页面的“离线学习资料”下载简历核心或全部资料，并核对完成状态。已访问内容会缓存，但首次打开不自动下载全库；清除网站数据会删除缓存和个人记录。

`restore_legacy_questions.py` 从固定历史基线提取已删除 ID，并原样写入 `data/legacy-questions.json`。它会改写存档，仅在核对基线和删除范围后显式使用；日常构建与验证无需运行。`legacy-archive-test.js` 需要该历史提交可用，CI 因此使用完整 Git 历史。

`tests/browser/sw-upgrade.js` 在同一站点路径切换真实已发布基线 `8c2db0c` 与当前版本，覆盖旧 Worker 首次刷新、更新激活、离线、新安装及个人记录保留。浏览器 CI 也需完整 Git 历史；等待 `controllerchange` 后还要确认控制 Worker 已到 `activated` 状态，才检查清理结果。

## 统一功能验证

Python 使用 3.11 或兼容版本，Node.js 使用 20 或兼容版本。运行 Python 桩测试前安装依赖；这些测试不调用真实模型 API：

```powershell
python -m pip install 'markdown-it-py==2.2.0' 'openai>=2.0' 'pydantic>=2.5'
python tools/validate_all.py --unit --jobs 2
```

浏览器套件需要可用的 Playwright 与 Chromium。使用已安装运行时可设置 `PW` 为模块名或模块目录、`CHROME` 为浏览器可执行文件；`CHROME=default` 使用 Playwright 管理的浏览器。需要指定服务器的 Python 时设置 `AIIV_PYTHON`。统一运行器不安装这些依赖。

```powershell
$env:PW = 'playwright'
$env:CHROME = 'default'
python tools/validate_all.py --browser --jobs 1
```

CI 与本地使用相同枚举规则：

- `--unit`：`tests/*.js`、`tests/baseline2/*-test.js`、`tests/*test.py`。
- `--browser`：`tests/browser/*.js`，排除独立性能测量 `performance.js`。
- 两个标志均省略：运行两类套件；`--jobs` 默认 2，范围限制为 1–4。涉及搜索耗时门槛时使用浏览器串行 `--jobs 1`，避免多个浏览器争抢资源。
- 每套测试使用不同的 `PORT`（9650 起），单套超时 240 秒；任何失败或超时使统一命令以非零状态退出。

每套完整输出保存在 `output/validation/`，汇总文件为 `unit-results.json`、`browser-results.json` 或 `all-results.json`。汇总记录套件路径、退出码、耗时及日志路径，**passed/failed 是套件数，不是断言数**。相同类别再次运行会更新对应结果；该目录不提交。CI 通过 artifact 保存两类日志，失败时也上传已有输出。

2026-09-30 冻结代码后的完整结果另归档为 [验证汇总](../delivery/reviews/validation-integration-20260930.json) 和 [逐套日志](../delivery/reviews/validation-integration-20260930.log)，随分支提交。构建须先于浏览器回归完成，不应在测试运行中删除并重生成分片。

本轮新增加载器、渐进搜索、旧题原样保留、核心内容、按需加载、旧题访问、练习可靠性与训练/离线套件都按上述规则纳入，无需另维护 CI 文件名清单。新测试应按规则命名；纯辅助模块不要直接放在这些会被枚举的位置。

统一运行器不代替构建、内容审计与适配器幂等检查。CI 还单独执行：

```powershell
node tools/import-pi-agent.js --check
node tools/fuse-ai-series.js --check
python tools/content_audit.py --selftest
python tools/verify_sources.py --selftest
python tools/highlight_audit.py --selftest
python tools/highlight_audit.py --strict
python tools/content_audit.py --strict
python tools/verify_sources.py --no-network
python tools/validate_bank.py
python tools/dedup_check.py
```

`fix_quotes.py` 会修改源文件，CI 要求其运行后 `data/` 无差异。来源结构检查与内容检查器只能检出其编码规则，不能替代逐题事实核对，也不证明外部链接在核验日有效。

## 独立性能测量

`tests/browser/performance.js` 与功能回归分开运行。`PERF_ROOT` 可指定基线目录，`PERF_REPORT` 指定 JSON 输出路径；`PERF_ASSERT=1` 对候选版本启用脚本中的预算断言。比较时使用同一浏览器、机器和限速配置，测量期间不要同时运行其他浏览器回归。脚本记录五次冷启动及热态交互；原始样本应与结论一起保留。

本轮五次对照与未达标项见 [最终融合验收](../docs/合入main验收-2026-09-30.md)。冷启动与已加载操作均应用 4 倍 CPU 降速；首题可作答后继续采集 1 秒，搜索、路由和输入各采样 30 次；路由与输入采用双 rAF 留出一次渲染机会，仍不代表屏幕像素呈现时刻。预算断言独立于功能 CI，功能测试通过不代表性能预算全部通过。

## 其他维护工具

- `convert_nowcoder.py`：牛客题库转换。
- `gen_thin_list.py`：生成薄项工作清单。
- `highlight_audit.py`：核对重点标注是否逐字命中、重叠或重复。
- `content_audit.py`：内容结构与交叉引用审计。
- `dedup_check.py`：题目重复度预警。
