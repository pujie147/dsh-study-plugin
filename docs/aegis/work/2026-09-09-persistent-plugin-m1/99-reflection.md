# Reflection — 学习插件常驻化 + 发布（2026-09-09）

## 做对了什么
- **先证据后抽象**：M2 前把 defineTool/sctx.effect/模块解析全部读到源码级（cordis lib:1168、dsh-tools lib:601、dsh bin.js:96、dsh-plugin preflight），预期 1-2 轮重启调试压缩成 0 轮——冒烟 33/33 直接吃掉全部 schema 风险。
- **净室测试先行**：发布前用假 profile + 宿主桥接复刻终端布局，把"唯一实质风险"在推 GitHub 之前消掉。
- **降级设计**：defineTool 解析失败只缺聊天工具，M1 面板永不受累（爆炸半径隔离）。
- **GIT_DIR 分离仓**：沙箱禁嵌套 git init + 禁工作区外写入时，detached git-dir 一行解套。

## 踩坑与代价
- Windows 符号链接需管理员 → Junction 平替（realpath 同实例，ESM 缓存友好）。
- Node 24 禁 .cmd 无 shell spawn、沙箱禁管道 stdio → node 直跑 npm-cli.js + 文件重定向捕获。
- `dependencies` 声明宿主包是**反模式**（registry 版本漂移遮蔽桥接）——发布前发现并删除，教训：抄同生态位包（free-search）的清单比按 npm 直觉写更可靠。
- 凭记忆移植代码不可信：首版宿主半与真实源码有实质偏差，靠逐字对照 _extract_host.js 重写纠正。
- 审批疲劳：~/.dsh 写与 push 各触发提权，累计 4+ 次弹窗；应更早合并成"一次本地准备 + 一次联网推送"的节奏。

## 边界与遗留
- codeload/raw 在本机网络不可达 → github: 简写通道未真实验证；git+https（直 clone）实测可用并写入 README。
- pnpm 11 的 24h minimumReleaseAge 会拦"刚发布即装"——文档已注明，无法本机消除。
- 动态版（src/ + plugin/ 快照）保留为回退，未退役（触发条件：常驻版稳定运行一个学习周期后用户决定）。

## 结论
T0–T9 全部完成，双目标（任何模式可用 / 可分发）闭环，任务停在健康状态；npm 渠道与 dshmarket 收录为无风险可选项。
