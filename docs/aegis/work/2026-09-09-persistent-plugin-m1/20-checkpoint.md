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
- [ ] T7b 重启 DSH 验证：左栏 📚（任意模式）、POST /study-rpc 通、README 刷新
- [ ] T8（M2）study_plan_* 工具静态化（defineTool 注册）
- [ ] T9（M3）去硬编码/config 化 + 发布分发

## 已完成
- M1 包骨架完成：`study-plugin/`（package.json 双 exports + dsh.client 清单；cordis.patch.yml 自插入；lib/index.js 宿主；src/client.mjs + scripts/build-client.mjs → lib/client.js 23KB；test/smoke.mjs）。
- 关键核验：`sctx.effect(execute, label)` 签名经 cordis 引擎源码（@deepseek-ai/cordis lib:1168）确认；客户端 UI 与 `_extract_client.js` 逐字对齐（50-299 行核对过）；宿主逻辑与 `_extract_host.js` 逐字对齐（13 个 study.* 处理器全量移植）。
- 冒烟测试 24/24：路由守卫（GET 405 / 非 loopback 403 / unknown method）+ 全链路（list→create→startResearch 注入→draft 采纳规范化→approve 文件命名→讲义采纳 active/ready→recordChapterSession→startChapter 教练指令含回写机制→continueChapter 短路→reject 磁盘清空→delete）。
- 已知原行为保留（非 M1 回归）：reject 后内存 draft 保留旧内容（带 rejected 标志），list 映射不含 rejected 字段；「重新调研」重触发走 chat 工具 study_plan_research（M2 静态化）。

## 阻塞
- T7 起依赖用户在场 + `~/.dsh` 写入审批 + DSH 重启。

## 下一步
T7 阶段2：符号链接 `study-plugin` → `~/.dsh/profiles/web/node_modules/`，重启 DSH，验证：左栏 📚 学习区（任意模式）、`POST /study-rpc {"method":"study.list"}` 通、README 刷新。通过后 M2（defineTool 五工具，预期 1-2 轮重启调试）。
