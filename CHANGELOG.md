# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

## [0.7.2] - 2026-09-18

### added
- **章节「打开讲义」（D33）**：点「📖 开始学习」在切换到章节会话后**自动打开本章讲义**；章节行另给独立「📖 讲义」按钮随时可开。落点分层，**不在左侧本面板内渲染**：
  1. 新 RPC **`study.readChapter`**（goalId + chapter_index → 绝对路径/正文/标题）先确认讲义确实已生成——`ch.file` 过 `path.basename` 全等校验，绝不借道读 `study-work` 之外的文件；
  2. 交给 **[DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)**（页签式右侧面板底座）开成页签：`ctx.get('betterSidebar').openFile({ sessionId: 本章会话 }, 绝对路径, 章标题)`，能力按其官方 `features` 单调列表含 `'openFile'` 门控，`.md` 由它内置 markdown viewer 渲染；服务只在 **client 侧**存在 ⇒ 与 `uiWorkspace` 同样**惰性取、绝不写进 inject**（没装它的机器不能因此启不来），两个插件互不依赖；
  3. 取不到服务 / 无该能力 → **`window.open('/study-file?goalId=…&chapter=…','_blank')`** 浏览器新标签；
  4. 新标签被浏览器拦下 → 白话提示里带上完整地址，用户手动开。
- **新 HTTP 路由 `/study-file`**（GET 章节讲义页）：入参**不含任何路径**（缺 `chapter` 或非整数 → 400、未知目标/章节、讲义未生成 → 404、非 GET → 405），默认出自包含 HTML —— 正文**全量转义**（注入载荷只会以 `&lt;script&gt;` 出现）、CSP `default-src 'none'; style-src 'unsafe-inline'` + `nosniff`、深色模式适配；`format=raw` 出 Markdown 原文。来源 IP 依旧不判定（承 D25）。
- 测试：`client.test` 40→**46**（未装插件时新标签 / 弹窗被拦降级提示 / `openFile` 收到 `{sessionId}`+绝对路径+**章**标题且不再开新标签 / `features` 缺 `openFile` 时不硬调 / 缺讲义白话报错 / 开始学习以本章会话为 scope 联动），`smoke` 新增 readChapter **3** 条 + `/study-file` **11** 条（注册、200+content-type、CSP、注入不执行、`format=raw` 原文、400×2、404×2、405）。净室探针的路由集合断言改为三条路由。
- ⚠ **真机验收未做**：`openFile` 的签名/字段核对自 better-sidebar 源码（0.19.1），但"装了这个插件的 DSH 上点一下真能出现右侧页签"仍需实机跑一次；其 `openTab` 在用户关掉 `editor` 页签类型时静默 no-op，本插件无法感知（见 D33 残留边界）。

### 备注（与本功能无关）
- 本机宿主升级到 **dsh 0.1.5-rc.2** 后其 `JsonlSessionPersistence` 不再暴露 `inspect()` ⇒ `smoke`（249 行起）与 `portable`（220 行）在**未改动的 master 上同样失败**，属夹具待跟进宿主漂移，与本功能无关、未改代码；`client.test` 46 / `sync.test` 78 全绿。

## [0.7.1] - 2026-09-18

### fixed
- **一键设备码轮询端点纠正（v0.7.0 真机才暴露的坏路径）**：`syncPollDeviceFlow` 原先打 `POST {web}/login/oauth/device/poll` 换取令牌，但那是 **GitHub App** 的端点；对普通 **OAuth App** 的设备码流程，真 GitHub 会返回 **HTTP 422 + HTML 报错页**（面板显示「⚠ 设备码轮询 失败: HTTP 422 — <!DOCTYPE html>…」）。改为文档规定的正确端点 **`POST {web}/login/oauth/access_token` 带 `grant_type=urn:ietf:params:oauth:grant-type:device_code`**，返回规范 JSON（`authorization_pending` / `access_token`）。顺带把 `slow_down`（轮询过快）也当正常中间态继续等，不误报失败。
- **根因**：mock GitHub server 照抄了代码里的同一错端点，所以 `sync.test` 一直全绿 ⇒ 只有真机一键才暴露。已在 mock 里复刻真端点语义（缺 `grant_type` 即返回 HTML 422），并加回归断言「轮询必走 access_token + device_code grant_type、绝不再打 device/poll」。`sync.test` 77→**78** / `client.test` **39** 全绿。
- **远端目标列表补「⬇ 拉取到本地」按钮**（真机验收发现的 UX 缺口）：旧版「拉取」只挂在**本机已有目标**且判为 `remoteAhead` 的行上，一台**空机器**（本机还没有学习目标）列出了远端目标却没有任何拉取入口 ⇒ 首次迁移/多机 adopt 后无法把仓库里的目标拉到本机。现远端每一行直接给「⬇ 拉取到本地」，走 `syncPull{remoteGoalId}`（本机无该目标即新建导入，不带 discardLocal）。`client.test` 39→**40**（新增远端行首次拉取断言）。

