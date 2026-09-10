# 学习区 导出 / 导入 —— 文件范围清单（待确认）

> 状态：**待用户确认**（本文只界定"导出包里放哪些文件"，不含实现细节与 UI 方案）。
> 所有结论均来自本机 `~/.dsh` 实测 + DSH 宿主包源码（`@deepseek-ai/dsh-session-persistence-jsonl`、`dsh-workspace`、`dsh-host-apiproxy/lib/types/session-export.js`）。

## 0. 一句话目标

把一个学习目标「连内容带会话」打成一个 zip；在另一台机器（或另一个 `DSH_HOME`）上用这个 zip 还原成可继续学习的目标 + 可打开的历史会话。

## 1. 实测事实（决定了清单的形状）

| 数据 | 位置 | 本机实测 |
| --- | --- | --- |
| 目标文档 | `~/.dsh/study-work/<goalId>/` | 5 个目标目录，11KB–76KB，共约 134KB（不含 `plugin/`） |
| 目标注册表 | `~/.dsh/study-work/index.json` | 571B，含 2 条在册 + 3 条已删目标；`path` 字段为**绝对路径**且分隔符混用（`C:/Users/…` 与 `C:\\Users\\…`） |
| 会话正文 | `~/.dsh/sessions/<projectKey(cwd)>/<encodeSegment(sessionId)>/session.jsonl.zstd` | 全机 105 个会话 / 14 个项目目录；学习区目标占 **16 个会话**，压缩 1.50MB / 明文 2.54MB |
| 项目目录名 | 由会话 header 的 `cwd` 规范化：分隔符→`-`、不安全字符→`~XXXX`、截断 251、外包 `--…--` | 例：`--C-Users-pyg12-.dsh-study-work-goal-mtqx3m6d-study--`；非 ASCII/`@`/空格会转义（`~0040`、`~0020`） |
| 会话结构 | 多帧 zstd 拼接：**第 1 帧只含 header 行**，之后每个 append 批次一帧 | 实测单会话 2–1542 帧；事件类型含 `session/title`、`user/message`、`assistant/message`、`tool/call`、`tool/result`、`request/context`、打包 `text-chunks`/`tool-call-chunks` 等 |
| 子代理会话 | **与父会话同 cwd ⇒ 落在同一个项目目录**，header 带 `parentSession`/`delegationDepth` | 全机 50 个 subagent 会话；学习区目标当前 0 个（但机制上会产生） |
| 工作区注册表 | `~/.dsh/storages/workspace.json`（**全局单文件**：`global.workspaceIds` 顺序 + `tables.workspaces[id] = {path,title,sessionIds,createdAt,updatedAt}` + `global.archivedSessionIds`） | 6.4KB，9 个工作区，10 个归档会话 |
| 会话投影缓存 | `~/.dsh/storages/session_projcache.json` | **23.6MB**，官方定性为"自愈缓存"（cold-read 未命中会回源重建） |
| 附件（图片） | `~/.dsh/attachments/v1/objects/<sha256[0:2]>/<sha256>`（内容寻址） | 本机无此目录（无图片会话） |
| 绝对路径在会话正文里的出现 | header `cwd` 用 `\\` 转义写法；插件注入的指令文本用 `/` 写法 | `goal-mtqx3m6d-study` 的 4 个会话：转义形式 46 处 + 正斜杠形式 116 处 |

会话 header 实例（逐字）：

```json
{"type":"session","version":0,"id":"session-072d0a0c-…","createdAt":1788518612327,
 "cwd":"C:\\Users\\pyg12\\.dsh\\study-work\\goal-mtms1l5g-transformer",
 "delegationDepth":0,"agentPreset":"standard"}
```

> 关键推论：**"工作区的所有 session" 的权威定义 = 该项目目录下的全部会话目录**（含 subagent 会话、含面板已丢失绑定的孤儿会话、含被归档的会话），而不是 `goal.json` 里 `sessionId` 那几个。

## 2. 导出清单（逐层）

### A. 目标内容区 —— `~/.dsh/study-work/<goalId>/` **整棵目录树**

以 zip 内 `goal/` 为根，保留相对路径，不落任何绝对路径。包含：

| 条目 | 说明 |
| --- | --- |
| `goal.json` | 状态机唯一权威：topic/target_level/requirements/status/draft/chapters[]（含每章 `sessionId`、`file`、`qaFile`）+ 目标 `sessionId`/`workspaceId` |
| `draft.json` | 课程草案（被退回后是**空文件**，空文件也要原样带上，用于区分"无草案"和"草案被清空"） |
| `chapters/NN-<slug>.md` | 讲义 |
| `chapters/NN-qa.md` | 问答要点沉淀 |
| `chapters/NN-notes/**` | 回写补充内容（每主题一文件，可含子目录） |
| 目标目录内**任意其他文件/子目录** | 会话 AI 有权在工作区（= 目标目录）写任何文件：练习题、代码、图片、笔记。按"目标下的所有内容"的字面要求，全量递归 |
| 历史遗留文件 | 如旧版 `diagnostic.json` / `diagnostic.md`（早期目标有），同样随目录带出 |

