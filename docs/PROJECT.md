# 项目文档（study_dsh_plugin）

学习区（study-work）DSH 插件的工程仓库。本文档面向开发/维护者；使用者请看 [USAGE.md](./USAGE.md)。

> **2026-09-09 状态**：主形态已升级为 **常驻插件包 [`study-plugin/`](../study-plugin/README.md)**（profile 组合插件：DSH 启动自动装载、任何模式/会话可用、重启不丢失，含面板 + `/study-rpc` + `study_plan_*` 五工具；v0.1.0 已净室验证）。本文 §3 起描述的**动态插件**保留为双轨回退（路线 A），数据契约两边完全一致。

## 1. 项目是什么

在 DeepSeek Harness Web GUI 中提供一套「个人学习管理」能力：

- **左侧栏「📚 学习区」入口 + 浮动面板**：管理多个学习目标（创建 / 调研 / 批准草案 / 章节讲义生成 / 开始学习）。
- **会话模型**：每个目标一个「目标总会话」（联网调研产草案、生成讲义）；每章一个「章节独立会话」（教学 + 多轮问答，问答要点写回 `NN-qa.md`）。
- **聊天管理工具**：`study_plan_status / create / research / approve / reject`，直接在聊天中查看进度、创建目标、发起/退回调研。
- **数据与文档**：全部数据落在 `~/.dsh/study-work/`，以文件为唯一事实来源；插件只做轮询采纳（不覆盖会话 AI 写出的内容）；启动时同步生成该目录的 README.md。

设计上**不设**小节测验、错题本、学时切分、学前诊断与「已学完」标记（按用户要求移除/未采纳）。

## 2. 仓库结构

```
study_dsh_plugin/
├── README.md            项目总览（快速开始）
├── INSTALL.md           安装 / 重装 / 重启恢复指引
├── docs/
│   ├── PROJECT.md       本文档（架构 / 状态机 / API / 决策记录）
│   ├── USAGE.md         使用手册（面向用户）
│   └── design/          单特性范围与决策（export-import-scope.md = 导出包文件清单）
├── src/
│   ├── host.js          宿主引擎源码（code.host 的 function body）
│   └── client.js        面板 UI 源码（code.client 的 function body）
├── scripts/
│   ├── build.mjs        打包 → dist/study-plugin.dist.json
│   └── install.mjs      安装快照 → ~/.dsh/study-work/plugin/
├── dist/
│   └── study-plugin.dist.json   打包产物（含 code.host / code.client）
├── study-plugin/        ★ 常驻插件包（主形态，可分发）
│   ├── package.json     双 exports + dsh.bundle.patch + dsh.client 清单
│   ├── cordis.patch.yml 自注册 row（- insert: study-engine）
│   ├── lib/index.js     宿主半（/study-rpc + /study-export + study.* ×19 + study_plan_* ×5 + study_goal_* ×2 + README）
│   ├── lib/portable.js  可携化工具（零依赖 ZIP + zstd 会话帧改写 + 附件引用收集 + zip-slip 防御）
│   ├── lib/client.js    客户端 bundle（构建产物，勿手改）
│   ├── src/client.mjs   客户端源码 + scripts/（build-client / install-profile / cleanroom-check）
│   └── test/            smoke.mjs(79 断言，含导出→导入往返) · portable.test.mjs(14) · client.test.mjs(19，桩 React 真实渲染点击)
└── package.json
```

## 3. 运行形态与打包原理

当前插件以 **DSH 动态插件（dynamic Cordis plugin）** 形态运行：

- 宿主半身（host）在 DSH Node 进程中执行：`ctx` 取服务（fs / agents / workspaceRegistry），`harness.handle` 注册客户端 RPC，`harness.defineTool + registerTool` 注册模型工具。
- 客户端半身（client）在浏览器页面执行：`styles` 注入 CSS，`slots.inject('sidebar.footer.action')` 挂载面板，通过 `host.call(method, args)` 调用宿主 RPC。
- **特性**：会话级、免编译、纯 JS；**限制**：源码只存在于会话内存，DSH 进程重启后插件定义丢失（数据与工作区/会话不丢）。

打包/重装流程（见 INSTALL.md）：

