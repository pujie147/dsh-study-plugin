// publish-repo.mjs — 把 study-plugin 打包为可直接推 GitHub 的独立仓库
// 产物 = 净室目录（仅发布文件：lib/*、cordis.patch.yml、README、LICENSE、CHANGELOG、package.json），
//       git 初始化完毕后，用户推送即 `dsh plugin --profile web add github:用户/仓库` 可装。
// 用法: node scripts/publish-repo.mjs [--out <目录>]（默认 ../dsh-study-plugin）
import { spawnSync } from 'node:child_process'
import { promises as fs } from 'node:fs'
import fsSync from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const pluginRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pkgJson = JSON.parse(fsSync.readFileSync(path.join(pluginRoot, 'package.json'), 'utf8'))
const argv = process.argv.slice(2)
const argOf = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : undefined }
const outDir = path.resolve(argOf('--out') || path.join(pluginRoot, '..', 'dsh-study-plugin'))

const npmCliCandidates = [
  path.join(path.dirname(process.execPath), 'node_modules', 'npm', 'bin', 'npm-cli.js'),
  'C:\\Program Files\\nodejs\\node_modules\\npm\\bin\\npm-cli.js'
]
let npmCli
for (const c of npmCliCandidates) { try { await fs.stat(c); npmCli = c; break } catch {} }
if (!npmCli) throw new Error('找不到 npm-cli.js（' + npmCliCandidates.join(' ; ') + '）')

const T = await fs.mkdtemp(path.join(pluginRoot, '.tmp-'))
try {
  // 1) npm pack → tarball（与 cleanroom-check 同技巧，无管道 stdio）
  const tgzName = pkgJson.name + '-' + pkgJson.version + '.tgz'
  const tgzAbs = path.join(T, tgzName)
  const packLog = path.join(T, 'pack.log')
  const fd1 = fsSync.openSync(packLog, 'w')
  let r = spawnSync(process.execPath, [npmCli, 'pack', '--pack-destination', T, '--cache', path.join(T, 'npmcache')], { cwd: pluginRoot, stdio: ['ignore', fd1, fd1] })
  fsSync.closeSync(fd1)
  if (r.status !== 0) throw new Error('npm pack 失败: ' + fsSync.readFileSync(packLog, 'utf8'))

  // 2) 解压到发布目录（先清空旧残留，strip-components=1 去掉 package/ 前缀）
  await fs.rm(outDir, { recursive: true, force: true })
  await fs.mkdir(outDir, { recursive: true })
  const unpackLog = path.join(T, 'unpack.log')
  const fd2 = fsSync.openSync(unpackLog, 'w')
  r = spawnSync('tar', ['-xzf', tgzAbs, '-C', outDir, '--strip-components=1'], { stdio: ['ignore', fd2, fd2] })
  fsSync.closeSync(fd2)
  if (r.status !== 0) throw new Error('tar 解包失败: ' + fsSync.readFileSync(unpackLog, 'utf8'))

  // 3) 提示（嵌套在开发仓库内 git init 失败——交由用户在外层终端执行）
  console.log('\n发布仓内容已就绪: ' + outDir)
  console.log('文件清单: ' + (await fs.readdir(outDir)).join(', '))
  console.log('\n--- 请在新的 PowerShell 终端执行以下命令（不再受开发仓库约束） ---')
  console.log('Copy-Item -Recurse "' + outDir + '" "C:\\Users\\pyg12\\gitProjects\\dsh-study-plugin"')
  console.log('cd C:\\Users\\pyg12\\gitProjects\\dsh-study-plugin')
  console.log('git init -b main')
  console.log('git add -A')
  console.log('git commit -m "init: study-plugin v' + pkgJson.version + '（发布仓）"')
  console.log('git remote add origin git@github.com:<你的用户名>/dsh-study-plugin.git')
  console.log('git push -u origin main')
  console.log('')
  console.log('其他用户安装:')
  console.log('  dsh plugin --profile web add github:<你的用户名>/dsh-study-plugin#v' + pkgJson.version)
} finally {
  await fs.rm(T, { recursive: true, force: true })
}
