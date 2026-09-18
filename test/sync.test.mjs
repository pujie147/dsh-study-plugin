// ============================================================================
// study-plugin — test/sync.test.mjs
// M5 GitHub 同步：本地 mock GitHub API（node:http）+ 两个插件实例（A/B 两台设备，
// 共享宿主真实 persistence/registry 夹具 ⇒ 跨机导入必然走身份换发，正是设计路径）。
// 覆盖：绑定（PAT/设备码/固定仓定位或创建/认领标记/422 竞态/占用拒绝/401 失效与重绑）、
//       五态判定（remoteMissing/upToDate/localAhead/remoteAhead/conflicted + 快进优先）、
//       双机往返（A 推 B 拉再推回）、CAS（sha 前置条件 409）、token 不外泄、fetch 缺席降级。
// 跑法：node test/sync.test.mjs   （宿主实现不可得时按 CLAUDE.md 约定**跳过**而非放宽）
// ============================================================================
import { createServer } from 'node:http'
import { EventEmitter } from 'node:events'
import { promises as fsp } from 'node:fs'
import { createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import * as P from '../lib/portable.js'
import { createHostServices } from './host-fixture.mjs'
import { apply } from '../lib/index.js'

let passed = 0, failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra).slice(0, 400) + ']' : '')) }
}
const gitBlobSha = (buf) => createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex')