## [0.7.0] - 2026-09-18

### added
- **GitHub 绑定「一键登录」主路（设备码 OAuth + 内置 public client_id，D32）**。发布版在 `lib/index.js` 内置一个官方 OAuth App 的 **public `client_id`**（`DEFAULT_CLIENT_ID`，公开值、**绝不含 client_secret**，设备码流程本就不需要 secret），`loadSyncCfg` 首次读取即种子化进配置。面板未绑定态据此露出 **🔗 一键登录 GitHub 授权**：点一下 → 自动 `window.open` 验证页 + 自动复制一次性代码 → **`setInterval` 自动轮询**（`authorization_pending` 静默继续，成功即落地并刷远端，**不再需要手动点"确认"**）。`syncGetConfig` 回 `oneClick` 标志，客户端据此切换一键/手填 UI。
- **「▸ 高级选项」折叠**：自构建/内置 App 被撤销时仍可手填 client_id「发起设备码」，或用 **fine-grained PAT**（逃生舱，逐机独立、单仓 Contents、最小权限）绑定。文档明确 **A vs C 的撤销耦合与 scope 差异**（撤 OAuth App = 一次作废所有机器的设备令牌；撤 PAT 只影响单机）。
- **多主机绑同一账号 = adopt**：同一 GitHub 账号下多台机器各自授权、各拿独立令牌、共同认领 `dsh-study-sync`；`locateOrCreateRepo` 见已有本插件认领标记即**直接采用**（`ready`，不触发 0.6.0 的接管流程），导出包各带 `deviceId` 供冲突面板区分来源。`sync.test` §9b 回归（第三台 adopt 后 `ready` 非 `account-only`、不清 A 已推目标、跨机 `deviceId` 独立）。

### changed
- `sync.test` 73→**77**、`client.test` 保持 **39**（一键/自动轮询/高级折叠/PAT 逃生舱/占用→接管/多主机 adopt 全链路）；`syncGetConfig` 增 `oneClick` 字段。红线不变：token 明文只 `••••末四位`、endpoint 强制 https 仅回环放行 http、认领标记仍是拒写他人同名仓的唯一凭据、接管/adopt 均不删已有内容。

## [0.6.0] - 2026-09-18

### changed
- **固定仓被本账号自己占用时不再硬拒，改为明示「接管」**（D28 修订）。0.5.0 遇 `dsh-study-sync` 已存在且无有效认领标记（或 `kind` 被改坏）会直接拒绝写入并要求改名/换账号，误伤"同一个仓本来就是我自己的、只是想重新认领"这一常见场景。现在绑定遇到占用会抛结构化的 `repoOccupied`（RPC 带 `needTakeOver:true`），并把已验证的 token 保留在 **account-only** 态；面板据此给出两路：**「✅ 接管这个已有仓库」** 与 **「↩ 放弃」**。

### added
- **`study.syncTakeOver` RPC + 面板接管入口**：点「接管」复用 account-only 里已存的 token 重跑 `locateOrCreateRepo({takeOver:true})`，**只补写/替换 `.study-sync-owner.json` 这一个标记文件**（对已存在的标记文件 PUT 带 sha），此后一切同步只落在 `study-goals/` 前缀下。**绝不删除该仓任何已有内容**（承 D22 no-prune）；「放弃」只清本机凭据（去改名或换账号）。红线不变——对他人同名仓永不自动下手，接管必须本人明示确认。`sync.test` 73 / `client.test` 39 断言（新增占用→接管/放弃两条链路与"token 明文不明文回显"回归）。

## [0.5.0] - 2026-09-18

