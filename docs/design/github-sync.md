# 学习区 GitHub 同步（v0.5.0，已实现）

> 状态：**已确认并落地**。本篇是 `import-overwrite-sync.md`（覆盖式导入/导出）的后续：
> 那篇把「同一个包重复应用 = 无改动」的幂等语义铺好，本篇在此之上加一条
> **只经 GitHub 固定仓流转、跨机器双向同步**的通道。导入/导出仍是底座，二者共栈但互不依赖。

## 0. 一句话目标

让多台机器的学习区通过**一个 GitHub 私有仓**互相同步：不搭自建服务、不加运行时依赖，
机器之间**只通过仓库**通信；正确性靠**乐观 CAS**（Contents API 的 sha 前置条件），
**无锁 ⇒ 无死锁**；真分叉时把仓库最新内容摊给用户看，让用户在「放弃本地 / 覆盖仓库」之间二选一，
程序绝不替用户悄悄吃掉任何一侧。

## 1. 仓库布局与"认领"

固定仓名 `dsh-study-sync`，定位不到就在**绑定账号**下自动建。布局：

```
dsh-study-sync/
├─ .study-sync-owner.json          # 认领标记：kind:'dsh-study-sync' —— 唯一的"这是本插件的仓"凭据
└─ study-goals/
   └─ <remoteGoalId>/
      ├─ bundle.zip                # v2 导出包（与手动「📤 导出」同构）
      └─ bundle.meta.json          # 元数据；**最后提交 = 提交点**
```

- **认领标记是拒绝误写的唯一依据**（红线）。绑定/重绑时读 `.study-sync-owner.json`：
  - 无此仓 ⇒ 建私有仓 + 写标记；
  - 有仓**有**内容但**无标记** ⇒ 判定"这不是本插件的同步仓"，**拒绝写入且不落绑定**，要求用户改名或换账号；
  - 标记 `kind` 被改坏 ⇒ 同样拒绝。
- **meta 最后推 = 提交点**：zip 先、meta 后。读方只认 meta，看不到"zip 已换、meta 仍旧"的半状态。
- 每次 push 在 meta 里记 `digest / exportedAt / deviceId / zipBytes / zipSha256 / zipBlobSha / sessions[]`，
  供冲突判定与展示。

## 2. 绑定：两条授权路 + 状态机

`study.syncGetConfig` 返回一个 `bindState`（**永不含 token 明文**，只给 `tokenHint = ••••末四位`）：

| bindState | 含义 | 面板出口 |
|---|---|---|
| `unbound` | 无凭据 | 设备码授权 / 粘贴 PAT 两条入口 |
| `account-only` | 已识别账号但未定位到仓 | 继续绑定流程 |
| `ready` | 凭据 + 仓库指向齐全 | 列远端、逐目标同步 |
| `invalid` | 凭据曾有效但被远端撤销（401 过） | 「重新绑定（复用已存凭据）」`syncRebind` |

- **设备码 OAuth（主路）**：`syncStartDeviceFlow` 向 `{web}/login/device/code` 申请一次性 code，
  面板显示 `user_code` + `verification_uri`；用户浏览器授权后 `syncPollDeviceFlow` 轮询。
  `authorization_pending` 是**正常中间态**（返回 `{ok:true,status:'pending'}`），
  `access_denied / expired_token` 才终止。拿到 `access_token` 后走同一 `bindWithToken` 尾段。
  需要本机先配好 OAuth App 的 `client_id`（见 README「注册 GitHub OAuth App」）。
- **PAT（兜底）**：`syncBindPat` 收 fine-grained PAT（`github_pat_…`）或 classic（`ghp_…`），
  仅要求 **Contents: Read and write**。形状校验后 `GET /user` 认账号 → 定位/建仓 → 落盘。
- **失败不落盘**：PAT 场景任一步失败（401/建仓被拒）**不改现有配置**；设备码场景保留 auth 待续。
- **endpoint 红线**：`apiBase/webBase` 只接受 `https://host`，明文 `http` 仅放行回环
  （`127.0.0.1|localhost:port`，为本地 mock 测试）。防止 token 走明文外泄。

`bindWithToken` 会 `Object.assign({}, cfg)` 出副本再改；两个 handler 拿到返回值后**显式写回 cfg**
（历史坑：曾把副本当成原对象，导致返回的 config 缺 repo/auth）。

## 3. 五态判定与 contentDigest

`syncInspect`（push/pull 内部复用同一 `syncAssess`）现算本地包指纹，比对远端 meta 与账本双基线，
得出五态之一：

| status | 条件 | 默认动作 |
|---|---|---|
| `remoteMissing` | 远端没有该目标 | 首推 |
| `upToDate` | 本地 digest == 远端 digest（或两侧相对基线都没动） | 无操作（幂等） |
| `localAhead` | 仅本地变了；或本地会话向量**严格覆盖**远端 | 推送 |
| `remoteAhead` | 仅远端变了；或远端会话向量严格覆盖本地 | 拉取 |
| `conflicted` | 双侧相对基线都有改动且**互不覆盖** | **二选一，不自动合并** |

- **contentDigest** = `sha256(排序后的 "文件名:sha256" + '#' + 会话向量 "remoteId:maxSeq:rows")`。
  与字节打包无关，只反映"内容 + 进度"。