1. `node scripts/build.mjs`：把 `src/host.js` / `src/client.js` 序列化为 `dist/study-plugin.dist.json`（结构即 `cordis_define` 的 `code.host` / `code.client` 参数，另含版本、构建时间与 sha256 前缀）。
2. `node scripts/install.mjs`：把 dist 快照 + 恢复指引写入 `~/.dsh/study-work/plugin/`。
3. 会话内恢复：助手读取 `study-plugin.dist.json` → `cordis_define(kind: new, idPrefix: 'stud')` → `cordis_run`（客户端首次需 GUI 批准）→ 停用旧实例。

## 4. 数据模型（~/.dsh/study-work）

```
study-work/
├── README.md                使用说明（插件启动时同步覆盖）
├── index.json               目标注册表 { goals: [{id,title,status,path}] }
├── exports/                 导出包 study-goal-<goalId>-<时间戳>.zip（面板 📦 视图可下载/删除）
└── <goal>/goal.json         目标状态机（唯一权威文件）
    └── chapters/            NN-<slug>.md 讲义；NN-qa.md 问答写回；NN-notes/ 补充内容目录
    └── draft.json           目标会话 AI 写出的课程草案（JSON），采纳后转待批准
```

导出包内容与会话/工作区的宿主侧落盘事实见 §5「可携化用到的宿主事实」与 [docs/design/export-import-scope.md](./design/export-import-scope.md)。

### goal.json 字段

| 字段 | 说明 |
| --- | --- |
| id / dir / title / topic | 目标标识与主题 |
| target_level | 目标水平（V5 起不采集起点水平） |
| requirements | 附加要求（风格等） |
| status | researching / draft_pending / approved / active / completed / deleted |
| draft | 采纳后的草案（course/overview/chapters/rejected/reject_reason/approved） |
| chapters[] | 章节：index/title/summary/est_hours/focus_points/file/status/sessionId/qaFile |
| sessionId / workspaceId | 目标总会话 / 工作区（面板「打开会话」或调研发起时记录） |
| research | 调研**派发事实** `{dispatchedAt, sessionId, source}`：只有真正把指令注入目标会话才写；`status:'researching'` 本身只是建档初值（见 D16） |
| reviewItems | 保留字段（测验/错题功能已移除，恒为空，不产生行为） |

### 状态机

- 目标：`researching → draft_pending → approved → active → completed`；退回草案 → `researching`（草案文件被清空，防止旧草案被重新采纳）。
- `researching` 有两副面孔，靠 `research.dispatchedAt` 区分：**有值** = 调研指令已注入目标会话（面板「调研中…」+「🔁 重新调研」）；**无值** = 只是建档初值，会话没收到过任何指令（面板「待调研」+「▶ 开始调研」）。`createGoalDoc` 建目标即置 `researching`，所以该状态不等于"AI 在跑"（D16）。
- 章节：`draft（待生成）→ generating（生成中）→ ready（讲义就绪）`；历史数据中的 `done` 读取时归一化为 `ready`。
- 讲义采纳规则：文件存在且正文 >200 字符 → `ready`（列表/状态读取时轮询采纳）。
- 讲义回写规则：章节会话中 AI 每次回答后自检，若有讲义未覆盖的补充内容则询问用户是否回写。回写采用「总结+链接+独立详细文件」模式：
  - 讲义中仅插入一行总结性引用（`> 💡 [补充：主题名](NN-notes/slug.md) — 一句话概括`），不破坏讲义主体结构。
  - 详细内容写入 `chapters/NN-notes/slug.md`（每个主题一个文件），含完整示例、解释、图示等。
  - 同一主题多次回写时，在同一详细文件末尾追加新段落（带日期标题），实现内容累积扩展。

## 5. 宿主 API 清单

### RPC（面板 host.call，`harness.handle`）

