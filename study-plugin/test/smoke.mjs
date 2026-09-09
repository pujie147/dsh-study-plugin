// smoke.mjs — 宿主半运行时冒烟测试（纯 Node，mock webServer/agents/workspaceRegistry）
// 运行: node study-plugin/test/smoke.mjs
// 覆盖: 路由守卫(GET/loopback)、study.* 全链路(list→create→draft 采纳→批准→讲义采纳→章节会话注入→删除)、unknown method。
import { EventEmitter } from 'node:events'
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
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
let capturedRoute = null
const effects = []
const ctx = {
  inject: (names, fn) => {
    for (const n of names) if (n !== 'webServer' && n !== 'agents' && n !== 'workspaceRegistry') throw new Error('unexpected service: ' + n)
    fn({
      effect: (fn2, label) => { const d = fn2(); effects.push({ label, d }); return d },
      webServer: {
        register: (route) => { capturedRoute = route; return () => { capturedRoute = null } }
      },
      agents: {
        get: (id) => ({ followup: (msg) => { injected.push({ id, msg }) } })
      },
      workspaceRegistry: {
        resolveByPath: async () => undefined,
        create: async () => ({ id: 'ws-test' })
      }
    })
  }
}
apply(ctx, { workRoot: tmpRoot })
if (!capturedRoute) { console.error('FAIL: /study-rpc 路由未注册'); process.exit(1) }
check('路由已注册', capturedRoute.kind === 'prefix' && capturedRoute.path === '/study-rpc')

function callRpc(method, args, opts = {}) {
  return new Promise((resolve, reject) => {
    const res = {
      code: 0, body: '',
      writeHead(code) { this.code = code },
      end(b) {
        this.body = b == null ? '' : b
        let json = null
        try { json = JSON.parse(this.body) } catch {}
        resolve({ code: this.code, json, text: this.body })
      }
    }
    const req = new EventEmitter()
    req.method = opts.method || 'POST'
    req.socket = { remoteAddress: opts.remote || '127.0.0.1' }
    setImmediate(() => {
      if (req.method === 'POST') req.emit('data', JSON.stringify({ method, args: args || {} }))
      req.emit('end')
    })
    try { capturedRoute.handler(req, res) } catch (e) { reject(e) }
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

  // reject 路径: 再建一个目标 → 草案 → reject
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

  // delete
  const r10 = await callRpc('study.deleteGoal', { goalId })
  check('deleteGoal ok', r10.json && r10.json.ok === true, r10.json)
  const r11 = await callRpc('study.list', {})
  check('list 不再含已删目标', !r11.json.goals.some((g) => g.id === goalId), r11.json.goals.map((g) => g.id))
}

await fsp.rm(tmpRoot, { recursive: true, force: true })
console.log('\nsmoke: ' + passed + ' passed, ' + failed + ' failed')
process.exit(failed > 0 ? 1 : 0)
