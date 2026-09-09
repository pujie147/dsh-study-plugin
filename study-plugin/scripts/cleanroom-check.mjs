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
  const need = ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js', 'LICENSE', 'CHANGELOG.md']
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
let route = null
const tools = []
const ctx = {
  inject: (names, fn) => fn({
    effect: (f) => f(),
    webServer: { register: (rt) => { route = rt; return () => {} } },
    tools: { register: (def) => { tools.push(def); return () => {} } },
    agents: { get: () => undefined },
    workspaceRegistry: { resolveByPath: async () => undefined, create: async () => ({ id: 'x' }), get: () => undefined }
  })
}
apply(ctx, { workRoot: ${JSON.stringify(workRootSpec)} })
const names = tools.map((t) => t.name).sort().join(',')
const expect = 'study_plan_approve,study_plan_create,study_plan_reject,study_plan_research,study_plan_status'
if (!route || route.path !== '/study-rpc') { console.error('✗ 路由未注册'); process.exit(1) }
if (names !== expect) { console.error('✗ 工具不符: ' + names); process.exit(1) }
const st = await tools.find((t) => t.name === 'study_plan_status').execute({})
if (!st || st.ok !== true || !Array.isArray(st.goals)) { console.error('✗ study_plan_status 执行异常'); process.exit(1) }
console.log('✓ 探针: 路由 + 5 工具注册 + status 执行（净室，无 dev junction）')
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
