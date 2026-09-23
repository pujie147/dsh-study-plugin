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
// ── 网页课程源（v0.8.0）行桩：未抓取 / 抓取中 / 材料就绪 / 抓取失败 + ⚡ 三态（部分待生成/全部就绪/有生成中）
// web 字段是宿主 listSummary 由 goal.webCrawl 派生的摘要（status/ok/failed/skipped/blocked/total/startUrl/error）。
const webRow = (id, title, over) => Object.assign({
  id, title, status: 'researching', target_level: '入门', requirements: '', updatedAt: 'x',
  workspaceId: 'ws-1', sessionId: 'session-g', researchDispatched: false,
  path: '/home/me/.dsh/study-work/' + id, draft: null, chapters: []
}, over)
const webNoneRow = webRow('goal-web-none', '网页课未抓', {})
const webRunRow = webRow('goal-web-run', '网页课抓取中', {
  status: 'crawling',
  web: { status: 'running', startedAt: 'x', finishedAt: '', error: '', startUrl: 'https://docs.demo.io/guide/', ok: 2, failed: 0, skipped: 1, blocked: 0, total: 3 }
})
const webDoneRow = webRow('goal-web-done', '网页课材料就绪', {
  web: { status: 'done', startedAt: 'x', finishedAt: 'y', error: '', startUrl: 'https://docs.demo.io/guide/', ok: 3, failed: 0, skipped: 1, blocked: 0, total: 4 }
})
const webFailRow = webRow('goal-web-fail', '网页课抓取失败', {
  web: { status: 'failed', startedAt: 'x', finishedAt: 'y', error: '全部页面抓取失败（站点不可达）', startUrl: 'https://dead.demo.io/', ok: 0, failed: 1, skipped: 0, blocked: 0, total: 1 }
})
const genRow = (id, title, statuses) => webRow(id, title, {
  status: 'active', researchDispatched: true,
  chapters: statuses.map((s, i) => ({ index: i + 1, title: '第' + (i + 1) + '章', file: '0' + (i + 1) + '-ch.md', status: s, sessionId: '', lastError: '' }))
})
const genMixedRow = genRow('goal-gen-mixed', '批量部分待生成', ['ready', 'draft', 'draft'])
const genReadyRow = genRow('goal-gen-ready', '批量全部就绪', ['ready', 'ready'])
const genBusyRow = genRow('goal-gen-busy', '批量有生成中', ['ready', 'generating'])
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
// 网页课程源（v0.8.0）用例的可控返回
let crawlStartResult = { ok: true, startUrl: 'https://docs.demo.io/guide/' }
let crawlPreviewResult = {
  ok: true, crawled: true, materialFiles: 3,
  webSources: [{ url: 'https://docs.demo.io/guide/', title: '' }],
  webCrawl: { status: 'running', startedAt: 'x', startUrl: 'https://docs.demo.io/guide/', pages: [
    { url: 'https://docs.demo.io/guide/', depth: 0, status: 'ok', title: '指南首页', chars: 5200 },
    { url: 'https://docs.demo.io/ch1/', depth: 1, status: 'ok', title: '第 1 章', chars: 4100 },
    { url: 'https://docs.demo.io/ch2/', depth: 1, status: 'ok', title: '第 2 章', chars: 66, low: true },
    { url: 'https://other.site/x', depth: 1, status: 'skipped', reason: '跨域链接', chars: 0 }
  ] }
}
let genAllResult = { ok: true, chapters: 2, indices: [2, 3] }
const handlers = {
  'study.list': () => ({ goals: listGoals }),
  'study.rejectDraft': (a) => { rpc.push(['reject', a]); return { ok: true } },
  'study.dispatchResearch': (a) => { rpc.push(['dispatch', a]); return dispatchResult },
  // ── 网页课程源（v0.8.0）：抓取发起 / 预览 / 一次性生成（可控返回，供面板用例驱动）──
  'study.startCrawl': (a) => { rpc.push(['startCrawl', a]); return crawlStartResult },
  'study.getCrawlPreview': (a) => { rpc.push(['crawlPreview', a]); return crawlPreviewResult },
  'study.generateAllChapters': (a) => { rpc.push(['generateAll', a]); return genAllResult },
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
  'study.reattachGoalSessions': (a) => { rpc.push(['reattach', a]); return { ok: true, workspaceId: 'ws-1', attached: 2, failed: [] } },
  'study.readChapter': (a) => { rpc.push(['readChapter', a]); return notesResult },
  'study.startChapter': (a) => { rpc.push(['startChapter', a]); return { ok: true } },
  // ── D36 测试单元（🎯/📝 派发、▶ 陪练、试卷/错题本文件页）的可控返回 ──
  'study.generateChapterTest': (a) => { rpc.push(['genChapterTest', a]); return genChapterTestResult },
  'study.generateGoalTest': (a) => { rpc.push(['genGoalTest', a]); return genGoalTestResult },
  'study.startTest': (a) => { rpc.push(['startTest', a]); return startTestResult },
  'study.recordTestSession': (a) => { rpc.push(['recordTestSession', a]); return { ok: true } },
  'study.readTestFile': (a) => { rpc.push(['readTestFile', a]); return testFileResult },
  'study.deleteTest': (a) => { rpc.push(['deleteTest', a]); return deleteTestResult },
  // ── M5 GitHub 同步（可控返回，供同步面板用例驱动）──
  'study.syncGetConfig': (a) => { rpc.push(['syncGetConfig', a]); return syncCfg },
  'study.syncSetConfig': (a) => { rpc.push(['syncSetConfig', a]); return { ok: true, config: Object.assign({}, syncCfg.config, a) } },
  'study.syncListRemote': (a) => { rpc.push(['syncListRemote', a]); return remoteGoals },
  'study.syncBindPat': (a) => { rpc.push(['syncBindPat', a]); return bindResult },
  'study.syncStartDeviceFlow': (a) => { rpc.push(['syncStartDeviceFlow', a]); return deviceStart },
  'study.syncPollDeviceFlow': (a) => { rpc.push(['syncPollDeviceFlow', a]); return devicePoll },
  'study.syncRebind': (a) => { rpc.push(['syncRebind', a]); return rebindResult },
  'study.syncTakeOver': (a) => { rpc.push(['syncTakeOver', a]); return takeOverResult },
  'study.syncUnbind': (a) => { rpc.push(['syncUnbind', a]); return { ok: true, bound: false } },
  'study.syncInspect': (a) => { rpc.push(['syncInspect', a]); return inspResults[a.goalId] || { ok: true, status: 'remoteMissing', goalId: a.goalId, remoteGoalId: a.goalId, local: {}, remote: null } },
  'study.syncPush': (a) => { rpc.push(['syncPush', a]); return pushResult },
  'study.syncPull': (a) => { rpc.push(['syncPull', a]); return pullResult },
  'study.syncDeleteRemote': (a) => { rpc.push(['syncDeleteRemote', a]); return deleteRemoteResult }
}
// 同步面板的可控返回
let syncCfg = { ok: true, bound: false, bindState: 'unbound', fetch: true, config: {} }
// 「打开讲义」的可控返回（study.readChapter）
let notesResult = { ok: true, title: '计算机系统基础', content: '# 本章目标\n计算机系统基础\n- 要点一\n> 💡 [补充：流水](01-notes/x.md) — 概括\n```py\nprint("<img src=x onerror=alert(1)>")\n```\n', filePath: '/home/me/.dsh/study-work/goal-demo/chapters/01-chapter.md' }
// D36 测试单元用例的可控返回
let genChapterTestResult = { ok: true, test_n: 3, file: '01-test-03.md' }
let genGoalTestResult = { ok: true, test_n: 2, file: 'goal-test-02.md' }
let startTestResult = { ok: true, sessionId: 'session-t1' }
let testFileResult = { ok: true, title: '第 1 章测试 01 · 计算机系统基础', content: '# 题\n', filePath: '/home/me/.dsh/study-work/goal-demo/chapters/01-test-01.md' }
let deleteTestResult = { ok: true, scope: 'chapter', sessionRemoved: true }
let remoteGoals = { ok: true, repo: 'tester/dsh-study-sync', branch: 'main', goals: [] }
const inspResults = {}
let pushResult = { ok: true, pushed: true }
let pullResult = { ok: true, pulled: true }
let deleteRemoteResult = { ok: true, deleted: 2 }
let bindResult = { ok: true, bound: true, config: { auth: { account: 'tester', tokenHint: '••••0101' }, repo: { fullName: 'tester/dsh-study-sync', branch: 'main' } } }
let rebindResult = { ok: true, bound: true, config: bindResult.config }
let takeOverResult = { ok: true, bound: true, config: bindResult.config }
let deviceStart = { ok: true, userCode: 'ABCD-1234', verificationUri: 'https://github.com/login/device', interval: 5, expiresIn: 900 }
let devicePoll = { ok: true, status: 'pending' }
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
globalThis.window = { __ModuleLoader__: { load: (m) => { mod = m } }, innerHeight: 900, addEventListener() {}, removeEventListener() {}, open: (u) => { openedUrls.push(u); return windowOpenResult } }
globalThis.document = { createElement: () => ({ dataset: {} }), head: { appendChild() {} }, querySelector: () => null }
// setInterval 桩：记录每个回调（面板 2.5s 刷新 + 设备码自动轮询都用它），测试里按需手动触发；不留真实句柄避免进程不退出
const intervals = []
const openedUrls = []
// window.open 返回假值 = 浏览器拦截了新标签，客户端要降级成文字提示；默认按"打开成功"跑
let windowOpenResult = {}
new Function('window', 'document', 'setInterval', 'clearInterval', bundle)(globalThis.window, globalThis.document, (fn) => { intervals.push(fn); return intervals.length }, () => {})
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
let mirrorRefreshes = 0
const sessionsSvc = {
  list: { getSnapshot: () => ({ byId: { 'session-g': {}, 'session-c1': {} } }) },
  refresh: async () => { mirrorRefreshes++ },
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
const mrBefore = mirrorRefreshes
await click(confirmBtn, 'confirm import')
const impArgs = rpc.filter((c) => c[0] === 'import').map((c) => c[1]).pop()
assert.equal(impArgs.confirm, true)
assert.equal(impArgs.mode, 'overwrite')
assert.equal(impArgs.path, 'C:\\tmp\\study-goal-goal-demo.zip')
tree = await renderAll()
assert.ok(bodyText().indexOf('已导入/更新目标「软件设计」') >= 0, '导入成功提示缺失')
assert.ok(bodyText().indexOf('追加 1') >= 0 && bodyText().indexOf('换身份 1') >= 0, '成功提示未带分类计数')
assert.ok(bodyText().indexOf('重启 DSH') >= 0, '缺重启提示')
assert.ok(mirrorRefreshes > mrBefore, '导入成功后应主动刷新左栏镜像（免重启尝试）')
ok('「✓ 确认覆盖导入」带 confirm+mode 调用、汇报分类与重启、并刷新左栏镜像')

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
// D36 起 📖/📝/🎯/▶/📕 都是纯图标按钮（文字在悬停 title 里），按 className + 图标文字找
const iconBtnIn = (title, emoji) => rowRange(title).find((e) => e.type === 'button' && e.props.className === 'stuiIconBtn' && textOf(e) === emoji)
const iconBtnsIn = (title, emoji) => rowRange(title).filter((e) => e.type === 'button' && e.props.className === 'stuiIconBtn' && textOf(e) === emoji)
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

// ── 宿主 API 迁移回归（用户实机报「打开会话失败：连接会话的方法不存在」）────────────
// dsh 0.1.5-rc.1 把浏览器侧 connectWorkspace/openSession 从 workspaces 迁到了 uiWorkspace，
// workspaces 只剩纯 controller。客户端半必须按「方法是否存在」挑路：新宿主、旧宿主、两者都无
// 三种形状都要能落到某条路上，且绝不把 TypeError 的字样冒到面板上。
// 每换一个宿主形状重新 apply 一次 —— getUiWorkspace() 会缓存成功结果（生产里服务不会中途消失），
// 不复位就测不到「这个形状下没有 uiWorkspace」。
const hostShape = { ui: false, legacy: true, phase: undefined, sidebar: false }
const wsCalls = []
const uiWorkspaceSvc = {
  connectWorkspace: async (id) => { wsCalls.push('ui:' + id); return { sessionId: 'session-ui' } },
  openSession: (id) => { opened.push('ui-open:' + id) }
}
// DSH-better-sidebar 的 client 侧服务（真实形状：openFile(scope, path, title?)，能力面 features）
const betterSidebarSvc = {
  version: '0.19.1',
  features: ['badge', 'tabLifecycle', 'openFile', 'targetedOpen'],
  openFile: (scope, p, title) => { opened.push('sidebar:' + JSON.stringify({ scope: scope, path: p, title: title })) }
}
const legacyConnect = async (id) => { wsCalls.push('legacy:' + id); return { sessionId: 'session-legacy' } }
const origSnapshot = sessionsSvc.list.getSnapshot
const origCreate = sessionsSvc.create
const origOpen = sessionsSvc.open
const makeCtx = () => ({
  get: (name) => (name === 'slots' ? slots
    : name === 'sessions' ? sessionsSvc
    : name === 'workspaces' ? workspacesSvc
    : name === 'uiWorkspace' ? (hostShape.ui ? uiWorkspaceSvc : undefined)
    : name === 'betterSidebar' ? (hostShape.sidebar ? betterSidebarSvc : undefined)
    : undefined),
  effect: (fn) => fn()
})
const useHost = async (shape, rows) => {
  hostShape.ui = shape.ui === true
  hostShape.legacy = shape.legacy === true
  hostShape.phase = shape.phase
  if (hostShape.legacy) workspacesSvc.connectWorkspace = legacyConnect
  else delete workspacesSvc.connectWorkspace
  sessionsSvc.list.getSnapshot = shape.snapshot || origSnapshot
  sessionsSvc.create = shape.noCreate ? undefined : origCreate
  sessionsSvc.open = shape.noOpen ? undefined : origOpen
  sessionsSvc.refresh = shape.onRefresh || (async () => {})
  factory.apply(makeCtx())
  opened.length = 0; rpc.length = 0; wsCalls.length = 0
  listGoals = rows
  await click(flat.find((e) => e.type === 'button' && e.props.title === '刷新'), 'refresh')
  await renderAll()
}
// 展开是 toggle，跨场景状态会残留，所以只在拿不到按钮时展开一次
const openBtn = async (title) => {
  await renderAll()
  let b = btnIn(title, '📄 打开会话')
  if (!b) { await expand(title); b = btnIn(title, '📄 打开会话') }
  assert.ok(b, '目标行缺少「📄 打开会话」按钮')
  return b
}

// (a) 新宿主：只有 uiWorkspace 有 connectWorkspace（workspaces 上被宿主删掉了）
await useHost({ ui: true, legacy: false }, [ghostRow])
await click(await openBtn('会话已销毁'), 'open session on new host')
assert.deepEqual(wsCalls, ['ui:ws-1'], '新宿主应走 uiWorkspace.connectWorkspace：' + JSON.stringify(wsCalls))
assert.ok(rpc.some((c) => c[0] === 'record' && c[1].goalId === 'goal-ghost' && c[1].sessionId === 'session-ui'), '拿到会话后要回写 recordGoalSession')
assert.deepEqual(opened, ['ui-open:session-ui'], '切换要走 uiWorkspace.openSession')
tree = await renderAll()
assert.ok(bodyText().indexOf('打开会话失败') < 0, '新宿主形状下打开会话不该报错')
assert.ok(bodyText().indexOf('is not a function') < 0, 'TypeError 字样漏到了面板上')
ok('宿主迁移回归：connectWorkspace 只在 uiWorkspace 上时，「打开会话」仍成功')

// (b) 旧宿主：只有 workspaces.connectWorkspace（升级前的安装不能被打断）
await useHost({ ui: false, legacy: true }, [ghostRow])
await click(await openBtn('会话已销毁'), 'open session on legacy host')
assert.deepEqual(wsCalls, ['legacy:ws-1'], '旧宿主应退回 workspaces.connectWorkspace')
assert.ok(rpc.some((c) => c[0] === 'record' && c[1].sessionId === 'session-legacy'), '旧宿主路径也要回写 sessionId')
assert.deepEqual(opened, ['session-legacy'], '没有 uiWorkspace 时退回 sessions.open')
tree = await renderAll()
assert.ok(bodyText().indexOf('打开会话失败') < 0, '旧宿主形状下打开会话不该报错')
ok('向后兼容：只有 workspaces.connectWorkspace 的旧宿主仍能打开会话')

// (c) 两个都没有：降级到 sessions.create({workspaceId})，动作仍算成功
await useHost({ ui: false, legacy: false }, [ghostRow])
await click(await openBtn('会话已销毁'), 'open session with no connect at all')
assert.deepEqual(wsCalls, [], '三层兜底的第 3 层不该调用任何 connectWorkspace')
assert.ok(rpc.some((c) => c[0] === 'record' && c[1].goalId === 'goal-ghost' && c[1].sessionId === 'session-new'), '应把 create 出来的会话记回 goal.json')
assert.deepEqual(opened, ['session-new'], 'sessions.create + sessions.open 兜底要能打开')
tree = await renderAll()
assert.ok(bodyText().indexOf('打开会话失败') < 0, '降级路径不该报错：' + bodyText().slice(0, 200))
ok('降级优先：宿主两个连接方法都缺席时落到 sessions.create，不报错')

// (e) 连 sessions.create 也没有：只能给出白话错误，不能是 TypeError
await useHost({ ui: false, legacy: false, noCreate: true }, [ghostRow])
await click(await openBtn('会话已销毁'), 'open session with nothing at all')
tree = await renderAll()
assert.ok(bodyText().indexOf('宿主未提供工作区连接能力') >= 0, '全缺时应说「宿主未提供工作区连接能力」')
assert.ok(bodyText().indexOf('is not a function') < 0, '白话错误没兜住，原始 TypeError 漏到面板')
ok('全部能力缺席时显示白话错误，而不是 is not a function')

// (d) 镜像 phase=loading：会话其实活着，只是镜像没追上 ⇒ 不许新建（D10 幂等）
let phaseReads = 0
await useHost({
  ui: true, legacy: false,
  snapshot: () => {
    phaseReads++
    // 前两次读还是 loading 且看不到会话，第三次起镜像追上
    if (phaseReads < 3) return { byId: {}, phase: 'loading' }
    return { byId: { 'session-g': {}, 'session-c1': {} }, phase: 'ready' }
  },
  onRefresh: async () => {}
}, [researchRow])
phaseReads = 0
await click(await openBtn('尚未派发'), 'open session while mirror loading')
assert.deepEqual(wsCalls, [], '镜像未就绪时不该判定为「会话已销毁」去重连工作区：' + JSON.stringify(wsCalls))
assert.ok(!rpc.some((c) => c[0] === 'record' && c[1].goalId === 'goal-never'), '镜像未就绪时不该新建并回写 sessionId')
assert.deepEqual(opened, ['ui-open:session-g'], '应复用已记录的目标会话')
ok('phase 感知：镜像 loading 不误判为已销毁，等到 ready 后复用原会话')

// 复位成基线形状，后面的用例沿用旧有假设
await useHost({ ui: false, legacy: true }, [goalRow])
sessionsSvc.list.getSnapshot = origSnapshot
sessionsSvc.create = origCreate
sessionsSvc.open = origOpen
ok('宿主形状复位，避免污染后续断言')

// ── 打开讲义：唯一入口 =「📖 开始学习」（独立讲义按钮已移除）；better-sidebar 页签优先 ⇒ 才新标签 ──
const origFeatures = betterSidebarSvc.features
const NOTES_PATH = '/home/me/.dsh/study-work/goal-demo/chapters/01-chapter.md'
const sidebarOpen = (sessionId) => 'sidebar:' + JSON.stringify({
  scope: { sessionId: sessionId }, path: NOTES_PATH, title: '计算机系统基础'
})
const startChapter = async () => {
  await renderAll()
  let b = iconBtnIn('软件设计', '📖')
  if (!b) { await expand('软件设计'); b = iconBtnIn('软件设计', '📖') }
  assert.ok(b && b.props.title.indexOf('开始学习') >= 0, '章节行缺少悬停「📖 开始学习」的图标按钮')
  await click(b, 'start chapter')
  return renderAll()
}

// (1) 未装 better-sidebar：开始学习 → readChapter 拿路径 → 新标签打开 /study-file 页
await useHost({ ui: true, legacy: false }, [goalRow])
hostShape.sidebar = false
openedUrls.length = 0
tree = await startChapter()
assert.deepEqual(opened, ['ui-open:session-c1'], '应先切换到已记录的章节会话：' + JSON.stringify(opened))
assert.deepEqual(rpc.filter((c) => c[0] === 'readChapter').map((c) => c[1]).pop(), { goalId: 'goal-demo', chapter_index: 1 }, 'readChapter 参数不对')
assert.deepEqual(openedUrls.slice(-1), ['/study-file?goalId=goal-demo&chapter=1'], '应新标签打开讲义页：' + JSON.stringify(openedUrls))
assert.ok(bodyText().indexOf('本章目标') < 0, '讲义不该在面板内渲染')
ok('打开讲义：未装 better-sidebar 时新标签打开 /study-file 页，面板不自渲染')

// (1b) 浏览器拦住新标签：白话提示里要带地址，不能静默失败
openedUrls.length = 0
windowOpenResult = null
tree = await startChapter()
assert.ok(bodyText().indexOf('/study-file?goalId=goal-demo&chapter=1') >= 0, '弹窗被拦时应把地址提示出来: ' + bodyText().slice(0, 300))
windowOpenResult = {}
ok('打开讲义：新标签被拦截时显示可手动访问的地址')

// (2) 装了 better-sidebar（features 含 openFile）：交出 scope+路径+章标题，不再开新标签
await useHost({ ui: true, legacy: false }, [goalRow])
hostShape.sidebar = true
openedUrls.length = 0
tree = await startChapter()
assert.deepEqual(opened, ['ui-open:session-c1', sidebarOpen('session-c1')], '应按 openFile(scope, path, title) 交给 better-sidebar：' + JSON.stringify(opened))
assert.deepEqual(openedUrls, [], 'better-sidebar 已受理时不该再开新标签')
assert.ok(bodyText().indexOf('本章目标') < 0, 'better-sidebar 已受理时不该在面板内自渲染')
ok('打开讲义：better-sidebar 在场时以本章会话为 scope 开右侧页签，本插件退让')

// (2b) 装了但能力面没有 openFile：绝不硬调，降级成新标签
betterSidebarSvc.features = ['badge', 'tabLifecycle']
await useHost({ ui: true, legacy: false }, [goalRow])
hostShape.sidebar = true
openedUrls.length = 0
tree = await startChapter()
assert.deepEqual(opened, ['ui-open:session-c1'], 'features 不含 openFile 时不该调用它：' + JSON.stringify(opened))
assert.deepEqual(openedUrls.slice(-1), ['/study-file?goalId=goal-demo&chapter=1'], '缺能力应降级成新标签：' + JSON.stringify(openedUrls))
betterSidebarSvc.features = origFeatures
ok('打开讲义：按 features 门控能力，缺 openFile 时降级而非硬调')

// (3) 讲义文件还没生成：会话照样打开，讲义报白话错误且不抛、不开新标签
hostShape.sidebar = false
openedUrls.length = 0
notesResult = { ok: false, error: '讲义文件还不存在：请先点「生成讲义」' }
await useHost({ ui: true, legacy: false }, [goalRow])
tree = await startChapter()
assert.ok(bodyText().indexOf('讲义文件还不存在') >= 0, '缺讲义时应白话报错: ' + bodyText().slice(0, 200))
assert.ok(bodyText().indexOf('打开章节会话失败') < 0, '讲义缺失不该被说成会话打开失败')
assert.deepEqual(opened, ['ui-open:session-c1'], '会话打开这一步不应被讲义失败推翻')
assert.deepEqual(openedUrls, [], '读不到文件时不该开新标签')
notesResult = { ok: true, title: '计算机系统基础', content: '# 本章目标\n计算机系统基础\n', filePath: NOTES_PATH }
ok('打开讲义：文件缺失时显示宿主返回的错误而非抛错')

// (4) 回归：就绪章节行的 📖 入口收敛为纯图标（D36：文字进悬停 title），独立「📖 讲义」按钮仍不存在
hostShape.sidebar = false
await useHost({ ui: true, legacy: false }, [goalRow])
tree = await renderAll()
const bookBtns = flat.filter((e) => e.type === 'button' && textOf(e).indexOf('📖') >= 0)
assert.deepEqual(bookBtns.map((e) => textOf(e)), ['📖'], '章节行的 📖 入口应只剩纯图标「📖」：' + JSON.stringify(bookBtns.map((e) => textOf(e))))
assert.ok(bookBtns[0].props.title.indexOf('📖 开始学习') >= 0, '悬停 title 必须说明「开始学习」')
assert.ok(bodyText().indexOf('也可随时单点') < 0, '提示文案不该再承诺单点讲义')
assert.ok(bodyText().indexOf('自动打开本章讲义') >= 0, '提示文案未说明自动开讲义: ' + bodyText().slice(0, 300))
ok('章节行只剩纯图标「📖」（悬停=开始学习），提示文案与之一致')

// ── D36 测试单元：🎯/📝 纯图标派发、章节/目标测试折叠区、▶ 陪练会话、📕 错题本页签 ──
const d36Row = {
  id: 'goal-d36', title: '测试单元目标', status: 'active', target_level: '软考中级', requirements: '',
  updatedAt: 'x', workspaceId: 'ws-1', sessionId: 'session-g',
  path: '/home/me/.dsh/study-work/goal-d36', draft: null,
  chapters: [{ index: 1, title: '计算机系统基础', file: '01-chapter.md', status: 'ready', sessionId: 'session-c1', lastError: '',
    test: [
      { n: 1, file: '01-test-01.md', status: 'ready', sessionId: 'session-t1' },
      { n: 2, file: '01-test-02.md', status: 'generating' }
    ], mistakes: 2 }],
  goalTests: [{ n: 1, file: 'goal-test-01.md', status: 'ready' }],
  goalMistakes: 1
}
const d36Snapshot = () => ({ byId: { 'session-g': {}, 'session-c1': {}, 'session-t1': {} }, phase: 'ready' })
await useHost({ ui: true, legacy: false, snapshot: d36Snapshot }, [d36Row])
hostShape.sidebar = false
sessionsSvc.list.getSnapshot = d36Snapshot
await expand('测试单元目标')
// (1) 图标按钮三件套就位：📖(悬停=开始学习) / 📝(悬停含「生成本章讲义测试」) / 🎯(悬停含「生成目标测试」)
assert.ok(iconBtnIn('测试单元目标', '📝') && iconBtnIn('测试单元目标', '📝').props.title.indexOf('生成本章讲义测试') >= 0, '章节行缺悬停「📝 生成本章讲义测试」的图标按钮')
assert.ok(iconBtnIn('测试单元目标', '🎯') && iconBtnIn('测试单元目标', '🎯').props.title.indexOf('生成目标测试') >= 0, '目标行缺悬停「🎯 生成目标测试」的图标按钮')
ok('D36：🎯/📝 均为纯图标按钮，文字在悬停 title 里')
// (2) 折叠区默认收起：计数摘要 + generating 提示，明细不渲染
assert.ok(bodyText().indexOf('▸ 本章测试（2 份 · 错题 2）') >= 0, '本章测试折叠头缺失: ' + bodyText().slice(0, 300))
assert.ok(bodyText().indexOf('⏳ 有考卷生成中') >= 0, '收起态应提示有卷在生成')
assert.ok(bodyText().indexOf('▸ 目标测试（1 份 · 错题 1）') >= 0, '目标测试折叠头缺失')
assert.ok(bodyText().indexOf('🧪 测试 01') < 0, '未展开不该渲染明细')
ok('D36：折叠区默认收起，摘要带份数与错题数并提示生成中')
// (3) 展开本章测试区：ready 卷带 ▶，generating 卷只有 chip；错题本行在场
await click(rowRange('测试单元目标').find((e) => textOf(e).indexOf('本章测试（') >= 0 && typeof e.props.onClick === 'function'), 'expand chapter tests')
tree = await renderAll()
assert.ok(bodyText().indexOf('🧪 测试 01') >= 0 && bodyText().indexOf('试卷就绪') >= 0 && bodyText().indexOf('生成中…') >= 0, '展开后应见两卷两态')
assert.ok(bodyText().indexOf('有考卷生成中') < 0, '展开后收起态提示该让位给明细')
assert.ok(bodyText().indexOf('📕 本章错题本') >= 0 && bodyText().indexOf('2 条') >= 0, '本章错题本行缺失')
const chPlays = iconBtnsIn('测试单元目标', '▶')
assert.equal(chPlays.length, 1, '▶ 只该出现在 ready 卷上：' + chPlays.length)
ok('D36：展开后逐卷呈现（ready 有 ▶、generating 没有）+ 错题本行')
// (4) ▶ 打开本章卷 = 「开始学习」同构：复用条目会话 + startTest 注入 + 试卷交 better-sidebar/新标签
rpc.length = 0; opened.length = 0; openedUrls.length = 0
await click(iconBtnsIn('测试单元目标', '▶')[0], 'open chapter test')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'startTest' && c[1].goalId === 'goal-d36' && c[1].chapter_index === 1 && c[1].test_n === 1 && c[1].sessionId === 'session-t1'), 'startTest 参数不对: ' + JSON.stringify(rpc))
assert.ok(!rpc.some((c) => c[0] === 'recordTestSession'), '条目已记测试会话 ⇒ 不该再新建')
assert.deepEqual(opened, ['ui-open:session-t1'], '应切进该卷的陪练会话: ' + JSON.stringify(opened))
const rtC = rpc.find((c) => c[0] === 'readTestFile')
assert.ok(rtC && rtC[1].scope === 'chapter-test' && rtC[1].chapter_index === 1 && rtC[1].test_n === 1, 'readTestFile 参数不对: ' + JSON.stringify(rtC))
assert.deepEqual(openedUrls.slice(-1), ['/study-file?goalId=goal-d36&scope=chapter-test&chapter=1&test=1'], '无 sidebar 时应新标签兜底出试卷页: ' + JSON.stringify(openedUrls))
ok('D36：▶=复用已记会话 + startTest 注入 + 试卷 /study-file 兜底页')
// (5) 📝/🎯 点击即派发（追加一份新卷），成功提示指向「会话内确认蓝图」
rpc.length = 0
await click(iconBtnIn('测试单元目标', '📝'), 'dispatch chapter test')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'genChapterTest' && c[1].goalId === 'goal-d36' && c[1].chapter_index === 1), '📝 应打 study.generateChapterTest: ' + JSON.stringify(rpc))
assert.ok(bodyText().indexOf('📝 第 1 章测试第 3 份已派发') >= 0 && bodyText().indexOf('确认出卷蓝图') >= 0, '缺派发成功提示: ' + bodyText().slice(0, 300))
rpc.length = 0
await click(iconBtnIn('测试单元目标', '🎯'), 'dispatch goal test')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'genGoalTest' && c[1].goalId === 'goal-d36'), '🎯 应打 study.generateGoalTest')
assert.ok(bodyText().indexOf('🎯 目标测试第 2 份已派发') >= 0, '缺目标卷派发提示')
ok('D36：📝/🎯 一次点击=派发一份新卷并提示去会话确认蓝图')
// (6) 目标测试区展开 + 无 sessionId 的卷：新建会话→记回条目→startTest→goal-test 兜底页
await click(rowRange('测试单元目标').find((e) => textOf(e).indexOf('目标测试（') >= 0 && typeof e.props.onClick === 'function'), 'expand goal tests')
tree = await renderAll()
assert.ok(bodyText().indexOf('🎯 目标卷 01') >= 0 && bodyText().indexOf('📕 目标错题本') >= 0, '目标测试区明细缺失')
rpc.length = 0; opened.length = 0; openedUrls.length = 0
const gPlays = iconBtnsIn('测试单元目标', '▶')
await click(gPlays[gPlays.length - 1], 'open goal test (fresh session)')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'recordTestSession' && c[1].goalId === 'goal-d36' && c[1].test_n === 1 && c[1].sessionId === 'session-new'), '无记录的卷应先新建会话并记回条目: ' + JSON.stringify(rpc))
assert.ok(rpc.some((c) => c[0] === 'startTest' && c[1].sessionId === 'session-new' && c[1].test_n === 1 && c[1].chapter_index === undefined), '目标卷 startTest 不该带 chapter_index: ' + JSON.stringify(rpc))
const rtG = rpc.find((c) => c[0] === 'readTestFile')
assert.ok(rtG && rtG[1].scope === 'goal-test' && rtG[1].test_n === 1, 'goal-test 文件参数不对: ' + JSON.stringify(rtG))
assert.deepEqual(openedUrls.slice(-1), ['/study-file?goalId=goal-d36&scope=goal-test&test=1'], JSON.stringify(openedUrls))
ok('D36：未记会话的卷先建后记再注入；目标卷派发/开卷不带 chapter_index')
// (7) 📕 错题本：装了 better-sidebar 时以目标会话为 scope 开页签，不开新标签
hostShape.sidebar = true
rpc.length = 0; opened.length = 0; openedUrls.length = 0
testFileResult = { ok: true, title: '目标错题本', content: '# 目标错题本\n## 考点：x\n', filePath: '/home/me/.dsh/study-work/goal-d36/goal-mistakes.md' }
await click(rowRange('测试单元目标').find((e) => e.type === 'button' && e.props.title === '打开目标错题本'), 'open goal mistakes')
tree = await renderAll()
const rtM = rpc.find((c) => c[0] === 'readTestFile')
assert.ok(rtM && rtM[1].scope === 'goal-mistakes', '📕 应读 goal-mistakes: ' + JSON.stringify(rtM))
assert.deepEqual(opened.slice(-1), ['sidebar:' + JSON.stringify({ scope: { sessionId: 'session-g' }, path: testFileResult.filePath, title: '目标错题本' })], '错题本应开成目标会话的右侧页签: ' + JSON.stringify(opened))
assert.deepEqual(openedUrls, [], 'better-sidebar 已受理时不该开新标签')
hostShape.sidebar = false
testFileResult = { ok: true, title: '第 1 章测试 01 · 计算机系统基础', content: '# 题\n', filePath: '/home/me/.dsh/study-work/goal-demo/chapters/01-test-01.md' }
sessionsSvc.list.getSnapshot = origSnapshot
ok('D36：📕 错题本走 better-sidebar 页签（scope=目标会话），缺席才兜底新标签')

