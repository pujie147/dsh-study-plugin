# 大纲 → 检索资料 → 整课确认 → 才写讲义（v0.14.0 设计，D40 · 已实现）

> 状态：**已实现并发布 v0.14.0（2026-10-23）**，四套测试全绿（`smoke 270/0`、`portable 32/0`、`client 68/0`、`sync 122/0`），净室 3 路由 + 13 工具通过；**真机验收见 §8（未做）**。
> 四个岔路口由用户 2026-10-23 定稿（见 §9）。
> 病灶 = 现在「点一下就直接写讲义」：AI 凭大纲里一句 `summary` + `focus_points` 凭空成文，
> 没有可核的外部依据，所以不连贯（本机实证 `goal-muntj636-study` 逆向工程 9 章全 ready 即为此形）。
> 出货 = 批准后新增「按大纲检索资料」一步，资料**由会话 AI 自己搜并落成文件**，
> 在 **session 聊天窗口里整课一次**请用户确认，确认事实写进 `goal.json`；
> 讲义照旧要写，但**未确认资料就绝不派发**。
> 现有的 调研→草案→批准→轮询采纳（D3 / D16 / D34 / D35）全部沿用，不改语义、不新增状态机节点。

## 0. 一句话目标

把「AI 凭空写讲义」改成「AI 先按大纲搜资料 → 人确认这批资料 → 讲义必须建立在已确认资料之上」，
并且确认这一步**发生在会话里**（用户就在聊天窗口，看得见来源、能当场说"第三章那篇换掉"），
面板只作展示与兜底。

## 1. 数据模型

### goal.json 新增字段（可选，旧目标不受影响）

| 字段 | 说明 |
| --- | --- |
| `materialSearch` | 检索与确认的**事实**（承 D16「谁执行谁写事实」，只在真正注入成功 / 真正确认时写）：`{dispatchedAt, sessionId, source, confirmedAt, confirmSource:'chat'\|'panel', confirmNote, files, sources}`；`files`/`sources` 是确认当时扫盘的快照计数，仅作展示，**不作为真相判定依据** |
| `materialSearch.confirmedAt` | **唯一的门**：有值才允许派发讲义。建档与批准都不给它初值 |

- 初始化：`createGoalDoc`（lib/index.js:600 一带）置 `materialSearch: undefined`。
- `rejectGoal`（:641，与 `g.research = undefined` 同处）一并清空 `materialSearch` —— 章次变了资料包就错位；
  但**盘上 `research/materials/` 不删**（承 D35 ⑤「reject 不清材料」，材料是原料）。
- 新增 helper（紧挨 :650 `markResearchDispatched` / `researchDispatched`）：
  `markMaterialSearchDispatched(g, sid, source)` / `markMaterialsConfirmed(g, {source, note, files, sources})` /
  `materialSearchDispatched(g)` / `materialsConfirmed(g)`。

### 新增目录 `<goal>/research/materials/`

一份**章级资料包**：`NN-<slug>.md`（NN = `ch.index`，与 `ch.file` 的 `NN-` 前缀对齐，便于机器归章）。
AI 写入的固定三节（扫描器按它数来源，指令按它约束）：

```
# 第 3 章 x86/x64 汇编与函数调用机制
## 来源清单
1. 标题 — https://… — 一句为什么相关 — 访问 2026-10-23
2. …
## 摘录与要点
- （来源 1）call 压返回地址、prologue 建栈帧……
## 本章仍缺的缺口
- 没有找到讲 SysV 与 MSVC x64 调用约定差异的中文材料
```

- 采纳规则与讲义/测试同法：文件存在且正文 > 200 字符才算一份有效资料包。
- `research/**` 已在 `walkGoalDir`（:1432）整树递归里 ⇒ **随导出包与 GitHub 同步自动旅行**，无需新通道。

## 2. 派发与确认（新增的一步）

### 检索指令 `buildMaterialSearchInstruction(g, absDir)`（放在 `researchInstruction`:319 旁）

- 依据：已批准的 `g.chapters`（`title` + `focus_points`），有 `gap_notes` 的章标「优先补料」排在前面。
- 逐章 2–4 次 `web_search`/`web_fetch`；优先权威来源（官方文档 / 经典教材 / 维护良好的仓库 / 长文），
  中文主题优先中文源；`env_baseline` / `project_thread` 类工程章必须检到官方安装文档与样例仓库。
- 红线三条：**本步不要写讲义**；**绝不虚构 URL**（没真正打开过的链接不得列入来源清单）；
  **无法证实的一律写进「缺口」而不是编造**。
- 全部章写完后，**在会话里给一次整课汇总**（每章：来源数 / 最权威的一份 / 明显缺口），
  收尾一句「以上资料是否可用？回复确认或指出要换掉的章与来源」。
