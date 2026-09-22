# study-plugin（学习区 · 常驻版）

学习区（study-work）的 **DSH 持久化插件包**：profile 组合插件形态，DSH 启动时自动装载 ——
任何模式、任何会话、重启后不丢失。本包是 `study_dsh_plugin` 仓库 `src/`（动态版）的静态移植。

## 形态（与 dsh-free-search / @xmanrui/dsh-im 等同构）
- **宿主半** `lib/index.js`：ESM 模块，`export function apply(ctx, config)`。
  - `ctx.inject(['webServer','agents','workspaceRegistry','tools'], …)` 注入服务；导出/导入另用一条 inject 取 `sessionPersistence / sessions / attachments`（缺席只降级该功能，面板与聊天工具不受影响）
  - `/study-rpc` webServer prefix 路由（POST only + 1MB 上限；**不判定来源 IP**，局域网可达）承载全部 `study.*` RPC；`/study-export` GET 路由下载导出 zip；`/study-file` GET 路由出章节讲义页（入参只有 goalId+chapter，落点经 goal.json 反查，正文转义 + CSP `default-src 'none'`）；`study.readChapter` 供面板「打开讲义」—— 路径优先交给 client 侧的 `betterSidebar` 服务（DSH-better-sidebar）开成右侧页签，取不到才 `window.open` `/study-file` 新标签
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
node test/smoke.mjs                 # 宿主半运行时冒烟（含 readChapter + /study-file 讲义页；跑在宿主真实 persistence + registry 上）
node test/sync.test.mjs             # GitHub 同步宿主半（78 断言，内存 mock GitHub server + 真宿主夹具，双设备 + 多主机 adopt）
npm test                            # smoke + portable + client(55，桩 React 真实渲染点击，含同步面板、「打开讲义」与网页课程源) + sync(78)
                                    # ⚠ 本机宿主升到 dsh 0.1.5-rc.2 后 JsonlSessionPersistence 无 inspect() ⇒ smoke(M4 起)/portable 崩，属夹具待跟进宿主漂移（见 CHANGELOG 0.7.2 备注），未改代码
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
node test/smoke.mjs                  # 宿主半冒烟（含覆盖式同步回归、readChapter + /study-file 讲义页）
node scripts/cleanroom-check.mjs     # 净室安装验证（离线）
```
Windows 用目录 Junction（免管理员）。安装后重启 DSH 验证：
- 左栏出现「📚 学习区」（任何模式）
- `curl -X POST http://127.0.0.1:3080/study-rpc -d '{"method":"study.list","args":{}}'` 返回 `{goals:[…]}`
- `~/.dsh/study-work/README.md` 被刷新为常驻版文案
- `curl "http://127.0.0.1:3080/study-file?goalId=<目标id>&chapter=1"` 返回该章讲义的 HTML 页（`&format=raw` 出 Markdown 原文）

## 章节讲义怎么打开（v0.7.2）

章节讲义就绪后，点「📖 开始学习」（该功能的唯一入口）= 进该章会话 **并自动在右侧打开本章讲义**。讲义**不在左侧学习区面板里渲染**，落点按优先级：

1. **交给 [DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar)**（页签式右侧面板底座）：`ctx.get('betterSidebar').openFile({ sessionId: 本章会话 }, 讲义绝对路径, 章标题)` —— 页签直接开在**你刚进入的那章会话**旁边，`.md` 由它内置的 markdown viewer 渲染。能力按其官方 `features` 列表（含 `'openFile'`）门控；两个插件**互不依赖**，纯靠服务名协作，本插件不引它的任何代码。
   装它：`dsh plugin --profile web add dsh-better-sidebar@latest`（装完浏览器硬刷新一次）。
2. 没装 / 取不到服务 / 能力面没有 `openFile` → **浏览器新标签**打开本插件自带的 `/study-file` 讲义页（自包含 HTML，正文全量转义、CSP 锁死外部资源、深色模式适配）；
3. 新标签也被拦 → 面板把完整地址白话显示出来，手动粘帖即可。