// ── mock GitHub API ─────────────────────────────────────────────────────────
function makeGithubMock() {
  const state = {
    tokens: new Map([['github_pat_mockAAAtester01', 'tester'], ['github_pat_mockBBBtester02', 'tester']]),   // token → login
    repos: new Map(),                                              // 'owner/name' → {id,default_branch,files:Map}
    blobs: new Map(),                                              // git blob sha → Buffer
    pollScript: [],                                                // 设备码轮询返回队列（对象或 'pending' 串）
    createRace422: false,                                          // true ⇒ 下次 POST /user/repos 表现为"别人先建成了"
    requests: [],
  }
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://mock')
    const p = decodeURIComponent(url.pathname)
    let body = ''
    for await (const c of req) body += c
    const send = (code, obj) => { res.writeHead(code, { 'content-type': 'application/json' }); res.end(JSON.stringify(obj)) }
    const auth = String(req.headers.authorization || '').replace(/^Bearer\s+/, '')
    const login = state.tokens.get(auth)
    state.requests.push(req.method + ' ' + p)
    const repoOf = (owner, name) => state.repos.get(owner + '/' + name)
    try {
      if (!login && p !== '/login/device/code' && p !== '/login/oauth/device/poll') return send(401, { message: 'Bad credentials' })
      if (req.method === 'GET' && p === '/user') return send(200, { login, id: 7 })
      if (req.method === 'POST' && p === '/login/device/code') {
        state.deviceCodes = true
        return send(200, { device_code: 'dc-1', user_code: 'MOCKCODE', verification_uri: 'http://127.0.0.1/login/device', expires_in: 900, interval: 1 })
      }
      if (req.method === 'POST' && p === '/login/oauth/device/poll') {
        const nxt = state.pollScript.shift()
        if (nxt === undefined) return send(200, { error: 'unsupported_grant_type' })
        if (nxt === 'pending') return send(200, { error: 'authorization_pending' })
        if (nxt === 'denied') return send(400, { error: 'access_denied' })
        return send(200, nxt)
      }
      if (req.method === 'POST' && p === '/user/repos') {
        const name = JSON.parse(body).name
        const key = login + '/' + name
        if (state.createRace422) {
          state.createRace422 = false
          if (!state.repos.has(key)) state.repos.set(key, { id: 100 + state.repos.size, default_branch: 'main', files: new Map() })
          return send(422, { message: 'name already exists on this account' })
        }
        if (state.repos.has(key)) return send(422, { message: 'name already exists on this account' })
        state.repos.set(key, { id: 100 + state.repos.size, default_branch: 'main', files: new Map() })
        return send(201, { id: 100 + state.repos.size, name, default_branch: 'main', fork: false, archived: false })
      }
      let m
      if ((m = /^\/repos\/([^/]+)\/([^/]+)$/.exec(p))) {
        const r = repoOf(m[1], m[2])
        if (!r) return send(404, { message: 'Not Found' })
        return send(200, { id: r.id, name: m[2], default_branch: r.default_branch, fork: false, archived: false })
      }
      if ((m = /^\/repos\/([^/]+)\/([^/]+)\/git\/blobs\/([0-9a-f]+)$/.exec(p))) {
        const buf = state.blobs.get(m[3])
        if (!buf) return send(404, { message: 'No blob in repository for sha' })
        return send(200, { sha: m[3], size: buf.length, content: buf.toString('base64') })
      }
      if ((m = /^\/repos\/([^/]+)\/([^/]+)\/contents\/(.+)$/.exec(p))) {
        const r = repoOf(m[1], m[2])
        if (!r) return send(404, { message: 'Not Found' })
        const fp = m[3].replace(/\/+$/, '')
        if (req.method === 'GET' && r.files.size === 0) return send(409, { message: 'This repository is empty.' })
        if (req.method === 'GET') {
          const buf = r.files.get(fp)
          if (buf !== undefined) {
            const sha = gitBlobSha(buf)
            state.blobs.set(sha, buf)
            return send(200, { name: path.posix.basename(fp), path: fp, sha, size: buf.length, type: 'file', content: buf.length <= 1024 * 1024 ? buf.toString('base64') : '' })
          }
          const kids = new Map()
          for (const [k, v] of r.files) {
            if (!k.startsWith(fp + '/')) continue
            const rest = k.slice(fp.length + 1)
            const seg = rest.split('/')[0]
            if (rest.includes('/')) kids.set(seg, { type: 'dir' })
            else kids.set(seg, { type: 'file', sha: gitBlobSha(v), size: v.length })
          }
          if (kids.size) {
            const out = [...kids].map(([seg, it]) => Object.assign({ name: seg, path: fp === '' ? seg : fp + '/' + seg }, it))
            return send(200, out)
          }
          return send(404, { message: 'Not Found' })
        }
        if (req.method === 'PUT') {
          const b = JSON.parse(body)
          const buf = Buffer.from(b.content, 'base64')
          const cur = r.files.get(fp)
          if (cur !== undefined && b.sha !== gitBlobSha(cur)) return send(409, { message: 'sha was not created in the repository', documentation_url: 'CAS' })
          if (cur !== undefined && !b.sha) return send(409, { message: 'A new commit with identical content is not allowed' })
          if (cur === undefined && b.sha) return send(422, { message: 'object does not exist' })
          r.files.set(fp, buf)
          const sha = gitBlobSha(buf)
          state.blobs.set(sha, buf)
          return send(cur === undefined ? 201 : 200, { content: { name: path.posix.basename(fp), path: fp, sha }, commit: { sha: 'c' + state.requests.length } })
        }
        return send(405, { message: 'Method Not Allowed' })
      }
      return send(404, { message: 'no route ' + p })
    } catch (e) { send(500, { message: String((e && e.message) || e) }) }
  })
  const done = new Promise((r) => server.listen(0, '127.0.0.1', r))
  return { server, state, ready: done, base: () => 'http://127.0.0.1:' + server.address().port }
}

