// client.test.mjs — 客户端半（lib/client.js）渲染与接线测试
// 运行: node test/client.test.mjs   （改过 src/ 请先 node scripts/build-client.mjs）
// 做法: 用最小 React/DOM/fetch 桩真实执行 bundle 的 factory 与组件函数，遍历元素树
//       触发 onClick/onChange，断言打到 /study-rpc 的调用序列与界面文案。
// 覆盖: 面板开合 → 目标列表 → 展开 → 📤 导出 → 成功提示 + 切到 📦 视图 + 下载链接 →
//       导入路径 → 🔍 预览（含"将重写会话 cwd"）→ ✓ 确认导入 → 冲突时确认按钮禁用 → 🔗 重新绑定会话 →
//       📄 打开会话(D10 幂等) → researching 三态(D16: 未派发/已派发/会话已销毁) 与「▶ 开始调研」→
//       空列表仍渲染「＋ 添加学习目标」（回归：它曾被关在 goals.length>0 分支，新装/删空后面板没有创建入口）。
// React 桩的 useEffect/useCallback 按槽位记 deps（与真实 React 一致）：否则每次渲染都会重跑
// 「打开面板就 refresh」的副作用，把 doAction 刚写上的失败红字异步清掉，测试就会假失败。
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
// researching 态的三种真相：建档后从未派发 / 已派发 / 记录过的会话已被销毁
const researchRow = {
  id: 'goal-never', title: '尚未派发', status: 'researching', target_level: '入门', requirements: '',
  updatedAt: 'x', workspaceId: 'ws-1', sessionId: 'session-g', researchDispatched: false,
  path: '/home/me/.dsh/study-work/goal-never', draft: null, chapters: []
}
const dispatchedRow = {
  id: 'goal-running', title: '正在调研', status: 'researching', target_level: '入门', requirements: '',
  updatedAt: 'x', workspaceId: 'ws-1', sessionId: 'session-g',
  researchDispatched: true, researchDispatchedAt: '2026-09-10T04:02:16.000Z',
  path: '/home/me/.dsh/study-work/goal-running', draft: null, chapters: []
}
const ghostRow = {
  id: 'goal-ghost', title: '会话已销毁', status: 'researching', target_level: '入门', requirements: '',
  updatedAt: 'x', workspaceId: 'ws-1', sessionId: 'session-gone', researchDispatched: false,
  path: '/home/me/.dsh/study-work/goal-ghost', draft: null, chapters: []
}
let dispatchResult = { ok: true, sessionId: 'session-g', message: '已派发' }
const pendingRow = {
  id: 'goal-pending', title: '草案待批', status: 'draft_pending', target_level: '入门', requirements: '',
  updatedAt: 'x', workspaceId: 'ws-1', sessionId: 'session-g', researchDispatched: true,
  researchDispatchedAt: '2026-09-10T04:02:16.000Z',
  path: '/home/me/.dsh/study-work/goal-pending', chapters: [],
  draft: { overview: '六章', approved: false, lastError: '', chapters: [{ index: 1, title: '地基', summary: '', est_hours: 2, focus_points: [] }] }
}
const planOk = {
  goalId: 'goal-demo', dir: '/home/me/.dsh/study-work/goal-demo', title: '软件设计', chapters: 10,
  sessionCount: 3, attachments: 1, files: 9, bytesTotal: 260431,
  goalExists: true, sameLineage: true, counts: { update: 0, append: 1, noop: 1, create: 1 },
  reissue: 1, hiddenByHostRule: [], agentPresets: ['standard'],
  exportedAt: '2026-09-10T02:00:00.000Z', source: { platform: 'win32' }, deviceId: 'dev-abc',
  sessions: [
    { remoteId: 'session-g', pkgId: 'session-g', localId: 'session-g', identity: 'update', action: 'append', title: '课程规划草案', boundTo: 'goal', pkgLines: 1420, localRows: 1418, detail: '' },
    { remoteId: 'session-c1', pkgId: 'session-c1', localId: 'session-9f3a', identity: 'reissue', action: 'create', title: '第 1 章学习', boundTo: 'chapter-1', pkgLines: 818, detail: 'id session-c1 已被别的目录占用' }
  ]
}
let importIdempotent = false
let inspectResult = { ok: true, canImport: true, conflicts: [], warnings: ['附件服务不可用时图片不会落盘'], plan: planOk }
let listGoals = [goalRow, researchRow, dispatchedRow, ghostRow, pendingRow]
const handlers = {
  'study.list': () => ({ goals: listGoals }),
  'study.rejectDraft': (a) => { rpc.push(['reject', a]); return { ok: true } },
  'study.dispatchResearch': (a) => { rpc.push(['dispatch', a]); return dispatchResult },
  'study.recordGoalSession': (a) => { rpc.push(['record', a]); return { ok: true, sessionId: a.sessionId } },
  'study.exportGoal': (a) => { rpc.push(['export', a]); return { ok: true, file: 'study-goal-goal-demo.zip', path: '/exp/study-goal-goal-demo.zip', downloadUrl: '/study-export?file=study-goal-goal-demo.zip', bytes: 152043, counts: { files: 9, sessions: 3, attachments: 1, sessionBytes: 148000 }, warnings: [] } },
  'study.listExports': () => ({ ok: true, dir: '/home/me/.dsh/study-work/exports', exports: [{ file: 'study-goal-goal-demo.zip', bytes: 152043, mtime: '2026-09-10T02:00:00.000Z', downloadUrl: '/study-export?file=study-goal-goal-demo.zip' }] }),
  'study.deleteExport': (a) => { rpc.push(['deleteExport', a]); return { ok: true } },
  'study.inspectImport': (a) => { rpc.push(['inspect', a]); return inspectResult },
  'study.importGoal': (a) => {
    rpc.push(['import', a])
    if (a.confirm !== true) return { ok: false, preview: true, needConfirm: true, canImport: inspectResult.canImport, conflicts: inspectResult.conflicts, warnings: inspectResult.warnings, plan: inspectResult.plan }
    return {
      ok: true, goalId: 'goal-demo', dir: '/home/me/.dsh/study-work/goal-demo', title: '软件设计', mode: a.mode || 'merge',
      sessions: 3, applied: { create: 1, append: 1, noop: 1 }, remap: [{ remoteId: 'session-c1', localId: 'session-9f3a', why: 'id 已被别的目录占用' }],
      goalFiles: { written: 2, same: 7, goalJson: 1 }, skipped: 0, attachments: 1, idempotent: importIdempotent,
      workspaceId: 'ws-new', verified: true, restartNeeded: true, warnings: [],
    }
  },
  'study.reattachGoalSessions': (a) => { rpc.push(['reattach', a]); return { ok: true, workspaceId: 'ws-1', attached: 2, failed: [] } }
}
globalThis.fetch = async (url, init) => {
  const body = JSON.parse(init.body)
  const fn = handlers[body.method]
  return { ok: true, status: 200, json: async () => (fn ? fn(body.args || {}) : { ok: true }) }
}

