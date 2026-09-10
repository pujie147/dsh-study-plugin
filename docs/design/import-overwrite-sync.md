# 学习区 导入 / 导出 —— 覆盖式同步语义（v0.3.0，已实现）

> 状态：**已确认并落地**。用户在 2026-09-10 对四个决策点分别拍了「做 / 采纳 / overwrite / 不做」。
> 本篇是 `export-import-scope.md`（v0.2.0 首次实现）的**后续修订**：D12 的「只改 cwd、不改 id」被证伪，
> 由本文 D17–D22 取代；其余范围清单继续有效。

## 0. 一句话目标

导出 / 导入不是为了"一次性恢复备份"，而是**云同步的前置能力**：
目标、会话、工作区三者都必须"已存在也能覆盖"，并且**同一个包重复应用 = 无改动**（幂等），
不能每同步一次就多出一堆副本。

## 1. 事故与证据（为什么要改）

用户实机现象：**「导入之后工作区的文件夹正常，但是 session 没有显示」**。

现场取证（`~/.dsh`，只读）：

| 观察 | 值 |
|---|---|
| 导入产生的工作区记录 | `fd22daa8…` path=`…\goal-mttqn6kv-transformer`，`sessionIds` = 3 条**全部在册** |
| 同一文件的 `global.archivedSessionIds` | 含其中 2 条 id（`session-761ec32d…`、`session-bd1c3e1b…`） |
| 第 3 条 transcript | 418 B / 4 事件，**没有 `turn/start`** ⇒ 宿主判为 blank |
| Web 端可见性谓词 | `origin!=='subagent' && !archived.has(id) && (!blank \|\| id===current)`（`dsh-client-ui-workspace/lib/client.js:101`） |
| 文件系统残留 | 另有两个 projectKey 目录里 **6 个空 session 目录**（回滚只 unlink 未 rmdir） |

三条全被隐藏 ⇒ 症状逐字吻合。而更早的三次导入失败另有原因：

```
宿主 list() / inspect() 实测抛：
  duplicate JSONL session id "session-f02e1cea-…" appears in multiple project directories
```

**根因（一句话）**：宿主把 **session id 当作全局身份**，而旧实现按 D2/D12 原样沿用源 id ⇒
同机"导出→导入"必然撞身份：轻则继承归档态（导入即隐身），重则整个 `session.list` API 炸掉（全库会话消失）。
`prune/覆盖` 的需求把这件事从"偶发"变成"必然"。

## 2. 宿主事实（读码 + 真后端离线实测，写代码前先看）

| # | 事实 | 证据 |
|---|---|---|
| H1 | session id 在 sessions 根内**全局唯一**；同 id 出现在两个 project 目录 ⇒ `list()` / `loadStored()` 直接抛，连带 `session.list` 整个 API 失败 | `dsh-session-persistence-jsonl/lib/index.js:1085`、`:1331`（实测复现） |
| H2 | 物理路径由 header 反推：`logPath(root, header.cwd, header.id)`；不一致即 `corrupt session log` ⇒ **换 id 必须同步换目录名，换 cwd 必须换 project 目录** | 同上 `assertStoredIdentity:1345-1354` |
| H3 | header 行严格校验：`type==='session'`、`version` 数字、`id` 字符串、`createdAt` 非负安全整数、**`delegationDepth` 非负安全整数**、`origin ∈ {undefined,'subagent'}` | `isHeaderLine:70` |
| H4 | 第 1 个 zstd 帧**必须恰好是一行 header**；帧 = `zstdCompress(text, {checksumFlag:1})`，正文帧 = 每批 `lines.join('\n')+'\n'` | `assertZstdHeaderFrame:741`、`encodeMaterialization:1171`、`encodeEventBatch:1180` |
| H5 | 事件按 `seq` 连续校验，跳号即 `corrupt session log: seq gap in committed region`（实测） | `scanLog`；测试 `portable.test.mjs §8b` |
| H6 | `archivedSessionIds` 是**注册表级全局集合、按 id 键控**，且这个版本**只有归档、没有解档 API/UI** ⇒ 沿用被归档过的 id = 永久隐藏 | `dsh-workspace` README §17 + 全库检索 `unarchive` 无命中 |
| H7 | `Workspace.attachSession(id)` 要求 `fs.realpath(header.cwd) === record.path`，否则抛；`ws.sessionIds` 是**投影**（`sessionPath(id)===record.path` 过滤 + 写入时剪枝）⇒ attach 不抛 ≠ 会显示 | `dsh-workspace/lib/index.js:87-105`、`:78-80`、`:149-166` |
| H8 | `storages/session_projcache.json` 按 id + `seq` 围栏存派生投影；把日志整体替换成更短的 ⇒ 派生元数据（统计/标题/时间线）滞后到下一次真实写入。**只追加尾帧不受影响** | `dsh-session-projection-cache` README + 冷读阶梯描述 |
| H9 | `inspect()` 只读（实测字节不变），`load()` / `prepare()` **有写副作用**（追加合成 closer）⇒ 自检/测试只用 `inspect()` | 实测（103 份 sha256 复核一致；合成 fixture 上 `load()` 270→369 B） |
| H10 | 会话 LIVE 时宿主协调器独占该文件（write-behind），外部写入会被回写盖掉 | `PersistenceCoordinator` 写路径 |