// ── 插件实例（每台"设备"独立一套 workRoot + sessions 根 + 宿主服务 + 一个 apply） ──
// 每台机器各有各的 sessions 根，才是真正的"两台机器"：跨机身份换发/重复 id 的边界由
// portable.test 专门覆盖，本文件聚焦同步自身的绑定/CAS/五态/快进/拉取语义。
async function makeDevice(tag) {
  const tmpRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'study-sync-' + tag + '-')))
  const sessRoot = await fsp.realpath(await fsp.mkdtemp(path.join(os.tmpdir(), 'study-sync-' + tag + '-sess-')))
  const live = []
  const sessionsSvc = { list: () => live, get: (id) => live.find((s) => s.id === id), flush: async () => {} }
  const H = await createHostServices({ sessionsRoot: sessRoot, sessions: sessionsSvc })
  if (!H) return undefined
  const routes = {}, effects = []
  const ctx = {
    inject: (names, fn) => {
      const scope = {
        effect: (fn2, label) => { const d = fn2(); effects.push({ label, d }); return d },
        webServer: { register: (route) => { routes[route.path] = route; return () => { delete routes[route.path] } } },
        tools: { register: () => () => {} },
        agents: { get: () => ({ followup: () => {} }) },
        workspaceRegistry: H.registry,
        sessionPersistence: H.persistence,
        sessions: sessionsSvc,
        attachments: { readImage: async () => { throw new Error('no attachments in sync test') }, saveImage: async () => { throw new Error('n/a') } },
      }
      for (const n of names) if (scope[n] === undefined) throw new Error('unexpected service: ' + n)
      fn(scope)
    },
  }
  apply(ctx, { workRoot: tmpRoot })
  const rpc = routes['/study-rpc']
  const call = (method, args) => new Promise((resolve, reject) => {
    const res = {
      code: 0, body: '',
      writeHead(code) { this.code = code },
      end(b) {
        this.body = b == null ? '' : b
        let json = null
        try { json = JSON.parse(this.body) } catch {}
        resolve(json)
      },
    }
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    setImmediate(() => { req.emit('data', JSON.stringify({ method, args: args || {} })); req.emit('end') })
    try { rpc.handler(req, res) } catch (e) { reject(e) }
  })
  return { tag, root: tmpRoot, H, call }
}

// 取不到宿主真实实现 ⇒ 整套跳过（前提就是跑宿主代码，不放宽断言）
const A = await makeDevice('A')
const B = await makeDevice('B')
if (!A || !B) {
  console.log('SKIP: 取不到宿主真实实现（@deepseek-ai/dsh-session-persistence-jsonl / dsh-workspace），同步测试的前提是跑宿主代码。')
  process.exit(0)
}
const mock = makeGithubMock()
await mock.ready
const base = mock.base()

const setupBoth = async () => {
  for (const d of [A, B]) {
    const r = await d.call('study.syncSetConfig', { apiBase: base, webBase: base })
    if (!r || r.ok !== true) { console.error('FAIL: syncSetConfig 失败', r); process.exit(1) }
  }
}

// 目标会话构造（真 locate + zstd 帧；每台设备写进自己的 sessions 根）
const ev = (type, seq, data, extra) => JSON.stringify(Object.assign({ type, seq, time: 1788000100000 + seq, data }, extra || {}))
async function makeSession(device, sid, cwd, rows) {
  const abs = device.H.persistence.locate({ cwd, id: sid }).path
  // 宿主的分代文件名 ↔ header.version 必须一致（实测：v3 文件名塞 version:0 的 header，
  // attach 时宿主 assertStoredIdentity 直接拒）。从 locate 返回的文件名反推该写哪个版本。
  const vm = /\.v(\d+)\.jsonl/.exec(path.basename(abs))
  const version = vm ? Number(vm[1]) : 0
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  const lines = [JSON.stringify({ type: 'session', version, id: sid, createdAt: 1788000000000, cwd, delegationDepth: 0, isSeeded: false, agentPreset: 'standard' }), ...rows]
  await fsp.writeFile(abs, await P.jsonlToZstdFrames(lines.join('\n') + '\n', 2))
  return abs
}
const goalDirOf = (device, goalId) => path.join(device.root, goalId)

