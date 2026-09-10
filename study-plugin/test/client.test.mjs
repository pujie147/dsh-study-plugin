// client.test.mjs — 客户端半（lib/client.js）渲染与接线测试
// 运行: node test/client.test.mjs   （改过 src/ 请先 node scripts/build-client.mjs）
// 做法: 用最小 React/DOM/fetch 桩真实执行 bundle 的 factory 与组件函数，遍历元素树
//       触发 onClick/onChange，断言打到 /study-rpc 的调用序列与界面文案。
// 覆盖: 面板开合 → 目标列表 → 展开 → 📤 导出 → 成功提示 + 切到 📦 视图 + 下载链接 →
//       导入路径 → 🔍 预览（含"将重写会话 cwd"）→ ✓ 确认导入 → 冲突时确认按钮禁用 → 🔗 重新绑定会话。
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const bundlePath = path.join(here, '..', 'lib', 'client.js')

let n = 0
const ok = (label) => { n++; console.log('  ok ' + n + ' — ' + label) }
const tick = async (times = 12) => { for (let i = 0; i < times; i++) await new Promise((r) => setImmediate(r)) }

// ── /study-rpc 桩 ────────────────────────────────────────────────────────────
const rpc = []
const goalRow = {
  id: 'goal-demo', title: '软件设计', status: 'active', target_level: '软考中级', requirements: '',
  updatedAt: 'x', workspaceId: 'ws-1', sessionId: 'session-g',
  path: '/home/me/.dsh/study-work/goal-demo', draft: null,
  chapters: [{ index: 1, title: '计算机系统基础', file: '01-chapter.md', status: 'ready', sessionId: 'session-c1', lastError: '' }]
}
const planOk = {
  goalId: 'goal-demo', dir: '/home/me/.dsh/study-work/goal-demo', title: '软件设计', chapters: 10,
  sessionCount: 3, attachments: 1, files: 9, bytesTotal: 260431, rewriteCwd: true,
  exportedAt: '2026-09-10T02:00:00.000Z', source: { platform: 'win32' },
  sessions: [
    { id: 'session-g', title: '课程规划草案', boundTo: 'goal', lines: 1418, exists: false },
    { id: 'session-c1', title: '第 1 章学习', boundTo: 'chapter-1', lines: 818, exists: false }
  ]
}
let inspectResult = { ok: true, canImport: true, conflicts: [], warnings: ['附件服务不可用时图片不会落盘'], plan: planOk }
const handlers = {
  'study.list': () => ({ goals: [goalRow] }),
  'study.exportGoal': (a) => { rpc.push(['export', a]); return { ok: true, file: 'study-goal-goal-demo.zip', path: '/exp/study-goal-goal-demo.zip', downloadUrl: '/study-export?file=study-goal-goal-demo.zip', bytes: 152043, counts: { files: 9, sessions: 3, attachments: 1, sessionBytes: 148000 }, warnings: [] } },
  'study.listExports': () => ({ ok: true, dir: '/home/me/.dsh/study-work/exports', exports: [{ file: 'study-goal-goal-demo.zip', bytes: 152043, mtime: '2026-09-10T02:00:00.000Z', downloadUrl: '/study-export?file=study-goal-goal-demo.zip' }] }),
  'study.deleteExport': (a) => { rpc.push(['deleteExport', a]); return { ok: true } },
  'study.inspectImport': (a) => { rpc.push(['inspect', a]); return inspectResult },
  'study.importGoal': (a) => {
    rpc.push(['import', a])
    if (a.confirm !== true) return { ok: false, preview: true, needConfirm: true, canImport: inspectResult.canImport, conflicts: inspectResult.conflicts, warnings: inspectResult.warnings, plan: inspectResult.plan }
    return { ok: true, goalId: 'goal-demo', dir: '/home/me/.dsh/study-work/goal-demo', title: '软件设计', sessions: 3, skipped: 0, attachments: 1, workspaceId: 'ws-new', verified: true, warnings: [] }
  },
  'study.reattachGoalSessions': (a) => { rpc.push(['reattach', a]); return { ok: true, workspaceId: 'ws-1', attached: 2, failed: [] } }
}
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const fn = handlers[body.method]
  return { ok: true, status: 200, json: async () => (fn ? fn(body.args || {}) : { ok: true }) }
}