// ── D36 补：测试行「🗑 删除」= 两次点击内联确认 → study.deleteTest（不可逆，删文件+会话）──
{
  const dels = iconBtnsIn('测试单元目标', '🗑')
  assert.equal(dels.length, 3, '章测试 2 卷 + 目标测试 1 卷各应有一个 🗑：' + dels.length)
  ok('D36：每份测试（章卷/目标卷）行都有 🗑 删除按钮')
  // 章卷 01（第一行）：首次点击只进「确认?」态，不发 RPC
  rpc.length = 0
  await click(iconBtnsIn('测试单元目标', '🗑')[0], 'del chapter test step1')
  tree = await renderAll()
  assert.ok(!rpc.some((c) => c[0] === 'deleteTest'), '首次点击不该真的删除')
  assert.ok(bodyText().indexOf('确认?') >= 0, '首次点击应把按钮切成「确认?」: ' + bodyText().slice(0, 200))
  // 二次点击：真正调用 study.deleteTest，章卷带 chapter_index
  await click(flat.find((e) => e.type === 'button' && textOf(e) === '确认?'), 'del chapter test step2')
  tree = await renderAll()
  const dtC = rpc.find((c) => c[0] === 'deleteTest')
  assert.ok(dtC && dtC[1].goalId === 'goal-d36' && dtC[1].chapter_index === 1 && dtC[1].test_n === 1, '章卷删除参数不对: ' + JSON.stringify(rpc))
  assert.ok(bodyText().indexOf('已删除') >= 0 && bodyText().indexOf('含陪练会话') >= 0, '缺删除成功提示: ' + bodyText().slice(0, 200))
  // 目标卷（最后一行）：二次确认后不带 chapter_index
  rpc.length = 0
  await click(iconBtnsIn('测试单元目标', '🗑')[iconBtnsIn('测试单元目标', '🗑').length - 1], 'del goal test step1')
  tree = await renderAll()
  await click(flat.find((e) => e.type === 'button' && textOf(e) === '确认?'), 'del goal test step2')
  tree = await renderAll()
  const dtG = rpc.find((c) => c[0] === 'deleteTest')
  assert.ok(dtG && dtG[1].goalId === 'goal-d36' && dtG[1].test_n === 1 && dtG[1].chapter_index === undefined, '目标卷删除不该带 chapter_index: ' + JSON.stringify(rpc))
  ok('D36：🗑 删除两次点击确认后才发 study.deleteTest；章卷带 chapter_index、目标卷不带')
}

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