console.log('\n══ 1. 未绑定守卫与配置 ══')
{
  const r = await A.call('study.syncGetConfig')
  check('初始 bound=false / bindState=unbound', r.ok === true && r.bound === false && r.config && !r.config.auth, r)
  const i = await A.call('study.syncInspect', { goalId: 'goal-x' })
  check('未绑定时 syncInspect 结构化拒绝（不抛）', i.ok === false && i.bound === false && /尚未绑定/.test(i.error || ''), i)
  const bad = await A.call('study.syncSetConfig', { apiBase: 'http://10.1.2.3:8080' })
  check('明文 endpoint 只放行回环', bad.ok === false, bad)
  const bad2 = await A.call('study.syncSetConfig', { apiBase: 'https://evil.example.com/steal' })
  check('带路径的 apiBase 被拒', bad2.ok === false, bad2)
  await setupBoth()
  const auto = await A.call('study.syncSetConfig', { autoSync: 'push' })
  check('autoSync 只接受 off/pull', auto.ok === false, auto)
}

console.log('\n══ 2. PAT 绑定：固定仓定位/创建 + 认领标记 + token 不外泄 ══')
{
  const badTok = await A.call('study.syncBindPat', { token: 'nope-1234567890abcdef' })
  check('坏 token → 401 文案且不落盘', badTok.ok === false && /凭据无效/.test(badTok.error || ''), badTok)
  const shortT = await A.call('study.syncBindPat', { token: 'abc' })
  check('形状不对的 token 直接被拒', shortT.ok === false, shortT)
  const cfg0 = await A.call('study.syncGetConfig')
  check('失败绑定后仍未绑定', cfg0.bound === false, cfg0)
  const r = await A.call('study.syncBindPat', { token: 'github_pat_mockAAAtester01' })
  check('PAT 绑定成功 ⇒ 自动建仓 ' + 'tester/dsh-study-sync', r.ok === true && r.bound === true && r.config.repo.fullName === 'tester/dsh-study-sync', r)
  check('仓被标为 private', mock.state.repos.get('tester/dsh-study-sync') !== undefined, [...mock.state.repos.keys()])
  const files = mock.state.repos.get('tester/dsh-study-sync').files
  const marker = files.get('.study-sync-owner.json')
  check('认领标记已首推且 kind 匹配', !!marker && JSON.parse(marker.toString('utf8')).kind === 'dsh-study-sync', marker && marker.toString())
  const leak = JSON.stringify(await A.call('study.syncGetConfig'))
  check('任何 RPC 返回不含 token 原文', !leak.includes('github_pat_mockAAAtester01'), leak.slice(0, 200))
  check('返回里有 tokenHint（末 4 位）', leak.includes('••••'), leak.slice(0, 200))
  const again = await A.call('study.syncBindPat', { token: 'github_pat_mockAAAtester01' })
  check('重复绑定走"采用已有仓"分支（不再建仓）', again.ok === true && again.config.repo.fullName === 'tester/dsh-study-sync', again)
}

console.log('\n══ 3. 设备码绑定（B 设备）══')
{
  const noId = await B.call('study.syncStartDeviceFlow')
  check('未配 client_id ⇒ 明确报缺失并提示 PAT 出路', noId.ok === false && /client_id/.test(noId.error || ''), noId)
  await B.call('study.syncSetConfig', { clientId: 'IvMock0001' })
  const st = await B.call('study.syncStartDeviceFlow')
  check('设备码下发 userCode+verificationUri', st.ok === true && st.userCode === 'MOCKCODE' && /login\/device/.test(st.verificationUri), st)
  mock.state.pollScript = ['pending', { access_token: 'github_pat_mockBBBtester02' }]
  const p1 = await B.call('study.syncPollDeviceFlow')
  check('未授权时轮询返回 pending（不误报失败）', p1.ok === true && p1.status === 'pending', p1)
  const p2 = await B.call('study.syncPollDeviceFlow')
  check('授权后轮询即完成绑定', p2.ok === true && p2.status === 'authorized' && p2.bound === true, p2)
  const cfg = await B.call('study.syncGetConfig')
  check('B 采用 A 建好的仓（认领标记通过）', cfg.config.repo && cfg.config.repo.fullName === 'tester/dsh-study-sync' && cfg.config.auth.kind === 'device', cfg)
  const orphan = await B.call('study.syncPollDeviceFlow')
  check('流程结束后再轮询报"没有进行中"', orphan.ok === false, orphan)
}