排除与保护：

- 排除 `goal/<…>/node_modules`、`.git`、`*.pack` 之类（可选，见 D5）；
- 单文件 > 20MB 跳过 + 在 manifest 里记 warning（防止工作区里出现大二进制把 zip 撑爆）；
- 目录内 `.dsh-*` 临时/锁文件跳过。

### B. `.mnemon/`（该目标工作区的运行时记忆）—— 默认**不含**

`~/.dsh/study-work/<goalId>/.mnemon/runtime/{memories.json,MEMORY.md,USER.md}`。它属于该工作区的记忆状态，但：与 DSH 全局记忆空间耦合、跨机语义不确定、体积可能不可控（若日后写 sqlite 库）。→ 默认排除，提供开关 `includeWorkspaceMemory`（见 D5）。

### C. 会话集合 —— 该目标工作区项目目录下的**全部**会话目录

对每个会话目录（当前只有 1 个文件，但按"目录保留给其他会话自有产物"的官方语义，整目录递归）：

| 条目 | 形态 | 为什么是这个形态 |
| --- | --- | --- |
| `session.jsonl.zstd`（**逐字节原文**） | zip 内 `sessions/<sessionId>/transcript.jsonl.zstd` | 导入端可直接落盘到目标机根目录，**零解码/零重压缩** ⇒ 最高保真。宿主自带的"会话日志导出"用的是解码后的明文 `session.jsonl`，导入时反而必须重新压帧。若目标机 `compression: 'none'`，导入时再解压成 `.jsonl` |
| `header.json`（manifest 侧记录，不改 transcript） | id / cwd / createdAt / parentSession / agentPreset / delegationDepth / title / 帧数 / 明文与压缩字节数 / sha256 | 让 zip 不解析正文也能被检查、被路径重写、被"会话标题"预览 |
| 会话目录内其他产物 | `sessions/<sessionId>/files/**` | 前向兼容（DSH 语义允许） |

导出前必须做的两件事（宿主已有先例）：

1. 对**当前存活（live）**的会话先 `sessions.flush(session)`（DSH 自己的导出即如此），否则 zip 里只有上一次 flush 的前缀；
2. 用 `ctx.get('sessionPersistence').locate({cwd, id})` 解析路径，**不要自己复刻 projectKey/encodeSegment**（转义规则含 `~0040`/`~0020`/251 截断，复刻必错）。

### D. 附件 / 媒体

扫描导出会话正文里的 `type:'image'` + `attachment` 引用，把对应对象从 `~/.dsh/attachments/v1/objects/…` 带进 zip（`media/<attachmentId>.<ext>` 或保持内容寻址 `objects/<xx>/<sha256>`）。导入时写回 attachment store（内容寻址 ⇒ 可按 sha256 原样复原，`attachmentId` 引用继续有效）。本机现状：空集。**这是"以后不会因图片丢失而变砖"的必要项，成本低，建议纳入。**

### E. 工作区登记信息 —— 导出为**参考元数据**，不导出全局文件本体

`~/.dsh/storages/workspace.json` 是全局单文件（含所有工作区、持久顺序、`archivedSessionIds`）。整包覆盖会摧毁目标机的其它工作区与顺序；且该注册表有启动不变量（同一会话被索引到两个工作区 / 两条记录声明同一路径 / 顺序偏离 ⇒ **拒绝启动**）。

因此只导出该目标那一行：

```
workspace.json  (zip 内，仅 informational)
{ id, path(绝对，源机), title, sessionIds, createdAt, updatedAt, archived: [sessionId…] }
```

导入时**走公开 API 重建**，绝不手改 `storages/workspace.json`：
`workspaceRegistry.create(absDir, title)` → 对每个会话 `ws.attachSession(sessionId)`（它会校验会话 header 的 cwd 与工作区 path 一致 ⇒ 这正是第 3 节路径改写的动机）→ 归档成员按需在导入后 `archiveSession(id)`。

### F. `manifest.json`（新增，唯一的事实头）

```
formatVersion, tool(study-plugin 版本), exportedAt
source: { platform, dshHome, sessionsRoot, studyWorkRoot, user }
goal:   { id, dir, title, topic, status, chapterCount, goalJsonSha }
files:  [ { zipPath, srcAbs, bytes, sha256, kind: goal|session|attachment } ]
sessions: [ { id, zipPath, cwd, createdAt, parentSession?, agentPreset?, title,
              frames, compressedBytes, logicalBytes, sha256, archived, boundTo: goal|chapter-N|unbound } ]
pathRewrite: { sourceGoalDir, sourceSessionsProjectKey, sourceStudyWorkRoot, sourceDshHome }
warnings: [ 跳过的大文件 / 读不到的会话 / 缺失 attachment / 无 flush 的 live 会话 … ]
```

## 3. 明确**不**导出

