// cleanroom-check.mjs — 净室安装验证（M3 验收项，离线，不触碰 ~/.dsh）
// 复刻终端用户布局：
//   T/profiles/web/node_modules/study-plugin   ← npm pack 的 tarball 解包（真实目录，非链接）
//   T/profiles/node_modules/@deepseek-ai/dsh-tools ← junction → 本机宿主嵌套副本（模拟 DSH 启动桥接）
// 探针：import 包宿主半 → mock ctx 走 apply() → 断言 /study-rpc 路由注册 + 5 个 study_plan_* 工具
// 注：子进程输出一律重定向到文件（沙箱禁管道 stdio）。
// 用法: node scripts/cleanroom-check.mjs [--host-tools <dsh-tools 目录>] [--keep]
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const argv = process.argv.slice(2)
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const keep = argv.includes('--keep')

const hostToolsDefault = path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai', 'dsh-tools')
const hostTools = path.resolve(argOf('--host-tools') || hostToolsDefault)
try { await fs.stat(path.join(hostTools, 'package.json')) } catch {
  console.error('✗ 未找到宿主 dsh-tools 副本: ' + hostTools + '（用 --host-tools 指定）')
  process.exit(1)
}

// 无管道子进程执行：stdout/stderr → 文件，返回 {status, out}
function run(cmd, args, opts, tag) {
  const T = opts.T
  const outPath = path.join(T, tag + '.log')
  const fd = fsSync.openSync(outPath, 'w')
  const r = spawnSync(cmd, args, { cwd: opts.cwd || T, stdio: ['ignore', fd, fd] })
  fsSync.closeSync(fd)
  let out = ''
  try { out = fsSync.readFileSync(outPath, 'utf8') } catch {}
  return { status: r.status, error: r.error, out }
}
import fsSync from 'node:fs'