// ── 最小 React / DOM 桩 ──────────────────────────────────────────────────────
let inst = { state: {}, idx: 0 }
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: Object.assign({}, props, children.length ? { children: children.flat(6) } : {}) }),
  useState: (init) => {
    const i = inst.idx++
    if (!(i in inst.state)) inst.state[i] = typeof init === 'function' ? init() : init
    return [inst.state[i], (v) => { inst.state[i] = typeof v === 'function' ? v(inst.state[i]) : v }]
  },
  useCallback: (fn) => fn,
  useMemo: (fn) => fn(),
  useRef: () => ({ current: { getBoundingClientRect: () => ({ left: 24 }) } }),
  useEffect: (fn) => { try { fn() } catch (e) { throw new Error('useEffect 抛错: ' + e.message) } },
  useLayoutEffect: (fn) => { try { fn() } catch (e) { throw new Error('useLayoutEffect 抛错: ' + e.message) } },
  useReducer: (r, init) => [init, () => {}]
}
const flat = []
function walk(node) {
  if (node === null || node === undefined || node === false || node === true) return
  if (Array.isArray(node)) { node.forEach(walk); return }
  if (typeof node !== 'object') return
  if (typeof node.type === 'function') { walk(node.type(node.props)); return }
  flat.push(node)
  if (node.props && node.props.children !== undefined) walk(node.props.children)
}
function render(rootEl) {
  // 两趟：第一趟里 useLayoutEffect/useEffect 可能 setState，第二趟才看得到
  for (let pass = 0; pass < 2; pass++) {
    flat.length = 0
    inst.idx = 0
    walk(rootEl)
  }
  return flat
}
const textOf = (node) => {
  const c = node.props && node.props.children
  if (c === undefined || c === null) return ''
  return (Array.isArray(c) ? c : [c]).map((x) => (typeof x === 'string' || typeof x === 'number' ? String(x) : (x && x.props ? textOf(x) : ''))).join('')
}
const bodyText = () => flat.map(textOf).join('\n')
const click = async (node, label) => {
  assert.equal(typeof node.props.onClick, 'function', 'no onClick: ' + label)
  await node.props.onClick({})
  await tick()
}
const input = async (node, value) => { await node.props.onChange({ target: { value: value } }); await tick() }

// ── 执行 bundle ──────────────────────────────────────────────────────────────
const bundle = readFileSync(bundlePath, 'utf8')
let mod = null
globalThis.window = { __ModuleLoader__: { load: (m) => { mod = m } }, innerHeight: 900, addEventListener() {}, removeEventListener() {} }
globalThis.document = { createElement: () => ({ dataset: {} }), head: { appendChild() {} }, querySelector: () => null }
// 把 setInterval/clearInterval 换成桩：否则面板的 2.5s 轮询会留下真实 timer 句柄，测试跑完进程也不退出
new Function('window', 'document', 'setInterval', 'clearInterval', bundle)(globalThis.window, globalThis.document, () => 0, () => {})
assert.ok(mod && mod.id === 'study-plugin', 'bundle 未注册模块')
const factory = mod.factory((name) => { if (name === 'react') return React; throw new Error('unexpected require: ' + name) })
assert.equal(typeof factory.apply, 'function')
ok('bundle 可执行（__ModuleLoader__.load → factory(require) 正常返回 apply）')

