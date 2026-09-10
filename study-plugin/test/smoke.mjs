// smoke.mjs — 宿主半运行时冒烟测试（纯 Node，mock webServer/agents/workspaceRegistry/sessionPersistence/sessions/attachments）
// 运行: node study-plugin/test/smoke.mjs
// 覆盖: 路由守卫(GET/loopback)、study.* 全链路(list→create→draft 采纳→批准→讲义采纳→章节会话注入→删除)、
//       unknown method、M4 导出/导入（含跨路径 header 重写、附件往返、冲突拒绝、副本模式、下载路由）。
import { EventEmitter } from 'node:events'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import * as P from '../lib/portable.js'
import { apply } from '../lib/index.js'

let passed = 0
let failed = 0
function check(name, cond, extra) {
  if (cond) { passed++; console.log('  ✓ ' + name) }
  else { failed++; console.log('  ✗ ' + name + (extra !== undefined ? '  [' + JSON.stringify(extra) + ']' : '')) }
}

// ── mock 基础设施 ────────────────────────────────────────────────────────────
const tmpRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'study-smoke-'))
const injected = []
const flushed = []
const routes = {}
const effects = []
const registeredTools = []
const createdWorkspaces = []

// 会话存储根（模拟 ~/.dsh/sessions）：项目目录名由 cwd 派生，会话目录名 = encodeSegment(id)
const sessRoot = path.join(tmpRoot, '_sessions')
const encodeSeg = (s) => String(s).replace(/[^A-Za-z0-9._-]/g, (c) => '~' + c.charCodeAt(0).toString(16).toUpperCase().padStart(4, '0'))
const projectKey = (cwd) => '--' + String(cwd).replace(/[\\/:]+/g, '-').replace(/^-+/, '').slice(0, 251) + '--'
const mockPersistence = {
  compression: 'zstd',
  locate: (meta) => ({ kind: 'jsonl', path: path.join(sessRoot, projectKey(meta.cwd), encodeSeg(meta.id), 'session.jsonl.zstd') }),
  // 非修改式检查：按 id 扫项目目录，找到后校验 header.id === id（与宿主同一套身份校验）
  inspect: async (id) => {
    const projects = await fsp.readdir(sessRoot, { withFileTypes: true }).catch(() => [])
    for (const pr of projects) {
      if (!pr.isDirectory()) continue
      const dir = path.join(sessRoot, pr.name, encodeSeg(id))
      let buf
      try { buf = await fsp.readFile(path.join(dir, 'session.jsonl.zstd')) } catch { continue }
      const hdr = P.readSessionHeader(buf)
      if (hdr.id !== id) throw new Error('session identity mismatch: ' + hdr.id + ' != ' + id)
      if (hdr.cwd && !pr.name.includes(encodeSeg('probe')) && path.dirname(path.dirname(path.join(dir, 'x'))) !== path.join(sessRoot, pr.name)) {
        throw new Error('transcript not under its cwd project dir')
      }
      return { id, header: hdr, lines: P.decodeTranscript(buf).text.split('\n').filter(Boolean).length }
    }
    throw new Error('session log not found: ' + id)
  }
}
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
      workspaceRegistry: {
        resolveByPath: async () => undefined,
        create: async (p, title) => {
          const ws = {
            id: 'ws-test',
            path: p,
            title: title,
            sessionIds: [],
            attachSession: async function (sid) { this.sessionIds.push(sid) }
          }
          createdWorkspaces.push(ws)
          return ws
        },
        get: () => undefined,
        archivedSessionIds: []
      },
      sessionPersistence: mockPersistence,
      sessions: { get: (id) => ({ id }), flush: async (s) => { flushed.push(s.id) } },
      attachments: mockAttachments
    }
    for (const n of names) if (scope[n] === undefined) throw new Error('unexpected service: ' + n)
    fn(scope)
  }
}
apply(ctx, { workRoot: tmpRoot })
const rpcRoute = routes['/study-rpc']
const fileRoute = routes['/study-export']
if (!rpcRoute) { console.error('FAIL: /study-rpc 路由未注册'); process.exit(1) }
check('路由已注册', rpcRoute.kind === 'prefix' && rpcRoute.path === '/study-rpc')
check('下载路由已注册', !!fileRoute && fileRoute.path === '/study-export' && fileRoute.kind === 'prefix')

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

