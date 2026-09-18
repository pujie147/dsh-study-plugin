// smoke.mjs — 宿主半运行时冒烟测试（纯 Node）
// 运行: node study-plugin/test/smoke.mjs
// 覆盖: 路由守卫(GET；来源不判定 ⇒ 非回环必须可达)、study.* 全链路(list→create→草案采纳→批准→讲义采纳→章节会话注入→删除)、
//       unknown method、M4 导出/导入、**M4.1 覆盖式同步语义**（身份重发/幂等/快进追加/回退需 force/
//       归档继承防护/工作区投影自检/回滚不留空目录）。
//
// 关键：会话存储与工作区注册表用**宿主真实实现**（test/host-fixture.mjs），只假一个内存 storageDomain。
// 上一版这里用我自己写的宽松 mock（attach 永远成功、列表从盘上现读），结果 96 条断言全绿却漏掉了
// 「导入保留源 session id ⇒ 宿主 list() 抛 duplicate / 继承归档态 ⇒ 会话看不见」这个真 bug。
import { EventEmitter } from 'node:events'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as P from '../lib/portable.js'
import { createHostServices } from './host-fixture.mjs'
import { apply } from '../lib/index.js'

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')) }
}

// ── 基础设施 ─────────────────────────────────────────────────────────────────
const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'study-smoke-'))
const injected = []
const flushed = []
const routes = {}
const effects = []
const registeredTools = []

const sessRoot = path.join(tmpRoot, '_sessions')
await fsp.mkdir(sessRoot, { recursive: true })
const live = []                       // 每项 {id, header:{id,cwd}} —— 用于「该会话正被打开」的硬冲突
const sessionsSvc = {
  list: () => live,
  get: (id) => live.find((s) => s.id === id),
  flush: async (s) => { flushed.push(s.id) },
}
const H = await createHostServices({ sessionsRoot: sessRoot, sessions: sessionsSvc })
if (!H) {
  console.error('FAIL: 取不到宿主真实实现（@deepseek-ai/dsh-session-persistence-jsonl / dsh-workspace）。\n' +
    '      这条测试的前提就是跑宿主代码；请确认本机装了 DSH（或 profile 里有这两个包）。')
  process.exit(1)
}
console.log('  \u00b7 ctx.sessions = ' + (H.usingRealSessionStore ? '宿主真实 SessionStore（会跑 Session.fromRestore 的 surface 校验）' : '最小 stub（拿不到宿主 dsh-session）'))
const mockPersistence = H.persistence
const wsRegistryReal = H.registry

// 附件存储根（模拟 ~/.dsh/attachments/v1，内容寻址）
const attachRoot = path.join(tmpRoot, '_attachments', 'objects')
const mockAttachments = {
  async readImage(ref) {
    const sha = String(ref.attachmentId || '').replace(/^sha256:/, '')
    return { data: await fsp.readFile(path.join(attachRoot, sha.slice(0, 2), sha)) }
  },
  async saveImage(input) {
    const sha = createHash('sha256').update(Buffer.from(input.data)).digest('hex')
    const dir = path.join(attachRoot, sha.slice(0, 2))
    await fsp.mkdir(dir, { recursive: true })
    await fsp.writeFile(path.join(dir, sha), Buffer.from(input.data))
    return { attachmentId: 'sha256:' + sha, mediaType: input.mediaType }
  }
}
/** index.json 里的目标行（多条断言共用）。 */
const readIndexGoals = async () => { try { return (JSON.parse(await fsp.readFile(path.join(tmpRoot, 'index.json'), 'utf8')).goals) || [] } catch { return [] } }
/** 会话在项目目录下的位置（不自己复刻 projectKey，走真 locate）。 */
const projectDirOf = (cwd) => path.dirname(path.dirname(mockPersistence.locate({ cwd, id: 'probe-x' }).path))
const ctx = {
  inject: (names, fn) => {
    const scope = {
      effect: (fn2, label) => { const d = fn2(); effects.push({ label, d }); return d },
      webServer: {
        register: (route) => { routes[route.path] = route; return () => { delete routes[route.path] } }
      },
      tools: {
        register: (def) => { registeredTools.push(def); return () => { const i = registeredTools.indexOf(def); if (i >= 0) registeredTools.splice(i, 1) } }
      },
      agents: { get: (id) => ({ followup: (msg) => { injected.push({ id, msg }) } }) },
      workspaceRegistry: wsRegistryReal,
      sessionPersistence: mockPersistence,
      sessions: sessionsSvc,
      attachments: mockAttachments
    }
    for (const n of names) if (scope[n] === undefined) throw new Error('unexpected service: ' + n)
    fn(scope)
  }
}
apply(ctx, { workRoot: tmpRoot })
const rpcRoute = routes['/study-rpc']
const fileRoute = routes['/study-export']
const pageRoute = routes['/study-file']
if (!rpcRoute) { console.error('FAIL: /study-rpc 路由未注册'); process.exit(1) }
check('路由已注册', rpcRoute.kind === 'prefix' && rpcRoute.path === '/study-rpc')
check('下载路由已注册', !!fileRoute && fileRoute.path === '/study-export' && fileRoute.kind === 'prefix')
check('讲义页路由已注册', !!pageRoute && pageRoute.path === '/study-file' && pageRoute.kind === 'prefix')

function callRpc(method, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      code: 0, body: '', headers: null,
      writeHead(code, h) { this.code = code; this.headers = h || null },
      end(b) {
        this.body = b == null ? '' : b
        let json = null
        try { json = JSON.parse(this.body) } catch {}
        resolve({ code: this.code, json, text: this.body, headers: this.headers, raw: this.body })
      }
    }
    const req = new EventEmitter()
    req.method = opts.method || 'POST'
    req.socket = { remoteAddress: opts.remote || '127.0.0.1' }
    setImmediate(() => {
      if (req.method === 'POST') req.emit('data', JSON.stringify({ method, args: args || {} }))
      req.emit('end')
    })
    try { rpcRoute.handler(req, res) } catch (e) { reject(e) }
  })
}

