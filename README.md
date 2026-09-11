# study-plugin（学习区 · 常驻版）

学习区（study-work）的 **DSH 持久化插件包**：profile 组合插件形态，DSH 启动时自动装载 ——
任何模式、任何会话、重启后不丢失。本包是 `study_dsh_plugin` 仓库 `src/`（动态版）的静态移植。

## 形态（与 dsh-free-search / @xmanrui/dsh-im 等同构）
- **宿主半** `lib/index.js`：ESM 模块，`export function apply(ctx, config)`。
  - `ctx.inject(['webServer','agents','workspaceRegistry','tools'], …)` 注入服务；导出/导入另用一条 inject 取 `sessionPersistence / sessions / attachments`（缺席只降级该功能，面板与聊天工具不受影响）
  - `/study-rpc` webServer prefix 路由（loopback 守卫）承载全部 `study.*` RPC；`/study-export` GET 路由下载导出 zip
  - `study_plan_*` 聊天工具 ×5 + `study_goal_export`/`study_goal_import` ×2：`defineTool(@deepseek-ai/dsh-tools) + sctx.tools.register`（宿主桥接解析，同实例；解析失败仅降级为无聊天工具）
- **可携化** `lib/portable.js`：零依赖 ZIP（store + deflate，已与 Windows 自带解压器互操作验证）+ zstd 会话帧工具（复刻宿主帧切分、帧级 header 重写〔可换 id/cwd/parentSession〕、只追加尾帧、行级前缀关系判定、zip-slip 防御、附件引用收集）
- **客户端半** `lib/client.js`（构建产物，勿手改）：`window.__ModuleLoader__.load({id, factory:(require)=>…})` 形态；
  源码 `src/client.mjs`；CSS 从仓库根 `src/client.js` 的 `styles.insert` 提取并内联。
  - `dsh.client` 清单在 `package.json`：`platform: web` + inject 边（runtime/layout/ui-sidebar）
- **自注册** `cordis.patch.yml`：`- insert: - id: study-engine name: study-plugin`（dsh-app-boot 合成 profile 时自动应用）

## 构建与测试
```bash
cd study-plugin
node scripts/build-client.mjs       # → lib/client.js（CSS 内联 + banner + react externals）
node test/smoke.mjs                 # 宿主半运行时冒烟（101 断言，跑在宿主真实 persistence + registry 上）
npm test                            # smoke(101) + portable(29，含真后端交叉验证) + client(24，桩 React 真实渲染点击)
node test/host-fixture.mjs 2>nul     // 夹具本身不单独跑；被 smoke/portable 复用
npm run sweep                         # 本机全部真实 transcript 逐帧验帧（约 100 份 / 70 MB）
node test/transcript-sweep.mjs      # 可选：拿本机真实会话日志全量验帧（无 DSH 数据时自动跳过）
node scripts/cleanroom-check.mjs    # 净室安装验证（npm pack → 假 profile → 探针）
```
开发说明：`node_modules/@deepseek-ai/dsh-tools` 是指向本机宿主副本的 **dev junction**（仅开发用；真实目录安装无需它，终端用户经 DSH 宿主桥接解析，净室脚本已验证）。

## 安装（他人机器，官方通道）
```bash
# GitHub 渠道（发布仓 = https://github.com/pujie147/dsh-study-plugin）
# git+https 形式经 pnpm 直接 git clone（对代理/受限网络最稳）；github: 简写走 codeload tarball 快捷路径
dsh plugin --profile web add git+https://github.com/pujie147/dsh-study-plugin.git
```
装完**重启 DSH** 即生效：左栏出现「📚 学习区」（任何模式），`study_plan_*` 五工具全局可用。
注意事项（来自官方安装器的已知边界）：
- `dsh plugin` 底层是把参数转发给 profile 目录里的 pnpm。pnpm 11 供应链策略可能拦首次安装：报 `Minimum release age` = 发布未满 24h（等或配 `minimumReleaseAge: 0`）；报 `untrusted origin` = 删 profile 目录 `node_modules` 与 `pnpm-lock.yaml` 后重装。
- 数据根目录 = `~/.dsh/study-work`（自动创建）；更新：`dsh plugin --profile web update study-plugin`；卸载在「已安装」列表或 `dsh plugin --profile web remove study-plugin`。
- 后续提供 npm 渠道后可直接 `dsh plugin --profile web add study-plugin`。

### 发布通道的事实（2026-09-11 实测）
- **发布 = 把本仓库 `master` 推上 GitHub + 打 tag**，不需要第二个仓。pnpm 对 git 依赖遵守 `files` 字段，实测落地只有 `lib/`、`cordis.patch.yml`、README、LICENSE、CHANGELOG、package.json —— `src/`、`test/`、`scripts/`、`docs/` 不进包。
- 不带 committish 时 pnpm 解析**仓库默认分支**，当前为 `master`。所以「装了旧版」基本都是默认分支落后，先 `git push origin master`。
- 不带 committish 会被 `pnpm-lock.yaml` 钉住首次解析的 commit：升级用 `dsh plugin --profile web update study-plugin`，或直接重跑 `add`。钉 `#v0.3.1` 则永久固定在该 tag，升级需 `remove` + 换新 tag `add`。
- 无 `prepare` 脚本，pnpm 11 的 `allowBuilds` 与 `minimumReleaseAge` 两道策略拦不到它。
- ⚠️ tag 必须打在扁平化（`3c2a562`）**之后**的 commit 上。打在之前的 commit 上，根 `package.json` 是旧脚手架（名字都不是 `study-plugin`），装出来没有 `dsh.bundle.patch`，DSH 只当普通依赖、面板永不装载。

## 本机开发安装（幂等脚本）
```powershell
cd study-plugin
node scripts/build-client.mjs        # 改过 src/ 后重建客户端 bundle（--sync-css 从动态版同步 CSS）
node scripts/install-profile.mjs     # 默认 $DSH_HOME/profiles/web；支持 --profile <dir> / --uninstall
node test/smoke.mjs                  # 冒烟 101 断言（含覆盖式同步回归）
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