> ⚠ 两点边界：① better-sidebar 的 `openFile` 是 fire-and-forget —— 用户在它的 side card 设置里关掉 `editor` 页签类型时它会**静默不响应**，本插件感知不到，于是要么看到页签、要么什么都没发生（不会报错）。② 本功能在装了 better-sidebar 的**真机上尚未跑过**，上面的签名/字段核对自其源码（0.19.1），落地效果待实机验收。

## 讲义结构与教学偏好（v0.7.3）

生成指令（提示词层，无硬校验）现按课程级上下文组装，只影响**新目标与新章节**，存量讲义不重生成：

- **总分结构**：每篇讲义固定六段——标题 → 本章概览(总) → 承接与补完 → 正文分节(每节先总后分，可递归) → 动手练习 → 本章小结(只回收讲过的内容，严禁冒生知识点)。
- **前后章接续**：生成第 N≥2 章前，AI 必须先 read 全部前置 ready 章讲义，复用其环境与工程、清偿「作黑盒使用，第 N 章详述」的欠账；第 1 章是工程线起点——`git init`，主分支为全课程基线，**每章独立分支 `chapter/NN-主题` 开发、章末合回，禁止直接在主分支开发**。
- **排版**：公式用 LaTeX/KaTeX，图用 mermaid（better-sidebar 的 markdown 预览原生渲染两者）。
- **教学偏好记忆体** `~/.dsh/study-work/_meta/teaching-prefs.md`：你在聊天里提出的长期结构/组织/构建规则（AI 提炼、经你同意后）记在这里，对后续所有生成生效；**只记规则不记课程内容**，随导出包/GitHub 同步旅行，导入时按行并集合并。

## 网页课程源：给个网址，照着教（v0.8.0）

目标行里填一个网页地址点「🌐 抓取网页材料」，插件（宿主自己 fetch，AI 不碰网）把**该页及其同域内链**（深度 2、≤30 页、总预算 120s）抓成纯文本材料，落在 `<目标>/research/web/` 下——面板给逐页预览清单（成功/失败/跳过/robots 拦截，正文过少会标注），确认后才发起调研：

- **调研改为基于材料**：指令禁网、逐份读网页材料；材料覆盖不到的知识点由 AI 记进草案 `gap_notes`，生成讲义时自动补全，且正文**强制标注「补充：非原始网页来源」**——哪些话来自原始网页、哪些是 AI 补的，读者分得清。
- **⚡ 一次性整理完全部讲义**：草案批准后不再逐章手点，一条整课指令单会话连续写章。按钮两态：有「待生成」章时 ⚡ 只派发待生成章（已就绪的讲义**绝不重写**，只作前置阅读）；**全部就绪时按钮变「⚡ 重新生成全部讲义」**（覆盖写入）。有章正在生成时一律拒绝。
- **边界（诚实说明）**：不执行 JS——前端渲染的站点会拿到「正文过少」，只标注不重试；robots 轻量遵守（只认 `User-agent: *`，抓不到即放行）；DSH 中途重启会让面板卡在「抓取中」，点「🔁 重抓」即覆盖重来（幂等）；reject 草案**不清网页材料**。网页材料在目标树下，随导出包 / GitHub 同步自动旅行。

设计细节见 [docs/design/web-course.md](./docs/design/web-course.md)（决策 D35）。

## GitHub 同步（跨机器 · v0.7.0）

在「📤 导出 / 导入」之上叠一条**只经 GitHub 一个固定私有仓 `dsh-study-sync` 流转**的双向同步通道：
不搭自建服务、不加运行时依赖，机器之间**只通过仓库**通信。

- **正确性靠乐观 CAS，不用锁**：每次写带"我读到的当前文件 sha"作前置条件，抢先提交者让对方撞 409 →
  重读重判。**无锁因此无死锁**；面板上的任何"某设备在场"提示（若将来出现）只能是提示，绝不阻塞读写。
