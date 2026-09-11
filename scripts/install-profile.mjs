// install-profile.mjs — 把 study-plugin 安装进 DSH profile（幂等，可手动运行）
// 用法:
//   node scripts/install-profile.mjs                     # 默认 profile: $DSH_HOME/profiles/web（或 ~/.dsh/profiles/web）
//   node scripts/install-profile.mjs --profile <目录>    # 指定 profile 目录
//   node scripts/install-profile.mjs --uninstall         # 卸载（删链接 + 撤注册，备份 package.json）
// 动作:
//   1) profile/package.json 备份（存在则不覆盖）
//   2) node_modules/study-plugin → 本包目录（Windows 优先 Junction=免管理员；失败退 symlink；再退复制）
//   3) dependencies 增 "study-plugin": "link:study-plugin"，dsh.profile.bundles 追加 "study-plugin"
//   4) 宿主半 import 自检
// 完成后需重启 DSH（bundle 代码装载发生在启动时）。
import { promises as fs } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PKG_NAME = JSON.parse(await fs.readFile(path.join(pkgRoot, 'package.json'), 'utf8')).name

const argv = process.argv.slice(2)
const argOf = (flag) => {
  const i = argv.indexOf(flag)
  return i >= 0 ? argv[i + 1] : undefined
}
const uninstall = argv.includes('--uninstall')

const dshHome = process.env.DSH_HOME || path.join(os.homedir(), '.dsh')
const profileDir = path.resolve(argOf('--profile') || path.join(dshHome, 'profiles', 'web'))
const profilePkgPath = path.join(profileDir, 'package.json')
const linkPath = path.join(profileDir, 'node_modules', PKG_NAME)

const fail = (msg) => { console.error('✗ ' + msg); process.exit(1) }
const ok = (msg) => console.log('✓ ' + msg)

// ── 前置检查 ─────────────────────────────────────────────────────────────────
let profilePkg
try {
  profilePkg = JSON.parse(await fs.readFile(profilePkgPath, 'utf8'))
} catch {
  fail('profile 的 package.json 不存在或不可读: ' + profilePkgPath + '（用 --profile <dir> 指定？）')
}
if (!profilePkg.dsh || !profilePkg.dsh.profile || !Array.isArray(profilePkg.dsh.profile.bundles)) {
  fail('该 package.json 没有 dsh.profile.bundles 数组，不是 DSH profile 目录: ' + profileDir)
}

// 判定一个目录项是「链接/Junction 挂载点」还是「真实目录」。
// Windows Junction 上 lstat().isDirectory() 为 true，但 readlink() 能取到目标；
// 真实目录 readlink() 报 EINVAL。据此避免把 rmdir（只删空目录）误用到真实目录上。
async function classifyEntry(p) {
  let st
  try { st = await fs.lstat(p) } catch { return { exists: false, link: false, stat: undefined } }
  let target
  try { target = await fs.readlink(p) } catch { target = undefined }
  return { exists: true, link: target !== undefined, target, stat: st }
}

if (uninstall) {
  // 卸载
  const bak = profilePkgPath + '.bak-' + PKG_NAME
  try { await fs.copyFile(profilePkgPath, bak) } catch {}
  const entry = await classifyEntry(linkPath)
  if (entry.exists) {
    if (entry.link) { await fs.rmdir(linkPath); ok('已删除链接 ' + linkPath) }
    else if (!entry.stat.isDirectory()) { await fs.rm(linkPath, { force: true }); ok('已删除文件 ' + linkPath) }
    else console.error('⚠ ' + linkPath + ' 是真实目录（官方安装器 pnpm 装的），本脚本不动它。'
      + '\n  要彻底卸载：dsh plugin --profile web remove ' + PKG_NAME + '，或自己把该目录改名/删除。')
  } else ok('链接本就不存在')
  delete profilePkg.dependencies[PKG_NAME]
  profilePkg.dsh.profile.bundles = (profilePkg.dsh.profile.bundles || []).filter((b) => b !== PKG_NAME)
  await fs.writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n')
  ok('已从 profile package.json 撤销注册（备份: ' + path.basename(bak) + '）')
  console.log('重启 DSH 后生效。')
  process.exit(0)
}

