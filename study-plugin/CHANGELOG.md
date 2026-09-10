# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
