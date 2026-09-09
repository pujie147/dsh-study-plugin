# study-plugin（学习区 · 常驻版）

学习区（study-work）的 **DSH 持久化插件包**：profile 组合插件形态，DSH 启动时自动装载 ——
任何模式、任何会话、重启后不丢失。本包是 `study_dsh_plugin` 仓库 `src/`（动态版）的静态移植。

## 形态（与 dsh-free-search / @xmanrui/dsh-im 等同构）
- **宿主半** `lib/index.js`：ESM 模块，`export function apply(ctx, config)`。
  - `ctx.inject(['webServer','agents','workspaceRegistry','tools'], …)` 注入服务
  - `/study-rpc` webServer prefix 路由（loopback 守卫）承载全部 `study.*` RPC
  - `study_plan_*` 聊天工具 ×5：`defineTool(@deepseek-ai/dsh-tools) + sctx.tools.register`（宿主桥接解析，同实例；解析失败仅降级为无聊天工具）
- **客户端半** `lib/client.js`（构建产物，勿手改）：`window.__ModuleLoader__.load({id, factory:(require)=>…})` 形态；
  源码 `src/client.mjs`；CSS 从仓库根 `src/client.js` 的 `styles.insert` 提取并内联。
  - `dsh.client` 清单在 `package.json`：`platform: web` + inject 边（runtime/layout/ui-sidebar）
- **自注册** `cordis.patch.yml`：`- insert: - id: study-engine name: study-plugin`（dsh-app-boot 合成 profile 时自动应用）

## 构建与测试
```bash
cd study-plugin
node scripts/build-client.mjs       # → lib/client.js（CSS 内联 + banner + react externals）
node test/smoke.mjs                 # 宿主半运行时冒烟（33 断言）
node scripts/cleanroom-check.mjs    # 净室安装验证（npm pack → 假 profile → 探针）
```
开发说明：`node_modules/@deepseek-ai/dsh-tools` 是指向本机宿主副本的 **dev junction**（仅开发用；真实目录安装无需它，终端用户经 DSH 宿主桥接解析，净室脚本已验证）。

## 安装（他人机器，官方通道）
```bash
# GitHub 渠道（发布仓 = https://github.com/pujie147/dsh-study-plugin）
dsh plugin --profile web add github:pujie147/dsh-study-plugin
```
装完**重启 DSH** 即生效：左栏出现「📚 学习区」（任何模式），`study_plan_*` 五工具全局可用。
注意事项（来自官方安装器的已知边界）：
- GitHub 通道经 `git ls-remote` + `codeload.github.com` 拉取 tarball 预检；大陆网络直连 codeload 常失败——配好系统代理后重试。npm 渠道发布后可改 `dsh plugin --profile web add study-plugin`。
- pnpm 11 供应链策略可能拦首次安装：报 `Minimum release age` = 发布未满 24h（等或配 `minimumReleaseAge: 0`）；报 `untrusted origin` = 删 profile 目录 `node_modules` 与 `pnpm-lock.yaml` 后重装。
- 数据根目录 = `~/.dsh/study-work`（自动创建）；更新 `dsh plugin --profile web update study-plugin`；卸载在「已安装」列表。

## 本机开发安装（幂等脚本）
```powershell
cd study-plugin
node scripts/build-client.mjs        # 改过 src/ 后重建客户端 bundle（--sync-css 从动态版同步 CSS）
node scripts/install-profile.mjs     # 默认 $DSH_HOME/profiles/web；支持 --profile <dir> / --uninstall
node test/smoke.mjs                  # 冒烟 33 断言
node scripts/cleanroom-check.mjs     # 净室安装验证（离线）
```
Windows 用目录 Junction（免管理员）。安装后重启 DSH 验证：
- 左栏出现「📚 学习区」（任何模式）
- `curl -X POST http://127.0.0.1:3080/study-rpc -d '{"method":"study.list","args":{}}'` 返回 `{goals:[…]}`
- `~/.dsh/study-work/README.md` 被刷新为常驻版文案

## 卸载
删除 `node_modules/study-plugin`（及符号链接）+ 重启 DSH。

## 与动态版关系
双轨并行：`src/host.js`、`src/client.js` 与 `~/.dsh/study-work/plugin/` 快照保留（路线 A 回退）。
数据目录、文件契约（index.json / goal.json / draft.json / chapters/）完全一致，两版可混用数据。
