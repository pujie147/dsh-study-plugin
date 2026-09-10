// 用宿主真实后端复现。只读写 tmp-probe-root，绝不碰 ~/.dsh。
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import * as P from './study-plugin/lib/portable.js'

const NM = 'C:/Users/pyg12/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const { default: JsonlSessionPersistence } = await import(pathToFileURL(NM + '/dsh-session-persistence-jsonl/lib/index.js').href)
const noop = () => {}
const base = {
  logger: { info: noop, warn: noop, error: noop, debug: noop },
  bus: { on: () => noop, subscribe: () => noop, emit: noop },
  sessions: { list: () => [], get: () => undefined },
  get: (k) => base[k], use: () => noop, config: {},
  reflect: { provide: noop, dispose: noop, dep: () => noop, resolve: () => undefined },
  provide: noop, dispose: noop, effect: () => noop, mount: () => noop,
}
const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : noop) })

const TMP = path.resolve('tmp-probe-root')
const ROOT = path.join(TMP, 'sessions')
await fs.rm(TMP, { recursive: true, force: true })
await fs.mkdir(ROOT, { recursive: true })
const SRC = path.join(os.homedir(), '.dsh', 'sessions')

const NATIVE = '--C-Users-pyg12-.dsh-study-work-goal-mtqx3m6d-study--'      // 宿主自己写的
const MINE = '--C-Users-pyg12-.dsh-study-work-goal-mttqn6kv-transformer--'  // 我导入时重写过的
async function cloneProject(pk, into) {
  const dst = path.join(ROOT, into || pk)
  await fs.mkdir(dst, { recursive: true })
  for (const sd of await fs.readdir(path.join(SRC, pk))) await fs.cp(path.join(SRC, pk, sd), path.join(dst, sd), { recursive: true })
}

const svc = new JsonlSessionPersistence(ctx, { root: ROOT, compression: 'zstd' })
console.log('root =', ROOT)

console.log('\n=== A) 原生 transcript + 我重写过 header 的 transcript 混在一起 list() ===')
await cloneProject(NATIVE)
await cloneProject(MINE)
let heads = await svc.list()
console.log('  条数 =', heads.length)
for (const h of heads.sort((a, b) => a.id.localeCompare(b.id))) console.log(`   ${h.id.slice(8, 16)}…  cwd=${JSON.stringify(h.cwd)}`)

console.log('\n=== B) 宿主 inspect() 能否读懂我写的多帧文件 ===')
for (const h of heads.filter(x => /mttqn6kv/.test(String(x.cwd)))) {
  try { const v = await svc.inspect(h.id); console.log(`   ${h.id.slice(8, 16)}… events=${v.events.length} 首=${v.events[0]?.type} 末=${v.events.at(-1)?.type}`) }
  catch (e) { console.log(`   ${h.id.slice(8, 16)}… FAIL ${e.message.slice(0, 200)}`) }
}

console.log('\n=== C) 复现「源会话还在盘上时再导入一次」= 同 id 出现在第二个 project 目录 ===')
const DUP = '--C-Users-pyg12-.dsh-study-work-goal-mtv99xxx-transformer--'
await cloneProject(MINE, DUP)
const newCwd = path.join(TMP, 'goal-mtv99xxx-transformer')
await fs.mkdir(newCwd, { recursive: true })
for (const sd of await fs.readdir(path.join(ROOT, DUP))) {
  const fp = path.join(ROOT, DUP, sd, 'session.jsonl.zstd')
  await fs.writeFile(fp, (await P.rewriteTranscriptCwd(await fs.readFile(fp), newCwd)).bytes)
}
try { console.log('   list() 没抛错？= ' + (await svc.list()).length + ' 条') }
catch (e) { console.log('   >>> list() THROW: ' + e.message.slice(0, 160)) }
try { const v = await svc.inspect('session-f02e1cea-e6f2-43bc-a1a1-51d5ec825ca0'); console.log('   inspect() 没抛错 events=' + v.events.length) }
catch (e) { console.log('   >>> inspect() THROW: ' + e.message.slice(0, 160)) }
console.log('   （上面这条 throw 会在宿主 session.list / workspace.attachSession 里同源发生）')
