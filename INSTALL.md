# 安装 / 重装 / 恢复指引（study_dsh_plugin）

> **首选：常驻插件包** —— `cd study-plugin && node scripts/install-profile.mjs` + 重启 DSH。
> 一次安装永久在线（任何模式/会话、重启不丢、含 study_plan_* 工具），见 [study-plugin/README.md](study-plugin/README.md)。
> 本文余下内容为**动态插件**（路线 A 回退）：源码需在会话内通过 `cordis_define` 定义并 `cordis_run` 激活，DSH 进程重启后需重新激活。

插件以 **DSH 动态插件** 形态运行：源码需在会话内通过 `cordis_define` 定义并 `cordis_run` 激活。
本仓库保存源码与打包产物，使「重装 / 重启恢复」可重复执行。

## 1. 打包

```bash
cd C:\Users\pyg12\gitProjects\study_dsh_plugin
node scripts/build.mjs     # 生成 dist/study-plugin.dist.json
node scripts/install.mjs   # 快照写入 ~/.dsh/study-work/plugin/
```

## 2. 安装到当前 DSH（会话内，由助手执行）

1. 读取 `dist/study-plugin.dist.json`（或 `~/.dsh/study-work/plugin/study-plugin.dist.json`）；
2. 调用 `cordis_define`：
   - `plugin.kind: "new"`，`idPrefix: "stud"`
   - `code.host` = 文件 `code.host` 字段内容
   - `code.client` = 文件 `code.client` 字段内容
   - name/purpose 可自拟（建议注明来源仓库与版本/hash）；
3. `cordis_run` 激活返回的 `pluginId` + `packageId`（mode: run）；客户端首次加载需在 GUI 批准；
4. 停用旧实例（避免双面板/双工具）：对仍在运行的 `stuh-6`、`stmc-8` 及更早引擎插件执行 `cordis_stop`；
5. 验证：左栏出现「📚 学习区」；聊天工具 `study_plan_*` 可用；`~/.dsh/study-work/README.md` 被同步。

> 提示：助手执行时把本文件的步骤作为操作依据即可；无需手动粘贴代码。

## 3. DSH 重启后恢复（数据不丢，插件需重装）

数据、工作区、目标/章节会话在重启后全部保留，仅动态插件定义丢失。
任一会话中对助手说：

> 按 `C:\Users\pyg12\.dsh\study-work\plugin\INSTALL.txt` 恢复学习插件

助手将读取该目录的 `study-plugin.dist.json`，按上文第 2 节步骤重建插件。

## 4. 升级流程（改代码后）

1. 编辑 `src/host.js` / `src/client.js`；
2. `node scripts/build.mjs && node scripts/install.mjs`；
3. 在会话内对助手说「按仓库 dist 升级学习插件到新版本」：助手以 `kind: "existing"` + 原 pluginId 追加新 package 并 `cordis_run(mode: update)`（或按第 2 节重建后停旧实例）。

## 5. 附：官方持久化路线（未实施）

正式做法是让插件常驻加载（进程重启后自动恢复），需把宿主改造为 profile 组合插件并在
`~/.dsh/profiles/web/cordis.patch.yml` 插入行，同时把客户端做成带 `dsh.client` 清单的
`window.__ModuleLoader__` 模块包并搭建 host↔client 远程调用桥。
本仓库 `docs/PROJECT.md` §7 记录了该路线的边界与现状；实施前无需改动现有使用方式。