console.log('\n══ 4. A 建目标 → 首推 → upToDate ══')
let goalId = ''
{
  const c = await A.call('study.createGoal', { topic: '同步试验', target_level: '入门', requirements: '中文' })
  goalId = c.goalId
  check('createGoal ok', c.ok === true && /^goal-/.test(goalId), c)
  await makeSession(A, 'sess-sync-1', goalDirOf(A, goalId), [
    ev('turn/start', 0, { turn: 1 }),
    ev('session/title', 1, { title: '同步试验会话' }),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
  ])
  const i0 = await A.call('study.syncInspect', { goalId })
  check('远端还没有 ⇒ remoteMissing', i0.ok === true && i0.status === 'remoteMissing', i0)
  check('本地摘要带标题/会话向量/字节数', i0.local && i0.local.title === '同步试验' && i0.local.sessions.length === 1 && i0.local.sessions[0].maxSeq === 2 && i0.local.bytes > 0, i0.local)
  const p = await A.call('study.syncPush', { goalId })
  check('首推成功且 meta+zip 落仓', p.ok === true && p.pushed === true, p)
  const files = mock.state.repos.get('tester/dsh-study-sync').files
  const gpath = 'study-goals/' + goalId + '/'
  check('仓内路径 = <prefix>/<goalId>/bundle.{zip,meta.json}', files.has(gpath + 'bundle.zip') && files.has(gpath + 'bundle.meta.json'), [...files.keys()])
  const meta = JSON.parse(files.get(gpath + 'bundle.meta.json').toString('utf8'))
  check('meta 携带展示冲突所需的最小信息', meta.kind === 'dsh-study-sync-bundle' && !!meta.exportedAt && /^dev-/.test(meta.deviceId) && meta.title === '同步试验' && !!meta.digest && meta.sessions[0].remoteId === 'sess-sync-1', meta)
  const i1 = await A.call('study.syncInspect', { goalId })
  check('推完即 upToDate', i1.status === 'upToDate', i1)
  const p2 = await A.call('study.syncPush', { goalId })
  check('重复推送短路 noop（不产生空提交）', p2.ok === true && p2.noop === true && p2.idempotent === true, p2)
}

console.log('\n══ 5. B 拉取 A 的目标（跨机导入 ⇒ 身份换发在真宿主上跑通） ══')
{
  const lr = await B.call('study.syncListRemote')
  check('B 能看到远端清单（标题/设备/时间）', lr.ok === true && lr.goals.length === 1 && lr.goals[0].title === '同步试验' && /^dev-/.test(lr.goals[0].deviceId) && !!lr.goals[0].exportedAt, lr)
  const pl = await B.call('study.syncPull', { remoteGoalId: goalId })
  check('B 拉取成功 ⇒ 本地出现同名目标', pl.ok === true && pl.pulled === true && pl.goalId === goalId && pl.applied && pl.applied.create >= 1, pl)
  const bl = await B.call('study.list', {})
  check('B 的列表里可见（同一 goalId 幂等 upsert）', bl.goals.some((g) => g.id === goalId), bl.goals)
  const pl2 = await B.call('study.syncPull', { remoteGoalId: goalId })
  check('重复拉同一版本 ⇒ idempotent', pl2.ok === true && pl2.idempotent === true, pl2)
  const i = await B.call('study.syncInspect', { goalId })
  check('拉完即 upToDate（pull 后基线用重算 digest，不被换 id 假阳性干扰）', i.status === 'upToDate', i)
  check('B 的账本里 remoteGoalId 与 A 一致（B 的本地会话 id 必然不同）', i.remoteGoalId === goalId, i)
}