| method | 入参 | 行为 |
| --- | --- | --- |
| study.list | – | 目标列表 + 采纳扫描（草案/讲义）；每行含 `researchDispatched` / `researchDispatchedAt` |
| study.createGoal | topic,target_level,requirements | 建 goal 目录 + index 注册 + 工作区（workspaceRegistry） |
| study.startResearch | goalId,sessionId | 记录目标会话 → 清空旧草案 → 注入调研指令 → 记 `research.dispatchedAt` |
| study.retryResearch | goalId | 向目标会话重发调研（带上次意见）→ 记 `research.dispatchedAt` |
| study.approveDraft | goalId | 草案→章节清单（含 qaFile），状态 approved |
| study.rejectDraft | goalId,reason | 退回并清空 draft.json（防旧草案被采纳）+ 清 `research`（退回=需重新派发） |
| study.generateChapter | goalId,chapter_index | 章节→generating，向章节会话（无则目标会话）注入讲义任务；无可将会话→回退 draft |
| study.continueChapter | goalId,chapter_index | 先查文件：已产出→ready；否则会话可用→重发任务；不可用→回退 draft 并提示 |
| study.recordChapterSession | goalId,chapter_index,sessionId | 记录章节会话 id |
| study.startChapter | goalId,chapter_index,sessionId | 向章节会话注入「本章学习教练」开场指令（读讲义→讲解→每次回答后检查是否有值得回写的补充内容并询问用户→写回 NN-qa.md） |
| study.recordGoalSession | goalId,sessionId | 回写目标总会话 id（旧会话被销毁后面板新建会话时使用，配合 D10） |
| study.dispatchResearch | goalId | 面板「▶ 开始调研 / 🔁 重新调研」的派发口：宿主内委托 `chatResearch`（解析目标会话 → 按 reject_reason 选首次/重试指令 → 注入 → 记 `research.dispatchedAt`），派发调研的唯一 owner |
| study.deleteGoal | goalId | 移出 index 并标记 deleted（文件保留） |
| study.ensureGoalWorkspace | goalId | 按需创建/解析目标工作区 |
| study.exportGoal | goalId | 导出该目标为 zip（目标树 + 全部会话 + 附件 + manifest），落 `exports/` |
| study.listExports / study.deleteExport | – / file | 导出包列表（大小/时间/下载 URL）/ 删除裸文件名 zip |
| study.inspectImport | file 或 path[,mode] | 读包 + 逐文件 sha256 校验 + 计算落点/冲突/是否需重写 header（只读预览） |
| study.importGoal | file 或 path,confirm[,mode,skipSessions] | 无 confirm 返回预览；有 confirm 执行还原（会话 header 重写 → 附件回写 → index 合并 → 工作区登记 → inspect 自检 → 失败整体回滚）；`mode=copy` 换新 goalId |
| study.reattachGoalSessions | goalId | 修复入口：重建工作区登记并把 goal.json 记录的会话挂回分组（迁移/重启后分组丢失时） |

### 文件路由（webServer prefix，GET 下载）

| 路由 | 行为 |
| --- | --- |
| `/study-export?file=<裸文件名>.zip` | 流式返回 `exports/` 内的导出包；仅 GET、仅 loopback、`path.basename` 后还必须与入参全等（拒路径穿越）、仅 `.zip` |

### 模型工具（聊天，`study_plan_*` / `study_goal_*`）

| 工具 | 何时用 |
| --- | --- |
| study_plan_status | 问学习进度/接下来学什么 |
| study_plan_create | 想学某主题、要学习计划 |
| study_plan_research | 开始/重新调研 |
| study_plan_approve | 批准草案 |
| study_plan_reject | 退回草案并记意见 |
| study_goal_export | 导出/备份某目标为 zip |
| study_goal_import | 从 zip 导入（无 confirm 只给预览与冲突；有 confirm 才写入；`mode=copy` 另存为副本） |

### 可携化用到的宿主事实（M4）

| 事实 | 说明 |
| --- | --- |
| 会话落盘 | `<sessionsRoot>/--<projectKey(cwd)>--/<encodeSegment(sessionId)>/session.jsonl.zstd` |
| `projectKey` / `encodeSegment` | 分隔符→`-`、不安全字符→`~XXXX`、截断 251、外包 `--…--`；**不可自己复刻**，一律 `ctx.get('sessionPersistence').locate({cwd,id}).path`（无 IO），项目目录 = 该路径的上上级 |
| transcript 物理形态 | 多帧 zstd 拼接：**第 1 帧只含 header 行**，其后每个 append 批次一帧；帧需 `ZSTD_c_checksumFlag=1` 且非 single-segment（用异步 `zlib.zstdCompress`，同步版会写成 single-segment） |
| 会话归属 | 子代理会话与父会话同 cwd ⇒ 同项目目录；`archivedSessionIds` 是注册表级全局集合 |
| 附件 | `attachmentId = "sha256:<内容哈希>"`，内容寻址 ⇒ 重新落盘后 id 不变，会话引用不悬空 |
| 全局单文件 | `storages/workspace.json`（所有工作区 + 持久顺序 + 归档集合）；`storages/session_projcache.json` 是可再生自愈缓存 ⇒ 都不进导出包 |
| 存活会话 | 读文件前必须 `sessions.flush(sessions.get(id))`，否则包里只有上次 flush 的前缀 |