### added
- **GitHub 同步（M5）：跨机器经一个固定私有仓双向同步学习区**。在「📤 导出 / 导入」之上叠一层，机器之间**只通过 GitHub 固定仓 `dsh-study-sync` 流转**，不搭自建服务、不加运行时依赖。正确性靠 **Contents API 的 sha 前置条件做乐观 CAS**，**无锁 ⇒ 无死锁**（记 D26）。仓库布局：`.study-sync-owner.json`（认领标记）+ `study-goals/<remoteGoalId>/bundle.zip` + `bundle.meta.json`（**meta 最后提交 = 提交点**）。
- **绑定状态机（4 态：unbound / account-only / ready / invalid）**，两条授权路：**设备码 OAuth（主路）** `syncStartDeviceFlow` + `syncPollDeviceFlow`（`authorization_pending` 是正常中间态），**fine-grained PAT（兜底）** `syncBindPat`。固定仓"定位或自建"；**认领标记 kind 是拒绝误写他人同名仓的唯一凭据**——已有同名仓无标记 / 标记被改坏 ⇒ 拒绝写入且不落绑定（D28）。`syncRebind` 走失效恢复，`syncUnbind` 只清本机凭据与仓库指向（远端数据与各目标基线不动）。
- **五态冲突判定 + contentDigest**：`syncInspect`（push/pull 内部复用）现算本地包指纹，比对远端 meta 与账本双基线，得 `remoteMissing / upToDate / localAhead / remoteAhead / conflicted`；**会话向量严格超集才快进**，否则判真分叉（D29）。
- **真分叉绝不自动吃掉任一侧**：push 无 force、pull 无 discardLocal 一律返回 `needChoice`，亮出仓库最新的 `exportedAt / deviceId / bytes`，交用户二选一——**「覆盖仓库」= force push** / **「放弃本地」= discardLocal 拉取（不 prune）**（D30，放弃≠删除）。
- **拉取完整性双校验**：`/git/blobs/{sha}` 下载校验 git blob sha，落地前再按 `meta.zipSha256` 校验整包，脏包不入库。
- **客户端 ☁ GitHub 同步面板**：未绑定态给 client_id 输入 + 设备码/PAT 两条入口；已绑定态列远端目标、逐目标检查五态并推送/拉取；冲突行亮远端时间/设备/体积 + 二选一按钮；invalid 态给重绑入口；无 fetch 降级提示且禁用授权。**token 明文永不出现在面板/任何 RPC 返回**，只显示 `••••末四位`。
- **安全边界**：同步 endpoint 强制 `https`，明文 `http` 仅放行回环（`127.0.0.1|localhost`，为本地 mock 测试）（D31）。
- **测试**：新增 `test/sync.test.mjs`（**70 断言**，真宿主 fixture + 内存 mock GitHub server + 双设备）覆盖绑定状态机、占用/建仓 422 竞态、快进链、真分叉二选一、CAS(200/409) 与坏包 sha256 拦截、降级红线；`test/client.test.mjs` 增 8 条同步面板断言（30 → 38）。
- **文档**：新增 [docs/design/github-sync.md](./docs/design/github-sync.md)，README 增「GitHub 同步」章（含 OAuth App 注册步骤与 **token 明文风险**），PROJECT.md 记 **D26–D31**。

### changed
- 版本号 `0.4.0` → `0.5.0`（新增同步能力，向后兼容：手动导出/导入通道与数据契约不变，同步层缺席任何服务只降级自身）。
- 适配宿主 transcript 的生成版本文件名（`session.v3.jsonl.zstd` 等）：会话收集/索引/查双改走统一的文件名候选解析器，修复在新宿主上导出取不到会话正文的问题。
- 已知限制更新：云同步通道已实现；增量传输、删除同步（tombstone）、多目标合包仍未做（>50MB 拒绝同步）。

## [0.4.0] - 2026-09-14

### fixed
- **从另一台机器打开面板，全线报「study RPC HTTP 403」**（用户实机报告，症状是「创建失败: study RPC HTTP 403」）。根因是本插件自己的守卫，不是宿主：`/study-rpc` 与 `/study-export` 各有一处 `req.socket.remoteAddress` 与 `127.0.0.1 / ::1 / ::ffff:127.0.0.1` 三个字面量的硬比对，不相等即 403。而客户端用的是**相对路径** `fetch('/study-rpc')` —— 页面从哪台机器加载、请求就发给那台机器 ⇒ 只要面板不是本机打开，请求必然带远程 IP 进来，远程访问下**必然 403**。守卫在 `handlers['study.*']` 分发之前，所以 20 个 RPC 方法 + zip 下载一起被挡。现已删除（见下）。
- 顺带排除宿主侧嫌疑：`@deepseek-ai/dsh-host-webserver` 的派发器不做任何来源/Origin/CORS 检查，宿主包里也没有会对插件 prefix 路由返回 403 的中间件；`src/client.mjs` 与 `study.listExports` 的 `downloadUrl` 全程相对路径，因此放开来源判定后不需要改客户端，`lib/client.js` 无 diff。