// ── 最小 React / DOM 桩 ──────────────────────────────────────────────────────
let inst = { state: {}, idx: 0, cb: {}, effects: {} }
const sameDeps = (a, b) => {
  if (b === undefined) return false // 无 deps = 每次渲染都跑（与 React 一致）
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false
  return a.every((v, i) => v === b[i])
}
// effect 钩子按槽位记 deps；useCallback 按槽位记忆，令 [refresh] 这类依赖跨渲染稳定
const hookSlot = () => inst.idx++
const effectHook = (fn, deps, name) => {
  const i = hookSlot()
  if (i in inst.effects && sameDeps(inst.effects[i], deps)) return
  inst.effects[i] = deps
  try { fn() } catch (e) { throw new Error(name + ' 抛错: ' + e.message) }
}
const React = {
  Fragment: 'Fragment',
  createElement: (type, props, ...children) => ({ type, props: Object.assign({}, props, children.length ? { children: children.flat(6) } : {}) }),
  useState: (init) => {
    const i = inst.idx++
    if (!(i in inst.state)) inst.state[i] = typeof init === 'function' ? init() : init
    return [inst.state[i], (v) => { inst.state[i] = typeof v === 'function' ? v(inst.state[i]) : v }]
  },
  useCallback: (fn, deps) => {
    const i = hookSlot()
    if (!(i in inst.cb) || !sameDeps(inst.cb[i].deps, deps)) inst.cb[i] = { fn, deps }
    return inst.cb[i].fn
  },
  useMemo: (fn) => fn(),
  useRef: () => ({ current: { getBoundingClientRect: () => ({ left: 24 }) } }),
  useEffect: (fn, deps) => effectHook(fn, deps, 'useEffect'),
  useLayoutEffect: (fn, deps) => effectHook(fn, deps, 'useLayoutEffect'),
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
assert.ok(bodyText().indexOf('导入 = 应用一个包') >= 0, '导入区未渲染')
ok('导出后切到 📦 视图：包列表可下载（/study-export?file=…）且出现导入区')

// 模式三选一，默认必须是「覆盖」（用户定的默认）
const modeBtns = flat.filter((e) => e.type === 'button' && /⤴ 覆盖|➕ 合并|📋 另存副本/.test(textOf(e)))
assert.equal(modeBtns.length, 3, '三模式按钮不齐: ' + modeBtns.map(textOf).join('|'))
assert.equal(modeBtns[0].props['data-tone'], 'primary', '默认模式不是「覆盖」')
ok('导入模式三选一（覆盖/合并/另存副本），默认选中「⤴ 覆盖」')

// 填路径 → 预览（mode=overwrite、force=false）
const pathInput = flat.find((e) => e.type === 'input' && String((e.props || {}).placeholder || '').indexOf('study-goal') >= 0)
assert.ok(pathInput, '导入路径输入框未渲染')
await input(pathInput, 'C:\\tmp\\study-goal-goal-demo.zip')
tree = await renderAll()
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('预览这个包') >= 0), 'preview')
assert.deepEqual(rpc.filter((c) => c[0] === 'inspect').map((c) => c[1]).pop(), { path: 'C:\\tmp\\study-goal-goal-demo.zip', mode: 'overwrite', force: false }, 'inspectImport 参数不对')
tree = await renderAll()
assert.ok(bodyText().indexOf('目标: 软件设计') >= 0, '预览摘要缺失')
assert.ok(bodyText().indexOf('同一目标 ⇒ 更新它') >= 0, '未说明目标已存在 ⇒ 更新而非复制')
assert.ok(bodyText().indexOf('将执行: ') >= 0 && bodyText().indexOf('追加尾帧 1') >= 0, '未渲染分类计数')
assert.ok(bodyText().indexOf('换发新身份') >= 0 && bodyText().indexOf('[chapter-1]') >= 0, '会话清单未渲染身份/绑定: ' + bodyText().slice(-260))
assert.ok(bodyText().indexOf('设备 dev-abc') >= 0, '未显示来源设备')
ok('「🔍 预览这个包」渲染落点/分类计数/每条会话的身份与动作')

