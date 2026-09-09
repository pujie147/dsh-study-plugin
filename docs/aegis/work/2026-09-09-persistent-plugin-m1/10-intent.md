# TaskIntentDraft — 学习插件常驻化（B 路线，可分发）

- 日期: 2026-09-09
- 目标: 把学习区（study）插件改造为**官方持久化形态**（profile 组合插件包），实现：DSH 进程重启后自动装载、任何模式/任何会话可用、可打包分发给其他用户（`dsh plugin --profile web add study-plugin`）。
- 用户决策链: 路线 A（每启动激活）→ 用户确认要“常驻”→ 方案对比 → 用户确认“要打包给更多用户”→ 选定 B（完整常驻包）→ 按里程碑 M1/M2/M3 推进。

## 范围（M1 本切片）
- 在仓库内新建 `study-plugin/` 静态插件包：
  - `package.json`（`dsh.bundle.patch` + `dsh.client` 清单 + `exports["./client"]`）
  - `cordis.patch.yml`（`- insert: - id: study-engine name: study-plugin`）
  - `lib/index.js` 宿主半（M1：`/study-rpc` webServer prefix 路由 + 全部 study.* RPC + README 同步）
  - `src/client.mjs` 客户端源码移植（styles.insert→bundle 内联 CSS；host.call→fetch('/study-rpc')；timer→setInterval+ctx.effect）
  - `scripts/build-client.mjs` 零依赖构建脚本 → `lib/client.js`（`window.__ModuleLoader__.load` banner + CSS 内联 + externals 仅 react）
- 纯仓库内工作：**不写 `~/.dsh`**（那是 M1 后的安装步骤/阶段2，需用户审批）。

## 非目标（M1 不做）
- M2：`study_plan_*` 五个聊天工具的静态化（`ctx.tools.register(defineTool(…))`，`@deepseek-ai/dsh-tools`，schema 需重启迭代）。
- M3：去硬编码/config 化、LICENSE/CHANGELOG、发布 npm/GitHub、上架市场。
- 不改动 `src/host.js`/`src/client.js`（动态版继续可用，双轨并行）。

## 停止条件
- M1 完成证据：`lib/index.js` 通过 `node --check`（ESM）；`lib/client.js` 构建成功且通过 `node --check`；banner 结构正确（含 `window.__ModuleLoader__.load`、`require("react")`、`return { apply, inject }`）；CSS 已内联；包结构齐全。
- 安装与运行时验证（面板出现、RPC 通、任何模式可见）**必须重启 DSH 后进行**，属 M1 的验收步骤（外部依赖：用户在场 + 审批写入 `~/.dsh`）。

## 基线引用（已读，本切片的权威依据）
- `docs/PROJECT.md` §3/§7、`INSTALL.md` §5（动态 vs 持久化路线与边界）
- `src/host.js`（712 行全量，RPC 契约与数据逻辑）
- `src/client.js` / `_extract_client.js`（315/313 行全量，面板 UI 与完整 CSS）
- DSH 发行版源码（只读）：
  - `dsh-app-boot/lib/index.js` applyEntryPatches/loadProfile（patch 语义、bundle 合成顺序）
  - `dsh-client-modules/lib/index.js`（clientModules 服务：dsh.client 清单字段、exports["./client"]、/plugins 路由、boot manifest 注入）
  - `dsh-web-app/cordis.patch.yml`（双面包 row 实例、`!!js` 表达式、browser roster 注释）
  - `dsh-client-ui-sidebar/lib/client.js`（slot 声明 sidebar.footer.action、CSS `<style data-plugin-css>` 注入模式、exports.apply/inject 尾）
  - `dsh-client-ui-cordis/lib/client.js`（静态 `ctx.slots.inject('sidebar.footer.action', …)` 注册实例）
  - `dsh-free-search`（profile 内社区包：package.json 形态、`ctx.inject(['tools'], sctx=>sctx.tools.register(defineTool(…)))`、`sctx.webServer.register(route)`、client bundle banner `window.__ModuleLoader__.load({id, factory:(require)=>{…require("react")…}})`、`exports.inject=["slots",…]` 契约）

## 风险提示
- `defineTool` 静态 schema 比动态 harness 严格（M2 迭代项，M1 不涉及）。
- `dsh.client` 的 inject 边（runtime/layout/ui-sidebar 包名）与 `exports["./client"]` 必须存在，否则 clientModules 激活抛 MissingClientBundleError → M1 构建产物必须随包提交。
- 宿主服务名假设：`webServer`/`agents`/`workspaceRegistry` 与动态 `ctx.get` 同名（依据：动态宿主同一服务注册表）。若重启后注入失败，报错会点名缺失服务，届时按名调整。
- `/study-rpc` 路由加了 loopback 守卫（127.0.0.1/::1）。