> 测试怎么拿到这些：`study-plugin/test/host-fixture.mjs` 用**宿主真实的** `JsonlSessionPersistence` +
> `WorkspaceRegistry` + 真实 `SessionStore`（只假一个内存 `storageDomain`）。两点实测坑：
> ① 模块路径必须 `realpath` 成**长文件名**再 import —— 走 8.3 短名（`PYG12~1`）时 cordis 的
> `/@deepseek-ai/` URL 模式匹配不上，裸标识符导入全灭；
> ② `ctx.sessions` 用真实 `SessionStore` 而不是手写 `prepare` stub —— stub 会漏掉
> `Session.fromRestore` 的 surfaceOp 校验（实测一个坏 `surfaceOp` 行 stub 放过、真 store 拒）。

## 3. 方案：双身份 + 幂等 upsert

### 3.1 身份模型（D17）

- **remoteId**：会话的稳定身份，随包旅行（= 导出时该会话的 id，或导出机账本里它的 remoteId）。
- **localId**：本机身份，受 H1/H6 约束，可由 `resolveImport` 换发。
- 映射落在**目标目录内的 `.study-sync.json`**（设备本地状态：导出不含、绝不从包恢复）：

```json
{ "v": 1, "deviceId": "dev-…", "remoteGoalId": "goal-mttqn6kv-transformer",
  "appliedFrom": { "ref": "…zip", "exportedAt": "…", "at": "…" },
  "sessions": [ { "remoteId": "…", "localId": "…", "pkgId": "…", "appliedSha": "…",
                  "appliedSeq": 3132, "appliedRows": 817, "lastAction": "append" } ] }
```

### 3.2 身份解析（每条会话，D18）

候选顺序：**账本已分配的 localId（幂等关键）→ 包里的 id → 新 uuid**。淘汰条件：
① 该 id 已被**别的 project 目录**占用（H1）；② 该 id 在宿主**归档集**里（H6）。
命中"该 id 就在本机目标目录里"⇒ `identity=update`（原地更新）；空闲且未归档 ⇒ 沿用（`fresh`/`adopt`）；否则 `reissue`。
`goal.json` 的 `sessionId` / `chapters[].sessionId` / `research.sessionId` 与包内会话的 `parentSession` 一律按 `pkgId|remoteId → localId` 重映射。

### 3.3 落盘规则（D19，尊重 append-only）

| 条件 | 动作 | force? |
|---|---|---|
| 目标文件不存在 | `create` | 否 |
| 全文件 sha 相同，或**除 header 外逐行相同** | `noop` | 否 |
| 本地是包的真前缀（且本地无撕裂尾帧） | **`append`：只追加尾帧** | 否 |
| 本地尾部有未完成帧 / 无法按行比对（超 60 MB） | `replace`（修复性整份替换） | 否 |
| 包比本地旧 | `rewind` | **是** |
| 与本地分叉（首个差异行起不同） | `diverged` | **是** |
| 该会话在本机正被打开 | `liveBlocked` | **不可放行** |

`append` 是这条链路的日常路径：不动已有字节 ⇒ H8 的 seq 围栏继续有效、日志天然连续（H5），
并为将来"只传增量帧"留好位置。

### 3.4 模式与目标/工作区覆盖（D20、D21）

