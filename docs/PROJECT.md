# 项目文档（study_dsh_plugin）

学习区（study-work）DSH 插件的工程仓库。本文档面向开发/维护者；使用者请看 [USAGE.md](./USAGE.md)。

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
│   └── USAGE.md         使用手册（面向用户）
├── src/
│   ├── host.js          宿主引擎源码（code.host 的 function body）
│   └── client.js        面板 UI 源码（code.client 的 function body）
├── scripts/
│   ├── build.mjs        打包 → dist/study-plugin.dist.json
│   └── install.mjs      安装快照 → ~/.dsh/study-work/plugin/
├── dist/
│   └── study-plugin.dist.json   打包产物（含 code.host / code.client）
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
└── <goal>/goal.json         目标状态机（唯一权威文件）
    └── chapters/            NN-<slug>.md 讲义；NN-qa.md 问答写回；NN-notes/ 补充内容目录
    └── draft.json           目标会话 AI 写出的课程草案（JSON），采纳后转待批准
```

### goal.json 字段

| 字段 | 说明 |
| --- | --- |
| id / dir / title / topic | 目标标识与主题 |
| target_level | 目标水平（V5 起不采集起点水平） |
| requirements | 附加要求（风格等） |
| status | researching / draft_pending / approved / active / completed / deleted |
| draft | 采纳后的草案（course/overview/chapters/rejected/reject_reason/approved） |
| chapters[] | 章节：index/title/summary/est_hours/focus_points/file/status/sessionId/qaFile |
| sessionId / workspaceId | 目标总会话 / 工作区（由 GUI 打开会话后记录） |
| reviewItems | 保留字段（测验/错题功能已移除，恒为空，不产生行为） |

### 状态机

- 目标：`researching → draft_pending → approved → active → completed`；退回草案 → `researching`（草案文件被清空，防止旧草案被重新采纳）。
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
| study.list | – | 目标列表 + 采纳扫描（草案/讲义） |
| study.createGoal | topic,target_level,requirements | 建 goal 目录 + index 注册 + 工作区（workspaceRegistry） |
| study.startResearch | goalId,sessionId | 记录目标会话 → 清空旧草案 → 注入调研指令 |
| study.retryResearch | goalId | 向目标会话重发调研（带上次意见） |
| study.approveDraft | goalId | 草案→章节清单（含 qaFile），状态 approved |
| study.rejectDraft | goalId,reason | 退回并清空 draft.json（防旧草案被采纳） |
| study.generateChapter | goalId,chapter_index | 章节→generating，向章节会话（无则目标会话）注入讲义任务；无可将会话→回退 draft |
| study.continueChapter | goalId,chapter_index | 先查文件：已产出→ready；否则会话可用→重发任务；不可用→回退 draft 并提示 |
| study.recordChapterSession | goalId,chapter_index,sessionId | 记录章节会话 id |
| study.startChapter | goalId,chapter_index,sessionId | 向章节会话注入「本章学习教练」开场指令（读讲义→讲解→每次回答后检查是否有值得回写的补充内容并询问用户→写回 NN-qa.md） |
| study.deleteGoal | goalId | 移出 index 并标记 deleted（文件保留） |
| study.ensureGoalWorkspace | goalId | 按需创建/解析目标工作区 |

### 模型工具（聊天，`study_plan_*`）

| 工具 | 何时用 |
| --- | --- |
| study_plan_status | 问学习进度/接下来学什么 |
| study_plan_create | 想学某主题、要学习计划 |
| study_plan_research | 开始/重新调研 |
| study_plan_approve | 批准草案 |
| study_plan_reject | 退回草案并记意见 |

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

## 7. 已知限制 / 后续路线

- 动态插件会话级生命周期：重启后需按 INSTALL.md 恢复（快照已放 `~/.dsh/study-work/plugin/`）。
- 面板「重新调研」已与聊天一致（退回即清草案）；研究失败态（research_failed）仅兼容旧数据。
- 正式持久化插件（profile `cordis.patch.yml` 组合行 + `dsh.client` 客户端模块 + host↔client 远程桥）尚未实施——实施后将不再依赖会话级重装。

## 8. 开发约定

- 代码保持纯 JS（无 JSX/TS/import 变换），宿主不用 `process/require/fetch` 等未声明全局。
- RPC/工具返回值必须是无损 JSON（递归剔除 undefined）。
- 修改 `src/host.js|client.js` 后执行 `npm run build && npm run install:dsh` 重新打包快照。
