# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
- 恢复被一次工作区回退吃掉的 D10（面板「📄 打开会话」幂等复用 `goal.sessionId` + `study.recordGoalSession`），双轨（常驻版 + 动态版）逐字节还原，动态版 `dist` hash 与幸存快照一致
- `scripts/install-profile.mjs`：`node_modules/study-plugin` 是**官方安装器留下的真实目录**时不再 `ENOTEMPTY` 崩溃 —— 改用 `readlink` 区分「Junction/符号链接」与「真实目录」，真实目录改名让位（不删字节），卸载路径同样不再误删真实目录
- 可携化服务缺席时报明确错误（`会话持久化服务不可用…`），并在日志里点名缺哪个服务；只有三项齐备才打印「portable deps ready」

### added（测试）
- `test/transcript-sweep.mjs`：用本机全部真实会话日志验帧处理（切帧/重写/行数与帧数不变/身份不变），无 DSH 数据时自动跳过

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