### 会话注入协议

宿主用 `agents.get(sessionId).followup(userMessage)` 向目标/章节会话注入任务指令（消息按普通用户消息排队执行，天然串行、不会并发覆盖）。指令文本约定目标会话 AI 将产物写成 JSON/Markdown 文件；面板轮询（客户端 2.5s）与聊天工具触发采纳扫描。

## 6. 关键设计决策记录

| # | 决策 | 背景 / 理由 |
| --- | --- | --- |
| D1 | 面板入口 = sidebar.footer.action 整行徽标（wide）/圆钮（rail） | 早期嵌入 regionArea/footArea 不可行；独立浮动面板方案 A 获用户批准 |
| D2 | 每目标一个工作区 + 目标总会话；每章独立会话 | 调研/讲义与学习行为分离；章节会话可追溯 |
| D3 | 文件即真相，插件只轮询采纳 | 会话 AI 写文件（其沙箱根为用户主目录），避免双写冲突 |
| D4 | 创建目标→自动打开会话→会话内联网调研→草案待批准 | 用户明确要求“先文档→开会话→会话内调研” |
| D5 | 不采集当前水平/学时；按自然章节切分；不设学前诊断 | 用户 V5 需求，删除对应字段与流程 |
| D6 | 取消小节测验/错题本/上一章复习；无 done 状态 | 用户 2026-09 需求：无考核节点，学完=讲义就绪可随时重学 |
| D7 | 拒绝草案 = 清空 draft.json | 防止 status 回 researching 后旧草案被采纳扫描重新捞起（曾为面板缺陷） |
| D8 | 聊天工具与面板 RPC 语义统一（合并进单一引擎） | stuh-6/stmc-8 历史分叉合并；一致的数据与错误契约 |
| D9 | 恢复 = dist 快照 + 会话内重新 define/run | 动态插件重启即失；官方持久化（cordis.patch.yml + dsh.client 包）列为后续路线 |
| D10 | 「📄 打开会话」= 幂等回到 `goal.sessionId`（目标总会话），仅当它未记录或已被销毁时才新建会话并 `study.recordGoalSession` 回写 | 旧实现走 `workspaces.connectWorkspace`，而它只复用**空白**会话：目标会话一旦产过草案就不再空白，于是每次点击都新建一个会话、把调研上下文丢在脑后。会话存活以客户端 `sessions.list` 镜像为准（镜像可能滞后 → 先 `refresh()` 再判定），因为 `sessions.open()` 只接受已列出的会话。（本条与其代码曾被一次工作区回退吃掉，2026-09-10 从安装副本 + dist 快照逐字节恢复） |
| D11 | 导出的会话范围 = 目标工作区**项目目录下全部会话**，而非 `goal.json` 登记的那几个 | 「工作区的所有 session」的字面要求；`goal.json` 会漏掉 subagent 会话、面板丢绑定的孤儿会话与已归档会话。按项目目录整体扫描天然包含它们 |
| D12 | transcript 以**逐字节原文**入包；跨路径导入**只重写 header 帧的 cwd**，正文不改写 | 逐字节 ⇒ 导入零解码零重压缩（宿主一个根只允许一种编码，重压缩反而引入风险）；正文里的旧绝对路径是历史文本，保留即可，全文替换需要解压重压且收益仅是「AI 回看历史时看到的路径更好看」 |
| D13 | 工作区登记走公开 API（`create` + `attachSession`），**永不覆盖** `storages/workspace.json` | 那是全局单文件且注册表有启动不变量（同会话被两个工作区索引 / 两条记录同路径 / 顺序偏离 ⇒ 拒绝启动）；整包覆盖会摧毁目标机其它工作区甚至让 DSH 起不来 |
| D14 | 导入 = 预览/确认两段式 + 逐文件 sha256 校验先于写盘 + 写入后宿主 `inspect()` 自检 + 任一步失败整体回滚 | 导入会跨目录写会话与索引，必须可判定、可拒绝、可撤销；`inspect()` 是官方"非修改式检查"，用它证明宿主真读得懂，而不是我们自说自话 |
| D15 | ZIP 与 zstd 帧工具自己实现（`lib/portable.js`，只用 `node:zlib`/`node:crypto`） | 插件既有的「纯 JS、零 npm 依赖、宿主平面受信」约定；不为了 zip 引入 fflate。外部解压器（Windows Expand-Archive）互操作已入测试 |
| D16 | 「调研已派发」升格为 goal.json 的 `research` 事实，由三处注入成功点写入；面板 `researching` 按该事实分岔给「▶ 开始调研 / 🔁 重新调研」（RPC `study.dispatchResearch` 委托 `chatResearch`） | 事故复盘：目标由 `study_plan_create` 建档（该路径按设计不调研）→ 用户点「打开会话」只建了会话没发指令 → 面板因初值 `status:'researching'` 长亮「⏳ 正在联网调研」，且 researching 分支零按钮 → 用户以为"卡住"，实际是"从没开始"，唯一出路是隐式的「对我说开始调研」。不新增 `created` 状态（方案 B 会牵动状态机/老数据归一化/全量文案），改为给事实加一个字段并在 UI 分岔；派发口只留一个 owner，避免与 startResearch/retryResearch 三处重复 |