- 随后：「学习者确认后请调用 `study_material_confirm(goal_id=…, note=一句话)`；**不要自行宣布确认**」。
- 照例注入 `prefsSection(await readTeachingPrefs())`（:295）与 `prefsWriteBackHint`。

### 派发 owner

`chatMaterialSearch(args)` 完全照抄 `chatResearch`（:3597）的会话解析与降级：
`g.sessionId` → 扫工作区 `sessionIds` 找活体 `agents.get` → 都没有就 `{ok:false, need_open:true, error:'请先…「📄 打开会话」…'}`；
前置校验 `g.chapters.length > 0`，否则「请先批准草案」；**注入恰好一次**（smoke 用 `injected.length` 计数）；
成功注入后才写 `markMaterialSearchDispatched`。

## 3. RPC 与面板

### 新 RPC（`handlers` 表 :726；47 → **50** 个方法；返回一律过 `stripUndefined`）

| method | 入参 | 行为 |
| --- | --- | --- |
| `study.dispatchMaterialSearch` | `goalId` | 面板派发口：3 行适配器委托 `chatMaterialSearch`（承 `study.dispatchResearch`:1076 的单一 owner 惯例） |
| `study.getMaterials` | `goalId` | 只读预览口（仿 `study.getCrawlPreview`:1111）：未派发 `{ok, dispatched:false}`；否则 `{dispatchedAt, confirmedAt, files:[{index, file, abs, chars, sources}], missing:[缺料的章号]}` |
| `study.confirmMaterials` | `goalId, note?` | **面板兜底整课确认**：先跑 `adoptMaterialFiles`，**≥1 份**才写事实，`confirmSource:'panel'` |

### 新扫描器

`adoptMaterialFiles(g)`：套 `adoptTestFiles`(:264) + `webMaterialOf`(:298) 的写法，
`readdir('<goal>/research/materials')` 匹配 `^(\d{2})-[^/\\]+\.md$`，按 NN 归章，
产出 `{index, file, abs, chars, sources}`（`sources` = `^N. ` 行计数）；**只扫盘呈现，不持久化清单**（D3）。
调用点：`listSummary`(:656，与 :662-664 三个采纳扫描并列) 与 `chatStatus`(:3524，:3530-3532 处)。

### 回带给前端 / 聊天

- 目标级新键：`materialDispatched` / `materialConfirmed` / `materialConfirmedAt`（与 `researchDispatched`:684-685 同法）。
- `chapters[]` 每项加 `materials:{file, chars, sources}`（:692-701 的 map 里）。
- 目标级 `materialsSummary:{dispatchedAt, confirmedAt, files, sources, missing[]}`（与现有 `web` 键 :704-718 同法）。
- `chatStatus` 的 `next_action`(:3543-3556) 插入分支「已批准 + 有章 + 未确认 ⇒ 下一步：检索并确认课程资料」，
  **必须排在「生成讲义」之前**，否则聊天叫你去生成、RPC 拒你。

### 新聊天工具（specs :3853-3912；11 → **13**；`defineTool` 解析失败时整块自然不注册）

| 工具 | 何时用 |
| --- | --- |
| `study_material_confirm` | 记录学习者**已在会话中确认整课资料**（写进 `goal.json` 才解锁讲义生成）。**仅当学习者明确说"确认"后调用**；强制 `goal_id`（缺了就报错指回 `study_plan_status`，严禁猜目标，口径抄 `study_test_generate`:3665）；参数 `{goal_id(必填), note}` |
| `study_material_search` | 聊天侧派发检索（D8 语义统一：用户在会话里说「检索资料」AI 能直接办）；参数 `{goal_id}`，委托 `chatMaterialSearch` |

### 面板（`src/client.mjs`，改完必须 `node scripts/build-client.mjs`）

- 新状态 `matPrev`(:100 旁) + `loadMaterials`(:334 `loadCrawlPreview` 同法) + 派发后 3s 轮询
  （:326-350 同法，`ui.crawlRunning` 那套"高频写期间暂停整表 2.5s 轮询"照搬）；
  `doDispatchMaterials`（复用 `dispatchResearch`:314「先确保活体会话再派发」）、`doConfirmMaterials`。
- `materialsSection(g)` 插在 `webSection(g)`（渲染点 :1186）之后，形态照 `webSection`(:574-625) 三态：
  - 无记录 → **「🔍 检索课程资料」**；
  - 已派发未确认 → 「⏳ 资料检索中」+ 资料包清单（章号 / 字符数 / 来源数）+ 缺料章告警 + **「✅ 整课确认」兜底**
    （镜像现有 :603-605 那个「✅ 确认材料 → ▶ 开始调研」钩子）；
  - 已确认 → 「✅ 已确认 N 份 / M 个来源」。