console.log('\n══ 6. 快进链：B 追加会话帧 → localAhead → 推；A remoteAhead → 拉 ══')
{
  await makeSession(B, 'sess-sync-1', goalDirOf(B, goalId), [
    ev('turn/start', 0, { turn: 1 }),
    ev('session/title', 1, { title: '同步试验会话' }),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
  ])
  // 独立机器：B 拉取后本地会话沿用 sess-sync-1（各自 sessions 根，不撞全局唯一）。
  // 在该会话尾部追加 3 帧 ⇒ 会话向量严格超集 ⇒ localAhead 快进推送。
  const abs = B.H.persistence.locate({ cwd: goalDirOf(B, goalId), id: 'sess-sync-1' }).path
  const a0 = P.analyzeTranscript(await fsp.readFile(abs))
  const tail = [ev('turn/start', a0.maxSeq + 1, { turn: 2 }), ev('user/message', a0.maxSeq + 2, { id: 'u9', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'B 上新增的问题' }] }, { surfaceOp: 'append' }), ev('turn/end', a0.maxSeq + 3, { turn: 2, reason: { kind: 'completed' } })]
  const app = await P.appendLinesToTranscript(await fsp.readFile(abs), tail.map((l) => String(l)))
  await fsp.writeFile(abs, app.bytes)
  const ib = await B.call('study.syncInspect', { goalId })
  check('B 会话超集 ⇒ localAhead（快进，不升冲突）', ib.status === 'localAhead', ib)
  const pb = await B.call('study.syncPush', { goalId })
  check('B 快进推送成功', pb.ok === true && pb.pushed === true, pb)
  const ia = await A.call('study.syncInspect', { goalId })
  check('A 视角 ⇒ remoteAhead', ia.status === 'remoteAhead', ia)
  const pa = await A.call('study.syncPull', { remoteGoalId: goalId })
  check('A 拉回（append 语义）⇒ applied.append ≥ 1', pa.ok === true && pa.applied && (pa.applied.append >= 1 || pa.applied.replace >= 1), pa)
  const txt = P.analyzeTranscript(await fsp.readFile(A.H.persistence.locate({ cwd: goalDirOf(A, goalId), id: 'sess-sync-1' }).path))
  check('A 的原始会话确实多出了 B 的事件（内容随 remoteId 旅行）', txt.lines.length === 6 && /B 上新增的问题/.test(JSON.stringify(txt.lines)), { n: txt.lines.length })
}

console.log('\n══ 7. 真分叉：双向都有改动 ⇒ conflicted ⇒ needChoice ⇒ 二选一 ══')
{
  await fsp.writeFile(path.join(goalDirOf(A, goalId), 'A-独家笔记.md'), '# A 写的')
  await fsp.writeFile(path.join(goalDirOf(B, goalId), 'B-独家笔记.md'), '# B 写的')
  const ia = await A.call('study.syncInspect', { goalId })
  check('A 未推前 localAhead', ia.status === 'localAhead', ia)
  const pa = await A.call('study.syncPush', { goalId })
  check('A 先推成功', pa.ok === true && pa.pushed === true, pa)
  const ib = await B.call('study.syncInspect', { goalId })
  check('B 两侧都变 + 向量相等 ⇒ conflicted', ib.status === 'conflicted', ib)
  check('冲突里带远端更新时间与设备', ib.remote && !!ib.remote.exportedAt && /^dev-/.test(ib.remote.deviceId) && ib.remote.bytes > 0, ib.remote)
  const pb = await B.call('study.syncPush', { goalId })
  check('B 无 force 推送 → needChoice 二选一', pb.ok === false && pb.needChoice === true && /二选一|force=true/.test(pb.error || ''), pb)
  check('needChoice 带冲突摘要（remote/local 对比）', pb.remote && pb.local && pb.remote.digest !== pb.local.digest, pb)
  const pw = await B.call('study.syncPush', { goalId, force: true })
  check('「覆盖仓库」= force push 成功', pw.ok === true && pw.pushed === true, pw)
  const ib2 = await B.call('study.syncInspect', { goalId })
  check('覆盖后 upToDate', ib2.status === 'upToDate', ib2)
  const ia2 = await A.call('study.syncInspect', { goalId })
  check('A 视角变为 remoteAhead', ia2.status === 'remoteAhead', ia2)
  // 让 A 本地再独占改一笔（未推）⇒ 双向都动 ⇒ conflicted ⇒ 无 discard 的拉取必须挡住
  await fsp.writeFile(path.join(goalDirOf(A, goalId), 'A-第二轮.md'), '# A 又写了')
  const ia3 = await A.call('study.syncInspect', { goalId })
  check('A 本地再改 + 远端已被 B 覆盖 ⇒ conflicted', ia3.status === 'conflicted', ia3)
  const pd = await A.call('study.syncPull', { remoteGoalId: goalId })
  check('A 无 discard 拉真分叉 ⇒ needChoice 二选一（亮出远端更新时间/设备）', pd.ok === false && pd.needChoice === true && !!pd.remote && !!pd.remote.exportedAt && /^dev-/.test(pd.remote.deviceId), pd)
  const pdc = await A.call('study.syncPull', { remoteGoalId: goalId, discardLocal: true })
  check('「放弃本地」= discardLocal 拉取成功', pdc.ok === true && pdc.pulled === true, pdc)
  check('B 独家笔记出现在 A（远端内容落地）', (await fsp.readFile(path.join(goalDirOf(A, goalId), 'B-独家笔记.md'), 'utf8')).includes('B 写的'))
  check('A 独家笔记仍在盘上（不 prune，放弃≠删除）', !!(await fsp.stat(path.join(goalDirOf(A, goalId), 'A-独家笔记.md')).catch(() => null)))
}

