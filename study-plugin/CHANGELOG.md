# 更新日志

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

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