// ── M5 GitHub 同步面板：绑定 / 五态 / 冲突二选一 / 解绑 / token 不回显 ─────────────
const hdrBtn = (title) => flat.find((e) => e.type === 'button' && e.props.title === title)
const btnText = (frag) => flat.find((e) => e.type === 'button' && textOf(e).indexOf(frag) >= 0)
const findInput = (pred) => flat.find((e) => e.type === 'input' && pred(e.props || {}))

rpc.length = 0
listGoals = [goalRow]
await click(hdrBtn('刷新'), 'refresh before sync')
tree = await renderAll()
// 高级选项（client_id / PAT）默认收起；需要时展开并取回 PAT 输入框
const openAdv = async () => { const b = btnText('高级选项'); if (b) await click(b, 'adv'); return await renderAll() }
const getPatBox = async () => { let b = findInput((p) => p.type === 'password'); if (!b) { await openAdv(); b = findInput((p) => p.type === 'password') } return b }

// (1) 未绑定 + 无内置 client_id（oneClick=false）：主按钮「配置并绑定」，client_id/PAT 收进高级选项
syncCfg = { ok: true, bound: false, bindState: 'unbound', fetch: true, oneClick: false, config: {} }
await click(hdrBtn('GitHub 同步'), 'open sync view')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncGetConfig'), '进入同步面板应先读配置')
assert.ok(bodyText().indexOf('未绑定') >= 0, '未绑定态文案缺失')
assert.ok(btnText('配置并绑定'), '无内置 client_id 时主按钮应是「配置并绑定」')
assert.ok(!btnText('一键登录'), '无内置 client_id 不该出现一键按钮')
assert.ok(!findInput((p) => p.type === 'password'), '高级选项收起时不该直接暴露 PAT 输入')
await openAdv()
assert.ok(findInput((p) => p.type === 'password'), '展开高级应出现 PAT 输入框')
assert.ok(findInput((p) => p.type !== 'password' && String(p.placeholder || '').indexOf('client_id') >= 0), '展开高级应出现 client_id 输入框')
ok('未绑定态：有内置 client_id 才给一键；否则「配置并绑定」，client_id/PAT 藏在高级选项')