### removed
- **`/study-rpc`、`/study-export` 的 loopback 守卫**：本插件不再判断请求的 IP/端口。⚠️ **升级即放开这两条路由到其监听的全部网络**——局域网鉴权由宿主侧的独立插件承担（用户拍板，记 D25）。与来源无关的输入约束**全部保留**：POST-only(405)、1MB body 上限(413)、`/study-export` 的 `path.basename` 全等 + `.zip` 白名单（拒路径穿越，400/404 不变）。
- 今后若再现「study RPC HTTP 403」，来源只可能是宿主侧鉴权插件或中间代理，不再是本插件；报错文案未改动（`src/client.mjs:39`）。

### changed
- `test/smoke.mjs`：两条原「非 loopback 被拒(403)」断言反向钉住新行为（`/study-rpc` 非回环来源 200 + `study.list` 正常返回、`/study-export` 非回环下载 200 且 zip 字节一致），成为局域网可达性的回归钉子；路径穿越 400、未知文件 404、GET→405 三条原样保留，用以证明只删了来源判定。
- 版本号 `0.3.1` → `0.4.0`（删除访问控制属行为变更，非补丁）。
- 文档同步：`README.md`、`docs/PROJECT.md`（路由表 + 新增决策记录 **D25「来源判定外移到宿主侧插件，本插件不判断 IP/端口」**，注明"别把这条删掉的判定当漏了的守卫加回来"）。

## [0.3.1] - 2026-09-11

### fixed
- **点「📄 打开会话」报「连接会话的方法不存在」**（用户实机报告）。根因是宿主 API 漂移，不是数据问题：dsh 0.1.5-rc.1 把浏览器侧的 `connectWorkspace` 从 `workspaces` 服务迁到了 UI 能力服务 `uiWorkspace`（`workspaces` 只剩纯 controller：`list/create/rename/delete/insertBefore/archiveSession/insertSessionBefore`），旧调用点撞上不存在的方法 ⇒ `TypeError`，被面板 catch 后显示成"打开会话失败: …"。症状时有时无是因为只有**目标会话需要新建**（从未建立 / 已被销毁 / 章节首次打开）才走这条路，复用已记录会话的 `sessions.open` 一直正常。现在按「方法是否存在」三段兜底：
  1. `uiWorkspace.connectWorkspace`（新宿主）；报 unknown workspace 时说明镜像还没收到该工作区，等它可见（≤1.5s）后**只重试这一层**；
  2. `workspaces.connectWorkspace`（旧宿主，升级前的安装不受影响）；
  3. `sessions.create({ workspaceId })`（两者都缺席时的最后手段）。
  三层能力全无时只显示白话错误「宿主未提供工作区连接能力」，不再冒 `is not a function`。`uiWorkspace` **刻意不写进模块级 `inject`** —— 那个数组是 cordis 的硬激活门，一旦某个安装没有 `dsh-client-ui-workspace`，`apply()` 就永不执行、整个面板消失；改为点击时惰性 `ctx.get`（成功才缓存）。
- **切换会话失败会把整个动作判死**：`study.recordGoalSession` 已经落盘之后再 `open` 失败，现在降级成提示"请在左侧会话列表手动打开"，不再让账本正确的操作显示成失败。
- **`workspacesSvc.refresh()` 的空转重试**：新版宿主的工作区服务根本没有 `refresh`，原来那句"刷新后重试一次"实际什么都没刷新。改为读 `list.getSnapshot().items` 判定工作区是否已进镜像。
- **镜像未就绪被误读成「会话已销毁」**：新宿主快照带 `phase`（只有 `ready` 可信）。原来只看 `byId` 里有没有，DSH 刚重启/刚建目标时会判定失败并**白建一个新会话**（破坏 D10 幂等），还顺带把用户推进上面那条已坏的新建路径。现在先 `refresh()` 并有界等待 `phase === 'ready'` 再判定。

### changed
- `test/client.test.mjs` 增加宿主形状回归：新宿主（只有 `uiWorkspace`）/ 旧宿主（只有 `workspaces`）/ 两者都无（降级到 `sessions.create`）/ 全缺（白话错误）/ `phase: 'loading'`（不许新建）共 5 个场景，用重新 `apply` 复位服务解析。断言数 24 → 30。

## [0.3.0] - 2026-09-10