function callFile(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      code: 0, body: '', headers: null,
      writeHead(code, h) { this.code = code; this.headers = h || null },
      end(b) { resolve({ code: this.code, headers: this.headers, raw: b == null ? Buffer.alloc(0) : Buffer.from(b) }) }
    }
    const req = { method: opts.method || 'GET', url, socket: { remoteAddress: opts.remote || '127.0.0.1' } }
    try { fileRoute.handler(req, res) } catch (e) { reject(e) }
  })
}

function callPage(url, opts = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      code: 0, body: '', headers: null,
      writeHead(code, h) { this.code = code; this.headers = h || null },
      end(b) { resolve({ code: this.code, headers: this.headers, text: b == null ? '' : String(b) }) }
    }
    const req = { method: opts.method || 'GET', url, socket: { remoteAddress: opts.remote || '127.0.0.1' } }
    try { pageRoute.handler(req, res) } catch (e) { reject(e) }
  })
}

// ── 路由守卫（只守方法与 body 大小，不守来源） ──────────────────────────────
{
  const r = await callRpc('study.list', {}, { method: 'GET' })
  check('GET 被拒(405)', r.code === 405, r.code)
  const r2 = await callRpc('study.list', {}, { remote: '10.0.0.5' })
  check('非回环来源放行(局域网可达)', r2.code === 200 && r2.json && Array.isArray(r2.json.goals), r2.code)
  const r3 = await callRpc('study.nope', {})
  check('unknown method → {ok:false}', r3.json && r3.json.ok === false && /unknown method/.test(r3.json.error), r3.json)
}