- `overwrite`（**面板默认**）：目标存在 ⇒ 更新；`wsRegistry.resolveByPath` 命中 ⇒ 复用记录并按需 `setTitle`，否则 `create`；重挂席位。
- `merge`（**聊天工具缺省**）：同上，但分叉/回退项**不动**（`skippedDiverged`），不报错。
- `copy`：换新 goalId，会话全部换身份，绝不触碰现有目标。
- 血缘判定：已存在目录的账本 `remoteGoalId` 与包一致 ⇒ 同一目标可覆盖；否则报 `goalUnrelated`，只有 force 才写。
- **不做 prune**（D22，用户明确"先不做"）：本地比包多的文件与会话一律保留，只在结果里报差异计数。

### 3.5 自检与回滚（D14 的加强）

1. 逐条 `persistence.inspect(localId)`（H9，只读）；
2. 读**宿主投影** `ws.sessionIds`，任一 localId 不在其中 ⇒ 判失败（这正是"看不见"的权威判据）；
3. 失败 ⇒ `restore()`：还原被覆盖的每个字节（事务内备份，预算 64 MB）、删除本次自建的文件与**目录**、
   恢复 `index.json` 快照、删除本次新建的工作区记录；
4. 顺带摘除幽灵席位：账本里被本次换掉的旧 localId、以及 transcript 已不存在的在册席位（只摘席位，不删文件）。

## 4. manifest v2

包级新增 `deviceId`、`sync.remoteGoalId`；每条会话新增 `remoteId`、`rows`、`maxSeq`、`lastTime`、`blank`、`origin`。
`SUPPORTED_FORMAT_VERSIONS=[1,2]` ⇒ **v1 包仍可导入**（`remoteId` 回落为其 `id`，行级关系照常按解码比对得出）。

## 5. 隐私与已知边界

- manifest 含源机绝对路径、用户名、deviceId ⇒ 面板与工具返回值都提示"公开发布前先看一遍"。
- 换 id 的代价：包内正文若**引用了自己的会话 id**（文本里提到），那些文字仍是旧 id（D12 保留正文原样的决定不变）。
- 悬空 `parentSession`（父会话不在包内）保留原值不删；实测 `inspect()`/`list()` 不受影响。
- 被换下的旧 localId 的 transcript 仍留在盘上（宿主没有删除会话 API）；本插件只摘席位，不越权删用户数据。
- blank 会话与 `origin==='subagent'` 子会话按宿主规则不会在工作区单独出现 ⇒ 导入结果里**明确报数**，不再让人以为丢了。

## 6. 验证

| 套件 | 结果 |
|---|---|
| `test/smoke.mjs`（真 persistence + 真 registry） | **101 断言 / 0 失败** |
| `test/portable.test.mjs`（含 §8 真后端交叉验证） | **29 断言全过** |
| `test/client.test.mjs`（bundle 驱动） | **24 断言全过** |
| `npm run sweep`（本机全部真实 transcript） | 103 份 / 69.9 MB 全过 |
| `scripts/cleanroom-check.mjs`（tarball 端到端） | 2 路由 + 7 工具 + 导出→抹掉→覆盖式导入→重复导入幂等 ✅ |

关键回归（任何一条退化都应视为破功）：
① 源会话仍在盘上时导入 ⇒ 无 duplicate id、`list()` 正常、投影齐全；
② 归档集里的 id 不复用；
③ 同一个包导两次 ⇒ 第二次 `idempotent=true`；
④ 包更新 ⇒ 走 `append` 且宿主 `inspect()` 认账；
⑤ 包更旧 / 分叉 ⇒ 无 force 被挡且本地未被改动；
⑥ 会话 LIVE ⇒ 硬冲突；
⑦ 自检失败 ⇒ 不留空目录、`index.json` 逐字还原。

## 7. 通往云同步还缺什么（不在本次范围）

1. 传输通道（对象存储 / HTTP）+ 鉴权与多设备身份；
2. 增量：包内只带 `appliedSeq` 之后的尾帧（§3.3 的 append 语义就是为它准备的前缀可比性）；
3. 删除同步（tombstone）与 prune 策略 —— 现在故意不做；
4. 真分叉的合并策略（目前是"要么 force 覆盖、要么不动"）；
5. 单目标包 → 多目标/全库包的批量同步（账本已是每目标一份，天然可并集）。
