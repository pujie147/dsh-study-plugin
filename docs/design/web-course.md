# 网页课程源（v0.8.0，已实现 · 真机验收待办）

> 状态：**已实现（v0.8.0）**。自动化测试已覆盖（`smoke` 回环 mock 站真抓取段 + `client.test` 8 场景，见 §7）；
> §8 真机验收清单尚未执行，发布打 tag 前需在实机跑一遍。
> 原料 = 用户提供一个网页 URL，插件在同域内爬一层把正文落成文件；
> 出货 = 草案批准后**一次性整理完全部讲义**（单会话连续写章），而不是逐章手点。
> 中间的调研→草案→批准→轮询采纳全部沿用现状（D3 / D16 / D34），不改语义。

## 0. 一句话目标

让用户说"照着这个网站教我 X"：插件抓取起始页及其同域内链（深度 2、上限 30 页），
产出**可预览、可确认**的材料清单；用户确认后才发起调研（基于材料、不再网上漫游）；
批准后向目标会话注入**一条**整课生成指令，AI 按章序逐章把讲义写盘，
网页材料覆盖不到的知识点由 AI 自动补全并在正文标注来源缺失。

## 1. 数据模型

### goal.json 新增字段（全部可选，旧目标不受影响）

| 字段 | 说明 |
| --- | --- |
| `webSources[]` | `{url, title}` —— 本目标的网页课程源；补爬追加去重（按 URL） |
| `webCrawl` | 抓取**事实**（承 D16 惯例，由真正执行处写入）：`{status:'running'\|'done'\|'failed', startedAt, finishedAt, pages[], error?}`；`pages[]` 每项 `{url, status:'ok'\|'failed'\|'skipped'\|'blocked', reason?, file?, title?, chars}` |
| `draft.chapters[].gap_notes[]` | 调研阶段 AI 记录的"本章哪些知识点网页材料覆盖不到"（字符串数组，可省）；生成阶段据此补全 |

### 新增目录 `<goal>/research/web/`

```
research/web/
├─ manifest.json      # { crawledAt, startUrl, pages:[与 goal.webCrawl.pages 同构] }
├─ 01-<slug>.txt      # 每页一个纯文本文件（提取后的正文）
├─ 02-<slug>.txt
└─ ...
```

- **文件即真相**（D3）：讲义/材料都是会话 AI 与插件共用的普通文件，`research/web/` 落在
  目标工作区内 ⇒ 导出/同步整树旅行，`lib/portable.js` **零改动**；调研会话里 AI 直接用
  read 工具读这些文件。
- `manifest.json` 是给人和面板看的索引；`.txt` 是给 AI 读的正文。两者由抓取器同批写。

### 状态机改动

- 在 `researching` 之前插派生显示态 **`crawling`**：`study.startCrawl` 置入，抓取协程结束
  （成功或部分成功）后置回 `researching` 并写 `webCrawl.status`。面板在 `crawling` 显示
  进度与「🔁 重新抓取」，抓完显示预览清单 + 确认入口。
- **退回草案（reject）不清网页材料**：`research/web/` 是用户主动导入的原料，不是 AI 产物，
  与 D7 清 `draft.json` 的动机（防旧草案被重新采纳）无关。
- 重跑抓取 = 幂等重建：清空 `research/web/` 后整批重抓（旧 `webCrawl.pages` 直接覆盖）。

## 2. 抓取器（宿主半新段，仿 GitHub 同步段的组织方式）

纯 Node + 正则，**不引任何 npm 依赖**（承 D15 精神）：`fetch` 拉 HTML →
剥 `<script>/<style>/<noscript>` 与标签 → 实体解码 → 压空白得正文；
另用一条 `<a href>` 正则收集内链（去 fragment/query、相对 URL 归一、小写域名列白名单）。

### 爬取规则（本版写死，不开放配置）

| 常量 | 值 | 说明 |
| --- | --- | --- |
| `CRAWL_MAX_DEPTH` | 2 | 起始页 = 深度 1，其同域内链 = 深度 2 |
| `CRAWL_MAX_PAGES` | 30 | 含失败页在内的总访问上限 |
| `CRAWL_MAX_BYTES_PER_PAGE` | 2MB | 超限截断标记 `truncated` |
| `CRAWL_PER_REQ_TIMEOUT` | 15s | 单请求（AbortController） |
| `CRAWL_TOTAL_BUDGET` | 120s | 整批超时，到点未访问的页记 `skipped: timeout-budget` |
| `CRAWL_MIN_CHARS` | 200 | 低于此字数判"疑似 JS 渲染/空页"，保留但在预览高亮提示 |

- **同域限定**：仅接受与起始 URL 同 host（含 `www.` 前缀互认）的链接；跨域一律不入队。
- **协议**：只抓 `http/https`；重定向用 `redirect:'error'` 手动跟——跳出同域或超过 3 跳即
  `failed: redirect-out-of-scope`（仿 `ghReq`，绝不无脑跟）。