### fixed
- **导入后工作区文件夹正常、会话却不显示**（用户实机报告）。根因：宿主把 **session id 当作全局身份**，而 0.2.x 的导入照抄源 id（D2/D12）。三条宿主规则被违反：
  1. 同一个 id 不能出现在两个 project 目录 —— `JsonlSessionPersistence.list()`(`:1085`) 与 `loadStored()`(`:1331`) 遇重复**直接抛错**，连带打爆整个 `session.list` API（症状：全库会话消失，文件夹照常）；
  2. `workspaceRegistry.archivedSessionIds` 按 id 全局键控，且**这个版本没有解档 API/UI** —— 沿用源 id 就继承源会话的归档态（Web 可见性谓词 `origin!=='subagent' && !archived.has(id) && (!blank||id===current)` ⇒ 直接隐藏）；
  3. `storages/session_projcache.json` 按 id + `seq` 围栏存派生投影 —— 整体替换日志会让统计/标题滞后到下次写入才自愈。
  取证与规则全文见 `docs/design/import-overwrite-sync.md`。
- **自检只看 `attachSession` 抛没抛**：宿主 `ws.sessionIds` 是**投影**（按 `realpath(header.cwd)===record.path` 过滤，写入时还会剪枝），attach 不抛 ≠ 会显示。现改为「逐条 `inspect()` 读得懂 **且** 出现在工作区投影里」，任一不过整体回滚 ⇒ 不再出现"导入成功却看不见"。
- **回滚只删文件不删自建目录**：失败导入留下空 `session-*` 目录（实机抓到 6 个）。现在事务记录自建目录并一并删除，`index.json` 逐字还原，本次新建的工作区记录也删除。
- **同一秒连续导出会互相覆盖**：`study-goal-<id>-<秒级时间戳>.zip` 同名 ⇒ 后一次盖掉前一次。现在自动加 `-2/-3` 后缀。
- **导出包把每份 transcript 存了两遍**（zip 条目重复 + `manifest.files` 双记录；两次读到的字节一旦不同还会自校验失败）。现在每个会话只入包一次。
- 会话 header 的 `cwd` 此前写成混合分隔符（`C:\Users\me/.dsh/…`，源于 `BASE` 的拼法）；宿主用 `fs.realpath` 比较侥幸能过，但任何按字符串比 cwd 的消费方都会漏。现统一写宿主 canonical 形态（与 workspace 记录 `path` 逐字相同）。
- `study.reattachGoalSessions` 同样改为以宿主投影判定成败，返回 `notShown[]` 并报告哪些 id 在归档集里。

### changed
- **导入 = 应用一个包（幂等 upsert）**，为云同步铺垫：目标 / 会话 / 工作区已存在时更新而非报错。
- **双身份模型 + 设备本地账本**：包携带稳定身份 `remoteId`，本机 `localId` 按需换发，映射与已应用快照记在 `<goal>/.study-sync.json`（导出不含、绝不从包恢复）。同一目标目录内的同一条会话仍沿用原 id（原地更新/追加）；换目录、撞 id、或该 id 在宿主归档集里 ⇒ 一律换发新 id。`goal.json` 的 `sessionId` / `chapters[].sessionId` / `research.sessionId` 与包内 `parentSession` 按映射重写。
- **会话落盘按 append-only 分档**：内容一致 `noop`；本地是包的前缀 ⇒ **只追加尾帧**（不动已有字节，seq 天然连续、投影缓存不受影响）；本地撕裂尾帧 / 超大无法比对 ⇒ `replace`；包比本地旧或与本地分叉 ⇒ 需 `force`；该会话在本机正被打开 ⇒ `liveBlocked`（`force` 也不放行，宿主回写会盖掉结果）。
- **三种模式统一作用于三层**：`overwrite`（面板默认，用户拍板）/ `merge`（聊天缺省，分叉项 `skippedDiverged`）/ `copy`（新 goalId + 全部换身份）。目标已存在不再硬冲突：账本血缘一致即更新，不一致报 `goalUnrelated` 需 force。
- 工作区登记：`resolveByPath` 命中即复用（标题不同则 `setTitle`），否则 `create`；重挂席位并摘除幽灵席位（被本次换掉的旧身份、以及 transcript 已不存在的在册席位）。**只摘席位，不删文件**。
- 覆盖写入事务化：被覆盖的每个文件先入内存备份（预算 64 MB），失败可逐字节还原。
- 面板导入区改为 三模式 + force 勾选 + 预览**分类计数**（新增/追加尾帧/整份替换/不变/回退/分叉/被挡）+ 每条会话显示「身份 ⇒ 动作」与 `本地行数→包行数`；幂等时提示「已是最新（无改动）」；切换模式或 force 自动重新预览。
- `manifest` 升到 **v2**（会话加 `remoteId`/`rows`/`maxSeq`/`lastTime`/`blank`/`origin`，包加 `deviceId` 与 `sync.remoteGoalId`）；**v1 的包仍可导入**（`remoteId` 回落为其 `id`）。
- `study_goal_import` 工具暴露 `mode` / `force`，预览返回 `plan.counts` 与 `summary`。