- **严格超集才快进**：`vecCovers(local, remote) && !vecCovers(remote, local)` ⇒ `localAhead`；反之 `remoteAhead`。
  双向都不覆盖（或向量相等但文件双向都改）⇒ `conflicted`。这是把"会话只是各自往前追加"与
  "真分叉"区分开的关键：前者是快进，后者必须人来裁决。
- **账本双基线**（`.study-sync.json` 的 `github.baseLocalDigest / baseRemoteDigest`）：
  每次成功 push/pull 后 `stampSyncBase` **现算**回写（pull 后本地内容被换身份重写，不能沿用 pull 前的 digest）。

## 4. 冲突处理：亮信息 + 二选一（red line）

真分叉下**两侧都不许被程序吃掉**：

- `syncPush` 无 `force` 且判 `conflicted` ⇒ 返回 `{ok:false, needChoice:true, error, hint, local, remote}`；
  `remote` 带 `exportedAt / deviceId / bytes / digest`，让用户看清"仓库里那份是谁、什么时候写的"。
- `syncPull` 在下载前先 `findLocalGoalForRemote` 反查本机对应目标并 `syncAssess`；
  若已 `conflicted` 且 `discardLocal` 为假 ⇒ 直接 `needChoice` 挡住，**不会先拉下来再靠导入侧报错**。
- 面板据此亮出远端更新时间/设备/体积，给两个按钮：
  - **「🔼 覆盖仓库」** = `syncPush force:true`（仓库那份丢失，用户明示）
  - **「🔽 放弃本地」** = `syncPull discardLocal:true`（导入按 force 覆盖本地会话，
    但**不 prune 本地多出的文件**，见 D22——放弃 ≠ 删除）

## 5. 并发与 CAS（无锁 ⇒ 无死锁）

机器之间**只通过仓库**通信，不设任何分布式锁。写冲突交给 GitHub Contents API 的 **sha 前置条件**：

- 每个 `ghPutContents` 带上"我读到的这个文件当前的 blob sha"作为 `sha` 字段。
- 若对方在你之后、你之前抢先提交 ⇒ 文件 sha 变了 ⇒ 你的 PUT 得到 **409**（`GhError.status===409/422`）。
- push 捕获 409/422 后**只重试一轮**：重读重判；若远端已与本地一致 ⇒ 视作幂等 noop；
  否则按新状态决定快进或交回用户裁决。再撞（`_retried`）就停手交回用户，不无限重试。
- **传输完整性**是另一层：`fetchRemoteZip` 用 `/git/blobs/{sha}` 下载并校验 `gitBlobSha(buf)===sha`；
  落地前再按 `meta.zipSha256` 校验整包（`sha256Hex(buf)!==meta.zipSha256` ⇒ 抛"sha256 校验失败"，**脏包不入库**）。
  注意：`syncInspect` 比的是 meta 里记的 `digest`，**不重算 zip 字节**，所以单纯塞坏 zip 不会改变五态——
  它会在 pull 落地时被 sha256 拦下（测试 §8 钉住此语义）。

### 软锁 / presence 的红线

设计允许**将来**展示"某目标正被别的设备编辑"这类** advisory 提示**，但有一条不可逾越的红线：

> **任何 presence / 软锁信号只能是提示，绝不能阻塞读写。**

当前实现里没有任何锁文件、没有"占用即拒绝"。若后续加提示性 badge，也必须保持：看到别的设备在场，
只是**告诉用户**，push/pull 照常按 CAS 走，由 CAS 而不是软锁来裁决并发。理由见 D27。

## 6. 诚实边界（做不到 / 故意不做的）

- **不做增量传输**：每次同步整包（`bundle.zip`）。超过 `MAX_SYNC_ZIP_BYTES = 50MB` 直接拒绝同步，
  提示改用手动「📤 导出」传。会话帧级增量路径已留（D19 的 append），但本版未接。
- **不做 prune / 删除同步**：本地比远端多的文件/会话一律保留（D22）。放弃本地也只是覆盖同名内容，不删独占文件。
- **不合并**：真分叉不跑三方合并，交人裁决（本设计的核心取向）。
- **冲突判定基于 digest 与账本基线**，若用户手工往仓里塞文件绕过插件，digest 对不上会被判成 `conflicted`，
  而不是被静默接受。
- token 明文**永不进任何 RPC 返回值**，只回 `tokenHint`（末四位）。

## 7. 测试

`test/sync.test.mjs`（70 断言）跑在**真实宿主 fixture** + **内存 mock GitHub server**（回环 endpoint）上：
两台设备 A/B 各持独立 `sessionPersistence` 根。覆盖：

- 绑定状态机（设备码 pending→authorized、PAT、失败不落盘、invalid→rebind、unbind）；
- 固定仓名的**占用拒绝**与**建仓 422 竞态**（输家重 GET + 标记校验后采用赢家）；
- 五态与快进链（B 追加帧 → localAhead 推 → A remoteAhead 拉 → 内容随 remoteId 旅行）；
- 真分叉二选一（覆盖仓库=force push / 放弃本地=discard pull，且不 prune）；
- **CAS**：正确 sha ⇒ 200、过期 sha ⇒ 409；塞坏 zip ⇒ pull 时 sha256 拦下；
- 降级红线：宿主无 fetch 只报不可用不抛、解绑只清本机、其它功能（list/导出）不受牵连。

客户端面板见 `test/client.test.mjs` 的同步段（token 不回显、二选一按钮、force/discard 参数、降级禁用）。
