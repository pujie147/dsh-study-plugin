# TodoCheckpointDraft — 2026-09-09

## Todo
- [x] T0 提交现有代码（git 37489de）
- [x] T1 建工作记录（10-intent.md / 20-checkpoint.md）
- [x] T2 study-plugin 包骨架：package.json + cordis.patch.yml + README
- [x] T3 宿主半 lib/index.js（/study-rpc 路由 + 全部 study.* + README 同步）
- [x] T4 客户端移植 src/client.mjs + scripts/build-client.mjs（CSS 提取/内联、fetch RPC、setInterval）
- [x] T5 构建 lib/client.js + node --check 双文件 + 运行时冒烟测试 24/24 过
- [x] T6 提交 M1（git）
- [x] T7 阶段2 安装：Junction 链接 + profile 注册完成；提供幂等脚本 `scripts/install-profile.mjs`（用户选择手动重跑亦可）
- [x] T7b 重启 DSH 验证：M1 验收通过（用户确认 + 独立证据：GET→405 文本、POST study.list→200 真实 3 目标、README 14:15 刷新）
- [x] T8（M2）study_plan_* 工具静态化：5 工具 defineTool 注册 + chat* 五函数移植；冒烟扩至 33/33（含真实 defineTool 编译）
- [x] T8b 重启 DSH 验证 M2：**通过**（标准模式会话直接调用 study_plan_status → 真实 2 目标 + next_action/session_ready；GET 405/POST 200；README 14:43 刷新为新文案）
- [x] T9（M3）发布分发完成：**GitHub 渠道上线** `pujie147/dsh-study-plugin`（main=v0.1.0=0793c9b；净室 + git clone 双验证）；CSS 固化包内 src/client.css（build 不再依赖仓库根，--sync-css 同步）；LICENSE/CHANGELOG/repository 字段；发布脚本 scripts/publish-repo.mjs（pack→解包→GIT_DIR 分离仓→push）；M3 修正：包**不声明** dsh-tools 依赖（与 free-search 对齐，走 DSH profiles/node_modules 宿主桥接——本机实测该桥接存在且指向宿主同实例）
- [ ] 后续可选：npm 渠道（需 npm login；study-plugin 名字 npmjs 空闲）、dshmarket 收录、终端用户真实安装验证（本机网络 codeload/raw 被墙，github 通道需代理；git clone 通道实测可用）

## M2 关键基建发现（重要，防再踩坑）
- `@deepseek-ai/dsh-tools` 实际住在 **DSH 全局安装树嵌套**：`%AppData%\Roaming\npm\node_modules\@deepseek-ai\dsh\node_modules\@deepseek-ai\dsh-tools`（v0.1.0-rc.7）；profile node_modules 只有 cosmokit/schemastery，**普通 ESM 从 profile 路径也解析不到 dsh-tools**（free-search 能跑是靠 DSH 装载器侧的解析链，非标准 ESM 规则）。
- 对策三件套：①包声明 `dependencies["@deepseek-ai/dsh-tools"]`；②workspace 侧 `study-plugin/node_modules/@deepseek-ai/dsh-tools` junction → 宿主那份（**realpath 相同 ⇒ ESM 缓存同实例**，零双实例风险；已实测 defineTool 可用）；③lib/index.js 顶层容错：静态 import 失败退 `createRequire(自身 package.json).resolve` 再退 `defineTool=undefined`（只缺工具不拖垮面板）。
- 静态 `defineTool` 支持逐属性 `required: true`（dsh-tools lib:601-602 + 冒烟实测）与空 `parameters: {}`；`tools.register` 要求 `output.render` 函数 + schema 过 `assertSupportedJsonSchema`（`additionalProperties: true` 合法）。
- ⚠ 分发注意：M3 发 npm 后用户侧无 workspace junction——宿主装载器解析链需实测（free-search 同样如此，大概率无碍）；README/CHANGELOG 需写明。

## 已完成
- M1 包骨架完成：`study-plugin/`（package.json 双 exports + dsh.client 清单；cordis.patch.yml 自插入；lib/index.js 宿主；src/client.mjs + scripts/build-client.mjs → lib/client.js 23KB；test/smoke.mjs）。
- 关键核验：`sctx.effect(execute, label)` 签名经 cordis 引擎源码（@deepseek-ai/cordis lib:1168）确认；客户端 UI 与 `_extract_client.js` 逐字对齐（50-299 行核对过）；宿主逻辑与 `_extract_host.js` 逐字对齐（13 个 study.* 处理器全量移植）。
- 冒烟测试 24/24：路由守卫（GET 405 / 非 loopback 403 / unknown method）+ 全链路（list→create→startResearch 注入→draft 采纳规范化→approve 文件命名→讲义采纳 active/ready→recordChapterSession→startChapter 教练指令含回写机制→continueChapter 短路→reject 磁盘清空→delete）。
- 已知原行为保留（非 M1 回归）：reject 后内存 draft 保留旧内容（带 rejected 标志），list 映射不含 rejected 字段；「重新调研」重触发走 chat 工具 study_plan_research（M2 静态化）。

## 阻塞
- 无。M1+M2 已在线上（本机常驻运行）。

## 下一步
主线全部完成（M1 面板 + M2 工具 + M3 发布）。可选延伸见 T9 后续项。恢复协议：读本文件 + 10-intent.md + `git log --oneline`。
