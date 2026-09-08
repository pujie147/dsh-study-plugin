# study_dsh_plugin 📚

「学习区」DSH 插件工程：DeepSeek Harness Web GUI 中的个人学习管理 —— 学习目标管理面板（左侧栏入口）+ 目标/章节独立会话 + 聊天管理工具。

- **项目文档**：[docs/PROJECT.md](./docs/PROJECT.md)（架构 / 状态机 / API / 决策记录）
- **使用手册**：[docs/USAGE.md](./docs/USAGE.md)（面板与聊天操作、恢复步骤、FAQ）
- **安装 / 重装**：[INSTALL.md](./INSTALL.md)

## 快速开始

```bash
npm run build          # 打包 src/ → dist/study-plugin.dist.json
npm run install:dsh    # 写入 ~/.dsh/study-work/plugin/ 安装快照
```

数据根目录：`~/.dsh/study-work/`（index.json + 各目标目录 + 自动维护的 README.md）。

## 结构

```
src/host.js     宿主引擎（RPC + 聊天工具 + README 同步）
src/client.js   学习区面板 UI（sidebar.footer.action）
scripts/        打包 / 安装脚本
docs/           项目文档 + 使用手册
dist/           打包产物（含 code.host / code.client）
```