let slotRender = null
let slotSpec = null
const capturedSlot = []
const slots = {
  inject: (name, setup) => { capturedSlot.push(name); setup() },
  register: (spec, renderFn) => { slotSpec = spec; slotRender = renderFn; return renderFn }
}
const sessionsSvc = {
  list: { getSnapshot: () => ({ byId: { 'session-g': {}, 'session-c1': {} } }) },
  refresh: async () => {},
  open: (id) => { opened.push(id) },
  create: async () => ({ sessionId: 'session-new' })
}
const workspacesSvc = { connectWorkspace: async () => ({ sessionId: 'session-g' }) }
const opened = []
factory.apply({ get: (name) => (name === 'slots' ? slots : name === 'sessions' ? sessionsSvc : name === 'workspaces' ? workspacesSvc : undefined), effect: (fn) => fn() })
assert.deepEqual(capturedSlot, ['sidebar.footer.action'], '未挂载到 sidebar.footer.action')
assert.ok(slotSpec && slotSpec.id === 'study-panel' && slotSpec.name === 'sidebar.footer.action', 'register 的 slot spec 不对')
assert.equal(typeof slotRender, 'function')
ok('客户端挂载到 sidebar.footer.action 插槽并注册 study-panel')

// 真实宿主会把 spec.inject() 的返回值并入 props（这里就是 workspaces/sessions）
const root = () => slotRender(Object.assign({ wide: true, useSessions: () => ({}) }, slotSpec.inject()))
// 渲染并等待 useEffect 里发出的异步 RPC 落地（refresh）
const renderAll = async () => { render(root()); await tick(); const f = render(root()); await tick(); return render(root()) }
let tree = await renderAll()
assert.ok(flat.some((e) => textOf(e).indexOf('学习区') >= 0), '徽标未渲染')
ok('收起态渲染出「学习区」徽标')

// 展开
const badge = flat.find((e) => e.type === 'button' && e.props.className === 'stuiBadge')
await click(badge, 'badge')
tree = await renderAll()
assert.ok(bodyText().indexOf('软件设计') >= 0, '目标标题未渲染: ' + bodyText().slice(0, 200))
assert.ok(bodyText().indexOf('学习中') >= 0, '状态 chip 未渲染')
assert.ok(bodyText().indexOf('📄 打开会话') >= 0)
ok('展开后拉取 study.list 并渲染目标（标题/状态/打开会话）')

// 展开目标体 → 导出按钮出现
const titleSpan = flat.find((e) => e.props.className === 'stuiGoalTitle')
await click(titleSpan, 'goal title')
tree = await renderAll()
assert.ok(bodyText().indexOf('📤 导出 zip') >= 0, '导出按钮未渲染')
assert.ok(bodyText().indexOf('🔗 重新绑定会话') >= 0, '重新绑定按钮未渲染')
ok('目标行展开后有「📤 导出 zip」与「🔗 重新绑定会话」')

// 点导出
const exportBtn = flat.find((e) => e.type === 'button' && textOf(e) === '📤 导出 zip')
await click(exportBtn, 'export')
assert.deepEqual(rpc.filter((c) => c[0] === 'export').map((c) => c[1]), [{ goalId: 'goal-demo' }], 'exportGoal 调用参数不对')
tree = await renderAll()
assert.ok(bodyText().indexOf('已导出 study-goal-goal-demo.zip') >= 0, '导出成功提示缺失: ' + bodyText().slice(0, 160))
assert.ok(bodyText().indexOf('148.5 KB') >= 0, '体积换算异常: ' + bodyText().slice(0, 200))
ok('「📤 导出 zip」调用 study.exportGoal 并给出成功提示')

// 自动切到 📦 视图：导出包列表 + 下载链接
const dl = flat.find((e) => e.type === 'a' && String((e.props || {}).href || '').indexOf('/study-export?file=') === 0)
assert.ok(dl, '导出包下载链接未渲染')
assert.equal(dl.props.download, 'study-goal-goal-demo.zip')
assert.ok(bodyText().indexOf('导入：填导出包路径') >= 0, '导入区未渲染')
ok('导出后切到 📦 视图：包列表可下载（/study-export?file=…）且出现导入区')