- 门控与改名：章行按钮(:1223) 与 ⚡ 区块(:1268-1280) 在 `!g.materialConfirmed` 时不渲染派发按钮，
  改一行提示「🔍 需先检索并确认课程资料」；确认后改名为 **「📄 依据资料生成」** /
  **「⚡ 依据已确认资料一次性整理全部讲义」**。「继续生成」(:1224)、「📖 开始学习」、📝/🎯 一律不动。
- `labelOf`/`toneOf`(:19-33) **不加新状态**（承 D16：靠事实字段分岔按钮，不扩状态机）。

## 4. 讲义门与讲义指令

### 门（本改动的硬后果）

`if (!materialsConfirmed(g)) return { ok:false, error:'讲义必须基于已确认的课程资料：请先点「🔍 检索课程资料」，在目标会话里看完整课资料清单并确认（回复确认或点面板「✅ 整课确认」）' }`

加在三处：
- `study.generateChapter`（:882，取到 `ch` 之后）；
- `study.generateAllChapters`（:1160，章数校验之后）；
- `study.continueChapter`（:905 的**派发分支** :923 起）。

⚠️ **`continueChapter` 的"文件其实已在盘上 → 直接标 ready"短路（:913-921）保留在门之前**——
它不派发任何新 AI 工作，只是按 D3 对账；把它也挡了，盘上已存在的讲义就永远标不成 ready。

`readChapter`(:1009) 的错误文案「请先点「生成讲义」」同步改指向新流程。

### 讲义指令（`buildGenInstruction` :799 / `buildAllChaptersInstruction` :1122）

新增硬要求段：**「本章已确认资料包（动笔前必须 `read` 逐份读完，事实优先以此为依据；读不到就停笔说明缺口）: <绝对路径>」**，
并把 `webMaterialOf`(:298) 的网页课程源材料并入同一份清单；
六段结构追加第 **⑦** 节 **「参考来源」**（从资料包来源清单抄 编号 + 标题 + URL）；
追加「超出资料范围的补全须在正文标注 `(补充)`」。
D34 那套约束（先总后分六段 / 前置章逐份 `read` / 黑盒欠账清偿 / 统一工程与 git 分支 / LaTeX + mermaid）**全部原样保留**。

## 5. 顺带修的两个真实缺陷（不修就是本改动的直接受害者）

1. **`runWebCrawl` 抹掉整个 `research/`**（:498 `fsp.rm(absDir + '/research', {recursive:true, force:true})`）：
   批准后点「🔁 重抓」会**连资料包一起删光**。收窄成只清 `webDir`（:497）。
2. **导入身份重映射漏字段**（:2500-2505 只 remap `g.sessionId` / `ch[].sessionId` / `g.research.sessionId`）：
   `g.materialSearch.sessionId` 不跟着换 ⇒ 跨机器指向一个本机不存在的会话（破 D17/D18 双身份模型）。补一行。
3. `scripts/cleanroom-check.mjs` 的工具名单**曾长期陈旧**（仍写 7 个，`study_test_generate` 与 `study_sync_*` 都没跟上）：v0.14.0 已补成 13 个排序全名，日志同步为「3 路由 + 13 工具注册 + status 执行 + export 参数校验」；顺带修了 Git Bash GNU tar 把 `C:\…` 当远端主机的解包失败（改用 cwd 相对路径）。

## 6. 诚实边界（做不到 / 故意不做的）

- 约束全在**提示词层**：插件不校验 AI 是否真搜了、摘录是否真来自所标 URL、讲义是否真读了资料包
  （承 D34「无硬校验」/ D35 ④ / D36 ①）。**唯一硬保证是门**：`confirmedAt` 不存在就绝不派发讲义。
- 模型可能**忘记调 `study_material_confirm`** ⇒ 面板「✅ 整课确认」兜底；但确认事实由人一点，
  `confirmSource` 能区分 chat / panel，代价是"人是否真逐条看过"不可证。
- 资料包与章的对应靠 `NN-` 前缀；AI 写错编号 ⇒ 该章落进 `missing[]`，**不猜**。
- **整课一次**确认（用户拍板）：只想换一章来源也要重跑整课，本版不做逐章确认。
- 存量目标不动：已 ready 的讲义不重写；但要**追加新章或整课重新生成**，必须先跑一次资料检索。
- 宿主半**不**程序化调用 `dsh-free-search` 的 `web_search`：已核实该插件 6 个工具 `execute(args)` 完全不碰会话上下文、
  技术上可行（且能给出确定性来源计数），但用户选择让会话 AI 自己搜 ⇒ 记进 §9，将来若要"可核计数"再翻案。
- 新增 0 条 HTTP 路由（`/study-rpc` / `/study-export` / `/study-file` 三条不变）。

## 7. 测试口径

