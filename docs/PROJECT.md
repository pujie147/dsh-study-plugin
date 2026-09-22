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
│   └── design/          单特性范围与决策（export-import-scope.md = 导出包文件清单；
│                        import-overwrite-sync.md = 覆盖式同步语义与宿主身份规则）
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
│   ├── lib/index.js     宿主半（/study-rpc + /study-export + study.* ×37（含 study.sync* ×12） + study_plan_* ×5 + study_goal_* ×2 + README）
│   ├── lib/portable.js  可携化工具（零依赖 ZIP + zstd 帧级 header 重写/尾帧追加/行级关系判定 + 附件引用收集 + zip-slip 防御）
│   ├── lib/client.js    客户端 bundle（构建产物，勿手改）
│   ├── src/client.mjs   客户端源码 + scripts/（build-client / install-profile / cleanroom-check）
│   └── test/            smoke.mjs(113 绿后崩于已知宿主 rc.2 漂移，见 §8) · portable.test.mjs(32，含真后端交叉验证)
│                        · client.test.mjs(55，桩 React 真实渲染点击) · transcript-sweep.mjs(npm run sweep)
│                        · host-fixture.mjs（夹具：宿主真实 JsonlSessionPersistence + WorkspaceRegistry，只假内存 storageDomain）
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
├── device.json              本机设备 id（一次性生成；导出包只带它的值）
├── exports/                 导出包 study-goal-<goalId>-<时间戳>[-n].zip（面板 📦 视图可下载/删除；同秒连导自动加后缀，不互相覆盖）
└── <goal>/goal.json         目标状态机（唯一权威文件）
    └── .study-sync.json     设备本地身份账本：remoteId↔localId + 已应用快照（导出不含、绝不从包恢复）
    └── chapters/            NN-<slug>.md 讲义；NN-qa.md 问答写回；NN-notes/ 补充内容目录
    └── draft.json           目标会话 AI 写出的课程草案（JSON），采纳后转待批准