1. `~/.dsh/settings.yaml`、`.credentials.yaml`、`dsh-pocket/token*` —— 配置与**凭据**，绝不能进包；
2. `~/.dsh/logs`、`skins`、`skin-center`、`profiles`（含已装插件本体）、`task-board`、`integrations`、`.agent-presets`；
3. `~/.dsh/storages/session_projcache.json`（23.6MB 自愈缓存，冷读自动回源重建）；
4. `~/.dsh/storages/workspace.json` 全量（只带该目标 row，见 E）；
5. 其它目标的目录、其它工作区的会话项目目录、`study-work/index.json` 的其它行；
6. `study-work/plugin/`（动态版恢复快照，130KB，属安装产物不是学习内容）、`study-work/README.md`（插件启动即重写）；
7. 全局记忆 `~/.dsh/.mnemon`（非目标作用域）。

## 4. zip 内部布局（建议）

```
study-goal-<goalId>-<YYYYMMDD-HHmm>.zip
├── manifest.json
├── goal/                              # A：目标目录整棵树（相对路径）
│   ├── goal.json
│   ├── draft.json
│   └── chapters/…
├── sessions/
│   └── <sessionId>/
│       ├── transcript.jsonl.zstd      # C：逐字节原文（或 .jsonl，视源机编码）
│       └── files/…                    # 预留：会话自有其他产物
├── attachments/objects/<xx>/<sha256>  # D：内容寻址原样
└── workspace.json                     # E：仅该目标的 row（参考）
```

导入落点（目标机）：`<studyWork>/<goalId>/**` ← `goal/`；`<sessionsRoot>/<projectKey(新 absDir)>/<sessionId>/session.jsonl.zstd` ← `sessions/**`；attachment 对象 ← `attachments/`；索引与登记走 API 合并。

## 5. 已确认决策（2026-09-09 用户拍板）

| # | 决策 | 选定 |
| --- | --- | --- |
| D1 | 会话范围 | **目标工作区项目目录下全部会话**（含 subagent、孤儿、已归档） |
| D2 | 路径策略 | **只改写会话 header 的 `cwd`**（正文旧路径作为历史文本保留；不做全文替换） |
| D3 | 导出粒度 | **单目标一个 zip**（面板每个目标行一个「📤 导出」；不做多目标合包） |
| D6 | 交付通道 | 导出 = **两处**（浏览器下载 + 落 `~/.dsh/study-work/exports/`）；导入 = **服务器端 zip 路径**（不做浏览器上传） |
| D5 | 附加内容 | **含附件图片**；**不含** `.mnemon` 工作区记忆 |
| D7 | 双轨 | **只做常驻版 `study-plugin/`**；动态版 `src/host.js`（路线 A 回退）不实现 |

仍按默认执行的细则（未列入确认问题，如需改变请说）：

- **会话 id 冲突**：目标机同 id 会话已存在 ⇒ **默认中止并报告冲突清单**；提供 `skipSessions` 与"整包换 `goalId` 另存为副本"两条出路（换 goalId 不改 session id，因为 D2 只重写 header 的 cwd）。
- **大文件保护**：目标目录内单文件 > 20MB 跳过 + warning；`node_modules`、`.git`、`*.tmp/.lock` 不入包。
- **导入后重启提示**：工作区/会话发现与会话投影缓存在宿主启动期定型，导入报告固定提示「重启 DSH 后左栏可见」。
- **隐私提示**：`manifest.json` 含源机绝对路径与用户名（D2 的路径改写需要它）。包给别人前先看一眼。

## 6. 技术风险验证（已通过）

**风险**：D2 要改会话 header 的 `cwd`，而 transcript 是"多帧 zstd 拼接、第 1 帧只含 header 行"。改一帧会不会让宿主拒读？

**做法**：复刻宿主 `scanZstdFrames` 的帧切分，只重编第 1 帧（用与宿主相同的 `{params:{ZSTD_c_checksumFlag:1}}` 选项），第 2..N 帧逐字节保留。

**结果**（真实目标会话 `session-7c203ad1…`，1184 帧 / 1418 逻辑行）：

```
SOURCE    : bytes=434332 frames=1184 logicalLines=1418  cwd=C:\Users\pyg12\.dsh\study-work\goal-mtqx3m6d-study
REWRITTEN : bytes=434323 frames=1184 logicalLines=1418  cwd=C:\Users\demo\.dsh\study-work\goal-demo
  id preserved: true | other header fields equal: true
  tail frames byte-identical: true
  logical lines beyond header identical: true
  new frame1 descriptor=0x4 checksumFlag=true firstFrameLineCount=1
```

帧描述符与宿主自己写出的完全一致（`0x04`：非 single-segment + content checksum）。落盘位置由 `sessionPersistence.locate({cwd,id}).path` 计算，正好满足宿主的身份校验（"header id/cwd 派生所选 transcript 路径"）。

**导入自检（写进实现）**：落盘后对每个会话调宿主 `sessionPersistence.inspect(id)`（官方定性"非修改式检查"）证明宿主读得懂；任一失败即回滚本次写入。运行期真验证 = 重启后左栏能打开还原的会话。