const T = await fs.mkdtemp(path.join(os.tmpdir(), 'study-cleanroom-'))
console.log('净室目录: ' + T)
try {
  // 1) npm pack（Node 24 禁 .cmd 无 shell spawn → 直接 node 跑 npm-cli.js）
  const npmCliCandidates = [
    path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
    'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
  ]
  let npmCli
  for (const c of npmCliCandidates) { try { await fs.stat(c); npmCli = c; break } catch {} }
  if (!npmCli) throw new Error('找不到 npm-cli.js（' + npmCliCandidates.join(' ; ') + '）')
  let r = run(process.execPath, [npmCli, 'pack', '--pack-destination', T, '--cache', path.join(T, 'npmcache')], { T, cwd: pkgRoot }, 'pack')
  if (r.error) throw new Error('npm pack 启动失败: ' + r.error.message)
  if (r.status !== 0) throw new Error('npm pack 失败: ' + r.out)
  const tgz = (await fs.readdir(T)).filter((f) => f.endsWith('.tgz')).pop()
  if (!tgz) throw new Error('净室内未见 tarball:\n' + r.out)
  const tgzAbs = path.join(T, tgz)
  console.log('✓ tarball: ' + tgz + ' (' + (await fs.stat(tgzAbs)).size + ' bytes)')

  // 1b) 内容核对（files 字段生效）
  r = run('tar', ['-tzf', tgzAbs], { T }, 'list')
  if (r.status !== 0) throw new Error('tar -tzf 失败: ' + r.out)
  const entries = r.out.trim().split(/\r?\n/).map((s) => s.replace(/^package\//, ''))
  const need = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'lib/portable.js', 'LICENSE', 'CHANGELOG.md']
  for (const n of need) if (!entries.includes(n)) throw new Error('tarball 缺少 ' + n)
  const forbidden = entries.filter((e) => e.startsWith('src/') || e.startsWith('test/') || e.startsWith('scripts/') || e.startsWith('node_modules/'))
  if (forbidden.length) throw new Error('tarball 混入开发文件: ' + forbidden.join(', '))
  console.log('✓ tarball 内容正确: ' + entries.join(', '))

  // 2) 解包到假 profile 的 web/node_modules（真实目录）
  const pkgDir = path.join(T, 'profiles', 'web', 'node_modules', 'study-plugin')
  await fs.mkdir(pkgDir, { recursive: true })
  r = run('tar', ['-xzf', tgzAbs, '-C', pkgDir, '--strip-components=1'], { T }, 'unpack')
  if (r.status !== 0) throw new Error('tar 解包失败: ' + r.out)
  console.log('✓ 已按真实目录布局解包')

  // 3) 宿主桥接 junction（复刻 DSH 启动时建的 profiles/node_modules 桥）
  const bridge = path.join(T, 'profiles', 'node_modules', '@deepseek-ai', 'dsh-tools')
  await fs.mkdir(path.dirname(bridge), { recursive: true })
  await fs.symlink(hostTools, bridge, process.platform === 'win32' ? 'junction' : 'dir')
  console.log('✓ 宿主桥接已模拟 → ' + hostTools)

  // 4) 探针
  const importSpec = 'file:///' + path.join(pkgDir, 'lib', 'index.js').replace(/\\/g, '/')
  const workRootSpec = (path.join(T, 'work')).replace(/\\/g, '/')
  const probe = `
import { apply } from ${JSON.stringify(importSpec)}
import * as Pb from ${JSON.stringify('file:///' + path.join(pkgDir, 'lib', 'portable.js').replace(/\\/g, '/'))}
import Fsp from 'node:fs/promises'
import Pth from 'node:path'
import { EventEmitter } from 'node:events'
const T = ${JSON.stringify(T.replace(/\\\\/g, '/'))}
const workRoot = ${JSON.stringify(workRootSpec)}
const sessRoot = Pth.join(T, 'sessions')
const enc = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, (c) => '~' + c.charCodeAt(0).toString(16).padStart(4, '0'))
const locate = (cwd, id) => Pth.join(sessRoot, enc(String(cwd).replace(/[\\\\/]/g, '-')), enc(id), 'session.jsonl.zstd')
const attached = []
// 镜像宿主两条硬不变量：同 id 出现在两个 project 目录 ⇒ list() 抛；attach 要 realpath 相符
async function listHeaders() {
  const out = []
  for (const pr of await Fsp.readdir(sessRoot, { withFileTypes: true }).catch(() => [])) {
    if (!pr.isDirectory()) continue
    for (const sd of await Fsp.readdir(Pth.join(sessRoot, pr.name), { withFileTypes: true })) {
      if (!sd.isDirectory()) continue
      const f = Pth.join(sessRoot, pr.name, sd.name, 'session.jsonl.zstd')
      try { out.push({ h: Pb.readSessionHeader(await Fsp.readFile(f)), p: f }) } catch {}
    }
  }
  const seen = new Set()
  for (const x of out) { if (seen.has(x.h.id)) throw new Error('duplicate JSONL session id ' + x.h.id); seen.add(x.h.id) }
  return out
}
const routes = []
const tools = []
const ctx = {
  inject: (names, fn) => fn({
    effect: (f) => f(),
    webServer: { register: (rt) => { routes.push(rt); return () => {} } },
    tools: { register: (def) => { tools.push(def); return () => {} } },
    agents: { get: () => undefined },
    workspaceRegistry: {
      archivedSessionIds: [],
      resolveByPath: async () => undefined,
      get: () => undefined,
      create: async (p, title) => ({
        id: 'ws-cr', path: await Fsp.realpath(p), title, sessionIds: [],
        attachSession: async function (sid) {
          const hit = (await listHeaders()).find((x) => x.h.id === sid)
          if (!hit) throw new Error('no such session ' + sid)
          if (Pth.resolve(await Fsp.realpath(hit.h.cwd)) !== this.path) throw new Error('cwd mismatch')
          if (!this.sessionIds.includes(sid)) this.sessionIds.push(sid)
          attached.push(sid)
        },
        detachSession: async function (sid) { this.sessionIds = this.sessionIds.filter((x) => x !== sid) },
        setTitle: async function (t) { this.title = t }
      })
    },
    sessionPersistence: {
      compression: 'zstd',
      locate: (m) => ({ kind: 'jsonl', path: locate(m.cwd, m.id) }),
      list: async () => (await listHeaders()).map((x) => x.h),
      inspect: async (id) => { const h = (await listHeaders()).find((x) => x.h.id === id); if (!h) throw new Error('not found ' + id); return { meta: h.h, events: [] } }
    },
    sessions: { get: () => undefined, flush: async () => {}, list: () => [] },
    attachments: { readImage: async () => ({ data: new Uint8Array() }), saveImage: async () => ({ attachmentId: 'sha256:0' }) }
  })
}
apply(ctx, { workRoot })
const rpc = routes.find((r) => r.path === '/study-rpc')
function call(method, args) {
  return new Promise((resolve, reject) => {
    const res = { writeHead() {}, end(b) { try { resolve(JSON.parse(String(b))) } catch (e) { reject(e) } } }
    const req = new EventEmitter()
    req.method = 'POST'
    req.socket = { remoteAddress: '127.0.0.1' }
    setImmediate(() => { req.emit('data', JSON.stringify({ method, args: args || {} })); req.emit('end') })
    try { rpc.handler(req, res) } catch (e) { reject(e) }
  })
}
const names = tools.map((t) => t.name).sort().join(',')
const expect = 'study_goal_export,study_goal_import,study_plan_approve,study_plan_create,study_plan_reject,study_plan_research,study_plan_status'
const paths = routes.map((r) => r.path).sort().join(',')
if (paths !== '/study-export,/study-rpc') { console.error('✗ 路由不符: ' + paths); process.exit(1) }
if (names !== expect) { console.error('✗ 工具不符: ' + names); process.exit(1) }
const st = await tools.find((t) => t.name === 'study_plan_status').execute({})
if (!st || st.ok !== true || !Array.isArray(st.goals)) { console.error('✗ study_plan_status 执行异常'); process.exit(1) }
let rejected = false
try { await tools.find((t) => t.name === 'study_goal_export').execute({}) } catch { rejected = true }
if (!rejected) { console.error('✗ study_goal_export 缺 goal_id 应被参数 schema 拦下'); process.exit(1) }
console.log('✓ 探针: 2 路由 + 7 工具注册 + status 执行 + export 参数校验')

// ── 端到端：造目标 → 造会话 → 导出 → 抹掉 → 覆盖式导入（证明 tarball 里 portable.js 真的可用）
const created = await call('study.createGoal', { topic: '净室回归', target_level: 'x', requirements: '' })
if (!created || created.ok !== true) { console.error('✗ createGoal: ' + JSON.stringify(created)); process.exit(1) }
const gid = created.goalId
const dir = Pth.join(workRoot, gid)
const sid = 'session-cr-1'
const writeAt = async (p, buf) => { await Fsp.mkdir(Pth.dirname(p), { recursive: true }); await Fsp.writeFile(p, buf) }
await writeAt(locate(dir, sid), await Pb.jsonlToZstdFrames(JSON.stringify({ type: 'session', version: 0, id: sid, createdAt: Date.now(), cwd: dir, delegationDepth: 0 }) + '\\n' + JSON.stringify({ type: 'turn/start', seq: 0, time: Date.now(), data: { turn: 1 } }) + '\\n', 1))
const ex = await call('study.exportGoal', { goalId: gid })
if (!ex || ex.ok !== true || ex.counts.sessions !== 1) { console.error('✗ exportGoal: ' + JSON.stringify(ex)); process.exit(1) }
if (ex.manifestFormatVersion && ex.manifestFormatVersion !== 2) { console.error('✗ manifest 版本异常'); process.exit(1) }
await Fsp.rm(dir, { recursive: true, force: true })
await Fsp.rm(Pth.dirname(Pth.dirname(locate(dir, sid))), { recursive: true, force: true })
await Fsp.writeFile(Pth.join(workRoot, 'index.json'), JSON.stringify({ goals: [] }))
const pv = await call('study.importGoal', { path: ex.path, mode: 'overwrite' })
if (!pv || pv.preview !== true || pv.canImport !== true) { console.error('✗ 预览: ' + JSON.stringify(pv)); process.exit(1) }
if (!pv.plan.sessions.every((s) => s.identity && s.action)) { console.error('✗ 预览未给出身份/动作'); process.exit(1) }
const im = await call('study.importGoal', { path: ex.path, mode: 'overwrite', confirm: true })
if (!im || im.ok !== true || im.applied.create !== 1) { console.error('✗ 导入: ' + JSON.stringify(im)); process.exit(1) }
const led = JSON.parse(await Fsp.readFile(Pth.join(dir, '.study-sync.json'), 'utf8'))
if (led.sessions[0].localId !== sid) { console.error('✗ 账本未记身份映射'); process.exit(1) }
if (attached.length !== 1 || attached[0] !== sid) { console.error('✗ 会话未挂回工作区: ' + attached.join(',')); process.exit(1) }
const re = await call('study.importGoal', { path: ex.path, mode: 'overwrite', confirm: true })
if (!re || re.ok !== true || re.idempotent !== true) { console.error('✗ 重复导入不应是幂等: ' + JSON.stringify(re)); process.exit(1) }
console.log('✓ 端到端: 导出→抹掉→覆盖式导入→重复导入幂等（含 portable.js 与 .study-sync.json 账本）')
`
  const probePath = path.join(T, 'probe.mjs')
  await fs.writeFile(probePath, probe)
  r = run(process.execPath, [probePath], { T }, 'probe')
  console.log(r.out)
  if (r.status !== 0) throw new Error('探针失败: ' + r.out)

  console.log('净室安装验证通过 ✅（终端用户解析链 = 真实目录 + DSH 宿主桥接，无需任何 dev junction）')
} finally {
  if (keep) console.log('（--keep）保留净室目录: ' + T)
  else await fs.rm(T, { recursive: true, force: true })
}