```

导出包内容与会话/工作区的宿主侧落盘事实见 §5「可携化用到的宿主事实」与
[docs/design/export-import-scope.md](./design/export-import-scope.md)（范围清单）、
[docs/design/import-overwrite-sync.md](./design/import-overwrite-sync.md)（覆盖式同步语义、身份规则、事故取证）。

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
| study.readChapter | goalId,chapter_index | 确认本章讲义已生成并回出**绝对路径** + 正文 + 标题（面板「打开讲义」数据口：路径交给 client 侧 `betterSidebar` 服务的 `openFile` 开成右侧页签，取不到则 `window.open` `/study-file`；ch.file 过 basename 全等校验防穿越） |
| study.recordGoalSession | goalId,sessionId | 回写目标总会话 id（旧会话被销毁后面板新建会话时使用，配合 D10） |
| study.dispatchResearch | goalId | 面板「▶ 开始调研 / 🔁 重新调研」的派发口：宿主内委托 `chatResearch`（解析目标会话 → 按 reject_reason 选首次/重试指令 → 注入 → 记 `research.dispatchedAt`），派发调研的唯一 owner |
| study.startCrawl | goalId,url | 网页课程源抓取派发（v0.8.0）：URL 校验（http/https 完整网址）→ 防并发（同目标已在抓取中直接拒）→ 同步占位后 fire-and-forget `runWebCrawl`（同域 BFS、深度 2、≤30 页、robots 轻量遵守），目标瞬态转 `crawling`，收尾回 `researching`；抓取事实写 `goal.webCrawl`，正文落 `research/web/*.txt` + `manifest.json` |
| study.getCrawlPreview | goalId | 抓取明细只读口：`crawled:false`（从未抓过）或 `{ webCrawl(逐页 status/title/chars/low/no-title 原因), webSources, materialFiles }`；面板抓取进度/预览清单/重抓入口都读它 |
| study.generateAllChapters | goalId[,regenerate] | ⚡ 一次性整课生成（v0.8.0）：默认只派发 `draft` 章（有 ready 章时指令列「已就绪(勿重写，仅作前置阅读)」；全就绪则拒并提示改用重新生成）；`regenerate:true` 覆盖全部章（指令改「覆盖写入」）；有章 `generating` 一律拒；单会话连续写章——向目标会话注入**一条**整课指令（含 gap_notes 补全口径 + 「补充：非原始网页来源」标注约定 + teaching-prefs），目标章转 generating，注入失败回滚 |
| study.deleteGoal | goalId | 移出 index 并标记 deleted（文件保留） |
| study.ensureGoalWorkspace | goalId | 按需创建/解析目标工作区 |
| study.exportGoal | goalId | 导出该目标为 zip（目标树 + 全部会话 + 附件 + manifest v2），落 `exports/`；同秒连导自动加 `-n` 后缀不互相覆盖 |
| study.listExports / study.deleteExport | – / file | 导出包列表（大小/时间/下载 URL）/ 删除裸文件名 zip |
| study.inspectImport | file 或 path[,mode,force] | 只读预览：校验包 → 解析每条会话的**本地身份**与**落盘动作** → 返回 `plan.counts` 分类计数 + conflicts/warnings |
| study.importGoal | file 或 path,confirm[,mode,force,skipSessions] | 应用包（幂等 upsert）：无 confirm 返回同一份预览；有 confirm 执行 ⇒ 目标树按 sha 比对后覆盖 → 会话按 create/append/replace 落盘（换身份时重写 header 帧的 id+cwd，正文原样）→ 附件内容寻址回写 → goal.json 会话 id 重映射 + index 合并 → 工作区复用/创建/重挂/摘幽灵席位 → **宿主 `inspect()` + `ws.sessionIds` 投影双自检** → 写 `.study-sync.json` 账本；任一失败整体回滚（还原字节 + 删自建目录 + 恢复 index + 删自建工作区）。返回 `applied{create,append,replace,noop,…}` / `remap[]` / `idempotent` / `goalFiles{written,same,goalJson}` |
| study.reattachGoalSessions | goalId | 修复入口：重建工作区登记并把 goal.json 记录的会话挂回分组；**以宿主投影判定成败**（`ok:false` + `notShown[]`），并报出哪些 id 在归档集里 |
| `mode` 语义 | `overwrite`（面板默认，包为准；分叉/回退需 `force`）/ `merge`（聊天缺省：只新增与快进，分叉项 `skippedDiverged`）/ `copy`（新 goalId + 会话全部换身份，绝不碰现有目标） | |

### 文件路由（webServer prefix，GET 下载 / 读文件）

| 路由 | 行为 |
| --- | --- |
| `/study-export?file=<裸文件名>.zip` | 流式返回 `exports/` 内的导出包；仅 GET、`path.basename` 后还必须与入参全等（拒路径穿越）、仅 `.zip`；**不判定来源 IP**（见 D25） |
| `/study-file?goalId=&chapter=[&format=raw]` | 章节讲义页：仅 GET；**入参不含路径**，落点经 `goal.json` 反查 + `ch.file` basename 全等校验（缺/非整数 chapter→400，未知目标或章节、讲义未生成→404）；默认出自包含 HTML（正文全量转义、CSP `default-src 'none'; style-src 'unsafe-inline'`、`nosniff`、深色适配），`format=raw` 出 Markdown 原文；同样**不判定来源 IP**（见 D25、D33） |

### 模型工具（聊天，`study_plan_*` / `study_goal_*`）

| 工具 | 何时用 |
| --- | --- |
| study_plan_status | 问学习进度/接下来学什么 |
| study_plan_create | 想学某主题、要学习计划 |
| study_plan_research | 开始/重新调研 |
| study_plan_approve | 批准草案 |
| study_plan_reject | 退回草案并记意见 |
| study_goal_export | 导出/备份某目标为 zip |
| study_goal_import | 应用 zip（幂等）：无 confirm 只给预览与分类计数；`mode=overwrite\|merge(缺省)\|copy`、`force=true` 才覆盖分叉/更旧的本地会话；`confirm=true` 才写入 |

### 可携化用到的宿主事实（M4 / M4.1，全部读码 + 真后端离线实测）

| 事实 | 说明 |
| --- | --- |
| 会话落盘 | `<sessionsRoot>/--<projectKey(cwd)>--/<encodeSegment(sessionId)>/session.jsonl.zstd` |
| `projectKey` / `encodeSegment` | 分隔符→`-`、不安全字符→`~XXXX`、截断 251、外包 `--…--`；**不可自己复刻**，一律 `ctx.get('sessionPersistence').locate({cwd,id}).path`（无 IO），项目目录 = 该路径的上上级 |
| transcript 物理形态 | 多帧 zstd 拼接：**第 1 帧只含 header 行**，其后每个 append 批次一帧；帧需 `ZSTD_c_checksumFlag=1` 且非 single-segment（用异步 `zlib.zstdCompress`，同步版会写成 single-segment） |
| **id 是全局身份** | session id 在整个 sessions 根内唯一：同 id 落两个 project 目录 ⇒ `list()`(`:1085`) / `loadStored()`(`:1331`) **抛错并连带打爆 `session.list`** ⇒ 跨目录导入必须换发新 id |
| **路径由 header 反推** | `assertStoredIdentity`(`:1345`) 要求 `logPath(root, header.cwd, header.id)` 与实际路径一致 ⇒ 换 id 必须同步换目录名，换 cwd 必须换 project 目录 |
| **header 字段严格校验** | `isHeaderLine`(`:70`)：`type==='session'` + `version:number` + `id:string` + `createdAt` 非负安全整数 + **`delegationDepth` 非负安全整数** + `origin ∈ {undefined,'subagent'}`；帧 1 必须**恰好一行**（`assertZstdHeaderFrame:741`） |
| **seq 连续性** | 事件按 `seq` 连续校验，跳号 ⇒ `corrupt session log: seq gap in committed region`（实测）⇒ 只有"本地是包的前缀"才能安全追加尾帧 |
| **归档按 id 且不可逆** | `archivedSessionIds` 注册表级全局、按 id 键控；该版本**没有解档 API/UI** ⇒ 沿用被归档过的 id = 会话永久隐藏 |
| **可见性谓词** | Web 端：`origin!=='subagent' && !archived.has(id) && (!blank \|\| id===current)`；`blank` = 日志里没有 `turn/start` ⇒ 空会话/子代理会话按规则不单独出现，导入结果须明确报数 |
| **attach 与投影** | `Workspace.attachSession` 要求 `fs.realpath(header.cwd) === record.path`；`ws.sessionIds` 是**投影**（`sessionPath(id)===record.path` 过滤 + 每次写入剪枝）⇒ attach 不抛 ≠ 会显示，自检必须读投影 |
| 投影缓存 | `storages/session_projcache.json` 按 id + `seq` 围栏存派生投影 ⇒ 整体替换成更短的日志会让统计/标题滞后到下次写入；**只追加尾帧不受影响** |
| 只读 vs 有副作用 | `inspect()` 只读（实测字节不变）；`load()` / `prepare()` 会追加合成 closer ⇒ 自检与测试只用 `inspect()` |
| 附件 | `attachmentId = "sha256:<内容哈希>"`，内容寻址 ⇒ 重新落盘后 id 不变，会话引用不悬空 |
| 全局单文件 | `storages/workspace.json`（所有工作区 + 持久顺序 + 归档集合）；`session_projcache.json` 可再生 ⇒ 都不进导出包、都不直接改写 |
| 存活会话 | 导出前必须 `sessions.flush(sessions.get(id))`，否则包里只有上次 flush 的前缀；导入时该会话 LIVE ⇒ 宿主回写会盖掉结果 ⇒ 硬冲突 |
| 测试夹具 | `test/host-fixture.mjs` 用宿主真实 `JsonlSessionPersistence` + `WorkspaceRegistry`（只假一个内存 `storageDomain`），`ctx.sessions` 用**真实 `SessionStore`**（跑 `Session.fromRestore` 的 surface 校验，比手写 stub 严格）；**模块路径必须 realpath 成长文件名**——8.3 短名（`PYG12~1`）会让 cordis 的 `/@deepseek-ai/` URL 模式匹配失效，裸标识符导入全灭 |

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
| D12 | transcript 以**逐字节原文**入包；跨路径导入**只重写 header 帧的 cwd**，正文不改写 | 逐字节 ⇒ 导入零解码零重压缩（宿主一个根只允许一种编码，重压缩反而引入风险）；正文里的旧绝对路径是历史文本，保留即可，全文替换需要解压重压且收益仅是「AI 回看历史时看到的路径更好看」。**2026-09-10 修订**：「只改 cwd、不改 id」被证伪（见 D17/D18），正文原样这条仍然成立 |
| D13 | 工作区登记走公开 API（`create` + `attachSession`），**永不覆盖** `storages/workspace.json` | 那是全局单文件且注册表有启动不变量（同会话被两个工作区索引 / 两条记录同路径 / 顺序偏离 ⇒ 拒绝启动）；整包覆盖会摧毁目标机其它工作区甚至让 DSH 起不来 |
| D14 | 导入 = 预览/确认两段式 + 逐文件 sha256 校验先于写盘 + 写入后宿主 `inspect()` 自检 + 任一步失败整体回滚 | 导入会跨目录写会话与索引，必须可判定、可拒绝、可撤销；`inspect()` 是官方"非修改式检查"，用它证明宿主真读得懂，而不是我们自说自话 |
| D15 | ZIP 与 zstd 帧工具自己实现（`lib/portable.js`，只用 `node:zlib`/`node:crypto`） | 插件既有的「纯 JS、零 npm 依赖、宿主平面受信」约定；不为了 zip 引入 fflate。外部解压器（Windows Expand-Archive）互操作已入测试 |
| D16 | 「调研已派发」升格为 goal.json 的 `research` 事实，由三处注入成功点写入；面板 `researching` 按该事实分岔给「▶ 开始调研 / 🔁 重新调研」（RPC `study.dispatchResearch` 委托 `chatResearch`） | 事故复盘：目标由 `study_plan_create` 建档（该路径按设计不调研）→ 用户点「打开会话」只建了会话没发指令 → 面板因初值 `status:'researching'` 长亮「⏳ 正在联网调研」，且 researching 分支零按钮 → 用户以为"卡住"，实际是"从没开始"，唯一出路是隐式的「对我说开始调研」。不新增 `created` 状态（方案 B 会牵动状态机/老数据归一化/全量文案），改为给事实加一个字段并在 UI 分岔；派发口只留一个 owner，避免与 startResearch/retryResearch 三处重复 |
| D17 | **双身份模型**：包里带稳定身份 `remoteId`，本机 `localId` 由导入侧决定；映射记在目标目录 `.study-sync.json`（设备本地，不入包、不从包恢复）；包级/目标级再加 `deviceId` 与 `remoteGoalId` | 宿主把 session id 当全局身份（H1/H6/H8）⇒ 沿用源 id 必然撞 duplicate 或继承归档态。云同步要求"同一个东西再同步一次还是它"，因此稳定身份必须与本机身份分离；账本让 A→B→A 往返时身份不漂移（二次导出仍带原 remoteId） |
| D18 | 身份解析候选序：账本已分配的 localId → 包里的 id → 新 uuid；淘汰条件 = 该 id 已被别的 project 目录占用 **或** 该 id 在宿主归档集里 | 前者避开 H1（否则整个 `session.list` 炸）；后者避开 H6（该版本无解档 API ⇒ 沿用即永久隐身，正是本次事故的直接原因）。优先复用账本 id 才可能幂等 |
| D19 | 会话落盘按 append-only 语义分档：`noop / append（只追加尾帧）/ replace（修复性）/ rewind 需 force / diverged 需 force / liveBlocked 不放行` | 宿主按 seq 连续校验（H5），整体替换成更短日志会让投影缓存滞后（H8）；前缀关系下只追加尾帧既不破不变量也不污染缓存，并为将来"只传增量帧"预留可比性。LIVE 会话由协调器 write-behind 独占（H10），外部写必被盖掉 ⇒ 硬冲突而不是静默丢失 |
| D20 | 统一三模式 `overwrite / merge / copy`，作用于目标、会话、工作区三层同一开关；**面板默认 overwrite**，聊天工具缺省 merge | 用户拍板：为云同步铺垫，"已存在也要能覆盖"。面板是人主动操作、有预览与确认，默认覆盖最贴合意图；聊天由模型驱动，缺省保守（merge）避免误吃本地历史 |
| D21 | 目标已存在不再是硬冲突：血缘一致（账本 `remoteGoalId` 相符）⇒ 直接更新；不一致 ⇒ `goalUnrelated` 需 force。工作区按 `resolveByPath→复用（必要时 setTitle）`，否则 `create`；重挂席位并摘除幽灵席位 | 覆盖式同步的日常就是"对同一个目标反复应用"；`create()` 对同一路径本就幂等（宿主 realpath）。幽灵席位（transcript 已不存在的在册会话）与账本被换掉的旧身份会让分组里堆积看不见的条目 |
| D22 | **不做 prune**：本地比包多的文件、会话、席位一律保留，只报差异计数 | 用户拍板"先不做"。镜像式删除需要可靠 tombstone 与双向账本，风险远大于收益；真上云时再单独决策（见 import-overwrite-sync.md §7） |
| D23 | 测试底座用**宿主真实实现**（`test/host-fixture.mjs`：真 `JsonlSessionPersistence` + 真 `WorkspaceRegistry`，只假内存 `storageDomain`）；mock 只留给宿主不可得时的降级跳过 | 上一版 mock 照抄我自己的实现（attach 永远成功、列表从盘上现读），96 条断言全绿却漏掉真 bug。身份/归档/投影/seq 这些不变量必须由宿主代码自己执行，我才骗不过去 |
| D24 | 浏览器侧的**宿主服务名/方法名是私有演进面**：只能按「方法是否存在」探测 + 调用时惰性 `ctx.get`；可选服务**一律不写进模块级 `inject`** | v0.3.0 及以前直接调 `workspaces.connectWorkspace`，dsh 0.1.5-rc.1 把它迁到 `uiWorkspace` ⇒ 用户实机点「打开会话」报"连接会话的方法不存在"。反过来把 `uiWorkspace` 加进 `inject` 更糟：cordis 的 `inject` 是**硬激活门**（`cordis/lib/index.js:1316-1328`，任一注入名无实现 ⇒ `apply()` 永不执行），缺该包的安装会让整个面板消失。`ctx.get` 本身惰性、未提供返回 undefined 不抛（`:762-771`），所以惰性解析 + 三段兜底（`uiWorkspace` → 旧 `workspaces` → `sessions.create`）既修得了漂移又拖不垮面板。**成功才缓存、失败不缓存**（瞬时取空被缓存会永久关掉首选路径） |
| D25 | 两条 HTTP 路由（`/study-rpc`、`/study-export`）**不判定来源 IP/端口**：局域网鉴权外移到宿主侧的鉴权插件，本插件不重复实现 | v0.3.1 及以前两处都用 `req.socket.remoteAddress` 硬比三个回环字面量，而客户端是相对路径 `fetch('/study-rpc')` —— 页面从哪台机器加载、请求就发给那台机器 ⇒ 只要不是本机开面板，远程 IP 必被判死，用户实机表现为「study RPC HTTP 403」。用户拍板：鉴权已由独立插件在宿主层承担，本插件再判一次 IP 不提供真实安全，只是把功能挡掉。保留的是**与来源无关的输入约束**：POST-only(405)、1MB body(413)、`path.basename` 全等 + `.zip`(400)。**别把这条删掉的判定当"漏了的守卫"加回来**；要恢复必须先确认宿主侧鉴权的边界。 |
| D26 | 跨机器同步**只通过 GitHub 固定仓流转**，不搭自建服务、不加运行时依赖；写冲突交给 **Contents API 的 sha 前置条件做乐观 CAS**，**不引入任何锁** | 目标是零运维、可审计（每次同步是一个 commit）。乐观 CAS：PUT 带"我读到的当前 blob sha"，抢先提交者让对方得到 409 → 后写者必被弹回重判。无锁因此**无死锁**；push 撞 409/422 只重试一轮，再撞就交回用户，不无限循环。见 docs/design/github-sync.md §5 |
| D27 | **软锁 / presence 只能是提示，绝不阻塞读写**（红线） | 用户明确要求"机器间只经仓库通信、正确性靠 CAS、不要锁"。若将来展示"某目标正被别的设备编辑"的 badge，也只能是 advisory：看到在场照常 push/pull，由 CAS 而非软锁裁决并发。把在场信号变成"占用即拒绝"会重新引入死锁与孤儿锁，违背 D26 |
| D28 | 固定仓名 `dsh-study-sync` + **认领标记 `.study-sync-owner.json`（kind:'dsh-study-sync'）是拒绝误写他人仓的唯一凭据**；对**本账号自己**已存在但无有效标记的同名仓，改为**受控接管（明示 opt-in）而非硬拒** | 账号下 `dsh-study-sync` 若已存在且有内容但无标记（或 kind 被改坏），**绝不静默写入**：抛结构化的 `repoOccupied`（`needTakeOver`），并保留 token 到 **account-only** 态供复用。用户点「接管」（`study.syncTakeOver`）才补写/替换**那一个标记文件**（PUT 带 sha），随后一切同步只落在 `study-goals/` 前缀下——**不删除该仓任何已有内容**（承 D22 no-prune），"放弃"则只清本机（换账号/改名）。建仓并发（首建撞 422）时输家重 GET + 标记校验后采用赢家。红线不变：对"别人的同名仓"永不自动下手，接管必须是本人明示 |
| D29 | 冲突判定用 **contentDigest**（sha256：排序文件指纹 + 会话向量）+ **账本双基线**，得**五态**；**严格超集才快进**（`localAhead`/`remoteAhead`），否则 `conflicted` | 单纯 digest 相等能判 upToDate，但"会话各自往前追加"与"真分叉"必须区分：`vecCovers` 单向成立才是快进链（A→B→A 内容随 remoteId 旅行），双向都不覆盖才是分叉。pull 后本地被换身份重写 ⇒ 基线必须现算重取，不能沿用 pull 前 digest（防换 id 假阳性） |
| D30 | 真分叉**程序绝不自动吃掉任一侧**：push 无 force、pull 无 discardLocal 一律返回 `needChoice`，亮出远端 `exportedAt/deviceId/bytes` 后由用户二选一（覆盖仓库 / 放弃本地） | 用户的原始诉求。`syncPull` 在下载**前**先反查本机对应目标并 `syncAssess`，已 conflicted 就直接挡，而不是拉下来靠导入侧再报错。放弃本地 = 导入 force，但**不 prune 本地独占文件**（D22），"放弃"≠"删除" |
| D31 | 同步 endpoint **只接受 `https://host`，明文 `http` 仅放行回环**（`127.0.0.1|localhost:port`，为本地 mock 测试）；token 明文**永不进任何 RPC 返回值**，只回 `tokenHint=••••末四位` | 绑定把长期凭据（PAT / OAuth access_token）发给 endpoint，走明文 http 会外泄。回环例外只为测试；生产恒 https。config 出面板前一律 `redactSyncCfg` 抹掉 token 与 clientSecret |
| D32 | GitHub 绑定主路 = **一键设备码**：发布版内置官方 OAuth App 的 **public `client_id`（`DEFAULT_CLIENT_ID`，绝不含 client_secret）**；`syncGetConfig` 回 `oneClick`，面板据此给「🔗 一键登录 GitHub 授权」（自动 `window.open` + 自动复制一次性代码 + `setInterval` 自动轮询，成功即落地不手动确认）。client_id 空/App 被撤 ⇒ 折叠「▸ 高级选项」手填 client_id 或走 fine-grained PAT 逃生舱。**多主机绑同一账号是预期用法**：各机各自授权、各拿独立令牌、共认领同一 `dsh-study-sync`，后来者见有效标记即 **adopt（直接采用为 ready）** 而非触发 D28 接管；导出包各带 `deviceId` 供冲突面板区分来源 | 用户诉求"绑定 git 太复杂，给个一键连接"。**Web redirect（PKCE + 本地回调）被否**：多主机/局域网下 `redirect_uri` 拓扑无解（承 D25 无 IP 守卫、D31 只回环明文），设备码天然多主机友好。**A（设备码）vs C（PAT）的取舍**：一键零配置，代价是账号级"撤销该 OAuth App"一次性作废所有机器的设备令牌需逐机重授、且 App 授权面可能宽于单仓；PAT 逐机独立、单仓 Contents 最小权限、撤一台不影响他机——长期/跨信任域优先 PAT。设备码流程不需要 secret，内置公开 client_id 可安全入仓分发（红线：secret 绝不进仓库）。`sync.test` §9b 回归 adopt 不误触接管、不清他机已推目标、跨机 deviceId 独立（77 断言） |
| D33 | 「打开讲义」= **交给 DSH-better-sidebar 开右侧页签，探不到才浏览器新标签**，绝不在左侧本面板内渲染：① `study.readChapter` 确认讲义已生成并拿绝对路径 → ② `ctx.get('betterSidebar').openFile({sessionId: 本章会话}, 绝对路径, 章标题)`（按 `features` 含 `'openFile'` 门控；抛错/缺席/无能力一律返回 false） → ③ 降级 `window.open('/study-file?goalId=…&chapter=…','_blank')` → ④ 新标签被拦才 `setNotice` 摆出地址。「📖 开始学习」在会话切换成功后自动跑 ②③④，且把**刚切过去的章节会话 id 当 scope** 传下去，它是该功能的**唯一入口**（曾另设独立「📖 讲义」按钮，用户要求移除 ⇒ 不再给单点入口，避免与「开始学习」两个 📖 按钮并排混淆） | 用户诉求原话是"在 DSH-better-sidebar 插件中打开讲义，如果没有插件可以打开一个页签" ⇒ 讲义该跟会话并排在**右侧页签**里，**占用左侧面板自身**的方案被当场否决。**API 已核到源码**（`omdsh-dev/DSH-better-sidebar` main @ 0.19.1，`docs/external-plugin-guide.md`）：`betterSidebar` 由 **client 半** `ctx.provide`（guide §10 明示"host 半无此服务"）⇒ 与 `uiWorkspace` 同理**绝不写进模块级 inject**（硬激活门：没装它的机器面板会整体消失），只惰性 `ctx.get` + 只缓存成功；`openFile(scope, path, title?)` 是 `openTab({type:'editor', id:'editor:'+path}, scope)` 的薄包装，`.md` 命中其**内置 markdown viewer**（`builtins/viewers.tsx` 注册 `exts:['md','markdown']`, `fetchStrategy:'fsRead'`）⇒ 本插件不需要 `registerTab`/`registerFileViewer`，也不引它的任何代码（无 peerDependency，纯服务名协作）。`scope.sessionId` 决定页签落在**哪个会话**的面板，所以必须跟着会话走。`features` 是官方承诺"只增不减"的单调能力列表 ⇒ 门控按成员判定，不比版本串。**残留边界**：`openTab` 在用户于 side card 设置里关掉 `editor` 类型时**静默 no-op**（只 `console.warn`），我们无从感知 ⇒ ② 的"成功"只代表"已受理"，不等于页签必然出现；真出现该情形时用户会看到什么都没发生（不会报错也不会自动补开新标签）。③ 必须有服务端渲染页，故**撤销**本决策早期"刻意不加 `/study-file` 第三条路由"的判断：新标签兜底绕不开它。其安全口径按 D25（不判来源 IP）另立三道硬约束：入参只有 `goalId`+整数 `chapter`（**不含路径**，缺参/非整数即 400，落点一律经 `goal.json` 反查 + `ch.file` basename 全等）、正文全量转义、CSP `default-src 'none'; style-src 'unsafe-inline'` + `nosniff`。测试：`client.test` 46 断言（未装插件→新标签 / 弹窗被拦→提示 / `openFile` 收到 `{sessionId}`+绝对路径+**章**标题且不开新标签 / `features` 缺 `openFile` 时不硬调 / 缺文件时**会话照样打开**且只报讲义白话错误 / 就绪章节行只剩「📖 开始学习」一个 📖 入口的回归）、`smoke` 新增 readChapter 3 + `/study-file` 11 断言（注册/200/CSP/注入不执行/raw/400×2/404×2/405）、净室路由集合断言改为三条路由。**真机验收仍未做**：需要一台装了 `dsh-better-sidebar@0.19.1` 的 DSH 实跑一次 |
| D34 | **讲义生成增强（v0.7.3）＝ 只改提示词层，不动渲染、不批量返工**：三个病灶（环境不接续 / 小结冒出没讲过的知识点 / 结构不按总分）根因同一个——生成指令缺课程级上下文。修法：① 章节生成指令固定六段**总分结构**（标题 → 本章概览(总) → 承接与补完 → 正文分节(每节先总后分、可递归) → 动手练习(统一工程增量) → 本章小结(只回收概览与正文讲过的东西)）；② **知识闭环硬约束**：小结/示例严禁出现未讲知识点，前面章节里没讲透的概念必须挂「作黑盒使用，第 N 章详述」欠账标记；③ 生成第 N 章（N≥2）前指令要求**用 read 工具逐份读完全部前置 ready 章讲义**，三个目的=接续环境与工程线 / 清偿挂到本章的欠账（就地改回「→ 已在第 N 章讲清」）/ 衔接核对；第 1 章则明确"全课程环境与工程线起点"；④ **git 分支工作流**：第 1 章 `git init`（主分支=全课程基线，**禁止直接在主分支开发**），每章从上一章合入点 `checkout -b chapter/NN-主题`，章末练习做完合回；⑤ 排版约定：公式一律 LaTeX/KaTeX（禁 ASCII 伪公式）、图一律 mermaid（一图配一句说明）；⑥ draft.json 新增**三个全可选字段** `env_baseline` / `depends_on` / `project_thread`（采纳时类型清洗：字符串去空、depends_on 过滤为 1..N 整数；批准透传、listSummary 回带）；⑦ 新建**教学偏好记忆体** `<workRoot>/_meta/teaching-prefs.md`：只记结构/组织/构建规则类长期习惯、**绝不记具体课程内容**，调研/重调研/生成/教练四处指令都注入它，尾部带沉淀提示（AI 提炼一句话规则、**先征得学习者同意**再追加，重复/冲突合并改写而非堆叠）。导出包新增 `meta/teaching-prefs.md` 条目（仅当文件存在），导入按**纯函数 `P.mergePrefLines` 行级并集**合并（trim+去空行+按行去重追加，无新增行返回 null=不动盘），因此**随 git 同步自动旅行**（contentDigest 覆盖 meta 条目 ⇒ 偏好变化会触发 push） | 用户报的三个问题各举了 JavaEE 的例子，但**例子只用于说明问题**，修复对象是插件的指令模板而非任何课程内容。"独立分支"经追问确认为 **git 工作流**（不在主分支直接开发），不是叙事结构。用户拍板的边界：**不动「重新生成讲义」按钮**（调整走 AI 聊天或手动改文件，这正是要 prefs 记忆体的动机——聊天里改的规则得能沉淀下来）；**只对新目标/新章节生效**，存量讲义不批量重生成；**`/study-file` CSP 不放宽**（`default-src 'none'` 与全量转义保持，本轮渲染侧不动）。诚实边界：所有约束都在提示词层，**无硬校验**，AI 不遵守时插件不报错也不拦截（要更强保证需引入讲义结构 lint，用户未要求）。渲染侧承接已核到 better-sidebar@0.19.1 源码：markdown viewer 的 preview 模式用 `splitMermaidBlocks` + 懒加载 `lib/client-mermaid.js` 渲染 mermaid 围栏，KaTeX 在 `src/client/markdown-html.ts` ⇒ 新排版约定在右侧页签内可直接呈现，本插件无需改动渲染。测试：`smoke` 新增 D34 断言（四处指令内容、字段清洗与透传、prefs 注入/沉淀、导出 meta 条目、导入并集重建），`portable` 新增 §7b `mergePrefLines` 4 条纯函数单测（32/32 绿）；`smoke` 的**导入段在本机仍被宿主 0.1.5-rc.2 漂移挡住**（`cannot validate session … holds no such session`，已用 `git stash` 在未改动 master 上验证**同样失败**，非本轮回归），同步关键的合并逻辑改由纯函数单测兜底。**真机验收未做**：新目标全链路（调研→批准→生成第1章→生成第2章）验证分支接续、概览首节、小结闭环、LaTeX/mermaid 呈现 |
| D35 | **网页课程源（v0.8.0）＝ 抓取 deterministic 归宿主、生成归 AI，插件只牵线**：① 抓取由宿主 `fetch` 同域 BFS（深度 2、≤30 页、单页 2MB、单请求 15s、总预算 120s、visited 归一化丢 hash/host 小写、重定向手动同域 ≤3 跳），正文提取落 `<goal>/research/web/NN-slug.txt` + `manifest.json`，抓取事实写 `goal.webCrawl`（承 D16「谁执行谁写事实」），目标瞬态 `crawling`、收尾回 `researching`——**不新增持久状态机节点**；② 调研改为**材料模式**：已抓过则指令禁网、逐份读 `research/web/`，AI 把材料覆盖不到的知识点记进草案可选字段 `gap_notes[]`（采纳时清洗：去空、非字符串转空即丢、全空→undefined）；③ ⚡ 整课生成 = **单会话连续写全部章**，按用户两次更正收敛成两态：**默认只派发「待生成」章**（有 ready 章时指令列「已就绪(勿重写，仅作前置阅读)」，全就绪直接拒并提示改用重新生成）；**全部就绪时按钮变「⚡ 重新生成全部讲义」**（`regenerate:true`，指令改「覆盖写入」）；有章 generating 一律拒；补全内容强制标注「补充：非原始网页来源」；④ robots **轻量**：只读 `User-agent: *` 段 Disallow 前缀，抓不到/非 2xx 一律放行，且必须**绕开 not-html 短路**用专用 `fetchRobotsText`（text/plain 走 `fetchCrawlPage` 会被当非 HTML 丢弃——本轮测试抓出来的真 bug）；⑤ reject 草案**不清网页材料**（材料是用户提供的原料，与草案质量无关）；⑥ 抓取期高频写与 D3 的 2.5s 轮询读会撞车 ⇒ `goal.json` 改**原子写**（tmp+rename），manifest 循环内逐页写在 skip/block/limit 分支 `continue` 之前 ⇒ 收尾必须**补写一次全量 manifest**否则尾部落不进包（同样是测试抓出来的）；面板抓取期用 `ui.crawlRunning` 暂停整表 2.5s 轮询，进度靠 3s `getCrawlPreview` 单点拉取 | 用户诉求"给个网页就能照着学：一次性调研、批准后一次性整理完全部讲义、缺的内容自动补"。四项确认取舍：同域自动一层爬取（不是全子域/单页）、宿主 fetch（AI 不碰网，结果可预览可重抓、可被 file-as-truth 审计）、单会话连续写章（逐章手点与整课一致性不可兼得，选后者）、AI 补全但必须标注来源缺失（诚实边界：读者能分辨哪些话来自原始网页）。零新依赖（D15）、零新路由、零新模型工具。测试：`smoke` 新增网页课程源段（**回环真 HTTP mock 站真抓取**，非 mock fetch：同域限定/深度截断/30 页上限/robots blocked/not-html 分类都以 hit 计数证明"从未访问"，约 38 断言全绿）、`client.test` 新增 8 场景（URL 输入→抓取进度→预览清单→开始调研→⚡ 两态流转，55/55 绿）。**真机验收未做**：见 docs/design/web-course.md §8 |

## 7. 已知限制 / 后续路线

- 动态插件会话级生命周期：重启后需按 INSTALL.md 恢复（快照已放 `~/.dsh/study-work/plugin/`）。
- 面板「重新调研」= 退回草案 + 清空草案文件 + **立刻重新派发指令**（D16；此前只退回不派发，目标会停在「调研中」）；研究失败态（research_failed）仅兼容旧数据。
- **D16 之前创建的 `researching` 目标没有 `research` 标记**，升级后会显示「待调研」。若它其实还在跑，点「▶ 开始调研」等于再发一次指令（幂等成本一次会话轮次）；一旦草案落地转 `draft_pending` 就自动归位，不做数据迁移。
- 正式持久化插件（profile `cordis.patch.yml` 组合行 + `dsh.client` 客户端模块 + host↔client 远程桥）**已实施**＝`study-plugin/`（主形态）；动态版 `src/*.js` + `dist/` 保留为路线 A 回退。本机当前以 junction 方式把 `~/.dsh/profiles/web/node_modules/study-plugin` 指向仓库，改完 `npm run build` 后重启即生效；要用官方通道更新则先 `node scripts/install-profile.mjs --uninstall`（只删链接）再 `dsh plugin --profile web add git+https://github.com/pujie147/dsh-study-plugin.git`。
- **导出/导入（M4 / M4.1）与派发事实（D16）只在常驻版实现**（D7 决策）：动态版 `src/host.js` 是路线 A 回退，不追新特性；两版数据契约仍一致，用常驻版导出的包可被任一版本的目标列表读取。
- 导入后仍建议重启 DSH 再看左栏（宿主分组与投影缓存在启动期定型）；但**可见性已在写入时按宿主投影自检**（D14 加强）：`ws.sessionIds` 不认账就整体回滚，不会再出现"导入成功却看不见"。`study.reattachGoalSessions` 是重启后的修复入口，同样按投影判定成败。
- 覆盖式导入的已知边界：① 换发新 id 后，会话**正文文本**里提到的旧 id 不会改写（D12 保留正文原样）；② `force` 覆盖 = 吃掉本地更完整的历史，无本地快照可回退（导入前想留就自己备份 zip）；③ 被换下的旧 transcript 留在盘上转 Ungrouped（宿主无删除会话 API，本插件不越权删）；④ 不做 prune（D22）。
- 归档集里的 id 会被自动避开（D18），但**已存在的旧归档会话本插件无法解档**（宿主这个版本没有解档 API）——只能在导入时换身份绕开。
- **GitHub 同步通道（M5 / v0.5.0）已实现**：跨机器经固定私有仓 `dsh-study-sync` 双向同步，乐观 CAS 保证正确性、无锁（见 [design/github-sync.md](./design/github-sync.md)、D26–D31）。绑定主路已升级为**一键设备码 + 内置 public client_id（D32）**，PAT 降为高级选项里的逃生舱；多主机绑同一账号走 adopt。仍未做的是：① 帧级**增量传输**（每次仍整包，>50MB 拒绝同步）；② **删除同步 / tombstone**（不 prune，D22）；③ 多目标合包。手动「📤 导出 / 导入」通道不变，二者共栈互不依赖。
- 目标工作区里的二进制/大文件超过 20MB 会被跳过并在 manifest 里记 warning（防包体积失控）；超过 60MB 的 transcript 不解正文 ⇒ 无法按行比对，落盘动作降级为需要 force 的 `replace`。
- **网页课程源（D35 / v0.8.0）的边界**：① 正文提取只解析静态 DOM，**不执行 JS** ⇒ 前端渲染站点会拿到「正文过少」（`pages[].low` 只标注、不重试）；② DSH 中途重启会让盘上的 `webCrawl.status` 停在 `running`（面板一直显示抓取中），防并发集合是内存态、重启即清 ⇒ 再点「🔁 重抓」即可覆盖重来（抓取幂等，旧材料整目录清空重写）；③ 同域 BFS 硬上限：深度 2、30 页、总预算 120s、单页 2MB，超出记 `skipped(page-limit)`；robots 轻量（只认 `User-agent: *`，抓不到即放行）；④ ⚡ 整课生成同样是**提示词层约束**（承 D34）——插件派发一条整课指令后不校验 AI 是否逐章写盘，讲义落地仍靠 D3 轮询采纳；⑤ `research/web/` 在目标目录下 ⇒ 随导出包与 GitHub 同步**自动旅行**（walkGoalDir 递归整树），无需额外通道。

## 8. 开发约定

- 代码保持纯 JS（无 JSX/TS/import 变换），宿主不用 `process/require/fetch` 等未声明全局。
- RPC/工具返回值必须是无损 JSON（递归剔除 undefined）。
- 修改 `src/host.js|client.js` 后执行 `npm run build && npm run install:dsh` 重新打包快照。
- 改常驻版：`cd study-plugin && node scripts/build-client.mjs`（改过 `src/client.mjs` 必须重建 bundle）→ `node scripts/install-profile.mjs` → 重启 DSH。
- 提交前跑全套：`npm test` 与 `node scripts/cleanroom-check.mjs`（净室 tarball 探针）。
- ⚠️ **`smoke` 与 `portable` 两套目前都是红的，同一个根因**：本机安装的宿主 `JsonlSessionPersistence` 只暴露 `locate/list/stat/append/create`，**没有 `inspect`**，而 `test/smoke.mjs:249`（崩前 25 条已过）与 `test/portable.test.mjs:220`（崩前 23 条已过，这一步是"换 id + 换 cwd 后宿主还认不认账"的验帧）都直接调它。生产侧 `lib/index.js` 用 `typeof pp.inspect === 'function'` 守卫，测试侧没有。这不是待修的插件缺陷，是**测试底座对宿主版本的要求高于安装包**——宿主补上 `inspect` 即自愈。
- ⚠️ `npm test` = `smoke && portable && client` 串接，smoke 先非零退出 ⇒ **portable 与 client 根本不会执行**。别把 `npm test` 的红当成"只有 smoke 红"，逐套单跑确认：`node test/client.test.mjs`（当前 30 条全绿）/ `node test/portable.test.mjs` / `node test/smoke.mjs`。改客户端半后务必先 `node scripts/build-client.mjs`（测试加载的是 `lib/client.js` 产物）。

- 动了 transcript 帧处理就跑 `node test/transcript-sweep.mjs`：它拿本机全部真实会话日志（本仓所在机器 108 个 / 59.3MB）验「切帧 / header 重写 / 逐行不变 / 帧数不变」，合成数据替代不了这一层。
- 触碰宿主落盘格式（会话帧 / 附件 / 注册表）前先读 §5「可携化用到的宿主事实」，路径一律用 `sessionPersistence.locate()` 解析，不要复刻 projectKey/encodeSegment。
- ⚠️ 未提交的工作在这个仓库被一次 IDE 回退吃掉过（2026-09-09 18:30，`git restore` 类操作不写 reflog）：**能验证过就立刻 commit**，别把成果只留在工作区。