// 导入：填路径 → 预览
const pathInput = flat.find((e) => e.type === 'input' && String((e.props || {}).placeholder || '').indexOf('study-goal') >= 0)
assert.ok(pathInput, '导入路径输入框未渲染')
await input(pathInput, 'C:\\tmp\\study-goal-goal-demo.zip')
tree = await renderAll()
const previewBtn = flat.find((e) => e.type === 'button' && textOf(e).indexOf('预览') >= 0 && textOf(e).indexOf('副本') < 0)
await click(previewBtn, 'preview')
assert.deepEqual(rpc.filter((c) => c[0] === 'inspect').map((c) => c[1]), [{ path: 'C:\\tmp\\study-goal-goal-demo.zip' }], 'inspectImport 参数不对')
tree = await renderAll()
assert.ok(bodyText().indexOf('目标: 软件设计') >= 0, '预览摘要缺失')
assert.ok(bodyText().indexOf('将重写会话 cwd') >= 0, '未提示 header 重写')
assert.ok(bodyText().indexOf('课程规划草案') >= 0 && bodyText().indexOf('[chapter-1]') >= 0, '会话清单未渲染')
ok('「🔍 预览」调用 study.inspectImport 并渲染落点/会话清单/重写提示')

// 确认导入
const confirmBtn = flat.find((e) => e.type === 'button' && textOf(e).indexOf('确认导入') >= 0)
assert.notEqual(confirmBtn.props.disabled, true, '无冲突时确认按钮不该禁用')
await click(confirmBtn, 'confirm import')
const imp = rpc.filter((c) => c[0] === 'import').map((c) => c[1])
assert.equal(imp.length, 1)
assert.equal(imp[0].confirm, true)
assert.equal(imp[0].path, 'C:\\tmp\\study-goal-goal-demo.zip')
tree = await renderAll()
assert.ok(bodyText().indexOf('已导入目标「软件设计」') >= 0, '导入成功提示缺失')
assert.ok(bodyText().indexOf('重启 DSH') >= 0, '缺重启提示')
ok('「✓ 确认导入」带 confirm:true 调用 study.importGoal 并提示重启')

// 冲突 → 确认按钮禁用
inspectResult = {
  ok: true, canImport: false, plan: planOk, warnings: [],
  conflicts: [{ kind: 'goalDir', detail: '/home/me/.dsh/study-work/goal-demo', hint: '用「另存为副本」导入' }]
}
tree = await renderAll()
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('预览') >= 0 && textOf(e).indexOf('副本') < 0), 'preview2')
tree = await renderAll()
const confirm2 = flat.find((e) => e.type === 'button' && textOf(e).indexOf('确认导入') >= 0)
assert.equal(confirm2.props.disabled, true, '有冲突时确认按钮应禁用')
assert.ok(bodyText().indexOf('冲突') >= 0 && bodyText().indexOf('另存为副本') >= 0, '冲突提示缺失')
ok('冲突时确认按钮禁用并给出「另存为副本」指引')

// 副本预览带 mode=copy
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('预览副本') >= 0), 'preview copy')
assert.ok(rpc.filter((c) => c[0] === 'inspect').some((c) => c.mode === 'copy' || c[1].mode === 'copy'), '副本预览未带 mode=copy')
ok('「📋 预览副本」以 mode=copy 请求预览')

// 返回目标列表
tree = await renderAll()
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('返回目标列表') >= 0), 'back to list')
tree = await renderAll()
assert.ok(bodyText().indexOf('软件设计') >= 0, '返回列表后目标应可见')
ok('「← 返回目标列表」可切回目标视图')

// 打开会话（D10 幂等：目标会话仍在镜像 → 直接 open，不新建）
await click(flat.find((e) => e.type === 'button' && textOf(e) === '📄 打开会话'), 'open session')
assert.deepEqual(opened, ['session-g'], '应直接打开已记录的目标会话')
ok('D10 未被破坏：「📄 打开会话」直接复用 goal.sessionId，不新建会话')

console.log('\nclient.test: ' + n + ' 断言全部通过')
