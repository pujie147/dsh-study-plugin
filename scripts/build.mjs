// build.mjs — 打包：读取 src/host.js 与 src/client.js，生成 dist/study-plugin.dist.json
// 产物结构（与 cordis_define 的 code.host / code.client 参数一一对应）：
//   { schema, name, purpose, version, builtAt, code: { host, client }, hash }
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (rel) => readFileSync(join(root, rel), 'utf8')

const host = read('src/host.js').trim()
const client = read('src/client.js').trim()

if (!host) throw new Error('src/host.js 为空')
if (!client) throw new Error('src/client.js 为空')

const hash = createHash('sha256')
  .update(host + '\x00' + client)
  .digest('hex')
  .slice(0, 16)

const manifest = {
  schema: 1,
  name: 'study-engine',
  purpose: '学习区：目标管理（调研/批准/章节讲义/独立会话）面板 + 聊天工具 + 文档同步',
  version: '1.0.0',
  builtAt: new Date().toISOString(),
  hash,
  code: { host, client }
}

mkdirSync(join(root, 'dist'), { recursive: true })
writeFileSync(join(root, 'dist', 'study-plugin.dist.json'), JSON.stringify(manifest, null, 2), 'utf8')

console.log(`[build] dist/study-plugin.dist.json 已生成`)
console.log(`  host   : ${host.length} chars`)
console.log(`  client : ${client.length} chars`)
console.log(`  hash   : ${hash}`)