// 勾 force ⇒ 重新预览带 force；取消勾选再带 false
const forceBox = flat.find((e) => e.type === 'input' && e.props.type === 'checkbox')
assert.ok(forceBox, 'overwrite 模式下应有 force 勾选框')
const toggleBox = async (n, label) => { await n.props.onChange({ target: { checked: !n.props.checked } }); await tick() }
await toggleBox(forceBox, 'force')
assert.equal(rpc.filter((c) => c[0] === 'inspect').map((c) => c[1]).pop().force, true, '勾 force 未重新预览')
tree = await renderAll()
await toggleBox(flat.find((e) => e.type === 'input' && e.props.type === 'checkbox'), 'force off')
assert.equal(rpc.filter((c) => c[0] === 'inspect').map((c) => c[1]).pop().force, false, '取消 force 未重新预览')
ok('「允许覆盖分叉/更旧的本地会话」勾选会带 force 重新预览')

// 确认导入
const confirmBtn = flat.find((e) => e.type === 'button' && textOf(e).indexOf('确认覆盖导入') >= 0)
assert.ok(confirmBtn, '确认按钮缺失: ' + flat.filter((e) => e.type === 'button').map(textOf).join('|'))
assert.notEqual(confirmBtn.props.disabled, true, '无冲突时确认按钮不该禁用')
await click(confirmBtn, 'confirm import')
const impArgs = rpc.filter((c) => c[0] === 'import').map((c) => c[1]).pop()
assert.equal(impArgs.confirm, true)
assert.equal(impArgs.mode, 'overwrite')
assert.equal(impArgs.path, 'C:\\tmp\\study-goal-goal-demo.zip')
tree = await renderAll()
assert.ok(bodyText().indexOf('已导入/更新目标「软件设计」') >= 0, '导入成功提示缺失')
assert.ok(bodyText().indexOf('追加 1') >= 0 && bodyText().indexOf('换身份 1') >= 0, '成功提示未带分类计数')
assert.ok(bodyText().indexOf('重启 DSH') >= 0, '缺重启提示')
ok('「✓ 确认覆盖导入」带 confirm+mode 调用并汇报分类与重启')