// ── 全链路 ───────────────────────────────────────────────────────────────────
let exportedFile = ''
let exportedGoalId = ''
{
  const r0 = await callRpc('study.list', {})
  check('初始 list 为空', r0.json && r0.json.ok !== false && Array.isArray(r0.json.goals) && r0.json.goals.length === 0, r0.json)

  const r1 = await callRpc('study.createGoal', { topic: 'Transformer 基础', target_level: '能读懂论文', requirements: '中文讲义' })
  check('createGoal ok', r1.json && r1.json.ok === true && String(r1.json.goalId).startsWith('goal-'), r1.json)
  const goalId = r1.json.goalId
  const wsIdOfGoal = String(r1.json.workspaceId || '')
  check('workspaceId 来自真注册表（uuid 形态、可在 registry.get 拿回）', /^[0-9a-f-]{36}$/.test(wsIdOfGoal) && !!wsRegistryReal.get(wsIdOfGoal), r1.json)

  const r2 = await callRpc('study.list', {})
  const g0 = r2.json.goals[0]
  check('list 含新目标(researching)', g0 && g0.status === 'researching' && g0.title === 'Transformer 基础', g0)
  check('list 含 path/workspaceId/sessionId 字段', typeof g0.path === 'string' && g0.workspaceId === wsIdOfGoal, g0)

  // 注入目标会话 → startResearch
  const r3 = await callRpc('study.startResearch', { goalId, sessionId: 'sess-goal-1' })
  check('startResearch ok', r3.json && r3.json.ok === true, r3.json)
  check('调研指令已注入会话', injected.length === 1 && injected[0].id === 'sess-goal-1' && /课程规划 AI/.test(injected[0].msg.content[0].text), injected)
  const gDisp = (await callRpc('study.list', {})).json.goals.find((g) => g.id === goalId)
  check('startResearch 记录「已派发」事实(researchDispatched + 时间)', gDisp.researchDispatched === true && typeof gDisp.researchDispatchedAt === 'string', gDisp)

  // recordGoalSession：面板「打开会话」重建目标会话后的回写口
  const rgs = await callRpc('study.recordGoalSession', { goalId, sessionId: 'sess-goal-9' })
  check('recordGoalSession ok', rgs.json && rgs.json.ok === true && rgs.json.sessionId === 'sess-goal-9', rgs.json)
  check('recordGoalSession 缺 sessionId → error', (await callRpc('study.recordGoalSession', { goalId, sessionId: '' })).json.ok === false)
  check('recordGoalSession 目标不存在 → error', /目标不存在/.test((await callRpc('study.recordGoalSession', { goalId: 'nope', sessionId: 'x' })).json.error || ''))
  await callRpc('study.recordGoalSession', { goalId, sessionId: 'sess-goal-1' })

  // 写 draft.json → 轮询采纳 → draft_pending
  const draftAbs = path.join(tmpRoot, goalId, 'draft.json')
  await fsp.writeFile(draftAbs, JSON.stringify({
    course: 'Transformer 入门', overview: '从注意力到完整架构',
    chapters: [
      { title: '注意力机制', summary: 'QKV 与缩放点积', est_hours: 0.3, focus_points: ['QKV', '缩放'] },
      { title: '位置编码' }
    ]
  }))
  const r4 = await callRpc('study.list', {})
  const g1 = r4.json.goals.find((g) => g.id === goalId)
  check('草案采纳 → draft_pending', g1.status === 'draft_pending', g1.status)
  check('草案章节规范化(index/est_hours 下限/缺失字段)', g1.draft.chapters[0].index === 1 && g1.draft.chapters[0].est_hours === 0.5 && g1.draft.chapters[1].title === '位置编码' && g1.draft.chapters[1].est_hours === null && g1.draft.chapters[1].focus_points.length === 0, g1.draft && g1.draft.chapters)

  // 批准
  const r5 = await callRpc('study.approveDraft', { goalId })
  check('approveDraft ok(chapters:2)', r5.json && r5.json.ok === true && r5.json.chapters === 2, r5.json)
  const gj = JSON.parse(await fsp.readFile(path.join(tmpRoot, goalId, 'goal.json'), 'utf8'))
  check('goal.json 章节文件命名 01-slug.md', gj.chapters[0].file === '01-attention-mechanism.md' || /^01-[^/]+\.md$/.test(gj.chapters[0].file), gj.chapters[0].file)

  // 写讲义 → 轮询采纳 → active/ready
  const chAbs = path.join(tmpRoot, goalId, 'chapters', gj.chapters[0].file)
  await fsp.mkdir(path.dirname(chAbs), { recursive: true })
  await fsp.writeFile(chAbs, '# 注意力机制\n' + '内容'.repeat(300))
  // 讲义回写补充目录（NN-notes/）+ 一个会话 AI 写在目标目录里的代码文件 → 都应进包
  const notesDir = path.join(tmpRoot, goalId, 'chapters', '01-notes')
  await fsp.mkdir(notesDir, { recursive: true })
  await fsp.writeFile(path.join(notesDir, '梯度消失.md'), '# 梯度消失\n详细补充内容')
  await fsp.writeFile(path.join(tmpRoot, goalId, 'chapters', '01-qa.md'), '# 问答要点\n- Q: 为何缩放')
  await fsp.writeFile(path.join(tmpRoot, goalId, 'demo.py'), 'print("会话 AI 在目标工作区里写的代码")')
  const r6 = await callRpc('study.list', {})
  const g2 = r6.json.goals.find((g) => g.id === goalId)
  check('讲义采纳 → ready + 目标 active', g2.chapters[0].status === 'ready' && g2.status === 'active', { ch: g2.chapters[0].status, goal: g2.status })

  // 章节会话记录 + 开始学习
  const r7 = await callRpc('study.recordChapterSession', { goalId, chapter_index: 1, sessionId: 'sess-ch-1' })
  check('recordChapterSession ok', r7.json && r7.json.ok === true, r7.json)
  const r8 = await callRpc('study.startChapter', { goalId, chapter_index: 1, sessionId: 'sess-ch-1' })
  check('startChapter ok', r8.json && r8.json.ok === true, r8.json)
  check('教练指令已注入(含回写机制)', injected.some((m) => m.id === 'sess-ch-1' && /学习教练/.test(m.msg.content[0].text) && /回写/.test(m.msg.content[0].text)), injected)

  // continueChapter 对已就绪章节 → ready 短路
  const r9 = await callRpc('study.continueChapter', { goalId, chapter_index: 1 })
  check('continueChapter(已就绪) → ready 短路', r9.json && r9.json.ok === true && r9.json.result === 'ready', r9.json)

  // readChapter：面板「打开讲义」的数据口（正文 + 绝对路径）
  const rc1 = await callRpc('study.readChapter', { goalId, chapter_index: 1 })
  check('readChapter ok(正文+路径+标题)', rc1.json && rc1.json.ok === true && /注意力机制/.test(rc1.json.content) && String(rc1.json.filePath).indexOf('chapters/' + gj.chapters[0].file) > 0 && rc1.json.title === gj.chapters[0].title, rc1.json && { ok: rc1.json.ok, len: (rc1.json.content || '').length })
  check('readChapter 目标不存在 → error', (await callRpc('study.readChapter', { goalId: 'goal-none', chapter_index: 1 })).json.ok === false)
  check('readChapter 章节不存在 → error', (await callRpc('study.readChapter', { goalId, chapter_index: 99 })).json.ok === false)

  // /study-file：面板新标签兜底页（只认 goalId+chapter，路径由 goal.json 反查）
  const pageUrl = '/study-file?goalId=' + encodeURIComponent(goalId) + '&chapter=1'
  const original = await fsp.readFile(chAbs)
  try {
    await fsp.appendFile(chAbs, '\n<script>alert(1)</script> & "quoted"\n')
    const p1 = await callPage(pageUrl)
    check('讲义页 200 + html content-type', p1.code === 200 && /text\/html/.test(String(p1.headers && p1.headers['content-type'])), { code: p1.code, headers: p1.headers })
    check('讲义页 CSP 锁死外部资源', String(p1.headers && p1.headers['content-security-policy']).indexOf("default-src 'none'") === 0 && String(p1.headers && p1.headers['x-content-type-options']) === 'nosniff', p1.headers)
    check('讲义页把正文转义后渲染（不执行注入）', p1.text.indexOf('<script>alert(1)</script>') < 0 && p1.text.indexOf('&lt;script&gt;') >= 0 && p1.text.indexOf('&amp; &quot;quoted&quot;') >= 0, p1.text.slice(-260))
    check('讲义页渲染出标题与路径回显', p1.text.indexOf('<h1>注意力机制</h1>') >= 0 && p1.text.indexOf(gj.chapters[0].file) > 0, p1.text.slice(0, 300))
    const praw = await callPage(pageUrl + '&format=raw')
    check('讲义页 format=raw 原样返回 markdown', praw.code === 200 && /text\/markdown/.test(String(praw.headers && praw.headers['content-type'])) && praw.text === original.toString('utf8') + '\n<script>alert(1)</script> & "quoted"\n', { code: praw.code, len: praw.text.length })
  } finally {
    await fsp.writeFile(chAbs, original)
  }
  check('讲义页缺 chapter 参数 → 400', (await callPage('/study-file?goalId=' + encodeURIComponent(goalId))).code === 400)
  check('讲义页 chapter 非数字 → 400', (await callPage('/study-file?goalId=x&chapter=../../etc/passwd')).code === 400)
  check('讲义页未知目标 → 404', (await callPage('/study-file?goalId=nope&chapter=1')).code === 404)
  check('讲义页讲义未生成 → 404', (await callPage('/study-file?goalId=' + encodeURIComponent(goalId) + '&chapter=2')).code === 404)
  check('讲义页拒绝非 GET', (await callPage(pageUrl, { method: 'POST' })).code === 405)

  // ── M4 前置：用真 locate 造出该目标的会话 transcript（目标会话 + 章节会话 + 空 subagent 会话）
  const goalAbsDir = path.join(tmpRoot, goalId)
  const ev = (type, seq, data, extra) => JSON.stringify(Object.assign({ type, seq, time: 1788000100000 + seq, data }, extra || {}))
  async function makeSession(sid, cwd, rows) {
    const abs = mockPersistence.locate({ cwd, id: sid }).path
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const lines = [JSON.stringify({ type: 'session', version: 0, id: sid, createdAt: 1788000000000, cwd, delegationDepth: 0, agentPreset: 'standard' }), ...rows]
    await fsp.writeFile(abs, await P.jsonlToZstdFrames(lines.join('\n') + '\n', 2))
    return abs
  }
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' + '0'.repeat(40), 'hex')
  const pngRef = await mockAttachments.saveImage({ data: new Uint8Array(pngBytes), mediaType: 'image/png' })
  await makeSession('sess-goal-1', goalAbsDir, [
    ev('turn/start', 0, { turn: 1 }),
    ev('session/title', 1, { title: 'Transformer 课程规划草案', messageSeqs: [2], source: { kind: 'llm' } }),
    ev('user/message', 2, { id: 'u1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '请调研并写 ' + goalAbsDir.replace(/\\/g, '/') + '/draft.json' }] }, { surfaceOp: 'append' }),
    ev('turn/end', 3, { turn: 1, reason: { kind: 'completed' } }),
  ])
  await makeSession('sess-ch-1', goalAbsDir, [
    ev('turn/start', 0, { turn: 1 }),
    ev('user/message', 1, { id: 'u2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '看这张图' }, { type: 'image', attachment: { attachmentId: pngRef.attachmentId, mediaType: 'image/png' } }] }, { surfaceOp: 'append' }),
    ev('turn/end', 2, { turn: 1, reason: { kind: 'completed' } }),
  ])
  await makeSession('sess-sub-1', goalAbsDir, [
    ev('user/message', 0, { id: 'u3', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '子代理任务' }] }, { surfaceOp: 'append' }),
  ])
  // 另一个目标工作区里混进的无关会话（同 sessRoot、不同项目目录）——不得被带走
  await makeSession('sess-other', path.join(tmpRoot, 'other-goal'), [ev('turn/start', 0, { turn: 1 }), ev('turn/end', 1, { turn: 1, reason: { kind: 'completed' } })])
  for (const sid of ['sess-goal-1', 'sess-ch-1', 'sess-sub-1']) {
    const v = await mockPersistence.inspect(sid)
    if (!v || !v.meta) throw new Error('测试前置数据未被宿主认账: ' + sid)
  }
  const rowsOf = async (sid, cwd) => { try { return P.analyzeTranscript(await fsp.readFile(mockPersistence.locate({ cwd, id: sid }).path)).lines.length } catch { return -1 } }
  const projectionOf = async (dir) => { const w = await wsRegistryReal.resolveByPath(dir).catch(() => undefined); return w ? w.sessionIds.map(String) : [] }
  const emptySessionDirs = async () => {
    const out = []
    for (const pr of await fsp.readdir(sessRoot, { withFileTypes: true }).catch(() => [])) {
      if (!pr.isDirectory()) continue
      for (const sd of await fsp.readdir(path.join(sessRoot, pr.name), { withFileTypes: true })) {
        if (sd.isDirectory() && !(await fsp.readdir(path.join(sessRoot, pr.name, sd.name))).length) out.push(pr.name + '/' + sd.name)
      }
    }
    return out
  }

  // ── P1 导出（含 v2 清单与导出卫生） ────────────────────────────────────────
  const rE = await callRpc('study.exportGoal', { goalId })
  check('exportGoal ok', rE.json && rE.json.ok === true && /\.zip$/.test(rE.json.file), rE.json)
  check('导出包落在 exports/', rE.json && path.dirname(rE.json.path).endsWith('exports') && !!(await fsp.stat(rE.json.path).catch(() => undefined)), rE.json && rE.json.path)
  exportedFile = rE.json.file
  exportedGoalId = goalId
  check('导出含 3 个会话（含 subagent、排除别的工作区会话）', rE.json.counts.sessions === 3, rE.json.counts)
  check('导出含 1 个附件对象', rE.json.counts.attachments === 1, rE.json.counts)
  const zipBuf = await fsp.readFile(rE.json.path)
  const zentries = P.readZip(zipBuf)
  const man = P.readJsonEntry(zentries, 'manifest.json')
  check('manifest formatVersion=2 / kind', man.formatVersion === 2 && man.kind === 'study-goal-export', { v: man.formatVersion, k: man.kind })
  check('包内条目名唯一（每份 transcript 只存一遍）', new Set(man.files.map((f) => f.name)).size === man.files.length, man.files.map((f) => f.name))
  check('导出带 deviceId 与 sync.remoteGoalId', typeof man.deviceId === 'string' && !!man.deviceId && man.sync.remoteGoalId === goalId, man.deviceId && man.sync)
  const sRec = man.sessions.find((s) => s.id === 'sess-ch-1')
  check('会话按逐字节原文入包（zstd 帧、header 保留源 cwd）', !!sRec && sRec.encoding === 'zstd' && sRec.frames >= 2 && P.normPath(sRec.cwd) === P.normPath(goalAbsDir), sRec)
  check('v2 会话带稳定身份与 seq/行数/blank', sRec.remoteId === 'sess-ch-1' && sRec.rows === 3 && sRec.maxSeq === 2 && typeof sRec.lastTime === 'number' && sRec.blank === false, sRec && { r: sRec.remoteId, rows: sRec.rows, seq: sRec.maxSeq, blank: sRec.blank })
  check('空会话被识别为 blank（宿主会隐藏，不是导入丢失）', man.sessions.find((s) => s.id === 'sess-sub-1').blank === true, man.sessions.map((s) => [s.id, s.blank]))
  const wantGoal = ['goal/goal.json', 'goal/draft.json', 'goal/chapters/' + gj.chapters[0].file, 'goal/chapters/01-qa.md', 'goal/chapters/01-notes/梯度消失.md', 'goal/demo.py']
  check('goal 树全部内容入包（讲义/qa/notes/代码/draft/goal.json）', wantGoal.every((n) => zentries.has(n)), wantGoal.filter((n) => !zentries.has(n)))
  check('会话绑定关系被记录(goal/chapter-1/unbound)', man.sessions.map((s) => s.boundTo).sort().join(',') === 'chapter-1,goal,unbound', man.sessions.map((s) => [s.id, s.boundTo]))
  check('附件按内容寻址入包', zentries.has(man.attachments[0].entry) && man.attachments[0].sha256 === pngRef.attachmentId.slice(7), man.attachments)
  check('导出包不含 .mnemon/凭据/缓存等', ![...zentries.keys()].some((k) => /\.mnemon|credentials|settings\.yaml|projcache/.test(k)), [...zentries.keys()])
  check('导出不含设备本地账本 .study-sync.json', ![...zentries.keys()].some((k) => k.endsWith('.study-sync.json')), [...zentries.keys()])
  check('manifest.files 逐条 sha256 与包内一致', man.files.every((f) => P.sha256Hex(zentries.get(f.name)) === f.sha256))
  const srcBody = P.decodeTranscript(zentries.get('sessions/sess-goal-1/transcript.jsonl.zstd')).text
  check('正文按 D2 不改写（源路径作为历史文本原样入包）', /draft\.json/.test(srcBody) && srcBody.indexOf(goalAbsDir.replace(/\\/g, '/')) > 0, srcBody.slice(0, 60))

  // 下载路由
  const d1 = await callFile('/study-export?file=' + encodeURIComponent(exportedFile))
  check('下载 GET 200 + zip 字节一致', d1.code === 200 && Buffer.compare(d1.raw, zipBuf) === 0, d1.code)
  check('下载带 attachment 头', /attachment;/.test((d1.headers || {})['content-disposition'] || ''), d1.headers)
  const dRemote = await callFile('/study-export?file=' + encodeURIComponent(exportedFile), { remote: '10.0.0.9' })
  check('非回环来源可下载(局域网可达)', dRemote.code === 200 && Buffer.compare(dRemote.raw, zipBuf) === 0, dRemote.code)
  check('下载拒绝路径穿越', (await callFile('/study-export?file=..%2F..%2Fetc%2Fpasswd.zip')).code === 400)
  check('下载 404 未知文件', (await callFile('/study-export?file=nope.zip')).code === 404)

  // ── P2 全新机器式恢复：清掉一切 ⇒ 预览 ⇒ 导入 ⇒ 宿主自己的投影认账 ─────────
  await fsp.rm(goalAbsDir, { recursive: true, force: true })
  await fsp.rm(projectDirOf(goalAbsDir), { recursive: true, force: true })
  await fsp.writeFile(path.join(tmpRoot, 'index.json'), JSON.stringify({ goals: [] }, null, 2))
  const insp = await callRpc('study.inspectImport', { path: rE.json.path })
  check('inspectImport 预览 ok 且无冲突', insp.json && insp.json.ok === true && insp.json.canImport === true && insp.json.conflicts.length === 0, insp.json && insp.json.conflicts)
  check('预览给出每条身份与动作', insp.json.plan.sessions.length === 3 && insp.json.plan.sessions.every((x) => x.identity === 'fresh' && x.action === 'create'), insp.json.plan.sessions.map((x) => [x.identity, x.action]))
  check('预览列出会话/附件/章节计数', insp.json.plan.sessionCount === 3 && insp.json.plan.attachments === 1 && insp.json.plan.chapters === 2, insp.json.plan)
  const imp = await callRpc('study.importGoal', { path: rE.json.path, confirm: true })
  check('importGoal ok 且 goalId 沿用包内值', imp.json && imp.json.ok === true && imp.json.goalId === exportedGoalId, imp.json)
  check('导入还原了目标目录树', !!(await fsp.stat(path.join(goalAbsDir, 'goal.json')).catch(() => undefined)) && !!(await fsp.stat(path.join(goalAbsDir, 'demo.py')).catch(() => undefined)), imp.json)
  const proj2 = await projectionOf(goalAbsDir)
  check('宿主工作区投影认账全部 3 条会话（这是"看不看得见"的权威）', proj2.slice().sort().join(',') === 'sess-ch-1,sess-goal-1,sess-sub-1', { projected: proj2, warnings: imp.json.warnings })
  check('导入复用/登记工作区（真注册表 uuid，path 指向目标目录）', /^[0-9a-f-]{36}$/.test(String(imp.json.workspaceId)) && (await wsRegistryReal.get(String(imp.json.workspaceId))).path === await fsp.realpath(goalAbsDir), imp.json.workspaceId)
  const tPath = mockPersistence.locate({ cwd: goalAbsDir, id: 'sess-ch-1' }).path
  const tHdr = P.readSessionHeader(await fsp.readFile(tPath))
  const wsRec = await wsRegistryReal.get(String(imp.json.workspaceId))
  check('header.cwd 用宿主 canonical 形态（realpath，与 workspace.path 逐字相同）', tHdr.cwd === wsRec.path, { hdr: tHdr.cwd, ws: wsRec.path })
  check('导入后会话正文逐行不变、id 不变（本地身份空闲时沿用）', tHdr.id === 'sess-ch-1' && (await rowsOf('sess-ch-1', goalAbsDir)) === 3 && /看这张图/.test(P.decodeTranscript(await fsp.readFile(tPath)).text), tHdr.id)
  const shaPng = pngRef.attachmentId.slice(7)
  const backPng = await fsp.readFile(path.join(attachRoot, shaPng.slice(0, 2), shaPng)).catch(() => undefined)
  check('附件按内容寻址回写，attachmentId 不变（会话引用不悬空）', !!backPng && Buffer.compare(backPng, pngBytes) === 0)
  check('导入自检 = 宿主 inspect() 通过', imp.json.ok === true && imp.json.verified === true, { verified: imp.json.verified })
  const led2 = JSON.parse(await fsp.readFile(path.join(goalAbsDir, '.study-sync.json'), 'utf8'))
  check('写了设备本地身份账本（remoteId↔localId 三条）', led2.remoteGoalId === exportedGoalId && led2.sessions.length === 3 && led2.sessions.every((x) => x.remoteId === x.localId), led2.sessions.map((x) => [x.remoteId, x.localId]))
  check('导入报告哪几条按宿主规则不会单独出现', /不会在工作区里单独出现/.test((imp.json.warnings || []).join(' ')), imp.json.warnings)
  // 往返：从恢复出来的副本再导出一次，稳定身份必须还是原来的
  const rE2 = await callRpc('study.exportGoal', { goalId: exportedGoalId })
  const man2b = P.readJsonEntry(P.readZip(await fsp.readFile(rE2.json.path)), 'manifest.json')
  check('二次导出的 remoteId 保持（账本让身份跨机旅行不漂移）', man2b.sessions.every((s) => s.remoteId === s.id) && man2b.sync.remoteGoalId === exportedGoalId, man2b.sessions.map((s) => [s.id, s.remoteId]))
  await fsp.unlink(path.join(tmpRoot, 'exports', rE2.json.file)).catch(() => {})

  // ── P3 幂等：同一个包再导一次 ⇒ 全 no-op，不新增副本 ──────────────────────
  const impAgain = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'overwrite' })
  check('重复导入同一包 = 幂等 no-op（不再复制一份目标）', impAgain.json && impAgain.json.ok === true && impAgain.json.idempotent === true && impAgain.json.applied.noop === 3, JSON.parse(JSON.stringify(impAgain.json, (k, v) => (k === 'plan' ? undefined : v))))
  check('幂等导入后投影仍是 3 条、目录未翻倍', (await projectionOf(goalAbsDir)).length === 3 && (await readIndexGoals()).length === 1, await readIndexGoals())

  // ── P4 快进 / 回退（尊重宿主 append-only + seq 连续性） ────────────────────
  const gp = mockPersistence.locate({ cwd: goalAbsDir, id: 'sess-goal-1' }).path
  const base = await fsp.readFile(gp)
  const baseRows = P.analyzeTranscript(base).lines.length
  const extra = [ev('turn/start', baseRows, { turn: 2 }), ev('user/message', baseRows + 1, { id: 'u9', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '第二章开始' }] }, { surfaceOp: 'append' }), ev('turn/end', baseRows + 2, { turn: 2, reason: { kind: 'completed' } })]
  await fsp.writeFile(gp, (await P.appendLinesToTranscript(base, extra)).bytes)
  check('本地会话被追加过（模拟"这边又学了"）', (await rowsOf('sess-goal-1', goalAbsDir)) === baseRows + 3, await rowsOf('sess-goal-1', goalAbsDir))
  const rEExt = await callRpc('study.exportGoal', { goalId: exportedGoalId })
  const zipExtPath = rEExt.json.path
  // 旧包覆盖新本地 ⇒ 回退：不带 force 必须被挡
  const rewind = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'overwrite' })
  check('包比本地旧 ⇒ 无 force 被挡（不悄悄吃掉本地历史）', rewind.json && rewind.json.ok === false && rewind.json.conflicts.some((c) => c.kind === 'sessionDiverged' && /比本地旧/.test(c.hint || '')), rewind.json && { err: rewind.json.error, conflicts: rewind.json.conflicts })
  check('被挡时本地历史未被改动', (await rowsOf('sess-goal-1', goalAbsDir)) === baseRows + 3, await rowsOf('sess-goal-1', goalAbsDir))
  const rewindForce = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'overwrite', force: true })
  check('带 force 才允许回退覆盖', rewindForce.json && rewindForce.json.ok === true && (await rowsOf('sess-goal-1', goalAbsDir)) === baseRows, { ok: rewindForce.json && rewindForce.json.ok, rows: await rowsOf('sess-goal-1', goalAbsDir) })
  // 新包覆盖旧本地 ⇒ 只追加尾帧（不动已有字节 ⇒ 投影缓存 seq 围栏继续有效）
  const ff = await callRpc('study.importGoal', { path: zipExtPath, confirm: true, mode: 'overwrite' })
  check('更新的包 ⇒ 走 append 快进（1 条追加，其余 noop）', ff.json && ff.json.ok === true && ff.json.applied.append === 1 && ff.json.applied.noop === 2, ff.json && ff.json.applied)
  check('快进不改本地身份（localId 未被换掉）', (await projectionOf(goalAbsDir)).sort().join(',') === 'sess-ch-1,sess-goal-1,sess-sub-1', await projectionOf(goalAbsDir))
  check('快进行数正确且宿主 inspect 认账', (await rowsOf('sess-goal-1', goalAbsDir)) === baseRows + 3 && !!(await mockPersistence.inspect('sess-goal-1')), await rowsOf('sess-goal-1', goalAbsDir))
  const ffAgain = await callRpc('study.importGoal', { path: zipExtPath, confirm: true, mode: 'overwrite' })
  check('快进收敛后再导一次 = 幂等', ffAgain.json && ffAgain.json.ok === true && ffAgain.json.idempotent === true, ffAgain.json && ffAgain.json.applied)

  // ── P5 该会话正被打开 ⇒ 硬冲突（宿主回写会盖掉导入结果） ──────────────────
  live.push({ id: 'sess-goal-1', header: { id: 'sess-goal-1', cwd: goalAbsDir } })
  const liveImp = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'overwrite', force: true })
  check('会话 LIVE ⇒ sessionLive 冲突且 force 也不放行', liveImp.json && liveImp.json.ok === false && liveImp.json.conflicts.some((c) => c.kind === 'sessionLive'), JSON.parse(JSON.stringify(liveImp.json, (k, v) => (k === 'plan' ? undefined : v))))
  live.length = 0

  // ── P6 失败要回滚干净：不留空目录、不留半个目标、index 还原 ────────────────
  const idxBefore = await fsp.readFile(path.join(tmpRoot, 'index.json'), 'utf8')
  const realInspect = mockPersistence.inspect
  mockPersistence.inspect = async () => { throw new Error('测试注入：宿主读不懂') }
  const boom = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'copy' })
  mockPersistence.inspect = realInspect
  check('自检失败 ⇒ ok:false + rolledBack', boom.json && boom.json.ok === false && boom.json.rolledBack === true, boom.json)
  check('回滚不留空 session 目录（上一版就是留了 6 个空壳）', (await emptySessionDirs()).length === 0, await emptySessionDirs())
  check('回滚后 index.json 逐字还原', (await fsp.readFile(path.join(tmpRoot, 'index.json'), 'utf8')) === idxBefore, (await readIndexGoals()).map((g) => g.id))
  check('回滚后没有留下半拉副本目录', !(await fsp.stat(boom.json.dir || path.join(tmpRoot, 'nope')).catch(() => undefined)) || (await fsp.readdir(boom.json.dir)).length > 0)

  // ── P7 坏包 / 篡改包 ⇒ 校验先于写盘 ───────────────────────────────────────
  const badZip = path.join(tmpRoot, 'bad.zip')
  await fsp.writeFile(badZip, P.createZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ kind: 'study-goal-export', formatVersion: 2, files: [], goal: { id: 'x', dir: 'x' }, sessions: [] })) }]))
  const bad = await callRpc('study.inspectImport', { path: badZip })
  check('缺 goal.json 的包 ⇒ 预览就报 canImport:false（不当能导入骗人）', bad.json && bad.json.ok === true && bad.json.canImport === false && bad.json.conflicts.some((c) => c.kind === 'packageNoGoal'), bad.json && { canImport: bad.json.canImport, conflicts: bad.json.conflicts })
  const tamperedZip = path.join(tmpRoot, 'tampered.zip')
  const manT = JSON.parse(JSON.stringify(man))
  manT.files = manT.files.map((f) => f.name === 'sessions/sess-sub-1/transcript.jsonl.zstd' ? Object.assign({}, f, { sha256: 'deadbeef' }) : f)
  await fsp.writeFile(tamperedZip, P.createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(manT), 'utf8') },
    ...[...zentries.entries()].filter(([k]) => k !== 'manifest.json').map(([k, v]) => ({ name: k, data: v, store: /\.zstd$/.test(k) })),
  ]))
  const tam = await callRpc('study.importGoal', { path: tamperedZip, confirm: true, mode: 'copy' })
  check('包内 sha256 被篡改 ⇒ 导入拒绝（校验先于写盘）', tam.json && tam.json.ok === false && /校验失败/.test(tam.json.error || ''), tam.json)

  // ── P8 归档继承防护（宿主 archivedSessionIds 按 id 全局键控，且这个版本没有解档 API）
  await wsRegistryReal.archiveSession('sess-ch-1')
  check('前置：sess-ch-1 已进入宿主归档集', (wsRegistryReal.archivedSessionIds || []).indexOf('sess-ch-1') >= 0, wsRegistryReal.archivedSessionIds)
  const dupImp = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'copy' })
  check('源仍在盘上 ⇒ 三条全部换发新身份（库里不出现 duplicate id，list() 仍正常）', dupImp.json && dupImp.json.ok === true && (dupImp.json.remap || []).length === 3 && (await mockPersistence.list()).length === 7, dupImp.json && { remap: (dupImp.json.remap || []).length, listed: (await mockPersistence.list()).length })
  await callRpc('study.deleteGoal', { goalId: dupImp.json.goalId })
  await fsp.rm(dupImp.json.dir, { recursive: true, force: true })
  await fsp.rm(projectDirOf(dupImp.json.dir), { recursive: true, force: true })
  // 8b 连源也抹掉 ⇒ 「id 空闲」时归档集仍然会藏会话 ⇒ 必须不换用该 id（上一版就在这里"导入即隐身"）
  await fsp.rm(goalAbsDir, { recursive: true, force: true })
  await fsp.rm(projectDirOf(goalAbsDir), { recursive: true, force: true })
  await fsp.writeFile(path.join(tmpRoot, 'index.json'), JSON.stringify({ goals: [] }, null, 2))
  const archImp = await callRpc('study.importGoal', { path: rE.json.path, confirm: true })
  const archRemap = (archImp.json && archImp.json.remap) || []
  check('空闲但在归档集里的 id 不复用（why 说明归档）', archImp.json && archImp.json.ok === true && archRemap.length === 1 && archRemap[0].remoteId === 'sess-ch-1' && /归档/.test(archRemap[0].why), archRemap)
  check('未归档的空闲 id 沿用原身份（不无谓换发）', (await projectionOf(goalAbsDir)).filter((id) => id === 'sess-goal-1' || id === 'sess-sub-1').length === 2, await projectionOf(goalAbsDir))

  // ── P8.5 血缘不同的同名目录 ⇒ 默认挡住，force 才放行（D21）
  const ledPath = path.join(goalAbsDir, '.study-sync.json')
  const ledReal = await fsp.readFile(ledPath, 'utf8')
  await fsp.writeFile(ledPath, JSON.stringify({ v: 1, remoteGoalId: 'goal-someone-else', sessions: [] }))
  const unrel = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'overwrite' })
  check('同名目录血缘不同 ⇒ 默认被 goalUnrelated 挡住（不会误盖别人的目标）', unrel.json && unrel.json.ok === false && (unrel.json.conflicts || []).some((c) => c.kind === 'goalUnrelated'), unrel.json && { err: unrel.json.error, conflicts: (unrel.json.conflicts || []).map((c) => c.kind) })
  const unrelForce = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'overwrite', force: true })
  check('带 force 才允许覆盖血缘不同的同名目录，并留下告警', unrelForce.json && unrelForce.json.ok === true && /force 覆盖/.test((unrelForce.json.warnings || []).join(' ')), unrelForce.json && { ok: unrelForce.json.ok, w: unrelForce.json.warnings })
  check('换身份后旧席位被摘除（投影仍是每条一席，不堆积）', (await projectionOf(goalAbsDir)).length === 3, await projectionOf(goalAbsDir))
  await fsp.writeFile(ledPath, ledReal)

  // ── P9 终态：主目标在、投影齐全、没有一条被归档集藏起来、无空目录残留 ──────
  const finProj = await projectionOf(goalAbsDir)
  check('终态：主目标工作区投影 3 条齐全', finProj.length === 3, finProj)
  check('终态：投影里没有一条在归档集里（导入结果一定看得见）', finProj.every((id) => (wsRegistryReal.archivedSessionIds || []).indexOf(id) < 0), { finProj, archived: wsRegistryReal.archivedSessionIds })
  check('终态：sessions 根下无空目录残留', (await emptySessionDirs()).length === 0, await emptySessionDirs())
}

