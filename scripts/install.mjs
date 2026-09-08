// install.mjs — 安装/重装快照：把打包产物写到 ~/.dsh/study-work/plugin/
// 该目录是"插件持久安装点"：进程重启后动态插件丢失时，恢复流程为——
//   1) 打开任意会话，对助手说：按 C:\Users\pyg12\.dsh\study-work\plugin\INSTALL.txt 恢复学习插件
//   2) 助手读取 study-plugin.dist.json，用 cordis_define(kind:new, idPrefix: stud)
//      填入 code.host / code.client 定义插件，再 cordis_run 激活即可。
import { readFileSync, writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dist = JSON.parse(readFileSync(join(root, 'dist', 'study-plugin.dist.json'), 'utf8'))
const pluginDir = join(homedir(), '.dsh', 'study-work', 'plugin')

mkdirSync(pluginDir, { recursive: true })
writeFileSync(join(pluginDir, 'install.json'), JSON.stringify({
  installedAt: new Date().toISOString(),
  pluginName: dist.name,
  version: dist.version,
  hash: dist.hash,
  purpose: dist.purpose,
  code: dist.code
}, null, 2), 'utf8')
copyFileSync(join(root, 'dist', 'study-plugin.dist.json'), join(pluginDir, 'study-plugin.dist.json'))

const instructions = [
  '# 学习插件恢复/重装指引（重启后动态插件丢失时使用）',
  '',
  '1. 数据都在 ~/.dsh/study-work（index.json + 各目标目录），不会因重启丢失。',
  '2. 本目录为插件快照：study-plugin.dist.json 含完整 code.host / code.client。',
  '3. 恢复步骤（告诉当前会话的助手）：',
  '   a) 读取 study-plugin.dist.json；',
  '   b) 调用 cordis_define：plugin.kind = "new"、idPrefix = "stud"，',
  '      code.host = 文件 code.host 字段，code.client = code.client 字段；',
  '   c) cordis_run 激活返回的 pluginId/packageId（mode: run，客户端需在 GUI 批准）；',
  '   d) 停用旧的动态插件实例（若存在 stuh-6 / stmc-8 / 旧引擎），避免重复。',
  '4. 恢复后旧学习目标自动出现在面板列表；打开目标会话可继续学习。',
  '',
  '仓库: C:\\Users\\pyg12\\gitProjects\\study_dsh_plugin  （node scripts/build.mjs && node scripts/install.mjs 可重新打包）'
].join('\n')
writeFileSync(join(pluginDir, 'INSTALL.txt'), instructions, 'utf8')

console.log(`[install] 快照已写入 ${pluginDir}`)
console.log('  - study-plugin.dist.json')
console.log('  - install.json')
console.log('  - INSTALL.txt')
console.log(`  hash: ${dist.hash}`)