### added
- `lib/portable.js`：`rewriteTranscriptHeader`（可换 id/cwd/parentSession）、`analyzeTranscript`（行数/maxSeq/lastTime/blank/帧数）、`compareTranscriptLines`（same/fastforward/rewind/diverged）、`appendLinesToTranscript`（尾帧追加，本地撕裂即拒绝）。
- 目标目录新增 `.study-sync.json`（身份账本）、`study-work/device.json`（本机设备 id）。
- 导入返回值：`applied{create,append,replace,noop,rewind,diverged,liveBlocked,skipped*}`、`remap[]`（含换身份原因）、`idempotent`、`goalFiles{written,same,goalJson}`。
- **`test/host-fixture.mjs`：测试底座换成宿主真实实现**（`JsonlSessionPersistence` + `WorkspaceRegistry`，只假一个内存 `storageDomain`）。此前 mock 照抄我自己的实现（attach 永远成功、列表从盘上现读）⇒ 96 条断言全绿仍漏掉真 bug；现在 duplicate id、`realpath` attach 校验、投影剪枝、`seq` 连续性都由宿主代码执行。模块路径必须 `realpath` 成长文件名（8.3 短名会让 cordis 的 URL 模式匹配失效）。

### tests
- `smoke.mjs` 79 → **101 断言**（跑在真宿主实现上）。新增回归：全新机器式恢复后**宿主投影认账**、同包重复导入幂等、快进只追加尾帧、包更旧无 force 被挡且本地未动、带 force 才回退、追加收敛后再导为 noop、LIVE 硬冲突、自检失败回滚不留空目录且 `index.json` 逐字还原、归档 id 不复用（原因说明归档）、终态无幽灵席位/无空目录、导出卫生（条目唯一、账本不入包、v2 字段齐备、往返 `remoteId` 不漂移）。
- `portable.test.mjs` 14 → **29 断言**，含 6 条**真后端交叉验证**：换 id+换 cwd 后宿主 `inspect()` 认账、追加尾帧后事件连续、`inspect()` 确实只读、重复 id 宿主抛错、新登记工作区投影为空数组、attach 拒绝未知会话；取不到宿主模块时明确 skip 而非放宽断言。
- `client.test.mjs` 21 → **24 断言**：三模式默认「覆盖」、预览分类计数与身份/动作渲染、force 勾选自动重新预览、幂等文案、分叉冲突禁用按钮与 force 指引、切副本模式重新预览。
- `scripts/cleanroom-check.mjs`：tarball 必含 `lib/portable.js`；探针加端到端（导出→抹掉→覆盖式导入→重复导入幂等），mock 镜像宿主 duplicate / realpath 两条不变量。
- `npm run sweep`：本机 103 份真实 transcript（69.9 MB）逐帧与 header 重写不变量全过。

### notes
- 数据兼容：0.2.x 的旧包直接可用。旧导入产生的"归档态隐身"会话，用本版重新导入一次即可恢复可见（本插件无法解档 —— 宿主没有该 API）。
- 仍**不做 prune**（用户拍板）：本地比包多的文件/会话/席位一律保留，只报差异计数。云通道、增量帧传输、删除同步见 `docs/design/import-overwrite-sync.md` §7。

## [0.2.2] - 2026-09-10

### fixed
- **目标列表为空时面板没有创建入口**：`＋ 添加学习目标` 原先挂在 `goals.length > 0` 那个分支里（`src/client.mjs` 的三元链），空列表只渲染 `stuiEmpty` 提示——而那句提示恰好指着这个不存在的按钮（「点下方『＋ 添加学习目标』开始」）。于是新装（零目标）、把目标全删空、以及面板首帧 `study.list` 还没返回时，面板上只剩 📦 / ⟳ / ✕ 三个按钮，**没有任何 UI 途径创建学习目标**，只能退回聊天用 `study_plan_create`。现在添加按钮归属整个「列表视图」（空态与非空列表都在末尾渲染）。
- 测试：`test/client.test.mjs` 19 → 21 断言——非空列表与空列表都必须渲染「＋ 添加学习目标」，且空态点击后进入创建表单（`学习主题 *` + `✓ 创建并调研`）。用 HEAD 的旧 bundle 跑新测试会在「空列表缺少按钮」上失败，确认拦得住回归。`test/smoke.mjs` 79、`test/portable.test.mjs` 14 不变，全绿。