- **内容类型**：`content-type` 非 `text/html`（PDF/图片/zip 等）→ `skipped: not-html`，
  在预览清单列出，不抓取、不入材料。
- **robots.txt 轻量遵守**：首次访问某协议+主机组合时拉 `/robots.txt`（拉不到 = 放行，
  不因此失败）；解析 `User-agent: *` 段的 `Disallow:` 路径前缀，命中即
  `blocked: robots` 并入预览清单（用户看得见"为什么这页没抓"）。仅对**起始域**做此检查。

### 失败处理

- 单页失败只记 `pages[].status='failed' + reason`，**不中断整批**；
  全部失败才置 `webCrawl.status='failed'`，部分成功置 `done`（预览清单里区分）。
- 抓取协程 fire-and-forget：`study.startCrawl` 立即返回 `{ok:true}`，面板靠 2.5s 轮询
  `study.list` 读 `webCrawl` 进度——与"插件不长连、轮询采纳"的既有节奏一致。
- 宿主 Node 无 `fetch` 全局 ⇒ 与 GitHub 同步同款降级：只报"抓取不可用"，其余功能不受影响。

## 3. RPC 与面板流

新增 3 个 RPC（**不新增 HTTP 路由、不新增聊天工具** ⇒ 净室断言仅改 RPC 计数：路由仍 3、工具仍 7）：

| method | 入参 | 行为 |
| --- | --- | --- |
| `study.startCrawl` | goalId, url | 校验 URL（http/https、可解析）→ 置 `crawling` + `webCrawl{status:'running'}` → 后台协程开抓 → 立即返回 |
| `study.getCrawlPreview` | goalId | 只读：回 `webCrawl` + `webSources` + 材料文件落盘数，供面板渲染确认清单 |
| `study.generateAllChapters` | goalId | 批准后批量派发（§5）；置全部 draft 章 `generating`，注入一条整课指令 |

### 面板（src/client.mjs）

- 创建目标视图加一行 URL 输入 + 「🌐 从网页抓取」；也允许先建目标后补 URL。
- `crawling` 态：「⏳ 抓取中 已抓 N（成功 S / 失败 F / 跳过 K）」；完成后面板展开预览清单
  （标题 / URL / 字数 / 状态徽标），低字数页高亮，blocked/skipped 带原因；
  底部「▶ 开始调研」沿用现有派发口（D16：`study.dispatchResearch` 唯一 owner）。
- 有材料的目标在调研卡片标「🌐 材料 N 页」；章节列表区加「⚡ 一次性生成全部讲义」，
  **逐章「生成讲义」按钮原样保留**（最小干预）。
- 二次抓取/生成中重复点击：RPC 侧按 `webCrawl.status==='running'` / 已有 `generating` 章拒绝并给白话提示。

## 4. 调研指令分岔：材料优先

`researchInstruction` / `retryInstruction` 检测 `goal.webSources` 非空且 `webCrawl.status==='done'`
时切换到材料模式（无材料目标指令原文不变）：

- **先读料**：动笔前用 read 工具逐份读完 `research/web/*.txt`（清单+文件名+URL 直接写进指令，
  禁跳读、禁只凭文件名猜测内容）。
- **一次性调研钉死**：以材料为唯一课程结构依据规划章节；仅当材料覆盖不到的关键知识点缺失时
  才允许 web_search **至多 2 次**补充；不允许自行上网漫游或重新抓取。
- **记欠账**：材料覆盖不到的知识点写入该章 `gap_notes`（"缺什么料、希望补什么"一句话一条），
  供批准后的生成阶段消费。
- 排版/结构约定（先总后分、overview 框架图、三个可选字段、prefs 注入）与 D34 全部不变。

## 5. 一次性整理全部讲义

`study.generateAllChapters` 向**目标会话**注入**一条**「整课生成」指令：

- **只生成「待生成」章**：派发范围 = `status==='draft'` 的章；`generating` 章一律排除，
  默认模式指令明令**绝不重写已存在的讲义文件**。无 draft 且存在 ready 章时 RPC 拒绝并提示
  "全部章节讲义已就绪"（面板此时已改出重新生成入口，见下）。
- **全部就绪 ⇒ 同键变「⚡ 重新生成全部讲义」**（`regenerate: true`）：派发范围 = **全部章**，
  指令授权**逐章覆盖重写**既有讲义（重写章按序置回 `generating`，采纳扫描会重新确认 ready）。
  面板按钮文案与 RPC 参数同步切换，"生成/继续/重新生成"三者共用这一个批量入口。
- 指令仍按**全章序 1..N 推进**（保持承接与欠账清偿的上下文）；默认模式下 ready 章位置标注
  "已就绪，勿重写，仅作前置阅读"（regenerate 模式无此标注）；**每写完一章立即落盘**
  `chapters/NN-<slug>.md` 再继续——中途停不会丢已写出的章，剩余待生成章可重按 ⚡ 或回落逐章按钮补跑。
