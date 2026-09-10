# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