// (2) 一键设备码（oneClick=true，官方 App 内置）：主按钮 → window.open + 展示代码 + 自动轮询（无手动确认）
syncCfg = { ok: true, bound: false, bindState: 'unbound', fetch: true, oneClick: true, config: { clientId: 'Iv1.officialapp' } }
await click(btnText('⟳ 刷新'), 'reload oneClick')
tree = await renderAll()
rpc.length = 0
const beforeInt = intervals.length
await click(btnText('一键登录 GitHub 授权'), 'one click bind')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncStartDeviceFlow'), '一键应直接发起设备码')
assert.ok(!rpc.some((c) => c[0] === 'syncSetConfig'), '内置 client_id 时一键不该再存 client_id')
assert.deepEqual(openedUrls.slice(-1), ['https://github.com/login/device'], '一键应 window.open 授权页')
assert.ok(bodyText().indexOf('ABCD-1234') >= 0, '应展示 user_code')
assert.ok(!btnText('我已在浏览器授权') && !btnText('确认授权'), '一键流程不该再有手动确认按钮')
assert.equal(intervals.length, beforeInt + 1, 'pending 应新注册一个自动轮询定时器')
const devCb = intervals[intervals.length - 1]
devicePoll = { ok: true, status: 'pending' }
await devCb(); await tick()
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncPollDeviceFlow'), '自动轮询应调用 syncPollDeviceFlow')
assert.ok(bodyText().indexOf('绑定状态：未绑定') >= 0, 'pending 时仍是未绑定')
assert.equal(intervals.length, beforeInt + 1, 'pending 不该重启/新增定时器')
devicePoll = { ok: true, status: 'authorized', bound: true, config: bindResult.config }
syncCfg = { ok: true, bound: true, bindState: 'ready', fetch: true, oneClick: true, config: bindResult.config }
await devCb(); await tick()
tree = await renderAll()
assert.ok(bodyText().indexOf('已就绪') >= 0, '授权成功自动切到已就绪')
assert.ok(!btnText('一键登录'), '已绑定后不应再有一键入口')
ok('一键设备码：主按钮→window.open+展示代码+自动轮询→authorized 自动绑定（无手动确认）')

