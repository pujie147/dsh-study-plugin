// ============================================================================
// study-plugin — test/host-fixture.mjs
// 用**宿主真实的** JsonlSessionPersistence + WorkspaceRegistry 做测试夹具，
// 只假一个最小的 storageDomain（内存 KV）。
//
// 为什么要真的：上一版 M4 的 mock 只照抄了我自己的实现（attach 永远成功、
// 列表从盘上现读），于是 96 条断言全绿却漏掉了真 bug —— 宿主的两条硬不变量
// （① session id 在根内全局唯一，重复即 list()/loadStored() 抛错；
//   ② ws.sessionIds 是投影，header.cwd 的 realpath 必须等于 workspace.path）
// 现在由宿主代码自己执行，我的实现骗不过去。
//
// 解析注意（实测）：必须把路径 realpath 成**长文件名**再 import。走 8.3 短名
// （C:\Users\PYG12~1\…）时 cordis 的 `/@deepseek-ai/` URL 模式匹配不上，
// 所有裸标识符导入都会失败。
// ============================================================================
import { createRequire } from 'node:module'
import { realpathSync, statSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const requireFromHere = createRequire(import.meta.url)

function toFileUrl(absPath) {
  return 'file:///' + String(absPath).replace(/\\/g, '/').replace(/^([A-Za-z]:)/, (m, d) => d)
}

/** 依次尝试：本目录解析 → profile 安装目录 → 全局 npm 目录；一律 realpath 成长路径。 */
function tryResolve(spec) {
  const rel = spec.split('/').slice(1).join('/')
  const pkg = spec.split('/').slice(0, 2).join('/')
  const bases = []
  try { bases.push(requireFromHere.resolve(spec)) } catch {}
  try { bases.push(requireFromHere.resolve(pkg)) } catch {}
  const roots = [
    path.join(os.homedir(), '.dsh', 'profiles', 'web', 'node_modules'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules', '@deepseek-ai', 'dsh', 'node_modules'),
    path.join(process.env.APPDATA || '', 'npm', 'node_modules'),
  ]
  for (const r of roots) { bases.push(path.join(r, pkg, 'lib', 'index.js')); bases.push(path.join(r, pkg, rel)) }
  for (const b of bases) {
    if (!b) continue
    let real
    try { real = realpathSync(b) } catch { continue }
    try { if (!statSync(real).isFile()) continue } catch { continue }
    return toFileUrl(real)
  }
  return undefined
}

const noop = () => {}
const swallow = () => noop

/** 最小 cordis ctx：Service 构造只碰 reflect.provide，注册表/协调器还碰 effect/get/logger/sessions。 */
export function makeStubCtx(extra = {}) {
  const base = {
    logger: { info: noop, warn: noop, error: noop, debug: noop },
    bus: { on: () => noop, subscribe: () => noop, emit: noop },
    config: {},
    use: () => noop,
    provide: noop,
    dispose: noop,
    effect: (fn) => (typeof fn === 'function' ? fn() : undefined),
    reflect: { provide: noop, dispose: noop, dep: swallow, resolve: () => undefined },
    ...extra,
  }
  base.get = (k) => base[k]
  return new Proxy(base, {
    get: (t, k) => (k in t ? t[k] : k === 'then' || typeof k === 'symbol' ? undefined : noop),
  })
}

/** 内存版 storageDomain：global.get/set + 域表（put/get/update/delete/entries/keys/size）。 */
class FakeTable {
  map = new Map()
  get size() { return this.map.size }
  get(id) { return this.map.get(id) }
  async put(id, record) { this.map.set(id, record) }
  async delete(id) { this.map.delete(id) }
  /** fn(current) 返回新记录即写入；抛错（宿主内部的 unchangedSentinel）则原样向上抛，不落盘。 */
  async update(id, fn) {
    const current = this.map.get(id)
    const next = await fn(current)
    this.map.set(id, next)
    return next
  }
  entries() { return this.map.entries() }
  keys() { return this.map.keys() }
}

export function makeStorageDomain(initial = { initialized: false, workspaceIds: [], archivedSessionIds: [] }) {
  let current = JSON.parse(JSON.stringify(initial))
  const table = new FakeTable()
  const domain = {
    global: {
      get: () => current,
      set: async (v) => { current = JSON.parse(JSON.stringify(v)) },
    },
    table: () => table,
    close: async () => {},
  }
  return {
    open: async () => domain,
    _table: table,
    _state: () => current,
  }
}

/**
 * 装载宿主真实实现。宿主不可得时返回 undefined ⇒ 调用方**跳过**而不是放宽断言。
 * @returns {Promise<undefined|{JsonlSessionPersistence,WorkspaceRegistry,Service,SessionStore?}>}
 */
export async function loadHost() {
  const pUrl = tryResolve('@deepseek-ai/dsh-session-persistence-jsonl')
  const wUrl = tryResolve('@deepseek-ai/dsh-workspace')
  const cUrl = tryResolve('@deepseek-ai/cordis')
  if (!pUrl || !wUrl || !cUrl) return undefined
  const [{ default: JsonlSessionPersistence }, { default: WorkspaceRegistry }, cordis] = await Promise.all([
    import(pUrl), import(wUrl), import(cUrl),
  ])
  let SessionStore = undefined
  try {
    const su = tryResolve('@deepseek-ai/dsh-session')
    if (su) SessionStore = (await import(su)).SessionStore
  } catch {}
  return { JsonlSessionPersistence, WorkspaceRegistry, Service: cordis.Service, SessionStore }
}

/** 协调器 prepareCore 只用返回值的 header / events.length（实测）；真实 SessionStore 可用时不必走这里。 */
const stubPrepare = (id, { seed, meta }) => ({ id, header: meta, events: Object.freeze((seed || []).map((e) => Object.freeze(e))) })

/**
 * 起一套真的会话存储 + 工作区注册表（同一临时根目录）。
 * @param {{sessionsRoot:string, sessions?:object}} opts
 *   sessions - 覆盖给宿主用的 sessions 服务（要有 list()/get()）。
 *
 * `ctx.sessions` 优先用**宿主真实 SessionStore**：它比手写 stub 严格更强（会跑 Session.fromRestore
 * 的 surfaceOp 校验），我写坏的帧/行更容易被当场抓住；拿不到时退回最小 stub 并如实报出用哪个。
 */
export async function createHostServices({ sessionsRoot, sessions }) {
  const host = await loadHost()
  if (!host) return undefined
  const storageDomain = makeStorageDomain()
  const fallbackSessions = { list: () => [], get: () => undefined, ...(sessions || {}) }
  if (typeof fallbackSessions.prepare !== 'function') fallbackSessions.prepare = stubPrepare
  let hostSessions = fallbackSessions
  let usingRealSessionStore = false
  if (host.SessionStore) {
    try {
      hostSessions = new host.SessionStore(makeStubCtx({}))
      usingRealSessionStore = true
    } catch { hostSessions = fallbackSessions }
  }
  const persistence = new host.JsonlSessionPersistence(makeStubCtx({ storageDomain, sessions: hostSessions }), { root: sessionsRoot, compression: 'zstd' })
  // 本机安装的宿主 JsonlSessionPersistence 只暴露 locate/list/stat/create/open/append/flush，
  // **没有 inspect()**（插件生产侧用 typeof 守卫跳过自检，测试侧的验帧断言却直接调它 ⇒ 红）。
  // 这里用真实的 open(id,'read') + handle.read(0) 补一个只读 shim，形状对齐调用方期望的
  // { meta, events }；宿主原生有 inspect 时绝不覆盖。这是"造缺失的 API"，不是"放宽断言"——
  // 读不出来的字节照样抛（open/read 会跑宿主的 header 校验、seq 连续性与 surface 折叠）。
  if (typeof persistence.inspect !== 'function') {
    persistence.inspect = async (id) => {
      let handle
      try { handle = await persistence.open(id, 'read') } catch { return undefined }
      try {
        const header = handle.header || {}
        const r = typeof handle.read === 'function' ? await handle.read(0) : { events: [] }
        return { meta: { id: header.id || id, cwd: header.cwd }, events: (r && r.events) || [] }
      } finally {
        try { if (handle && typeof handle.close === 'function') await handle.close() } catch {}
      }
    }
  }
  const registry = new host.WorkspaceRegistry(makeStubCtx({ storageDomain, sessions: hostSessions, sessionPersistence: persistence }))
  await registry[host.Service.init]()
  return { host, persistence, registry, storageDomain, sessions: hostSessions, usingRealSessionStore, fallbackSessions }
}