- **真分叉不自动合并**：本地与仓库各自都改过时，面板亮出**仓库最新更新时间 / 设备 / 体积**，
  让你二选一——**「🔼 覆盖仓库」**（用本地 force push，仓库那份丢失）或**「🔽 放弃本地」**
  （拉仓库版落地，但不删你本地多出的独占文件）。程序绝不替你吃掉任一侧。
- **对他人同名仓绝不静默下手**：账号下已有的 `dsh-study-sync` 若没有本插件的认领标记，绑定**不会自动写入**，而是提示你**明示「接管」**——接管只补写那一个认领标记文件、此后只往 `study-goals/` 前缀同步，**不删除该仓任何已有内容**；不想接管就「放弃」，去给那个仓改名或换一个账号。（红线不变：接管必须是本人确认。）
- **多台机器绑同一个 GitHub 账号是预期用法**：每台机器各自跑一遍授权、各拿一份独立令牌，共同认领并读写同一个 `dsh-study-sync`；后来者若发现仓里已有本插件的认领标记，直接**采用（adopt）**而不触发接管。导出包各带自己的 `deviceId`，冲突面板据此区分"是哪台机器推的"。**唯一的耦合点**是账号级"撤销这个 OAuth App"——见下方方式一与方式二的差别。

打开面板点顶栏 **☁ GitHub 同步** 进入。设计细节见 [docs/design/github-sync.md](./docs/design/github-sync.md)。

### 授权方式一：一键登录 GitHub（设备码 OAuth，推荐）

发布版插件已内置一个官方 OAuth App 的 **public client_id**（公开值、**不含任何 secret**，可安全写进仓库），
所以你**不需要自己去建 App**。绑定只需一步：

1. 面板里点 **🔗 一键登录 GitHub 授权**；
2. 浏览器自动打开 GitHub 的验证页、面板显示一次性代码（并自动复制到剪贴板）——在浏览器里确认授权；
3. 面板**自动轮询**，授权成功后就在你账号下定位/创建 `dsh-study-sync` 并进入就绪态，无需手动点确认。

> 若你从源码自构建、或这个内置 App 被撤销：点 **▸ 高级选项**，自己填一个 OAuth App 的 client_id（启用 Device Flow，
> 回调 URL 填 `http://127.0.0.1` 即可，设备码流程不真正回跳）后「发起设备码」；或直接改用方式二。

**维护方登记内置 App 的步骤**（仅发布方需要，普通用户跳过）：GitHub → Developer settings → New OAuth App
（Homepage 随意、回调填 `http://127.0.0.1`）→ Device settings 里启用 **Device Flow** → 把 **Client ID**（只此公开值）
填进 `lib/index.js` 的 `DEFAULT_CLIENT_ID` 常量。**切勿把 client_secret 写进仓库或分发给用户**——设备码流程不需要它。

### 授权方式二：fine-grained PAT（逃生舱 · 逐机隔离）

不想依赖内置 OAuth App（或想给每台机器完全独立的凭据），点 **▸ 高级选项**，粘一个 **fine-grained Personal Access Token**：
只授予目标仓 `dsh-study-sync` 的 **Contents: Read and write** 权限、**只针对那一个仓**、**务必设过期时间**。
粘贴后点 **🔗 用 PAT 绑定**。

> **方式一 vs 方式二（撤销耦合与权限面）**：设备码走的是**同一个内置 OAuth App**，好处是零配置一键授权，
> 代价是**账号级撤销该 App 会一次性作废你所有机器上的设备令牌**（需逐机重授），且 OAuth App 权限面按授权范围可能宽于单仓；
> fine-grained PAT **逐机独立**——撤掉某台的 PAT 只影响那台，且 scope 锁死到单仓 Contents，权限面最小。
> 多台长期共存、跨信任域（如公司机 + 家用机）优先用 PAT；嫌逐机建 token 麻烦、且接受"撤 App = 全部重授"用一键。

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