// (3) 已绑定：列远端目标 + 检查本机状态 + 推送 localAhead
remoteGoals = { ok: true, repo: 'tester/dsh-study-sync', branch: 'main', goals: [{ remoteGoalId: 'goal-demo', title: '软件设计', bytes: 152043, exportedAt: '2026-09-10T02:00:00.000Z' }] }
inspResults['goal-demo'] = { ok: true, status: 'localAhead', goalId: 'goal-demo', remoteGoalId: 'goal-demo', local: { exportedAt: '2026-09-11T00:00:00.000Z' }, remote: { exportedAt: '2026-09-10T02:00:00.000Z', deviceId: 'dev-x', bytes: 152043 } }
await click(btnText('☁ 列出仓库里的目标'), 'list remote')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncListRemote'), '未列远端目标')
assert.ok(bodyText().indexOf('tester/dsh-study-sync') >= 0, '未显示仓库名')
// 远端每一行都要能直接「拉取到本地」——本机还没有该目标时的首次落地入口（旧版缺此按钮 = 空机无法拉取）
rpc.length = 0
assert.ok(btnText('⬇ 拉取到本地'), '远端目标行应有「⬇ 拉取到本地」按钮（本机无该目标时可首次拉取）')
pullResult = { ok: true, pulled: true, goalId: 'goal-demo' }
await click(btnText('⬇ 拉取到本地'), 'remote-row pull')
const remoteRowPull = rpc.filter((c) => c[0] === 'syncPull').map((c) => c[1]).pop()
assert.deepEqual(remoteRowPull, { remoteGoalId: 'goal-demo' }, '远端行拉取应按 remoteGoalId 且不带 discardLocal')
ok('远端目标行：首次「拉取到本地」走 syncPull{remoteGoalId}（不带 discardLocal）')
// 远端目标行「删除」：内联二次确认，确认后才走 syncDeleteRemote{confirm:true}
rpc.length = 0
assert.ok(btnText('🗑 删除'), '远端目标行应有「🗑 删除」按钮')
await click(btnText('🗑 删除'), 'remote delete arm')
tree = await renderAll()
assert.ok(!rpc.some((c) => c[0] === 'syncDeleteRemote'), '首次点击只进入确认态，不应触发删除')
assert.ok(btnText('确认删除?'), '首次点击后应切到「确认删除?」内联态')
deleteRemoteResult = { ok: true, deleted: 2 }
await click(btnText('确认删除?'), 'remote delete confirm')
const delCall = rpc.filter((c) => c[0] === 'syncDeleteRemote').map((c) => c[1]).pop()
assert.deepEqual(delCall, { remoteGoalId: 'goal-demo', confirm: true }, '确认删除必须带 confirm=true 且按 remoteGoalId')
ok('远端目标行删除：内联二次确认 → syncDeleteRemote{confirm:true}')
await click(btnText('检查本机目标同步状态'), 'inspect all')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncInspect' && c[1].goalId === 'goal-demo'), '未对本机目标做 syncInspect')
assert.ok(bodyText().indexOf('⬆ 本地待推') >= 0, 'localAhead 状态 chip 缺失')
rpc.length = 0
pushResult = { ok: true, pushed: true }
await click(btnText('⬆ 推送到仓库'), 'push')
tree = await renderAll()
const pushCall = rpc.filter((c) => c[0] === 'syncPush').map((c) => c[1]).pop()
assert.deepEqual(pushCall, { goalId: 'goal-demo' }, '普通推送不应带 force')
ok('已绑定：远端列表 + 本机 localAhead → 推送（普通 push 不带 force）')