- 每章沿用 D34 全部约定：固定六段总分结构、动笔前 read 全部前置 ready 章、
  欠账清偿（含就地改回「→ 已在第 N 章讲清」）、git 分支动线、LaTeX/mermaid、知识闭环自检。
- **缺料补全**：本章 `gap_notes` 列出的点，材料里没有依据的由 AI 用自身知识补全
  （会话有 web_search 工具可辅以 ≤2 次检索），正文对应小节末尾标注
  「> 📤 补充：非原始网页来源」——这是"自动补全"的**唯一**落点。
- 章节状态：派发时**仅待生成章**置 `generating`；`adoptChapterFiles` 轮询采纳（>200 字符 → `ready`）不变，
  `continueChapter` 的单章兜底路径不变。

## 6. 诚实边界（做不到 / 故意不做的）

- **JS 渲染站点（SPA）抓不到正文**：宿主只拿服务端返回的 HTML。表现为该页 `chars` 过低，
  进预览清单由高亮提示，人来决定是否手工补 URL 重抓；**插件不自动补抓**，
  更不会因为某页没抓下来就在讲义里"无中生有"。
- **抓取层缺页 ≠ 生成层补全**：自动补全只发生在知识点层面（focus_point/gap_notes 在，
  但网页材料没讲透）；整页缺失不会被"补"出来。
- **单会话整课生成的上下文限制**：章数多（经验值 >8）时后半程质量可能下降——已接受的取舍，
  兜底 = 已落盘章不丢 + 逐章按钮重跑。不引入跨会话接力（复杂度不划算）。
- **不做增量/缓存抓取**：重爬即整批重抓，不与上次结果做 diff；30 页规模下不必要。
- **不做域名白名单等参数配置**：本版规则写死；确有需求（如子域、翻页深度）下版再开。
- **robots 检查只管起始域、只认 `User-agent: *` 段**：轻量礼貌抓取，不是完整 RFC 9309 实现。
- 材料文件在目标工作区内 ⇒ AI 会话可读可写，与本插件所有文件产物同信任级，不额外加防护。

## 7. 测试口径

- `test/smoke.mjs`：回环 **mock 文档站**（内存 http server，含同域内链/跨域链接/非 html/
  低正文页/robots.txt）覆盖：同域限定、深度 2 截断、30 页上限、`not-html`/`blocked`/`failed`
  分类、robots 拉不到=放行、重跑幂等清空、三条新 RPC、材料模式调研指令内容断言
  （含 gap_notes 清洗）、`generateAllChapters` 指令与章状态迁移断言。
- `test/client.test.mjs`：URL 输入→抓取进度→预览清单→开始调研→⚡按钮的流转，
  及 running 态重复点击被拒的白话提示。
- `scripts/cleanroom-check.mjs`：RPC 集合计数更新；路由/工具集合断言不变。
- 已知红项：smoke/portable 在本机宿主 rc.2 漂移下先天红（见记忆「宿主 rc.2 漂移」），
  以未改动 master 对照验证，不算本 feature 回归。

## 8. 真机验收清单（发布前必跑）

1. 选一个真实同域文档站（静态渲染优先），走完 建目标→抓取→预览确认→调研→批准→⚡一次生成；
2. 核对 `research/web/` 文件数与预览清单一致、乱码/空页有提示；
3. 核对草案 chapter 与材料对得上、`gap_notes` 有真实产出；
4. 核对全部章节讲义落盘、后续章能引用前置章、补全处带「非原始网页来源」标注、
   mermaid/LaTeX 在右侧页签正常渲染；
5. 导出 zip → 他机导入，确认 `research/web/` 随行。

## 9. 决策摘要（为什么这样选）

- **宿主 fetch 而非会话 AI 抓取**：抓取过程确定、可预览、可重试、可限流，符合"文件即真相"；
  AI 抓取则过程不可见，"一次性"只能靠提示词祈祷。代价（SPA 抓不到）如实报出而非掩盖。
- **同域一层（深度 2 / 30 页）**：足够覆盖典型文档站的目录+内容页拓扑；再深则噪声与
  时长失控，且"关联网页"的用户语义就是"这个站的相关页面"。
- **单会话连续写全部章**：用户要的是"同意调研后一次性整理完"。逐章自动接力要新建
  N 次派发编排，并发多会话则直接杀死 D34 的章间承接——两者都不是"一次"。
  单会话写章让**承接与欠账清偿天然成立**（AI 顺序写，前置章就在上下文里）。
- **AI 知识自动补 + 显式标注**：补缺口是诉求，但用户必须能分辨"网页里有的"与"AI 补的"，
  所以标注是硬要求而非可选。
