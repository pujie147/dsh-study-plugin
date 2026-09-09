# study-plugin（学习区 · 常驻版）

学习区（study-work）的 **DSH 持久化插件包**：profile 组合插件形态，DSH 启动时自动装载 ——
任何模式、任何会话、重启后不丢失。本包是 `study_dsh_plugin` 仓库 `src/`（动态版）的静态移植。

## 形态（与 dsh-free-search / @xmanrui/dsh-im 等同构）
- **宿主半** `lib/index.js`：ESM 模块，`export function apply(ctx, config)`。
  - `ctx.inject(['webServer','agents','workspaceRegistry'], …)` 注入服务
  - `/study-rpc` webServer prefix 路由（loopback 守卫）承载全部 `study.*` RPC
  - `study_plan_*` 聊天工具：**M2**（`ctx.inject(['tools'], sctx => sctx.tools.register(defineTool(…)))`，`@deepseek-ai/dsh-tools`）
- **客户端半** `lib/client.js`（构建产物，勿手改）：`window.__ModuleLoader__.load({id, factory:(require)=>…})` 形态；
  源码 `src/client.mjs`；CSS 从仓库根 `src/client.js` 的 `styles.insert` 提取并内联。
  - `dsh.client` 清单在 `package.json`：`platform: web` + inject 边（runtime/layout/ui-sidebar）
- **自注册** `cordis.patch.yml`：`- insert: - id: study-engine name: study-plugin`（dsh-app-boot 合成 profile 时自动应用）

## 构建
```bash
cd study-plugin
node scripts/build-client.mjs   # → lib/client.js（CSS 内联 + banner + react externals）
```

## 安装（本机 web profile，阶段2）
```powershell
# 开发期：符号链接（改仓库代码 → 重启 DSH 即生效）
New-Item -ItemType SymbolicLink -Path "C:\Users\pyg12\.dsh\profiles\web\node_modules\study-plugin" -Target "C:\Users\pyg12\gitProjects\study_dsh_plugin\study-plugin"
# 发布期（M3）：dsh plugin --profile web add study-plugin（npm/GitHub 包）
```
重启 DSH 后：
- 左栏出现「📚 学习区」（任何模式）
- `curl -X POST http://127.0.0.1:3080/study-rpc -d '{"method":"study.list","args":{}}'` 返回 `{goals:[…]}`
- `~/.dsh/study-work/README.md` 被刷新为常驻版文案

## 卸载
删除 `node_modules/study-plugin`（及符号链接）+ 重启 DSH。

## 与动态版关系
双轨并行：`src/host.js`、`src/client.js` 与 `~/.dsh/study-work/plugin/` 快照保留（路线 A 回退）。
数据目录、文件契约（index.json / goal.json / draft.json / chapters/）完全一致，两版可混用数据。