// (4) 真分叉：亮出远端时间/设备/体积 + 二选一（覆盖仓库=force push / 放弃本地=discard pull）
inspResults['goal-demo'] = { ok: true, status: 'conflicted', goalId: 'goal-demo', remoteGoalId: 'goal-demo', local: { exportedAt: '2026-09-11T09:00:00.000Z' }, remote: { exportedAt: '2026-09-10T02:00:00.000Z', deviceId: 'dev-remote', bytes: 152043 } }
await click(btnText('检查本机目标同步状态'), 'inspect conflict')
tree = await renderAll()
assert.ok(bodyText().indexOf('真分叉') >= 0, '冲突 chip 缺失')
assert.ok(bodyText().indexOf('dev-remote') >= 0, '冲突未亮出远端设备')
assert.ok(bodyText().indexOf('148.5 KB') >= 0, '冲突未亮出远端体积')
assert.ok(btnText('覆盖仓库') && btnText('放弃本地'), '冲突缺少二选一按钮')
rpc.length = 0
pushResult = { ok: true, pushed: true }
await click(btnText('覆盖仓库'), 'overwrite repo')
assert.ok(rpc.some((c) => c[0] === 'syncPush' && c[1].force === true), '「覆盖仓库」必须 force=true')
rpc.length = 0
pullResult = { ok: true, pulled: true }
await click(btnText('放弃本地'), 'discard local')
const discardPull = rpc.filter((c) => c[0] === 'syncPull').map((c) => c[1]).pop()
assert.deepEqual(discardPull, { remoteGoalId: 'goal-demo', discardLocal: true }, '「放弃本地」= discardLocal 拉取')
ok('真分叉：亮远端时间/设备/体积 ⇒ 覆盖仓库(force push) / 放弃本地(discard pull) 各如其分')

// (5) remoteAhead：普通拉取不带 discardLocal
inspResults['goal-demo'] = { ok: true, status: 'remoteAhead', goalId: 'goal-demo', remoteGoalId: 'goal-demo', local: {}, remote: { exportedAt: '2026-09-12T00:00:00.000Z', deviceId: 'dev-r', bytes: 1000 } }
await click(btnText('检查本机目标同步状态'), 'inspect remoteAhead')
tree = await renderAll()
assert.ok(bodyText().indexOf('⬇ 远端待拉') >= 0, 'remoteAhead chip 缺失')
rpc.length = 0
pullResult = { ok: true, pulled: true }
await click(btnText('⬇ 拉取到本地'), 'plain pull')
const plainPull = rpc.filter((c) => c[0] === 'syncPull').map((c) => c[1]).pop()
assert.equal(plainPull.discardLocal, undefined, 'remoteAhead 快进拉取不应带 discardLocal')
ok('remoteAhead：普通「⬇ 拉取到本地」不带 discardLocal')

