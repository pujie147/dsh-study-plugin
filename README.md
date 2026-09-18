# study-plugin（学习区 · 常驻版）

学习区（study-work）的 **DSH 持久化插件包**：profile 组合插件形态，DSH 启动时自动装载 ——
任何模式、任何会话、重启后不丢失。本包是 `study_dsh_plugin` 仓库 `src/`（动态版）的静态移植。

## 形态（与 dsh-free-search / @xmanrui/dsh-im 等同构）
- **宿主半** `lib/index.js`：ESM 模块，`export function apply(ctx, config)`。
  - `ctx.inject(['webServer','agents','workspaceRegistry','tools'], …)` 注入服务；导出/导入另用一条 inject 取 `sessionPersistence / sessions / attachments`（缺席只降级该功能，面板与聊天工具不受影响）
  - `/study-rpc` webServer prefix 路由（POST only + 1MB 上限；**不判定来源 IP**，局域网可达）承载全部 `study.*` RPC；`/study-export` GET 路由下载导出 zip
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
node test/sync.test.mjs             # GitHub 同步宿主半（73 断言，内存 mock GitHub server + 真宿主夹具，双设备）
npm test                            # smoke(101) + portable(29，含真后端交叉验证) + client(39，桩 React 真实渲染点击，含 9 条同步面板) + sync(73，GitHub 同步)
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

## GitHub 同步（跨机器 · v0.5.0）

在「📤 导出 / 导入」之上叠一条**只经 GitHub 一个固定私有仓 `dsh-study-sync` 流转**的双向同步通道：
不搭自建服务、不加运行时依赖，机器之间**只通过仓库**通信。

- **正确性靠乐观 CAS，不用锁**：每次写带"我读到的当前文件 sha"作前置条件，抢先提交者让对方撞 409 →
  重读重判。**无锁因此无死锁**；面板上的任何"某设备在场"提示（若将来出现）只能是提示，绝不阻塞读写。
- **真分叉不自动合并**：本地与仓库各自都改过时，面板亮出**仓库最新更新时间 / 设备 / 体积**，
  让你二选一——**「🔼 覆盖仓库」**（用本地 force push，仓库那份丢失）或**「🔽 放弃本地」**
  （拉仓库版落地，但不删你本地多出的独占文件）。程序绝不替你吃掉任一侧。
- **对他人同名仓绝不静默下手**：账号下已有的 `dsh-study-sync` 若没有本插件的认领标记，绑定**不会自动写入**，而是提示你**明示「接管」**——接管只补写那一个认领标记文件、此后只往 `study-goals/` 前缀同步，**不删除该仓任何已有内容**；不想接管就「放弃」，去给那个仓改名或换一个账号。（红线不变：接管必须是本人确认。）

打开面板点顶栏 **☁ GitHub 同步** 进入。设计细节见 [docs/design/github-sync.md](./docs/design/github-sync.md)。

### 授权方式一：GitHub OAuth App + 设备码（推荐）

1. 到 GitHub → Settings → **Developer settings → OAuth Apps → New OAuth App**；
   Application name / Homepage 随意，**回调 URL 可填 `http://127.0.0.1`**（设备码流程不真正回跳）。
2. 创建后进该 App → **Generate a new client secret**（记下备用）；拿到 **Client ID**。
3. 在 App 设置里启用 **Device Flow**（Device settings → 允许设备码授权）。
4. 把 Client ID 告诉插件：面板里调用 `study.syncSetConfig { clientId }`（或按面板提示填一次），
   之后点 **🔑 用 GitHub 设备码授权** → 浏览器打开给出的地址、输入面板显示的一次性代码 →
   回面板点**确认**即可。授权成功后插件会在你账号下定位/创建 `dsh-study-sync`。

### 授权方式二：fine-grained PAT（兜底）

不想建 OAuth App，就直接粘一个 **fine-grained Personal Access Token**：
只授予目标仓 `dsh-study-sync` 的 **Contents: Read and write** 权限，**务必设过期时间**。
在面板 PAT 输入框粘贴后点 **🔗 用 PAT 绑定**。

> ⚠️ **令牌明文风险（务必读）**：无论设备码拿到的 `access_token` 还是 PAT，插件都**以明文**存在该机器的
> `~/.dsh/study-work` 同步配置里（面板/任何 RPC 返回值只会显示 `••••末四位`，绝不回显全文；
> 除发往 https 的 GitHub endpoint 外不外传）。**能读到那台机器磁盘的人 = 能拿到这个令牌。**
> 因此：优先用**只针对单仓、带过期**的 fine-grained PAT；设备令牌同理；共享/受管机器上用完就点**解绑**
> （解绑只清本机凭据与仓库指向，GitHub 上的数据与各目标同步基线都不动）。

## 卸载
删除 `node_modules/study-plugin`（及符号链接）+ 重启 DSH。

## 与动态版关系
双轨并行：`src/host.js`、`src/client.js` 与 `~/.dsh/study-work/plugin/` 快照保留（路线 A 回退）。
数据目录、文件契约（index.json / goal.json / draft.json / chapters/）完全一致，两版可混用数据。