## 7. 已知限制 / 后续路线

- 动态插件会话级生命周期：重启后需按 INSTALL.md 恢复（快照已放 `~/.dsh/study-work/plugin/`）。
- 面板「重新调研」= 退回草案 + 清空草案文件 + **立刻重新派发指令**（D16；此前只退回不派发，目标会停在「调研中」）；研究失败态（research_failed）仅兼容旧数据。
- **D16 之前创建的 `researching` 目标没有 `research` 标记**，升级后会显示「待调研」。若它其实还在跑，点「▶ 开始调研」等于再发一次指令（幂等成本一次会话轮次）；一旦草案落地转 `draft_pending` 就自动归位，不做数据迁移。
- 正式持久化插件（profile `cordis.patch.yml` 组合行 + `dsh.client` 客户端模块 + host↔client 远程桥）尚未实施——实施后将不再依赖会话级重装。
- **导出/导入（M4）与派发事实（D16）只在常驻版实现**（D7 决策）：动态版 `src/host.js` 是路线 A 回退，不追新特性；两版数据契约仍一致，用常驻版导出的包可被任一版本的目标列表读取。
- 导入后需重启 DSH 才会在左栏分组与会话列表里完整可见（工作区/会话发现与投影缓存在宿主启动期定型）；`study.reattachGoalSessions` 是重启后的修复入口。
- 导出包目前只在同机 `exports/` 与浏览器下载之间流转；多目标合包、云同步、全文路径替换（D2②）都未做。
- 目标工作区里的二进制/大文件超过 20MB 会被跳过并在 manifest 里记 warning（防包体积失控）。

## 8. 开发约定

- 代码保持纯 JS（无 JSX/TS/import 变换），宿主不用 `process/require/fetch` 等未声明全局。
- RPC/工具返回值必须是无损 JSON（递归剔除 undefined）。
- 修改 `src/host.js|client.js` 后执行 `npm run build && npm run install:dsh` 重新打包快照。
- 改常驻版：`cd study-plugin && node scripts/build-client.mjs`（改过 `src/client.mjs` 必须重建 bundle）→ `node scripts/install-profile.mjs` → 重启 DSH。
- 提交前跑全套：`cd study-plugin && npm test`（smoke 79 + portable 14 + client 19）与 `node scripts/cleanroom-check.mjs`（净室 tarball 探针）。
- 动了 transcript 帧处理就跑 `node test/transcript-sweep.mjs`：它拿本机全部真实会话日志（本仓所在机器 108 个 / 59.3MB）验「切帧 / header 重写 / 逐行不变 / 帧数不变」，合成数据替代不了这一层。
- 触碰宿主落盘格式（会话帧 / 附件 / 注册表）前先读 §5「可携化用到的宿主事实」，路径一律用 `sessionPersistence.locate()` 解析，不要复刻 projectKey/encodeSegment。
- ⚠️ 未提交的工作在这个仓库被一次 IDE 回退吃掉过（2026-09-09 18:30，`git restore` 类操作不写 reflog）：**能验证过就立刻 commit**，别把成果只留在工作区。