// (6) invalid → 重绑
syncCfg = { ok: true, bound: false, bindState: 'invalid', fetch: true, config: bindResult.config }
rebindResult = { ok: true, bound: true, config: bindResult.config }
await click(btnText('⟳ 刷新'), 'reload cfg invalid')
tree = await renderAll()
assert.ok(bodyText().indexOf('凭据已失效') >= 0, 'invalid 态文案缺失')
rpc.length = 0
await click(btnText('重新绑定'), 'rebind')
assert.ok(rpc.some((c) => c[0] === 'syncRebind'), '未触发 syncRebind')
ok('invalid 态：给出「重新绑定（复用已存凭据）」入口并调用 syncRebind')

// (7) 解绑回到未绑定 → PAT 重新绑定；token 明文绝不回显
syncCfg = { ok: true, bound: true, bindState: 'ready', fetch: true, config: bindResult.config }
await click(btnText('⟳ 刷新'), 'back to bound')
tree = await renderAll()
assert.ok(btnText('解绑（只清本机）'), '已就绪态应有解绑按钮')
syncCfg = { ok: true, bound: false, bindState: 'unbound', fetch: true, config: {} }
rpc.length = 0
await click(btnText('解绑（只清本机）'), 'unbind')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncUnbind'), '未触发 syncUnbind')
assert.ok(bodyText().indexOf('未绑定') >= 0, '解绑后应回到未绑定')
const patBox = await getPatBox()
assert.ok(patBox, '未绑定态展开高级后应有 PAT 输入框')
await input(patBox, 'github_pat_SUPERSECRET_123456')
tree = await renderAll()
bindResult = { ok: true, bound: true, config: { auth: { account: 'tester', tokenHint: '••••3456' }, repo: { fullName: 'tester/dsh-study-sync', branch: 'main' } } }
syncCfg = { ok: true, bound: true, bindState: 'ready', fetch: true, config: bindResult.config }
await click(btnText('用 PAT 绑定'), 'bind pat')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncBindPat' && c[1].token === 'github_pat_SUPERSECRET_123456'), 'PAT 绑定参数不对')
assert.ok(bodyText().indexOf('已就绪') >= 0, 'PAT 绑定后应显示已就绪')
assert.ok(bodyText().indexOf('github_pat_SUPERSECRET_123456') < 0, '红线：token 明文不得出现在面板')
assert.ok(bodyText().indexOf('••••3456') >= 0, '应只显示 tokenHint 末四位')
ok('解绑→PAT 重绑成功；token 明文不出现在界面，只显示 ••••末四位')

// (7b) 固定仓已被本账号占用：不硬拒，面板给「接管 / 放弃」两路（token 只存本机、不明文回显）
syncCfg = { ok: true, bound: false, bindState: 'unbound', fetch: true, config: {} }
await click(btnText('⟳ 刷新'), 'reload unbound for takeover')
tree = await renderAll()
rpc.length = 0
const patBox2 = await getPatBox()
assert.ok(patBox2, '占用场景起点应是未绑定 + PAT 输入框')
await input(patBox2, 'github_pat_OCCUPIED_9999')
tree = await renderAll()
bindResult = { ok: false, needTakeOver: true, bound: false, bindState: 'account-only', error: '账号 tester 下 dsh-study-sync 已存在，但已有内容没有学习区的认领标记。确认这是你自己的仓库后可接管……' }
syncCfg = { ok: true, bound: false, bindState: 'account-only', fetch: true, config: { auth: { account: 'tester', tokenHint: '••••9999' } } }
await click(btnText('用 PAT 绑定'), 'bind occupied')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncBindPat'), '占用态应先发起 PAT 绑定')
const tkBtn = btnText('接管这个已有仓库')
assert.ok(tkBtn, 'account-only 应给出「接管这个已有仓库」入口')
assert.ok(bodyText().indexOf('认领标记') >= 0, '占用应显示认领标记相关说明')
assert.ok(bodyText().indexOf('github_pat_OCCUPIED_9999') < 0, '红线：占用态也不回显 token 明文')
takeOverResult = { ok: true, bound: true, config: { auth: { account: 'tester', tokenHint: '••••9999' }, repo: { fullName: 'tester/dsh-study-sync', branch: 'main' } } }
syncCfg = { ok: true, bound: true, bindState: 'ready', fetch: true, config: takeOverResult.config }
await click(tkBtn, 'take over')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncTakeOver'), '点接管应调用 study.syncTakeOver')
assert.ok(bodyText().indexOf('已就绪') >= 0 && bodyText().indexOf('tester/dsh-study-sync') >= 0, '接管后应显示已就绪 + 仓库')
// 放弃 = 清提示并只清本机（换账号/先改名的出路）
syncCfg = { ok: true, bound: false, bindState: 'account-only', fetch: true, config: { auth: { account: 'tester', tokenHint: '••••9999' } } }
await click(btnText('⟳ 刷新'), 'reload account-only for cancel')
tree = await renderAll()
const cancelBtn = btnText('放弃')
assert.ok(cancelBtn, 'account-only 也应给「放弃」出口')
await click(cancelBtn, 'cancel takeover')
tree = await renderAll()
assert.ok(rpc.some((c) => c[0] === 'syncUnbind'), '放弃应触发解绑（只清本机）')
ok('固定仓被本账号占用：面板给「接管/放弃」两路，接管复用已存 token 且不明文回显')

// (8) 无 fetch 降级：只报同步不可用，不抛
syncCfg = { ok: true, bound: false, bindState: 'unbound', fetch: false, oneClick: true, config: {} }
await click(btnText('⟳ 刷新'), 'reload cfg nofetch')
tree = await renderAll()
assert.ok(bodyText().indexOf('无 fetch') >= 0, '无 fetch 应给出降级提示')
assert.ok(btnText('一键登录').props.disabled === true, '无 fetch 时一键授权按钮应禁用')
ok('宿主无 fetch：面板降级提示同步不可用，授权按钮禁用而非抛错')

// ── 网页课程源（v0.8.0）：URL 输入→抓取发起→进度→预览→确认调研→重抓/失败→⚡ 一次性生成三态 ──
const crawlInputIn = (title) => rowRange(title).find((e) => e.type === 'input' && String((e.props || {}).placeholder || '').indexOf('docs.example.com') >= 0)
const hasRpc = (name, args) => rpc.some((c) => c[0] === name && JSON.stringify(c[1]) === JSON.stringify(args))
// M5 用例结束时面板停在 sync 视图，先回目标列表
{ const back = btnText('← 返回目标列表'); if (back) await click(back, 'back to list before web-course') }

// (1) 未抓取的目标：展开后给 URL 输入框 + 「🌐 抓取网页材料」；空地址不发 RPC
rpc.length = 0
listGoals = [webNoneRow]
await click(hdrBtn('刷新'), 'refresh web-none')
tree = await renderAll()
await expand('网页课未抓')
assert.ok(crawlInputIn('网页课未抓'), '未抓取目标应有网页地址输入框')
assert.ok(String(crawlInputIn('网页课未抓').props.placeholder).indexOf('同域内链自动抓一层') >= 0, '输入框应说明同域一层/30 页上限')
assert.ok(bodyText().indexOf('🌐 抓取网页材料') >= 0, '缺少「🌐 抓取网页材料」按钮')
assert.ok(bodyText().indexOf('之后「开始调研」将基于材料一次性规划') >= 0, '缺少白话说明')
await click(btnIn('网页课未抓', '🌐 抓取网页材料'), 'crawl with empty url')
assert.ok(!rpc.some((c) => c[0] === 'startCrawl'), '空 URL 不该发起 study.startCrawl')
tree = await renderAll()
assert.ok(bodyText().indexOf('请先填写网页地址') >= 0, '空 URL 应有白话提示')
ok('网页课程源：未抓取目标给 URL 入口，空地址拦在本地不发 RPC')

