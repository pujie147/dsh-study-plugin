// 真后端离线验证：用宿主自己的 inspect() 校验我写出的 transcript 字节。
// 关键：必须用**长路径** import（短路径 PYG12~1 会让 cordis 的 /@deepseek-ai/ URL 匹配失效）。
import fs from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { pathToFileURL } from 'node:url'
import * as P from './study-plugin/lib/portable.js'

const LONG = 'C:/Users/pyg12/AppData/Roaming/npm/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai'
const { default: JsonlSessionPersistence } = await import(pathToFileURL(LONG + '/dsh-session-persistence-jsonl/lib/index.js').href)
const noop = () => {}
const base = {
  logger: { info: noop, warn: noop, error: noop, debug: noop },
  bus: { on: () => noop, subscribe: () => noop, emit: noop },
  sessions: {
    list: () => [], get: () => undefined,
    prepare: (id, { seed, meta }) => ({ id, header: meta, events: Object.freeze((seed || []).map((e) => Object.freeze(e))) }),
  },
  get: (k) => base[k], use: () => noop, config: {},
  reflect: { provide: noop, dispose: noop, dep: () => noop, resolve: () => undefined },
  provide: noop, dispose: noop, effect: () => noop, mount: () => noop,
}
const ctx = new Proxy(base, { get: (t, k) => (k in t ? t[k] : k === 'then' ? undefined : noop) })

const TMP = path.resolve('tmp-real-backend')
const ROOT = path.join(TMP, 'sessions')
await fs.rm(TMP, { recursive: true, force: true })
await fs.mkdir(ROOT, { recursive: true })
const SRC = path.join(os.homedir(), '.dsh', 'sessions')
const svc = new JsonlSessionPersistence(ctx, { root: ROOT, compression: 'zstd' })

const PICK = [
  ['--C-Users-pyg12-.dsh-study-work-goal-mttqn6kv-transformer--', 'session-bd1c3e1b-05f6-48aa-a065-13727154687c'],
  ['--C-Users-pyg12-.dsh-study-work-goal-mttqn6kv-transformer--', 'session-f02e1cea-e6f2-43bc-a1a1-51d5ec825ca0'],
  ['--C-Users-pyg12-.dsh-study-work-goal-mttqn6kv-transformer--', 'session-761ec32d-ab14-4e7b-a815-44ab0259fab2'],
  ['--C-Users-pyg12-.dsh-study-work-goal-mtqx3m6d-study--', 'session-140776c2-beeb-4d28-81fa-a86639a2e33a'],
  ['--C-Users-pyg12-.dsh-study-work-goal-mtqx3m6d-study--', 'session-975595f3-7990-4db8-b5d8-65c84c2e862d'],
]
for (const [pk, sd] of PICK) {
  const src = path.join(SRC, pk, sd, 'session.jsonl.zstd')
  const buf = await fs.readFile(src)
  const h = P.readSessionHeader(buf)
  const dst = svc.locate({ cwd: h.cwd, id: h.id })          // 让宿主告诉我该放哪
  const relPath = path.relative(ROOT, path.dirname(dst.path))
  await fs.mkdir(path.dirname(dst.path), { recursive: true })
  await fs.writeFile(dst.path, buf)
  console.log(`\n[${h.id.slice(8, 16)}] 放置: ${relPath}  ${buf.length}B`)
  try {
    const v = await svc.inspect(h.id)
    const after = await fs.stat(dst.path)
    console.log(`   inspect OK  events=${v.events.length} meta.cwd=${JSON.stringify(v.meta.cwd)} 首=${v.events[0]?.type} 末=${v.events.at(-1)?.type} 未被改写=${after.size === buf.length}`)
  } catch (e) { console.log('   inspect FAIL ' + String(e.message).slice(0, 220)) }
}

console.log('\n=== 换 id + 换 cwd 后（模拟修复后的导入）宿主还认不认 ===')
const [pk0, sd0] = PICK[1]
const src0 = path.join(SRC, pk0, sd0, 'session.jsonl.zstd')
const raw = await fs.readFile(src0)
const newId = 'session-' + 'a'.repeat(8) + '-0000-0000-0000-000000000000'
const newCwd = path.join(TMP, 'goal-moved')
await fs.mkdir(newCwd, { recursive: true })
const rw = await P.rewriteTranscriptHeader(raw, { id: newId, cwd: newCwd })
const p2 = svc.locate({ cwd: newCwd, id: newId })
await fs.mkdir(path.dirname(p2.path), { recursive: true })
await fs.writeFile(p2.path, rw.bytes)
console.log('  locate 反推路径 =', path.relative(ROOT, p2.path))
try { const v = await svc.inspect(newId); console.log(`  inspect OK events=${v.events.length} id=${v.meta.id} cwd=${JSON.stringify(v.meta.cwd)}`) }
catch (e) { console.log('  inspect FAIL ' + String(e.message).slice(0, 220)) }
try { await svc.list(); console.log('  list() OK（无重复 id）') } catch (e) { console.log('  list() FAIL ' + e.message.slice(0, 160)) }

console.log('\n=== 追加尾帧后（模拟快进）===')
const [pk1, sd1] = PICK[3]
const buf1 = await fs.readFile(path.join(SRC, pk1, sd1, 'session.jsonl.zstd'))
const h1 = P.readSessionHeader(buf1)
const a = await svc.inspect(h1.id).catch((e) => ({ err: e.message }))
if (a.err) { console.log('  基线 inspect FAIL ' + a.err.slice(0, 160)) } else {
  const fakeTail = [JSON.stringify({ type: 'turn/start', seq: 99, time: Date.now(), data: { turn: 1 } }), JSON.stringify({ type: 'turn/end', seq: 100, time: Date.now(), data: { turn: 1, reason: 'done' } })]
  const app = await P.appendLinesToTranscript(buf1, fakeTail)
  const p3 = svc.locate({ cwd: h1.cwd, id: h1.id })
  const bak = path.join(TMP, 'bak.zstd')
  await fs.writeFile(bak, buf1)
  await fs.writeFile(p3.path, app.bytes)
  try { const v = await svc.inspect(h1.id); console.log(`  追加后 inspect OK events=${v.events.length}（基线 ${a.events.length} + ${app.appended}）末=${v.events.at(-1).type}`) }
  catch (e) { console.log('  追加后 inspect FAIL ' + String(e.message).slice(0, 240)) }
  await fs.writeFile(p3.path, await fs.readFile(bak))
}