### 说明
- 只改常驻版（`study-plugin/`）。动态版 `src/client.js:271` 有同一段三元结构，同样带这个缺陷；按 D7（动态版为路线 A 回退）本次未同步，需要时一条改动即可镜像。
- 宿主半未改动：本版本唯一产物差异是 `lib/client.js`，因此已安装副本可直接替换该文件生效（`/plugins/study-plugin/client.js` 每次请求现读磁盘并带 `cache-control: no-cache`，刷新页面即可，无需重启 DSH）。

## [0.2.1] - 2026-09-10

### changed
- **「调研中」不再谎报进度（D16）**：`status:'researching'` 一直是建档初值（`createGoalDoc` 建目标即置位），并不代表指令已发出。现在由 `goal.json` 的 `research.dispatchedAt` 记录「调研指令确实注入过目标会话」——`study.startResearch` / `study.retryResearch` / `study_plan_research` 三处注入成功后写入，`study.rejectDraft` 退回时清除。面板按事实分岔：未派发 → chip「待调研」+「⚠️ 调研还没开始」；已派发 → 「⏳ 正在联网调研（派发于 HH:mm）」。
- 草案待批准的「重新调研」名副其实：退回并清空草案后**紧接着**重新派发指令（旧行为只退回不派发，目标就此停在「调研中」——本次事故的第二个死锁点）。
- 动作失败的红字不再被随后的 `study.list` 刷新冲掉（`doAction`：先刷新、再落回错误），消除「点了没反应」。
- `study_plan_status` 的 `next_action` 按派发事实分别给指引，并输出 `research_dispatched` / `research_dispatched_at`。

### added
- 宿主 RPC `study.dispatchResearch {goalId}`：面板「▶ 开始调研 / 🔁 重新调研」的派发口，委托宿主内既有的 `chatResearch`（解析目标会话 → 按 `reject_reason` 选首次或重试指令 → 注入 → 记派发事实），派发调研只留一个 owner。
- `study.list` 每行新增 `researchDispatched` / `researchDispatchedAt`；面板派发前若发现目标会话已销毁或未建立，先重建并回写 `sessionId` 再派发。
- 测试：`test/smoke.mjs` 69 → 79 断言（派发事实、`dispatchResearch` 参数/意见/无会话 `need_open`、reject 清除标记）；`test/client.test.mjs` 13 → 19 断言（researching 三态、reject→dispatch 顺序、红字存活）。React 桩的 `useEffect`/`useCallback` 改为按槽位记 deps（此前每次渲染都重跑副作用，会把 doAction 刚写上的失败红字异步清掉 → 测试假失败）。

### 说明
- 与 M4 一致，只落常驻版（D7：动态版 `src/host.js` 为路线 A 回退，不追新特性）。
- 老数据兼容：升级前已派发的目标没有 `research` 字段，会显示「待调研」——这正是需要人工确认的一次点击；一旦目标进入 `draft_pending/approved` 或用户点过一次派发，事实即归位。

## [0.2.0] - 2026-09-10

### added
- **目标导出 / 导入（可携化）**：一个学习目标打成单个 zip（目标目录整棵树 + 该目标工作区**全部**会话 transcript 逐字节原文 + 会话引用的附件对象 + 工作区登记信息 + `manifest.json`），可在另一台机器/另一个 `DSH_HOME` 还原
  - 新宿主 RPC ×6：`study.exportGoal` / `study.listExports` / `study.deleteExport` / `study.inspectImport` / `study.importGoal`（不带 confirm 即预览） / `study.reattachGoalSessions`
  - 新 GET 路由 `/study-export?file=…`（loopback 守卫、只认 exports 目录内裸文件名的 `.zip`）
  - 新聊天工具 ×2：`study_goal_export` / `study_goal_import`（与面板 RPC 同一实现）
  - 面板：目标行「📤 导出 zip」「🔗 重新绑定会话」、顶部「📦」导出包视图（列表 / ⬇ 下载 / 删除 / 路径预览 / 确认导入）
- `lib/portable.js`：零依赖 ZIP（store + deflate）与 zstd 会话帧工具（帧切分复刻宿主 `scanZstdFrames`、只重写 header 帧、明文↔zstd 转换、附件引用收集、zip-slip 防御）
- `test/portable.test.mjs`（14 断言）与 `test/client.test.mjs`（13 断言，最小 React/DOM/fetch 桩真实渲染并点击面板）