// 全 no-op 时的说法不同（幂等）
importIdempotent = true
tree = await renderAll()
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('预览这个包') >= 0), 'preview idem')
tree = await renderAll()
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('确认覆盖导入') >= 0), 'confirm idem')
tree = await renderAll()
assert.ok(bodyText().indexOf('已是最新（无改动）') >= 0, '幂等时不应说"已导入"：' + bodyText().slice(0, 160))
importIdempotent = false
ok('同一个包再导一次 ⇒ 面板说「已是最新（无改动）」')

// 冲突 → 确认按钮禁用 + 给出 force 指引
inspectResult = {
  ok: true, canImport: false, plan: planOk, warnings: [],
  conflicts: [{ kind: 'sessionDiverged', detail: 'session-c1', hint: '与本地内容有差异；带 force=true 才会覆盖' }]
}
tree = await renderAll()
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('预览这个包') >= 0), 'preview2')
tree = await renderAll()
const confirm2 = flat.find((e) => e.type === 'button' && textOf(e).indexOf('确认覆盖导入') >= 0)
assert.equal(confirm2.props.disabled, true, '有冲突时确认按钮应禁用')
assert.ok(bodyText().indexOf('force=true') >= 0, '冲突提示缺失: ' + bodyText().slice(0, 200))
ok('分叉冲突时确认按钮禁用并给出 force 指引')

// 切到副本模式 ⇒ 预览带 mode=copy
await click(flat.find((e) => e.type === 'button' && textOf(e).indexOf('另存副本') >= 0), 'mode copy')
assert.equal(rpc.filter((c) => c[0] === 'inspect').map((c) => c[1]).pop().mode, 'copy', '切模式未重新预览')
ok('「📋 另存副本」以 mode=copy 重新预览')

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

// ── researching 态的三种真相（D16）：未派发 / 已派发 / 目标会话已销毁 ──────────
const rowRange = (title) => {
  const starts = []
  flat.forEach((e, i) => { if (e.props && e.props.className === 'stuiGoal') starts.push(i) })
  for (let k = 0; k < starts.length; k++) {
    const seg = flat.slice(starts[k], starts[k + 1] === undefined ? flat.length : starts[k + 1])
    if (seg.length && textOf(seg[0]).indexOf(title) >= 0) return seg
  }
  return []
}
const btnIn = (title, label) => rowRange(title).find((e) => e.type === 'button' && textOf(e) === label)
const expand = async (title) => { await click(rowRange(title).find((e) => e.props.className === 'stuiGoalTitle'), 'expand ' + title); return await renderAll() }

await expand('尚未派发')
assert.ok(textOf(rowRange('尚未派发')[0]).indexOf('待调研') >= 0, '未派发目标 chip 应为「待调研」')
assert.ok(rowRange('尚未派发').some((e) => textOf(e).indexOf('调研还没开始') >= 0), '未派发缺提示文案')
assert.ok(btnIn('尚未派发', '▶ 开始调研'), '未派发应有「▶ 开始调研」按钮')
ok('D16：researching 且未派发 → chip「待调研」+「▶ 开始调研」出口')

await click(btnIn('尚未派发', '▶ 开始调研'), 'start research')
const dispatchCalls = rpc.filter((c) => c[0] === 'dispatch').map((c) => c[1])
assert.deepEqual(dispatchCalls, [{ goalId: 'goal-never' }], 'dispatchResearch 参数不对')
assert.ok(!rpc.some((c) => c[0] === 'record' && c[1].goalId === 'goal-never'), '会话仍在镜像时不该重建')
assert.deepEqual(opened, ['session-g'], '不该为已存活会话再次新建/切换')
ok('「▶ 开始调研」调用 study.dispatchResearch（复用已存活的目标会话，不重建）')