// (2) 填地址 → 抓取派发 + 自动拉预览
await click(hdrBtn('刷新'), 'retry web-none')   // 清掉上一条红字
tree = await renderAll()
await input(crawlInputIn('网页课未抓'), '  https://docs.demo.io/guide/  ')
tree = await renderAll()   // 重渲染让按钮闭包看到新的 crawlInputs
rpc.length = 0
await click(btnIn('网页课未抓', '🌐 抓取网页材料'), 'crawl start')
assert.ok(hasRpc('startCrawl', { goalId: 'goal-web-none', url: 'https://docs.demo.io/guide/' }), 'startCrawl 参数不对（应 trim）：' + JSON.stringify(rpc))
assert.ok(hasRpc('crawlPreview', { goalId: 'goal-web-none' }), '发起成功后应立即拉一次 getCrawlPreview')
ok('网页课程源：「🌐 抓取网页材料」→ study.startCrawl(trim 后 URL)，成功后拉预览')

// (3) 抓取中：行 chip「抓取网页中…」+ 进度行 + 明细页（running 目标的预览由 3s 轮询自动拉）
rpc.length = 0
listGoals = [webRunRow]
await click(hdrBtn('刷新'), 'refresh web-run')
tree = await renderAll()
assert.ok(textOf(rowRange('网页课抓取中')[0]).indexOf('抓取网页中…') >= 0, 'crawling 行 chip 应为「抓取网页中…」')
assert.ok(hasRpc('crawlPreview', { goalId: 'goal-web-run' }), '抓取中的目标应自动拉 getCrawlPreview')
await expand('网页课抓取中')
assert.ok(bodyText().indexOf('🌐 正在抓取网页材料…（2 页成功 / 0 失败 / 1 跳过，共访问 3）') >= 0, '抓取进度行缺失: ' + bodyText().slice(0, 300))
assert.ok(bodyText().indexOf('✓ 指南首页') >= 0 && bodyText().indexOf('⤳ 跳过 https://other.site/x（跨域链接）') >= 0, '未渲染逐页明细（无标题页应显 URL+原因）')
assert.ok(!crawlInputIn('网页课抓取中'), '抓取中不该再给 URL 输入/重复发起入口')
ok('网页课程源：crawling 态 = chip + 成功/失败/跳过进度行 + 逐页明细，且无重复抓取入口')

// (4) 材料就绪：预览清单 + ⚠低正文提示 + 「✅ 确认材料 → ▶ 开始调研」+「🔁 重抓」
rpc.length = 0
listGoals = [webDoneRow]
await click(hdrBtn('刷新'), 'refresh web-done')
tree = await renderAll()
await expand('网页课材料就绪')
assert.ok(bodyText().indexOf('🌐 网页材料 3 页已就绪（跳过 1） · 来源 https://docs.demo.io/guide/') >= 0, '材料就绪摘要缺失: ' + bodyText().slice(0, 300))
assert.ok(bodyText().indexOf('有页面正文过少') >= 0, '应提示疑似 JS 渲染页')
assert.ok(bodyText().indexOf('✓ 第 2 章（66 字 ⚠过少）') >= 0, '逐页明细应带字数与 ⚠过少')
assert.ok(btnIn('网页课材料就绪', '✅ 确认材料 → ▶ 开始调研'), 'researching 且未派发时应给「✅ 确认材料 → ▶ 开始调研」')
assert.ok(btnIn('网页课材料就绪', '🔁 重抓'), '缺少「🔁 重抓」')
rpc.length = 0
await click(btnIn('网页课材料就绪', '✅ 确认材料 → ▶ 开始调研'), 'confirm research')
assert.ok(hasRpc('dispatch', { goalId: 'goal-web-done' }), '确认材料应派发调研（复用存活会话，不重建）')
assert.ok(!rpc.some((c) => c[0] === 'record'), '目标会话仍在镜像时不该重建')
ok('网页课程源：材料就绪态渲染清单/低正文警告，「✅ 确认材料 → ▶ 开始调研」直派 dispatchResearch')

// (5) 抓取失败：错误行 + 「🔁 重新抓取」+「⟳ 刷新明细」按需重拉
listGoals = [webFailRow]
await click(hdrBtn('刷新'), 'refresh web-fail')
tree = await renderAll()
await expand('网页课抓取失败')
assert.ok(bodyText().indexOf('⚠ 抓取失败：全部页面抓取失败（站点不可达）') >= 0, '失败态文案缺失: ' + bodyText().slice(0, 300))
assert.ok(btnIn('网页课抓取失败', '🔁 重新抓取') && btnIn('网页课抓取失败', '⟳ 刷新明细'), '失败态应有重抓与刷新明细按钮')
rpc.length = 0
await click(btnIn('网页课抓取失败', '⟳ 刷新明细'), 'refresh detail')
assert.ok(hasRpc('crawlPreview', { goalId: 'goal-web-fail' }), '「⟳ 刷新明细」应重拉 getCrawlPreview')
ok('网页课程源：失败态显示宿主 error + 「🔁 重新抓取」/「⟳ 刷新明细」')

// (6) ⚡ 有「待生成」章：按钮报章数，只派发默认模式（不带 regenerate）——用户定的：一次生成只碰待生成章
crawlStartResult = { ok: true, startUrl: 'https://docs.demo.io/guide/' }
genAllResult = { ok: true, chapters: 2, indices: [2, 3] }
rpc.length = 0
listGoals = [genMixedRow]
await click(hdrBtn('刷新'), 'refresh gen-mixed')
tree = await renderAll()
await expand('批量部分待生成')
assert.ok(btnIn('批量部分待生成', '⚡ 一次性生成全部讲义（2 章）'), '部分就绪时按钮应只报「待生成」章数: ' + rowRange('批量部分待生成').filter((e) => e.type === 'button').map(textOf).join('|'))
assert.ok(!btnIn('批量部分待生成', '⚡ 重新生成全部讲义'), '有待生成章时不该出现「重新生成」')
rpc.length = 0
await click(btnIn('批量部分待生成', '⚡ 一次性生成全部讲义（2 章）'), 'gen all mixed')
assert.ok(hasRpc('generateAll', { goalId: 'goal-gen-mixed' }), '默认派发不应带 regenerate：' + JSON.stringify(rpc))
tree = await renderAll()
assert.ok(bodyText().indexOf('⚡ 一次性生成已派发（2 章）') >= 0, '成功后缺提示')
ok('⚡ 一次性生成：只派发「待生成」章（3 章里 1 已就绪 → 按钮显示 2 章），调用不带 regenerate')

// (7) 全部讲义就绪：同一位置变「⚡ 重新生成全部讲义」，派发带 regenerate=true
genAllResult = { ok: true, chapters: 2, indices: [1, 2], regenerate: true }
listGoals = [genReadyRow]
await click(hdrBtn('刷新'), 'refresh gen-ready')
tree = await renderAll()
await expand('批量全部就绪')
assert.ok(btnIn('批量全部就绪', '⚡ 重新生成全部讲义'), '全部就绪时应变「⚡ 重新生成全部讲义」: ' + rowRange('批量全部就绪').filter((e) => e.type === 'button').map(textOf).join('|'))
rpc.length = 0
await click(btnIn('批量全部就绪', '⚡ 重新生成全部讲义'), 'regen all')
assert.ok(hasRpc('generateAll', { goalId: 'goal-gen-ready', regenerate: true }), '重新生成必须带 regenerate=true：' + JSON.stringify(rpc))
tree = await renderAll()
assert.ok(bodyText().indexOf('⚡ 一次性重新生成已派发（2 章）') >= 0, '重新生成缺提示')
ok('⚡ 全部就绪 ⇒ 同键变「⚡ 重新生成全部讲义」，派发 regenerate=true')

// (8) 有章节生成中：⚡ 入口收起，只给等待说明（既不重复派发也不覆盖）
listGoals = [genBusyRow]
await click(hdrBtn('刷新'), 'refresh gen-busy')
tree = await renderAll()
await expand('批量有生成中')
assert.ok(bodyText().indexOf('⚡ 有章节正在生成中') >= 0, '生成中应给等待说明')
assert.ok(!rowRange('批量有生成中').some((e) => e.type === 'button' && textOf(e).indexOf('⚡') >= 0), '生成中不该出现 ⚡ 派发按钮')
ok('⚡ 有章生成中：收起派发按钮，只提示等待完成')

console.log('\nclient.test: ' + n + ' 断言全部通过')