// ── reject 路径 + 删除 ───────────────────────────────────────────────────────
{
  const rA = await callRpc('study.createGoal', { topic: 'temp' })
  const id2 = rA.json.goalId
  const d2 = path.join(tmpRoot, id2, 'draft.json')
  await fsp.writeFile(d2, JSON.stringify({ course: 'x', overview: 'y', chapters: [{ title: 'a' }] }))
  await callRpc('study.list', {})
  const rB = await callRpc('study.rejectDraft', { goalId: id2, reason: '章节太少' })
  check('rejectDraft ok', rB.json && rB.json.ok === true, rB.json)
  const g3 = (await callRpc('study.list', {})).json.goals.find((g) => g.id === id2)
  const draftOnDisk = await fsp.readFile(d2, 'utf8').catch(() => '<missing>')
  check('reject 后回 researching 且磁盘草案被清空', g3.status === 'researching' && draftOnDisk.trim() === '', { status: g3.status, disk: draftOnDisk.slice(0, 40) })
  check('rejectDraft 清掉「已派发」事实（退回=需要重新派发）', g3.researchDispatched === false, g3.researchDispatched)

  // study.dispatchResearch = 面板「▶ 开始调研 / 🔁 重新调研」的派发口（owner = chatResearch）
  const rNoSess = await callRpc('study.dispatchResearch', { goalId: id2 })
  check('dispatchResearch 无目标会话 → need_open', rNoSess.json && rNoSess.json.ok === false && rNoSess.json.need_open === true, rNoSess.json)
  await callRpc('study.recordGoalSession', { goalId: id2, sessionId: 'sess-goal-2' })
  const injBefore = injected.length
  const rDisp = await callRpc('study.dispatchResearch', { goalId: id2 })
  check('dispatchResearch 注入并返回 sessionId', rDisp.json && rDisp.json.ok === true && rDisp.json.sessionId === 'sess-goal-2' && injected.length === injBefore + 1, rDisp.json)
  check('dispatchResearch 带上退回意见（走重试指令）', /上次意见: 章节太少/.test((injected[injected.length - 1] || {}).msg.content[0].text || ''), injected[injected.length - 1])
  check('dispatchResearch 后 researchDispatched=true', (await callRpc('study.list', {})).json.goals.find((g) => g.id === id2).researchDispatched === true)
  check('dispatchResearch 未知目标 → error', (await callRpc('study.dispatchResearch', { goalId: 'nope' })).json.ok === false)
  const r10 = await callRpc('study.deleteGoal', { goalId: exportedGoalId })
  check('deleteGoal ok', r10.json && r10.json.ok === true, r10.json)
  const r11 = await callRpc('study.list', {})
  check('list 不再含已删目标', !r11.json.goals.some((g) => g.id === exportedGoalId), r11.json.goals.map((g) => g.id))
  await callRpc('study.deleteGoal', { goalId: id2 })
}