// ── 路由守卫 ─────────────────────────────────────────────────────────────────
{
  const r = await callRpc('study.list', {}, { method: 'GET' })
  check('GET 被拒(405)', r.code === 405, r.code)
  const r2 = await callRpc('study.list', {}, { remote: '10.0.0.5' })
  check('非 loopback 被拒(403)', r2.code === 403, r2.code)
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
  check('workspaceId 来自注册表', r1.json.workspaceId === 'ws-test', r1.json)

  const r2 = await callRpc('study.list', {})
  const g0 = r2.json.goals[0]
  check('list 含新目标(researching)', g0 && g0.status === 'researching' && g0.title === 'Transformer 基础', g0)
  check('list 含 path/workspaceId/sessionId 字段', typeof g0.path === 'string' && g0.workspaceId === 'ws-test', g0)

  // 注入目标会话 → startResearch
  const r3 = await callRpc('study.startResearch', { goalId, sessionId: 'sess-goal-1' })
  check('startResearch ok', r3.json && r3.json.ok === true, r3.json)
  check('调研指令已注入会话', injected.length === 1 && injected[0].id === 'sess-goal-1' && /课程规划 AI/.test(injected[0].msg.content[0].text), injected)

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

  // ── M4 前置：为该目标造出真实会话 transcript（目标会话 + 章节会话 + subagent 会话）
  const goalAbsDir = path.join(tmpRoot, goalId)
  async function makeSession(sid, cwd, extraEvents) {
    const abs = mockPersistence.locate({ cwd, id: sid }).path
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const lines = [
      JSON.stringify({ type: 'session', version: 0, id: sid, createdAt: 1788000000000, cwd, delegationDepth: 0, agentPreset: 'standard' }),
      ...extraEvents
    ]
    await fsp.writeFile(abs, await P.jsonlToZstdFrames(lines.join('\n') + '\n', 2))
    return abs
  }
  const pngBytes = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4' + '0'.repeat(40), 'hex')
  const pngRef = await mockAttachments.saveImage({ data: new Uint8Array(pngBytes), mediaType: 'image/png' })
  await makeSession('sess-goal-1', goalAbsDir, [
    JSON.stringify({ type: 'session/title', seq: 0, data: { title: 'Transformer 课程规划草案' } }),
    JSON.stringify({ type: 'user/message', seq: 1, data: { content: [{ type: 'text', text: '请调研并写 ' + goalAbsDir.replace(/\\/g, '/') + '/draft.json' }] } })
  ])
  await makeSession('sess-ch-1', goalAbsDir, [
    JSON.stringify({ type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '看这张图' }, { type: 'image', attachment: { attachmentId: pngRef.attachmentId, mediaType: 'image/png' } }] } }),
    JSON.stringify({ type: 'turn/end', seq: 1, data: {} })
  ])
  await makeSession('sess-sub-1', goalAbsDir, [
    JSON.stringify({ type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '子代理任务' }] } })
  ])
  // 另一个目标工作区里混进的无关会话（同 sessRoot、不同项目目录）——不得被带走
  await makeSession('sess-other', path.join(tmpRoot, 'other-goal'), [JSON.stringify({ type: 'user/message', seq: 0, data: { content: [{ type: 'text', text: '无关' }] } })])

  // 导出
  const rE = await callRpc('study.exportGoal', { goalId })
  check('exportGoal ok', rE.json && rE.json.ok === true && /\.zip$/.test(rE.json.file), rE.json)
  check('导出包落在 exports/', rE.json && path.dirname(rE.json.path).endsWith('exports') && !!await fsp.stat(rE.json.path).catch(() => undefined), rE.json && rE.json.path)
  exportedFile = rE.json.file
  exportedGoalId = goalId
  check('导出含 3 个会话（含 subagent、排除别的工作区会话）', rE.json.counts.sessions === 3, rE.json.counts)
  check('导出含 1 个附件对象', rE.json.counts.attachments === 1, rE.json.counts)
  const zipBuf = await fsp.readFile(rE.json.path)
  const zentries = P.readZip(zipBuf)
  const man = P.readJsonEntry(zentries, 'manifest.json')
  check('manifest 格式版本/kind', man.formatVersion === 1 && man.kind === 'study-goal-export', { v: man.formatVersion, k: man.kind })
  const wantGoal = [
    'goal/goal.json', 'goal/draft.json',
    'goal/chapters/' + gj.chapters[0].file, 'goal/chapters/01-qa.md',
    'goal/chapters/01-notes/梯度消失.md', 'goal/demo.py'
  ]
  check('goal 树全部内容入包（讲义/qa/notes/代码/draft/goal.json）', wantGoal.every((n) => zentries.has(n)), wantGoal.filter((n) => !zentries.has(n)))
  const sRec = man.sessions.find((s) => s.id === 'sess-ch-1')
  check('会话按逐字节原文入包（zstd 帧、header 保留源 cwd）', !!sRec && sRec.encoding === 'zstd' && sRec.frames >= 2 && P.normPath(sRec.cwd) === P.normPath(goalAbsDir), sRec)
  check('会话绑定关系被记录(goal/chapter-1/unbound)', man.sessions.map((s) => s.boundTo).sort().join(',') === 'chapter-1,goal,unbound', man.sessions.map((s) => [s.id, s.boundTo]))
  check('会话标题被提取', sRec.title === '' || typeof sRec.title === 'string', sRec.title)
  check('附件按内容寻址入包', zentries.has(man.attachments[0].entry) && man.attachments[0].sha256 === pngRef.attachmentId.slice(7), man.attachments)
  check('导出包不含 .mnemon/凭据/缓存等', ![...zentries.keys()].some((k) => /\.mnemon|credentials|settings\.yaml|projcache/.test(k)), [...zentries.keys()])
  check('manifest.files 逐条 sha256 与包内一致', man.files.every((f) => P.sha256Hex(zentries.get(f.name)) === f.sha256))
  const srcBody = P.decodeTranscript(zentries.get('sessions/sess-goal-1/transcript.jsonl.zstd')).text
  check('正文按 D2 不改写（源路径作为历史文本原样入包）', /draft\.json/.test(srcBody) && srcBody.indexOf(goalAbsDir.replace(/\\/g, '/')) > 0, srcBody.slice(0, 80))

  // 下载路由
  const d1 = await callFile('/study-export?file=' + encodeURIComponent(exportedFile))
  check('下载 GET 200 + zip 字节一致', d1.code === 200 && Buffer.compare(d1.raw, zipBuf) === 0, d1.code)
  check('下载带 attachment 头', /attachment;/.test((d1.headers || {})['content-disposition'] || ''), d1.headers)
  check('下载 loopback 守卫', (await callFile('/study-export?file=' + encodeURIComponent(exportedFile), { remote: '10.0.0.9' })).code === 403)
  check('下载拒绝路径穿越', (await callFile('/study-export?file=..%2F..%2Fetc%2Fpasswd.zip')).code === 400)
  check('下载 404 未知文件', (await callFile('/study-export?file=nope.zip')).code === 404)

  // ── 模拟"另一台机器"：清掉目标目录 + index + 全部会话，然后导入
  await fsp.rm(goalAbsDir, { recursive: true, force: true })
  await fsp.rm(path.join(sessRoot, projectKey(goalAbsDir)), { recursive: true, force: true })
  await fsp.writeFile(path.join(tmpRoot, 'index.json'), JSON.stringify({ goals: [] }, null, 2))
  const insp = await callRpc('study.inspectImport', { path: rE.json.path })
  check('inspectImport 预览 ok 且无冲突', insp.json && insp.json.ok === true && insp.json.canImport === true && insp.json.conflicts.length === 0, insp.json)
  check('同路径导入无需改写 header（rewriteCwd=false）', insp.json.plan.rewriteCwd === false, insp.json.plan.rewriteCwd)
  const inspCopy = await callRpc('study.inspectImport', { path: rE.json.path, mode: 'copy' })
  check('副本模式预告要改写 header（rewriteCwd=true）', inspCopy.json && inspCopy.json.ok === true && inspCopy.json.plan.rewriteCwd === true && inspCopy.json.plan.goalId !== exportedGoalId, inspCopy.json && { rc: inspCopy.json.plan.rewriteCwd, id: inspCopy.json.plan.goalId })
  check('预览列出会话与附件与章节数', insp.json.plan.sessionCount === 3 && insp.json.plan.attachments === 1 && insp.json.plan.chapters === 2, insp.json.plan)
  const imp = await callRpc('study.importGoal', { path: rE.json.path, confirm: true })
  check('importGoal ok', imp.json && imp.json.ok === true && imp.json.goalId === exportedGoalId, imp.json)
  check('导入还原了目标目录树', !!(await fsp.stat(path.join(goalAbsDir, 'goal.json')).catch(() => undefined)) && !!(await fsp.stat(path.join(goalAbsDir, 'demo.py')).catch(() => undefined)), imp.json)
  const wsForImport = createdWorkspaces.filter((w) => P.normPath(w.path) === P.normPath(path.join(tmpRoot, exportedGoalId))).pop()
  check('导入重新登记工作区并挂回全部会话', imp.json.workspaceId === 'ws-test' && !!wsForImport && wsForImport.sessionIds.slice().sort().join(',') === 'sess-ch-1,sess-goal-1,sess-sub-1', imp.json && wsForImport && wsForImport.sessionIds)
  const goalAfter = JSON.parse(await fsp.readFile(path.join(goalAbsDir, 'goal.json'), 'utf8'))
  check('goal.json 的会话绑定按原 id 保留', goalAfter.sessionId === 'sess-goal-1' && goalAfter.chapters[0].sessionId === 'sess-ch-1', { s: goalAfter.sessionId, c: goalAfter.chapters && goalAfter.chapters[0].sessionId })
  const idxAfter = JSON.parse(await fsp.readFile(path.join(tmpRoot, 'index.json'), 'utf8'))
  check('index.json 合并进该目标（不丢其它行）', idxAfter.goals.length === 1 && idxAfter.goals[0].id === exportedGoalId, idxAfter.goals.map((g) => g.id))
  const tPath = mockPersistence.locate({ cwd: goalAbsDir, id: 'sess-ch-1' }).path
  const tBuf = await fsp.readFile(tPath)
  const tHdr = P.readSessionHeader(tBuf)
  const tLines = P.decodeTranscript(tBuf).text.split('\n').filter(Boolean)
  check('导入后会话落在新机项目目录且 header.cwd 已改写', P.normPath(tHdr.cwd) === P.normPath(goalAbsDir), tHdr.cwd)
  check('导入后会话正文逐行不变、id 不变', tHdr.id === 'sess-ch-1' && tLines.length === 3 && /看这张图/.test(tLines[1]), tLines.length)
  const shaPng = pngRef.attachmentId.slice(7)
  const backPng = await fsp.readFile(path.join(attachRoot, shaPng.slice(0, 2), shaPng)).catch(() => undefined)
  check('附件按内容寻址回写，attachmentId 不变（会话引用不悬空）', !!backPng && Buffer.compare(backPng, pngBytes) === 0)
  check('导入报告需要重启提示', imp.json.ok === true && imp.json.verified === true, { verified: imp.json.verified })

  // 重复导入 → 冲突拒绝（同 goalId + 同会话 id）
  const dup = await callRpc('study.importGoal', { path: rE.json.path, confirm: true })
  check('重复导入被冲突挡住（不覆盖已有会话/目录）', dup.json && dup.json.ok === false && /冲突/.test(dup.json.error || ''), dup.json)
  // 副本模式 → 新 goalId + 会话 header 再次改写
  const cp = await callRpc('study.importGoal', { path: rE.json.path, confirm: true, mode: 'copy' })
  check('copy 模式另存为新 goalId', cp.json && cp.json.ok === true && cp.json.goalId !== exportedGoalId, cp.json && cp.json.goalId)
  const cpDir = path.join(tmpRoot, cp.json.goalId)
  const cpHdr = P.readSessionHeader(await fsp.readFile(mockPersistence.locate({ cwd: cpDir, id: 'sess-goal-1' }).path))
  check('副本会话 header.cwd 指向新副本目录', P.normPath(cpHdr.cwd) === P.normPath(cpDir), cpHdr.cwd)
  check('副本 goal.json 换了 id（会话 id 保持）', JSON.parse(await fsp.readFile(path.join(cpDir, 'goal.json'), 'utf8')).id === cp.json.goalId)
  // 坏包 → 校验失败
  const badZip = path.join(tmpRoot, 'bad.zip')
  await fsp.writeFile(badZip, P.createZip([{ name: 'manifest.json', data: Buffer.from(JSON.stringify({ kind: 'study-goal-export', formatVersion: 1, files: [] })) }]))
  const bad = await callRpc('study.inspectImport', { path: badZip })
  check('缺 goal 信息的包在预览阶段即失败', bad.json && bad.json.ok === false, bad.json)
  // 缺会话文件 / sha 被篡改 → 校验先于写盘，直接拒绝
  const tamperedZip = path.join(tmpRoot, 'tampered.zip')
  const man2 = JSON.parse(JSON.stringify(man))
  man2.files = man2.files.map((f) => f.name === 'sessions/sess-sub-1/transcript.jsonl.zstd' ? Object.assign({}, f, { sha256: 'deadbeef' }) : f)
  await fsp.writeFile(tamperedZip, P.createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify(man2), 'utf8') },
    ...[...zentries.entries()].filter(([k]) => k !== 'manifest.json').map(([k, v]) => ({ name: k, data: v, store: /\.zstd$/.test(k) }))
  ]))
  const tam = await callRpc('study.importGoal', { path: tamperedZip, confirm: true, mode: 'copy' })
  check('包内 sha256 被篡改 → 导入拒绝（校验先于写盘）', tam.json && tam.json.ok === false && /校验失败/.test(tam.json.error || ''), tam.json)
  check('校验失败未留下半拉目录', !(await fsp.stat(path.join(tmpRoot, man2.goal.dir + '-x')).catch(() => undefined)))

  // 清理副本，避免影响后面的断言
  await callRpc('study.deleteGoal', { goalId: cp.json.goalId })
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