for (const rel of ['package.json', 'cordis.patch.yml', 'lib/index.js', 'lib/client.js']) {
  try { await fs.stat(path.join(pkgRoot, rel)) } catch { fail('本包缺 ' + rel + '（先在包目录跑 node scripts/build-client.mjs）') }
}
ok('包结构完整: ' + pkgRoot)

// ── 备份 profile package.json ────────────────────────────────────────────────
const bak = profilePkgPath + '.bak-' + PKG_NAME
try {
  await fs.copyFile(profilePkgPath, bak, fs.constants.COPYFILE_EXCL)
  ok('已备份 profile package.json → ' + path.basename(bak))
} catch {
  ok('备份已存在，保留首个: ' + path.basename(bak))
}

// ── node_modules 链接 ────────────────────────────────────────────────────────
async function ensureLink() {
  const entry = await classifyEntry(linkPath)
  if (entry.exists) {
    if (entry.link) {
      let real
      try { real = await fs.realpath(linkPath) } catch { real = undefined }
      if (real && path.resolve(real).toLowerCase() === path.resolve(pkgRoot).toLowerCase()) { ok('链接已就绪（指向本仓库）: ' + linkPath); return }
      await fs.rmdir(linkPath)
      ok('已移除指向别处的旧链接')
    } else if (!entry.stat.isDirectory()) {
      await fs.rm(linkPath, { force: true })
      ok('已移除残留文件')
    } else {
      // 真实目录（官方安装器 pnpm 装的）：改名让位，不删任何字节，随时可还原
      const aside = linkPath + '.installed-' + new Date().toISOString().replace(/[-:]/g, '').slice(0, 14)
      await fs.rename(linkPath, aside)
      ok('官方安装的真实目录已改名让位: ' + path.basename(aside) + '（回退：删掉本链接并把该目录改回原名）')
    }
  }
  const attempts = process.platform === 'win32' ? ['junction', 'dir'] : ['dir']
  for (const kind of attempts) {
    try {
      await fs.symlink(pkgRoot, linkPath, kind)
      ok('已创建 ' + kind + ' 链接: ' + linkPath)
      return
    } catch (e) {
      console.log('  （' + kind + ' 不可用: ' + e.code + '）')
    }
  }
  await fs.cp(pkgRoot, linkPath, { recursive: true })
  ok('降级为复制安装（改代码后需重跑本脚本）')
}
await ensureLink()

// ── 注册 profile package.json ────────────────────────────────────────────────
let changed = false
profilePkg.dependencies = profilePkg.dependencies || {}
if (profilePkg.dependencies[PKG_NAME] !== 'link:' + PKG_NAME) {
  profilePkg.dependencies[PKG_NAME] = 'link:' + PKG_NAME
  changed = true
}
if (!profilePkg.dsh.profile.bundles.includes(PKG_NAME)) {
  profilePkg.dsh.profile.bundles.push(PKG_NAME)
  changed = true
}
if (changed) {
  await fs.writeFile(profilePkgPath, JSON.stringify(profilePkg, null, 2) + '\n')
  ok('已注册: dependencies.' + PKG_NAME + ' + dsh.profile.bundles')
} else {
  ok('注册项已存在，无改动')
}

// ── 宿主半自检 ───────────────────────────────────────────────────────────────
try {
  const m = await import('file:///' + linkPath.replace(/\\/g, '/') + '/lib/index.js')
  if (typeof m.apply !== 'function') fail('宿主半缺少 apply 导出')
  ok('宿主模块 import 自检通过（exports: ' + Object.keys(m).join(', ') + '）')
} catch (e) {
  fail('宿主模块 import 失败: ' + e.message)
}

console.log('\n完成。下一步: 重启 DSH，然后在任意模式的会话左栏应出现「📚 学习区」。')
console.log('验证 RPC: 浏览器打开 http://127.0.0.1:3080/study-rpc 应 405（POST-only），或面板打开即证明链路通。')