// ── M2/M4: 聊天工具 ─────────────────────────────────────────────────────────
{
  check('defineTool 已解析（静态注册启用）', registeredTools.length > 0, '注册数=' + registeredTools.length)
  const names = registeredTools.map((t) => t.name).sort()
  check('7 个工具注册', names.join(',') === 'study_goal_export,study_goal_import,study_plan_approve,study_plan_create,study_plan_reject,study_plan_research,study_plan_status', names)
  const byName = Object.fromEntries(registeredTools.map((t) => [t.name, t]))
  const createJson = JSON.stringify(byName.study_plan_create && byName.study_plan_create.parameters)
  check('create schema 含 topic 且表达 required', /topic/.test(createJson) && /required/.test(createJson), createJson)
  const rendered = byName.study_plan_status.output.render({}, { ok: true, goals: [] })
  check('output.render 返回 text 段', Array.isArray(rendered) && rendered[0] && rendered[0].type === 'text' && JSON.parse(rendered[0].text).ok === true, rendered)
  const impToolJson = JSON.stringify(byName.study_goal_import.parameters)
  check('import 工具暴露 path/file/mode/confirm', /path/.test(impToolJson) && /confirm/.test(impToolJson), impToolJson)
  // study_goal_import 不带 confirm = 只预览
  const pv = await byName.study_goal_import.execute({ path: path.join(tmpRoot, 'exports', exportedFile) })
  check('study_goal_import 无 confirm 只给预览', pv.ok === false && pv.preview === true && !!pv.plan, { ok: pv.ok, preview: pv.preview, error: pv.error })
}

await fsp.rm(tmpRoot, { recursive: true, force: true })
console.log('\nsmoke: ' + passed + ' passed, ' + failed + ' failed')
process.exit(failed > 0 ? 1 : 0)