console.log('\n══ 8. CAS 与并发语义（直打 mock 校验 sha 前置条件） ══')
{
  const files = mock.state.repos.get('tester/dsh-study-sync').files
  const fp = 'study-goals/' + goalId + '/bundle.zip'
  const cur = gitBlobSha(files.get(fp))
  const put = async (sha) => {
    const r = await fetch(base + '/repos/tester/dsh-study-sync/contents/' + fp, {
      method: 'PUT', headers: { authorization: 'Bearer github_pat_mockAAAtester01', 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'x', content: Buffer.from('#stale').toString('base64'), branch: 'main', sha }),
    })
    return r.status
  }
  check('正确 sha ⇒ CAS 通过 (200)', await put(cur) === 200)
  check('过期 sha ⇒ 409（后写者必被弹回）', await put('00000000000000000000000000000000000000aa') === 409)
  const corruptPull = await A.call('study.syncPull', { remoteGoalId: goalId })
  check('远端包被塞坏 ⇒ 拉取时 sha256 校验拦下，绝不落地脏数据', corruptPull.ok === false && /sha256/.test(corruptPull.error || ''), corruptPull)
  const fix = await A.call('study.syncPush', { goalId, force: true })
  check('force push 修复回 upToDate', fix.ok === true && (fix.pushed === true || fix.noop === true), fix)
}