- `test/smoke.mjs` 现状会**成片红**（行为被改了，不是回归）：`generateChapter`(:252/255/259/262/266)、
  `continueChapter`(:268)、`generateAllChapters`(:440-463)、`readChapter` 报错文案(:272-276)、工具名单(:1076 的 11 名全等)。
  - 最省事的解封：`approveDraft`(:213) 之后补一段「`dispatchMaterialSearch` → 写 `research/materials/01-*.md` → `confirmMaterials`」，
    网页课程源段(:429 附近)同样补一次。
  - 新段断言：未确认时三处派发**都被拒且不改章状态**、`need_open` 降级、扫描计数（files / sources / missing）、
    `confirmSource` 区分 chat vs panel、`study_material_confirm` 缺 `goal_id` 报错、
    指令文本正则（「不要写讲义」「绝不虚构 URL」「整课」「已确认资料包」「参考来源」「teaching-prefs」）、
    导出 zip 含 `research/materials/**`（:711-727 段）、**「🔁 重抓后资料仍在」**（§5-1 回归）。
- `test/client.test.mjs`：RPC stub 表(:108-155) 补三个新方法；`genRow`(:74-80) 加 `materialConfirmed`
  （⚡ 三态 :1090-1128 才能保持现有标签断言）；新增两场景（未确认 → 只有「🔍 需先…」提示且无派发按钮 /
  点「✅ 整课确认」→ 打到 `study.confirmMaterials`）；:655 与 :658 的错误文案与宿主 :1009 同步改。
- `portable` / `sync` 预期不受影响（包是整树递归）；能顺手加一条「资料包变化改变 `contentDigest` ⇒ 触发 push」更好。
- 单跑基线先立（`npm test` 是串接、前一套非零退出后一套根本不跑）：
  `node test/client.test.mjs`（现全绿）→ `node test/portable.test.mjs` → `node test/smoke.mjs`。
  ⚠️ Windows 抓取段偶发 `EPERM: rename goal.json.*.tmp`（PROJECT.md §8）依旧适用，同码连红才算回归。

## 8. 真机验收清单（发布前必跑）

1. 新建目标 → 调研 → 批准 → 点「🔍 检索课程资料」。
2. 在**目标会话**里确认：AI 真的逐章搜了、写出 `research/materials/NN-*.md`、并在聊天里给出**整课清单**并请求确认。
3. 回「确认」→ 看 `goal.json` 出现 `materialSearch.confirmedAt` 且 `confirmSource:'chat'`（模型没回调就点面板「✅ 整课确认」，验证兜底与 `'panel'` 值）。
4. 点「📄 依据资料生成」→ 讲义末尾有「参考来源」节、URL 与资料包一致。
5. 另找一个未确认的目标点 ⚡ ⇒ 被拒且给出「先检索并确认课程资料」的白话指引（不留英文报错）。
6. 批准后触发一次「🔁 重抓」⇒ 确认 `research/materials/` 没被删（§5-1）。
7. 导出该目标 → 解包看 `research/materials/**` 在包里；换机导入后 `materialSearch.sessionId` 已换成本机 id（§5-2）。
8. 验证过**立刻 commit**（本仓吃过一次 IDE 回退，CLAUDE.md 末条）。

## 9. 决策摘要（为什么这样选 · 用户 2026-10-23 拍板）

| 岔路口 | 选定 | 放弃项与代价 |
| --- | --- | --- |
| 谁做 websearch | **会话 AI 自己搜**，插件只注入指令 | 放弃「宿主半程序化调 `dsh-free-search` 的 `web_search`」（技术可行、可核计数、可预览）与「自己抓搜索引擎结果页」（脆弱、可能违条款）。代价：搜没搜、搜得对不对**不可硬校验** |
| 大纲怎么承载 | **保留现有调研（含联网）+ 网页课程源材料模式**，批准后再叠检索层 | 放弃「新增独立 `outline.json`」与「把联网从调研步骤摘掉」。代价：同一主题可能被搜两遍，但语义不动、存量数据不动 |
| 讲义还写不写 | **仍写，但必须有已确认资料** | 放弃「本轮只交付大纲→检索→确认」与「资料即学习素材、不再写讲义」。代价：三处派发口的前置条件变了，**这是对 D34「不动『重新生成讲义』按钮」边界的有意推翻**，须在 D40 里明写 |
| 确认粒度与落点 | **整课一次 + 会话内回调 `study_material_confirm` 记事实 + 面板兜底按钮** | 放弃逐章确认（细但要点 N 次、连贯性仍靠 AI 自己串）与纯面板勾选（可靠但不符合"通过 session 交互窗口确认"的原话）。代价：换一章来源也要重跑整课；模型忘回调时确认改由人一点 |
| 状态机 | **不新增节点**，靠 `materialSearch` 事实字段分岔按钮 | 承 D16 / D35 ①：加 `materials_pending` 会牵动全量文案与历史数据归一化 |