### 契约与取舍
- 会话正文**不**改写：跨机导入只重写会话 header 帧的 `cwd`（帧描述符与宿主写出一致：非 single-segment + content checksum，已 spike 验证）
- 工作区登记走公开 API（`workspaceRegistry.create` + `ws.attachSession`），**不覆盖**全局 `storages/workspace.json`
- 不含：凭据/设置/日志/profile/`session_projcache.json`（自愈缓存）/`study-work/plugin/` 快照/目标目录内 `.mnemon/` 记忆
- 导入写入后用宿主 `sessionPersistence.inspect()` 自检，任一会话读不懂即整体回滚；包内逐文件 sha256 校验先于写盘
- 导入/迁移后需重启 DSH 才会完整刷新左栏分组与会话列表

### fixed
- 恢复被一次工作区回退吃掉的 D10（面板「📄 打开会话」幂等复用 `goal.sessionId` + `study.recordGoalSession`），双轨（常驻版 + 动态版）逐字节还原：动态版 `dist` hash 与幸存快照一致；常驻版重建 bundle 与安装副本 375 行逐行一致；并与已发布的 v0.1.1 逐行核对 —— 发布仓内容无一行为本仓所缺，等价确认
- `scripts/install-profile.mjs`：`node_modules/study-plugin` 是**官方安装器留下的真实目录**时不再 `ENOTEMPTY` 崩溃 —— 改用 `readlink` 区分「Junction/符号链接」与「真实目录」，真实目录改名让位（不删字节），卸载路径同样不再误删真实目录
- 可携化服务缺席时报明确错误（`会话持久化服务不可用…`），并在日志里点名缺哪个服务；只有三项齐备才打印「portable deps ready」

### added（测试）
- `test/transcript-sweep.mjs`：用本机全部真实会话日志验帧处理（切帧/重写/行数与帧数不变/身份不变），无 DSH 数据时自动跳过

## [0.1.1] - 2026-09-09

> 注：本节与 GitHub 发布仓 `pujie147/dsh-study-plugin` 的 v0.1.1 内容一致。开发仓当时被一次工作区回退吃掉了这份未提交改动（见 v0.2.0 的 fixed 条），现补回以保持版本史连续。

### changed
- **面板「📄 打开会话」不再每次新建会话**：优先切回 `goal.json` 里记录的「目标总会话」（即产出课程草案的那个会话，反复点都回到同一个会话）；只有它未记录或已被销毁时，才在目标工作区新建会话。旧实现直接走 `workspaces.connectWorkspace`，而它只复用**空白**会话——目标会话一旦产过草案就不再空白，导致每次点击都多出一个新会话、调研上下文被留在旧会话里。
- 打开会话时对客户端会话/工作区镜像做一次滞后兜底（`refresh()` 后重判/重试），避免 DSH 刚重启或刚建目标时误判「会话不存在」而误新建。
- 「✓ 创建并调研」的自动开会话走同一兜底路径。

### added
- 宿主 RPC `study.recordGoalSession {goalId, sessionId}`：面板新建目标会话后把新 id 记回 `goal.json`（冒烟 33 → 37 断言）。

## [0.1.0] - 2026-09-09

### added
- **常驻插件包**（profile 组合插件形态，DSH 启动自动装载，任何模式/会话可用，重启不丢失）
- **学习区面板**：侧栏 `sidebar.footer.action` 插槽「📚 学习区」，React 浮窗（目标列表/草案批准/章节讲义/会话打开），经同源 `/study-rpc` 与宿主通信
- **宿主 RPC**：`/study-rpc` webServer prefix 路由，承载 13 个 `study.*` 方法（目标 CRUD、调研注入、草案采纳、讲义轮询、章节会话、工作区保障），loopback 守卫 + POST-only
- **聊天工具 `study_plan_*` 五件套**（status/create/research/approve/reject）：经 `defineTool(@deepseek-ai/dsh-tools)` 静态注册，全局会话可见
- `scripts/build-client.mjs` 零依赖客户端 bundle 构建（CSS 内联、react externals）
- `scripts/install-profile.mjs` 幂等安装/卸载脚本（Windows Junction 免提权）
- `test/smoke.mjs` 宿主半运行时冒烟测试（33 断言）
- `scripts/cleanroom-check.mjs` 净室安装验证（tarball → 假 profile + 宿主桥接 → 探针）

### 说明
- 与动态版（仓库 `src/`，cordis 快照激活路线）数据契约完全一致（`~/.dsh/study-work`），双轨可混用
- `@deepseek-ai/*` 宿主包按社区惯例经 DSH 启动时的 profile 宿主桥接（`profiles/node_modules`）解析，不声明为 npm 依赖，避免版本遮蔽与双实例