dispatchResult = { ok: false, need_open: true, error: '目标会话代理未激活：请打开该目标会话' }
await click(btnIn('尚未派发', '▶ 开始调研'), 'start research fail')
tree = await renderAll()
assert.ok(bodyText().indexOf('代理未激活') >= 0, '动作失败原因被刷新冲掉了（doAction 应保留 error）')
ok('动作失败的红字在其后 study.list 刷新后仍然可见')
dispatchResult = { ok: true, sessionId: 'session-g', message: '已派发' }

await expand('正在调研')
const running = textOf(rowRange('正在调研')[0])
assert.ok(running.indexOf('待调研') < 0 && running.indexOf('调研中…') >= 0, '已派发行不该显示「待调研」')
assert.ok(running.indexOf('正在联网调研') >= 0 && running.indexOf('派发于') >= 0, '已派发应显示进行中含派发时间')
assert.ok(btnIn('正在调研', '🔁 重新调研'), '已派发应有「🔁 重新调研」')
ok('D16：researching 且已派发 → 「⏳ …派发于 HH:mm」+「🔁 重新调研」')

const openedBefore = opened.length
await expand('会话已销毁')
await click(btnIn('会话已销毁', '▶ 开始调研'), 'start research on ghost')
const rec = rpc.filter((c) => c[0] === 'record').map((c) => c[1])
assert.ok(rec.some((c) => c.goalId === 'goal-ghost' && c.sessionId === 'session-g'), '会话已销毁时应先重建并 recordGoalSession：' + JSON.stringify(rec))
assert.ok(rpc.filter((c) => c[0] === 'dispatch').some((c) => c[1].goalId === 'goal-ghost'), '重建后应完成派发')
assert.equal(opened.length, openedBefore + 1, '重建后应打开新会话')
ok('D16：记录过的会话已销毁 → 先重建+回写 sessionId，再派发调研')

// 草案待批准的「重新调研」= 退回 + 立刻重新派发（旧行为只退回，目标就此停在「调研中」）
await expand('草案待批')
await click(btnIn('草案待批', '重新调研'), 're-research')
const seq = rpc.filter((c) => c[0] === 'reject' || c[0] === 'dispatch').map((c) => c[0] + ':' + c[1].goalId)
assert.ok(seq.indexOf('reject:goal-pending') >= 0 && seq.indexOf('dispatch:goal-pending') === seq.indexOf('reject:goal-pending') + 1,
  '应「先 rejectDraft 再 dispatchResearch」: ' + JSON.stringify(seq))
ok('D16：草案待批准的「重新调研」名副其实——rejectDraft 后紧接 dispatchResearch')

// ── 空列表：提示文案与「＋ 添加学习目标」必须同时在场（回归：按钮曾被关在
//    goals.length>0 的分支里，新装/删空/首帧未加载时面板没有任何创建入口）────────
assert.ok(flat.some((e) => e.type === 'button' && e.props.className === 'stuiAdd'), '非空列表也应有「＋ 添加学习目标」')
ok('非空列表渲染「＋ 添加学习目标」')
// 打开面板的 useEffect 只跑一次（桩按槽位记 deps，与真 React 一致），改数据源后要手动点 ⟳ 重取
listGoals = []
await click(flat.find((e) => e.type === 'button' && e.props.title === '刷新'), 'refresh')
tree = await renderAll()
assert.ok(bodyText().indexOf('还没有学习目标') >= 0, '空列表应显示空态提示')
const addBtn = flat.find((e) => e.type === 'button' && e.props.className === 'stuiAdd')
assert.ok(addBtn, '空列表缺少「＋ 添加学习目标」按钮（提示文案指向了不存在的出口）')
assert.equal(textOf(addBtn), '＋ 添加学习目标')
await click(addBtn, 'add goal from empty state')
tree = await renderAll()
assert.ok(bodyText().indexOf('学习主题') >= 0 && bodyText().indexOf('✓ 创建并调研') >= 0, '空态点添加应进入创建表单')
ok('空列表仍渲染「＋ 添加学习目标」，点击可进入创建表单')

console.log('\nclient.test: ' + n + ' 断言全部通过')