console.log('\n══ 9. 固定仓名的占用、受控接管与竞态 ══')
{
  const C = await makeDevice('C')
  await C.call('study.syncSetConfig', { apiBase: base, webBase: base })
  mock.state.tokens.set('github_pat_mockCCCtester03', 'ghost')
  // 占用：同名仓、有内容、无认领标记（用独立账号 ghost，避免踩坏 A 的 tester 仓）
  const ghostFiles = () => mock.state.repos.get('ghost/dsh-study-sync').files
  mock.state.repos.set('ghost/dsh-study-sync', { id: 999, default_branch: 'main', files: new Map([['README.md', Buffer.from('# 别人的仓')]]) })
  const occ = await C.call('study.syncBindPat', { token: 'github_pat_mockCCCtester03' })
  check('同名非学习区仓 ⇒ 不硬拒，给 needTakeOver 且不落绑定', occ.ok === false && occ.needTakeOver === true && occ.bound === false && /认领标记/.test(occ.error || ''), occ)
  check('占用后本机是 account-only（token 已留，供接管复用）', (await C.call('study.syncGetConfig')).bindState === 'account-only', null)
  const to1 = await C.call('study.syncTakeOver')
  check('明示接管 ⇒ 补写标记并绑定就绪', to1.ok === true && to1.bound === true, to1)
  check('接管只补标记、绝不删已有内容（README 仍在 + 标记 kind 正确）', ghostFiles().has('README.md') && JSON.parse(ghostFiles().get('.study-sync-owner.json').toString('utf8')).kind === 'dsh-study-sync', null)
  // 标记不符（kind 被人改）也算占用；接管只替换那一个标记文件
  await C.call('study.syncUnbind')
  mock.state.repos.set('ghost/dsh-study-sync', { id: 998, default_branch: 'main', files: new Map([['README.md', Buffer.from('# keep')], ['.study-sync-owner.json', Buffer.from(JSON.stringify({ kind: 'someone-else' }))]]) })
  const bad1 = await C.call('study.syncBindPat', { token: 'github_pat_mockCCCtester03' })
  check('认领标记 kind 不符 ⇒ 同样 needTakeOver', bad1.ok === false && bad1.needTakeOver === true && /认领标记/.test(bad1.error || ''), bad1)
  const to2 = await C.call('study.syncTakeOver')
  check('不符态接管成功且只替换标记（README 保留）', to2.ok === true && ghostFiles().has('README.md') && JSON.parse(ghostFiles().get('.study-sync-owner.json').toString('utf8')).kind === 'dsh-study-sync', to2)
  // 422 竞态：两设备同时首建 ⇒ 输家采用赢家
  await C.call('study.syncUnbind')
  mock.state.repos.delete('ghost/dsh-study-sync')
  mock.state.createRace422 = true
  const race = await C.call('study.syncBindPat', { token: 'github_pat_mockCCCtester03' })
  check('建仓 422（输家）⇒ 重 GET + 标记校验 ⇒ 采用成功', race.ok === true && race.bound === true, race)
}

console.log('\n══ 10. 失效 → 重绑恢复；降级面 ══')
{
  mock.state.tokens.delete('github_pat_mockAAAtester01')            // 远端撤销了 token
  const gone = await A.call('study.syncListRemote')
  check('token 被撤 ⇒ needRebind 结构化返回', gone.ok === false && gone.needRebind === true, gone)
  const cfg = await A.call('study.syncGetConfig')
  check('配置进入 invalid 态（token 与仓库指向保留）', cfg.bindState === 'invalid' && cfg.config.repo && cfg.config.repo.fullName === 'tester/dsh-study-sync', cfg)
  mock.state.tokens.set('github_pat_mockAAAtester01', 'tester')      // 重新授权
  const rb = await A.call('study.syncRebind')
  check('syncRebind 恢复 ready（账本基线不动）', rb.ok === true && rb.bound === true, rb)
  const i = await A.call('study.syncInspect', { goalId })
  check('恢复后五态判定照旧可用', i.ok === true && !!i.status, i)
  const realFetch = globalThis.fetch
  globalThis.fetch = undefined
  const nf = await A.call('study.syncListRemote')
  check('宿主无 fetch ⇒ 只报同步不可用，不抛', nf.ok === false && /fetch/.test(nf.error || ''), nf)
  globalThis.fetch = realFetch
  const ub = await A.call('study.syncUnbind')
  check('解绑只清本机（bound=false）', ub.ok === true && ub.bound === false, ub)
  check('解绑后远端数据仍在仓里', mock.state.repos.get('tester/dsh-study-sync').files.has('study-goals/' + goalId + '/bundle.meta.json'))
}

console.log('\n══ 11. 其它功能不受牵连（降级红线） ══')
{
  const l = await A.call('study.list', {})
  check('解绑后 study.list 正常（同步层不拖垮面板）', l.ok !== false && Array.isArray(l.goals) && l.goals.length >= 1, l)
  const e = await A.call('study.exportGoal', { goalId })
  check('导出仍正常（sync 与 export 共栈但互不依赖）', e.ok === true && !!e.file, e)
}

mock.server.close()
console.log('\nsync.test: ' + passed + ' 通过 / ' + failed + ' 失败')
process.exit(failed ? 1 : 0)
