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
import http from 'node:http'
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
const failInject = new Set()           // 该集合里的会话 id 注入时抛错（模拟「代理未激活」，测 D36 派发回滚）
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
      agents: { get: (id) => ({ followup: (msg) => { if (failInject.has(id)) throw new Error('会话代理未激活（测试注入）'); injected.push({ id, msg }) } }) },
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
  {
    const ri = injected[0].msg.content[0].text
    check('调研指令=全课程总览+三可选字段+排版约定(D34)', /全课程总览/.test(ri) && /env_baseline/.test(ri) && /depends_on/.test(ri) && /project_thread/.test(ri) && /LaTeX/.test(ri) && /mermaid/.test(ri), ri.slice(0, 200))
    check('调研指令=偏好沉淀回路且指向 _meta/teaching-prefs.md', /偏好沉淀/.test(ri) && /teaching-prefs\.md/.test(ri), ri.slice(-200))
    check('无偏好文件时调研指令不含偏好段(缺失不炸)', !/用户教学偏好/.test(ri), ri.slice(0, 120))
  }
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
      { title: '注意力机制', summary: 'QKV 与缩放点积', est_hours: 0.3, focus_points: ['QKV', '缩放'], env_baseline: 'Python+PyTorch 环境+git 仓库(主分支=基线)', project_thread: '在 baseline 分支工程内新增 attention/ 模块' },
      { title: '位置编码', depends_on: [1, 99, -2, 1.5, 'x'] }
    ]
  }))
  const r4 = await callRpc('study.list', {})
  const g1 = r4.json.goals.find((g) => g.id === goalId)
  check('草案采纳 → draft_pending', g1.status === 'draft_pending', g1.status)
  check('草案章节规范化(index/est_hours 下限/缺失字段)', g1.draft.chapters[0].index === 1 && g1.draft.chapters[0].est_hours === 0.5 && g1.draft.chapters[1].title === '位置编码' && g1.draft.chapters[1].est_hours === null && g1.draft.chapters[1].focus_points.length === 0, g1.draft && g1.draft.chapters)
  check('草案可选字段规范化(D34: 字符串清洗/depends_on 仅留合法前置章号)', g1.draft.chapters[0].env_baseline === 'Python+PyTorch 环境+git 仓库(主分支=基线)' && g1.draft.chapters[1].depends_on.length === 1 && g1.draft.chapters[1].depends_on[0] === 1 && g1.draft.chapters[1].project_thread === undefined, g1.draft.chapters)

  // 批准
  const r5 = await callRpc('study.approveDraft', { goalId })
  check('approveDraft ok(chapters:2)', r5.json && r5.json.ok === true && r5.json.chapters === 2, r5.json)
  const gj = JSON.parse(await fsp.readFile(path.join(tmpRoot, goalId, 'goal.json'), 'utf8'))
  check('goal.json 章节文件命名 01-slug.md', gj.chapters[0].file === '01-attention-mechanism.md' || /^01-[^/]+\.md$/.test(gj.chapters[0].file), gj.chapters[0].file)
  check('批准透传可选字段(D34)', gj.chapters[0].env_baseline === 'Python+PyTorch 环境+git 仓库(主分支=基线)' && gj.chapters[1].depends_on[0] === 1, gj.chapters)

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

  // 教学偏好记忆体登场：此后所有指令都应带上它（导出侧也应含 meta/ 条目）
  const prefsAbs = path.join(tmpRoot, '_meta', 'teaching-prefs.md')
  await fsp.mkdir(path.dirname(prefsAbs), { recursive: true })
  await fsp.writeFile(prefsAbs, '- 2026-09-19 讲义一律先总后分，概览配 mermaid 框架图\n')

  // 章节会话记录 + 开始学习
  const r7 = await callRpc('study.recordChapterSession', { goalId, chapter_index: 1, sessionId: 'sess-ch-1' })
  check('recordChapterSession ok', r7.json && r7.json.ok === true, r7.json)
  const r8 = await callRpc('study.startChapter', { goalId, chapter_index: 1, sessionId: 'sess-ch-1' })
  check('startChapter ok', r8.json && r8.json.ok === true, r8.json)
  check('教练指令已注入(含回写机制)', injected.some((m) => m.id === 'sess-ch-1' && /学习教练/.test(m.msg.content[0].text) && /回写/.test(m.msg.content[0].text)), injected)
  {
    const ci = injected[injected.length - 1].msg.content[0].text
    check('教练指令含偏好注入+沉淀回路(D34)', /用户教学偏好/.test(ci) && /先总后分/.test(ci) && /偏好沉淀/.test(ci) && /teaching-prefs\.md/.test(ci), ci.slice(0, 200))
  }

  // generateChapter：第1章=环境基线确立；第2章=读全部前置章讲义+承接与补完+闭环
  const injB0 = injected.length
  const rg1 = await callRpc('study.generateChapter', { goalId, chapter_index: 1 })
  check('generateChapter ch1 ok(注入目标会话)', rg1.json && rg1.json.ok === true && injected.length === injB0 + 1, rg1.json)
  {
    const t1 = injected[injected.length - 1].msg.content[0].text
    check('ch1 指令=环境基线+git 分支约定+先总后分', /环境的起点|工程线的起点/.test(t1) && /git init/.test(t1) && /checkout -b chapter\//.test(t1) && /本章概览\(总\)/.test(t1) && /作黑盒使用，第 N 章详述/.test(t1) && /用户教学偏好/.test(t1) && !/前置章讲义/.test(t1), t1.slice(0, 260))
  }
  const rL9a = await callRpc('study.list', {})   // ch1 讲义文件在盘 → 采纳回 ready，别把 generating 状态带进 ch2 的前置章判定
  const rg2 = await callRpc('study.generateChapter', { goalId, chapter_index: 2 })
  check('generateChapter ch2 ok', rg2.json && rg2.json.ok === true, rg2.json)
  {
    const t2 = injected[injected.length - 1].msg.content[0].text
    check('ch2 指令=前置章讲义路径+承接与补完+清偿欠账+LaTeX/mermaid', /前置章讲义\(动笔前必须用 read 工具逐份读完\)/.test(t2) && t2.indexOf('chapters/' + gj.chapters[0].file) > 0 && /承接与补完/.test(t2) && /欠账清偿/.test(t2) && /已在第 2 章讲清/.test(t2) && /LaTeX/.test(t2) && /mermaid/.test(t2) && /全课程总览/.test(t2) && /依赖章: 1/.test(t2), t2.slice(0, 300))
  }
  const rL9 = await callRpc('study.list', {})
  const g9 = rL9.json.goals.find((g) => g.id === goalId)
  check('重新生成不毁已有讲义(ch1 文件在→回到 ready)', g9.chapters[0].status === 'ready' && g9.chapters[1].status === 'generating', g9.chapters.map((c) => c.status))

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

// ── 网页课程源（v0.8.0）：回环 mock 站真抓取 + 材料模式调研 + ⚡ 整课一次性生成 ──
// 抓取走的是**真实网络栈**（Node fetch → 127.0.0.1 临时 HTTP 服务），不是 mock fetch：
// 同域限定 / 深度截断 / 页数上限 / not-html / 404 / robots / 幂等重抓 都要按真协议行为成立。
{
  const LONG = '知识要点段落，够两百字以避开低正文标记。'.repeat(12) // >200 字
  const htmlPage = (title, body, links) => '<html><head><title>' + title + '</title><style>.x{color:red}</style>' +
    '<script>console.log("evil " + (1 < 2))</script></head><body><h1>' + title + '</h1><p>' + body + '</p>' +
    links.map((u) => '<a href="' + u + '">' + u + '</a>').join('') + '<br>页脚</body></html>'
  const deeperHits = []          // 三级页被访问则记 URL（应当始终为空）
  const privateHits = []         // robots 禁抓页被访问则记 URL（应当始终为空）
  const srv1 = http.createServer((req, res) => {
    const p = req.url.split('?')[0].split('#')[0]
    const send = (code, ct, body) => { res.writeHead(code, { 'content-type': ct }); res.end(body) }
    if (p === '/robots.txt') return send(404, 'text/plain', 'nope')            // robots 拉不到 = 放行
    if (p === '/guide/') return send(200, 'text/html; charset=utf-8', htmlPage('指南首页', 'A &amp; B &lt;C&gt; 起步。' + LONG,
      ['/ch1', '/sub', '/raw', '/missing', ...Array.from({ length: 40 }, (_, i) => '/t' + (i + 1)), 'http://other.invalid/x.html', '#frag', '/guide/', 'javascript:alert(1)']))
    if (p === '/ch1') return send(200, 'text/html', htmlPage('第一章', LONG, ['/ch1/deeper']))
    if (p === '/sub') return send(200, 'text/html', htmlPage('短章', '就一句话。', ['/sub/deeper']))  // 正文 <200 字 → low
    if (/^\/t\d+$/.test(p)) return send(200, 'text/html', htmlPage('附录 ' + p.slice(2), LONG, []))
    if (p === '/raw') return send(200, 'text/plain', 'not html')
    if (p === '/missing') return send(404, 'text/html', 'gone')
    if (p === '/ch1/deeper' || p === '/sub/deeper') { deeperHits.push(p); return send(200, 'text/html', htmlPage('三级', LONG, [])) }
    return send(404, 'text/plain', 'nf')
  })
  const srv2 = http.createServer((req, res) => {
    const p = req.url.split('?')[0]
    const send = (code, ct, body) => { res.writeHead(code, { 'content-type': ct }); res.end(body) }
    if (p === '/robots.txt') return send(200, 'text/plain', 'User-agent: studybot\nDisallow: /nope/\n\nUser-agent: *\nDisallow: /private/\n')
    if (p === '/start') return send(200, 'text/html', htmlPage('入口', LONG, ['/public/p1', '/private/secret']))
    if (p === '/public/p1') return send(200, 'text/html', htmlPage('公开页', LONG, []))
    if (p === '/private/secret') { privateHits.push(p); return send(200, 'text/html', htmlPage('禁区', LONG, [])) }
    return send(404, 'text/plain', 'nf')
  })
  await new Promise((r) => srv1.listen(0, '127.0.0.1', r))
  await new Promise((r) => srv2.listen(0, '127.0.0.1', r))
  const url1 = 'http://127.0.0.1:' + srv1.address().port + '/guide/'
  const url2 = 'http://127.0.0.1:' + srv2.address().port + '/start'

  const rowOf = async (gid) => { const j = (await callRpc('study.list', {})).json; return (((j || {}).goals) || []).find((g) => g.id === gid) }
  const waitCrawl = async (gid) => {
    for (let i = 0; i < 400; i++) {
      const row = await rowOf(gid)
      if (row && row.web && row.web.status !== 'running' && row.status !== 'crawling') return row
      await new Promise((r) => setTimeout(r, 25))
    }
    return null
  }

  const rc = await callRpc('study.createGoal', { topic: '网页课程源测试' })
  const wGoal = rc.json.goalId
  check('startCrawl 非法 URL → 拒（js/非 http 均挡）', (await callRpc('study.startCrawl', { goalId: wGoal, url: 'javascript:alert(1)' })).json.ok === false &&
    /URL 无效/.test((await callRpc('study.startCrawl', { goalId: wGoal, url: 'javascript:alert(1)' })).json.error || ''))
  const rStart = await callRpc('study.startCrawl', { goalId: wGoal, url: url1 })
  check('startCrawl ok 且回带归一化 startUrl', rStart.json && rStart.json.ok === true && rStart.json.startUrl === url1, rStart.json)
  const runRow = await rowOf(wGoal)
  check('抓取派发 → 目标瞬态 crawling + web.status=running', runRow.status === 'crawling' && runRow.web && runRow.web.status === 'running', runRow && runRow.web)
  check('抓取中重复发起被拒（防并发）', /正在抓取中/.test((await callRpc('study.startCrawl', { goalId: wGoal, url: url1 })).json.error || ''))
  const doneRow = await waitCrawl(wGoal)
  check('抓完自动回到 researching（crawling 只是瞬态）', !!doneRow && doneRow.status === 'researching', doneRow && { s: doneRow.status, w: doneRow.web })
  check('list.web 摘要：done + 28 成 / 1 败 / 16 跳（含 15 页上限）', doneRow.web.status === 'done' && doneRow.web.ok === 28 && doneRow.web.failed === 1 && doneRow.web.skipped === 16 && doneRow.web.total === 45, doneRow.web)
  {
    const pv = await callRpc('study.getCrawlPreview', { goalId: wGoal })
    const pages = pv.json.webCrawl.pages
    check('预览 crawled=true + 材料文件数与 ok 页一致', pv.json.ok === true && pv.json.crawled === true && pv.json.materialFiles === 28, pv.json && pv.json.materialFiles)
    check('深度 2 截断：三级页既不在清单也未被访问', !pages.some((p) => /deeper/.test(p.url)) && deeperHits.length === 0, deeperHits)
    check('同域限定：外域链接根本不进清单', !pages.some((p) => /other\.invalid/.test(p.url)))
    check('归一化去重：起始页(#锚点/自重)只一条', pages.filter((p) => p.url === url1).length === 1)
    const byPath = (u) => pages.find((p) => p.url === u)
    check('404 → failed(HTTP 404)；text/plain → skipped(not-html)', byPath(url1.replace('/guide/', '/missing')).status === 'failed' && /HTTP 404/.test(byPath(url1.replace('/guide/', '/missing')).reason) && byPath(url1.replace('/guide/', '/raw')).status === 'skipped' && byPath(url1.replace('/guide/', '/raw')).reason === 'not-html', pages.filter((p) => p.status !== 'ok').slice(0, 4))
    check('30 页尝试上限，其余页记 skipped(page-limit)', pages.filter((p) => p.depth !== undefined).length === 30 && pages.filter((p) => p.reason === 'page-limit').length === 15, { attempts: pages.filter((p) => p.depth !== undefined).length, capped: pages.filter((p) => p.reason === 'page-limit').length })
    check('低正文标记：短文页 low=true，长文页 low=false', byPath(url1.replace('/guide/', '/sub')).low === true && byPath(url1).low === false, byPath(url1.replace('/guide/', '/sub')))
    const webDir = path.join(tmpRoot, wGoal, 'research', 'web')
    const files = await fsp.readdir(webDir)
    check('每 ok 页落 NN-slug.txt + manifest.json', files.length === 29 && files.includes('manifest.json') && pages.filter((p) => p.status === 'ok').every((p) => /^\d{2}-.+\.txt$/.test(p.file) && files.includes(p.file)), files.slice(0, 6))
    const guideTxt = await fsp.readFile(path.join(webDir, byPath(url1).file), 'utf8')
    check('正文提取：title 进记录；脚本/样式剔除；实体解码', /指南首页/.test(guideTxt) && /A & B <C>/.test(guideTxt) && !/console\.log/.test(guideTxt) && !/color:red/.test(guideTxt) && byPath(url1).title === '指南首页', guideTxt.slice(0, 120))
    const man = JSON.parse(await fsp.readFile(path.join(webDir, 'manifest.json'), 'utf8'))
    check('manifest 与 webCrawl 同步（整树可携，D3）', man.startUrl === url1 && man.pages.length === 45, man.pages && man.pages.length)
  }
  {
    // robots：拉不到=放行已在 srv1 验证；这里验证 Disallow 前缀拦截（只认 User-agent: * 段）
    const rc2 = await callRpc('study.createGoal', { topic: 'robots 测试' })
    const g2 = rc2.json.goalId
    await callRpc('study.startCrawl', { goalId: g2, url: url2 })
    const d2 = await waitCrawl(g2)
    const pv2 = await callRpc('study.getCrawlPreview', { goalId: g2 })
    const pl = pv2.json.webCrawl.pages
    check('robots 只认 * 段：/private/ 记 blocked 且从未被请求', pl.some((p) => p.status === 'blocked' && /\/private\/secret$/.test(p.url) && p.reason === 'robots') && privateHits.length === 0, pl)
    check('robots 站其余页正常成文', d2.web.status === 'done' && d2.web.ok === 2 && d2.web.blocked === 1, d2.web)
    await callRpc('study.deleteGoal', { goalId: g2 })
  }
  {
    // 幂等重抓：先塞一个残留文件，重抓必须整批重建
    const webDir = path.join(tmpRoot, wGoal, 'research', 'web')
    await fsp.writeFile(path.join(webDir, 'leftover.txt'), 'stale')
    await callRpc('study.startCrawl', { goalId: wGoal, url: url1 })
    const again = await waitCrawl(wGoal)
    const gone = await fsp.readFile(path.join(webDir, 'leftover.txt'), 'utf8').catch(() => undefined)
    check('重抓幂等：research/ 整批重建，残留文件不存活', again.web.status === 'done' && again.web.ok === 28 && gone === undefined, { st: again.web.status, gone })
  }
  {
    // 材料模式调研指令（webCrawl.done ⇒ 禁再抓取、逐份读材料、gap_notes 出口）
    await callRpc('study.recordGoalSession', { goalId: wGoal, sessionId: 'sess-web-1' })
    const inj0 = injected.length
    const rd = await callRpc('study.dispatchResearch', { goalId: wGoal })
    check('材料模式派发调研 ok', rd.json && rd.json.ok === true && injected.length === inj0 + 1, rd.json)
    {
      const ri = injected[injected.length - 1].msg.content[0].text
      check('材料指令：禁重抓 + 逐份清单(绝对路径+来源) + web_search≤2 + gap_notes 字段', /「网页课程源」调研/.test(ri) && /禁止重新抓取网页/.test(ri) && /research\/web\/\d{2}-/.test(ri) && /（来源 http:\/\/127\.0\.0\.1/.test(ri) && /至多 2 次/.test(ri) && /gap_notes/.test(ri), ri.slice(0, 300))
      check('材料指令仍是完整规划协议(overview/D34 可选字段/排版)', /全课程总览/.test(ri) && /env_baseline/.test(ri) && /LaTeX/.test(ri) && /mermaid/.test(ri))
    }
    // 草案带 gap_notes → 清洗 → reject 不清材料 → 再采纳 → 批准透传
    const draftAbs = path.join(tmpRoot, wGoal, 'draft.json')
    const draftJson = JSON.stringify({
      course: '网页课', overview: '三章总览',
      chapters: [
        { title: '地基', summary: '一', focus_points: ['a'] },
        { title: '正文', summary: '二', gap_notes: ['  缺部署实践  ', '', null] },
        { title: '收尾', summary: '三', gap_notes: [] }
      ]
    })
    await fsp.writeFile(draftAbs, draftJson)
    await callRpc('study.list', {})
    const wRow = await rowOf(wGoal)
    check('gap_notes 清洗：trim + 去空/去 null，空数组=无字段', JSON.stringify(wRow.draft.chapters[1].gap_notes) === '["缺部署实践"]' && wRow.draft.chapters[0].gap_notes === undefined && wRow.draft.chapters[2].gap_notes === undefined, wRow.draft && wRow.draft.chapters.map((c) => c.gap_notes))
    await callRpc('study.rejectDraft', { goalId: wGoal, reason: '再想想' })
    check('reject 草案不清网页材料（重抓成本高，设计 §1）', (await fsp.readdir(path.join(tmpRoot, wGoal, 'research', 'web'))).filter((f) => f.endsWith('.txt')).length === 28)
    await fsp.writeFile(draftAbs, draftJson)
    await callRpc('study.list', {})
    const ap = await callRpc('study.approveDraft', { goalId: wGoal })
    check('approve ok(chapters:3)', ap.json && ap.json.ok === true && ap.json.chapters === 3, ap.json)
    const gjw = JSON.parse(await fsp.readFile(path.join(tmpRoot, wGoal, 'goal.json'), 'utf8'))
    check('批准透传 gap_notes 到 goal.json', gjw.chapters[1].gap_notes[0] === '缺部署实践' && gjw.chapters[0].gap_notes === undefined, gjw.chapters.map((c) => c.gap_notes))

    // ⚡ 整课生成：只碰待生成章 → 全部就绪报错 → regenerate 覆盖
    const chFile = (i) => path.join(tmpRoot, wGoal, 'chapters', gjw.chapters[i].file)
    await fsp.mkdir(path.dirname(chFile(0)), { recursive: true })
    await fsp.writeFile(chFile(0), '# 地基\n' + '内容'.repeat(200))
    await callRpc('study.list', {})
    check('单章文件在盘 → 采纳 ready（⚡ 前的混合态）', (await rowOf(wGoal)).chapters.map((c) => c.status).join(',') === 'ready,draft,draft', (await rowOf(wGoal)).chapters.map((c) => c.status))
    const injA = injected.length
    const ga = await callRpc('study.generateAllChapters', { goalId: wGoal })
    check('generateAll 默认：只派发待生成 2 章（indices 2,3）', ga.json && ga.json.ok === true && ga.json.chapters === 2 && ga.json.indices.join(',') === '2,3' && ga.json.regenerate === undefined, ga.json)
    check('generateAll 后注入目标会话 + 待生成章转 generating', injected.length === injA + 1 && (await rowOf(wGoal)).chapters.map((c) => c.status).join(',') === 'ready,generating,generating')
    {
      const t = injected[injected.length - 1].msg.content[0].text
      check('整课指令：总数/章次地图/材料清单/缺料补全标注', /一次性整理全部讲义（共 3 章）/.test(t) && /章次地图: /.test(t) && /网页课程源材料\(先通读再动笔/.test(t) && /📤 补充：非原始网页来源/.test(t) && /六段结构\(先总后分\)/.test(t) && /gap_notes: 缺部署实践/.test(t) && /teaching-prefs/.test(t), t.slice(0, 200))
      check('默认模式：就绪章仅前置、绝不重写；落盘清单只列 2/3 章', /已就绪\(勿重写，仅作前置阅读\): 第1章=/.test(t) && /绝不重写其讲义文件/.test(t) && /待你撰写落盘的章节[^。]*第2章/.test(t) && !/落盘的章节[^。]*第1章/.test(t))
    }
    check('全部 generating 时再点默认 ⚡ → 拒(没有处于「待生成」)', /没有处于「待生成」/.test((await callRpc('study.generateAllChapters', { goalId: wGoal })).json.error || ''))
    await fsp.writeFile(chFile(1), '# 正文\n' + '内容'.repeat(200))
    await fsp.writeFile(chFile(2), '# 收尾\n' + '内容'.repeat(200))
    await callRpc('study.list', {})
    check('三章全 ready ⇒ 默认 ⚡ 报「全部章节讲义已就绪」', (await rowOf(wGoal)).chapters.every((c) => c.status === 'ready') &&
      /全部章节讲义已就绪/.test((await callRpc('study.generateAllChapters', { goalId: wGoal })).json.error || ''))
    const injB = injected.length
    const gr = await callRpc('study.generateAllChapters', { goalId: wGoal, regenerate: true })
    check('regenerate=true：全 3 章覆盖派发 + 注入目标会话', gr.json && gr.json.ok === true && gr.json.chapters === 3 && gr.json.regenerate === true && injected.length === injB + 1, gr.json)
    {
      const t = injected[injected.length - 1].msg.content[0].text
      check('regenerate 指令：覆盖写入全部章，无「勿重写」段', /覆盖写入/.test(t) && !/已就绪\(勿重写/.test(t) && /各章讲义文件: /.test(t))
    }
    await callRpc('study.list', {})   // 文件在盘 → 采纳回 ready
    check('regenerate 派发后旧文件即被采纳回 ready（不毁数据）', (await rowOf(wGoal)).chapters.every((c) => c.status === 'ready'))
    check('generateAll 未知目标 → error', (await callRpc('study.generateAllChapters', { goalId: 'nope' })).json.ok === false)
  }
  await new Promise((r) => srv1.close(r))
  await new Promise((r) => srv2.close(r))
  await callRpc('study.deleteGoal', { goalId: wGoal })
}

// ── 测试单元（v0.9.0，D36）：多份追加不覆盖 + 编号预占回滚 + 扫盘收编 + 蓝图/陪练指令 + 错题本 + scope 页 ──
{
  const rowNow = async () => (await callRpc('study.list', {})).json.goals.find((g) => g.id === goalId)
  const chAbs = (name) => path.join(tmpRoot, goalId, 'chapters', name)
  const LONG = '题目与解析正文，需要超过两百字以通过落卷采纳门槛。'.repeat(12)

  // 会话内自带能力（不依赖聊天工具）：调研指令=目标测试能力，教练指令=第 6 条本章出卷能力
  {
    const ri = injected[0].msg.content[0].text
    check('调研指令自带「目标测试能力」(goal-test-NN 命名+蓝图先行+额度入卷+统一错题规则)', /【目标测试能力】/.test(ri) && /goal-test-NN\.md/.test(ri) && /错题按额度入卷/.test(ri) && /只先给蓝图/.test(ri) && /错题本记录规则/.test(ri) && /goal-mistakes\.md/.test(ri), ri.slice(-300))
    const coach = injected.find((m) => /本章学习教练/.test(m.msg.content[0].text)).msg.content[0].text
    check('教练指令第 6 条=讲义问答答错记 01-mistakes.md + 会话内出卷(先 ls 取号绝不复用)', /【错题与本章测试】/.test(coach) && /01-mistakes\.md/.test(coach) && /01-test-XX\.md/.test(coach) && /绝不复用/.test(coach) && /【错题重做｜来源/.test(coach) && /错题本记录规则/.test(coach), coach.slice(-360))
  }

  // 前置闸门
  check('generateChapterTest 未知目标 → error', (await callRpc('study.generateChapterTest', { goalId: 'nope', chapter_index: 1 })).json.ok === false)
  check('generateChapterTest 未知章节 → error', /章节不存在/.test((await callRpc('study.generateChapterTest', { goalId, chapter_index: 99 })).json.error || ''))
  check('generateChapterTest 讲义未就绪 → 拒绝出卷', /未就绪/.test((await callRpc('study.generateChapterTest', { goalId, chapter_index: 2 })).json.error || '') && ((await rowNow()).chapters[1].test || []).length === 0)
  {
    const gTmp = (await callRpc('study.createGoal', { topic: 'D36 闸门用' })).json.goalId
    check('generateGoalTest 草案批准前 → 拒(没有可覆盖全课程的材料)', /课程草案批准前/.test((await callRpc('study.generateGoalTest', { goalId: gTmp })).json.error || ''))
    await fsp.writeFile(path.join(tmpRoot, gTmp, 'draft.json'), JSON.stringify({ course: 'x', overview: 'y', chapters: [{ title: 'a' }] }))
    await callRpc('study.list', {})   // 先轮询采纳草案（approveDraft 读的是 goal.draft）
    await callRpc('study.approveDraft', { goalId: gTmp })
    check('generateGoalTest 无目标会话 → 拒(不猜不落空)', /尚未记录目标会话/.test((await callRpc('study.generateGoalTest', { goalId: gTmp })).json.error || ''))
    await callRpc('study.deleteGoal', { goalId: gTmp })
  }

  // 派发失败 → 回滚预占条目（编号不烧死）
  failInject.add('sess-ch-1'); failInject.add('sess-goal-1')
  const rFail = await callRpc('study.generateChapterTest', { goalId, chapter_index: 1 })
  check('出卷注入失败 → ok:false 且回滚条目（列表不残留 generating）', rFail.json.ok === false && /没有可用会话/.test(rFail.json.error || '') && ((await rowNow()).chapters[0].test || []).length === 0, rFail.json)
  const rFailG = await callRpc('study.generateGoalTest', { goalId })
  check('目标卷注入失败 → 同样回滚 goalTests', rFailG.json.ok === false && /派发失败/.test(rFailG.json.error || '') && ((await rowNow()).goalTests || []).length === 0, rFailG.json)
  failInject.clear()

  // 正常派发 ×2：追加编号、旧卷不覆盖
  const injN = injected.length
  const rT1 = await callRpc('study.generateChapterTest', { goalId, chapter_index: 1, requirements: '选择题10道' })
  check('📝 派发成功=优先注入本章会话 + n=1 + 01-test-01.md', rT1.json.ok === true && rT1.json.test_n === 1 && rT1.json.file === '01-test-01.md' && injected.length === injN + 1 && injected[injN].id === 'sess-ch-1', rT1.json)
  {
    const t = injected[injN].msg.content[0].text
    check('出卷指令=蓝图先行(确认前不写文件)+额度组卷(优先重错、绝不超插)+重做标注+统一错题规则', /你是出卷 AI/.test(t) && /只先给出卷蓝图/.test(t) && /先不写任何文件/.test(t) && /错题按额度匹配组卷/.test(t) && /优先标「重错」/.test(t) && /绝不超插蓝图外模块的错题/.test(t) && /【错题重做｜来源/.test(t) && /错题本记录规则/.test(t), t.slice(0, 220))
    check('出卷指令=依据本章讲义+落卷/错题本路径+附加要求优先+偏好注入+题答案分离', t.indexOf('/chapters/' + gj.chapters[0].file) > 0 && t.indexOf('01-test-01.md') > 0 && t.indexOf('01-mistakes.md') > 0 && /选择题10道/.test(t) && /用户教学偏好/.test(t) && /参考答案与解析/.test(t), t.slice(0, 300))
  }
  const rT2 = await callRpc('study.generateChapterTest', { goalId, chapter_index: 1 })
  check('重复点击=追加 01-test-02.md（旧卷不覆盖）', rT2.json.ok === true && rT2.json.test_n === 2 && rT2.json.file === '01-test-02.md', rT2.json)
  {
    const c1 = (await rowNow()).chapters[0]
    check('折叠区视图=两条 test 均 generating（失败派发没留 residue）', c1.test.length === 2 && c1.test.map((x) => x.status).join(',') === 'generating,generating', c1.test)
    const gjT = JSON.parse(await fsp.readFile(path.join(tmpRoot, goalId, 'goal.json'), 'utf8'))
    check('requirements 记入预占条目（仅本卷生效不串卷）', gjT.chapters[0].tests[0].requirements === '选择题10道' && gjT.chapters[0].tests[1].requirements === undefined, gjT.chapters[0].tests)
  }

  // file-as-truth 采纳 + 野文件收编 + 编号防撞
  await fsp.writeFile(chAbs('01-test-01.md'), '# 第 1 章测试 01\n' + LONG + '<script>alert(2)</script>\n')
  check('落卷 >200 字 → 轮询采纳 generating→ready（另一份仍 generating）', (await rowNow()).chapters[0].test.map((x) => x.status).join(',') === 'ready,generating')
  await fsp.writeFile(chAbs('01-test-09.md'), '# 盘上野卷（AI 直接写出的）\n' + LONG)
  check('adoptTestFiles 收编未登记卷（01-test-09 → ready）', (await rowNow()).chapters[0].test.some((x) => x.n === 9 && x.status === 'ready'), (await rowNow()).chapters[0].test)
  const rT3 = await callRpc('study.generateChapterTest', { goalId, chapter_index: 1 })
  check('派发前先扫盘 ⇒ 新号跳过野文件（n=10，不与 01-test-09 撞号）', rT3.json.ok === true && rT3.json.test_n === 10 && rT3.json.file === '01-test-10.md', rT3.json)

  // 会话记录 + 打开陪练
  const rrs = await callRpc('study.recordTestSession', { goalId, chapter_index: 1, test_n: 1, sessionId: 'sess-t-1' })
  check('recordTestSession ok + 幂等重记', rrs.json.ok === true && (await callRpc('study.recordTestSession', { goalId, chapter_index: 1, test_n: 1, sessionId: 'sess-t-1' })).json.ok === true, rrs.json)
  check('recordTestSession 缺 sessionId → error', (await callRpc('study.recordTestSession', { goalId, chapter_index: 1, test_n: 1, sessionId: '' })).json.ok === false)
  check('recordTestSession 缺 test_n → error', /缺少 test_n/.test((await callRpc('study.recordTestSession', { goalId, chapter_index: 1, sessionId: 'x' })).json.error || ''))
  check('recordTestSession 不存在的卷 → error', /没有测试 77|该章没有测试/.test((await callRpc('study.recordTestSession', { goalId, chapter_index: 1, test_n: 77, sessionId: 'x' })).json.error || ''))
  const rOpenGen = await callRpc('study.startTest', { goalId, chapter_index: 1, test_n: 2, sessionId: 'sess-t-2' })
  check('未落盘的卷(generating) → 「▶ 打开」被拒(不注入陪练)', rOpenGen.json.ok === false && /还没生成完毕/.test(rOpenGen.json.error || ''), rOpenGen.json)
  const injS = injected.length
  const rOpen = await callRpc('study.startTest', { goalId, chapter_index: 1, test_n: 1 })
  check('▶ 打开 ready 卷 → 注入陪练到条目已记录的 sess-t-1（缺省 sessionId）', rOpen.json.ok === true && injected.length === injS + 1 && injected[injS].id === 'sess-t-1', rOpen.json)
  {
    const t = injected[injS].msg.content[0].text
    check('陪练指令=逐题呈现+答错三讲(为什么错/考点/考点内容)+记错题+重做回标+成绩汇报', /你是陪练教练/.test(t) && /逐题呈现/.test(t) && /为什么错/.test(t) && /考点内容/.test(t) && /→ 已在 YYYY-MM-DD 重做答对/.test(t) && /错题本记录规则/.test(t) && /汇报成绩/.test(t), t.slice(0, 220))
    check('陪练指令=试卷路径+本章错题本路径(来源=01-test-01.md)', t.indexOf('01-test-01.md') > 0 && t.indexOf('01-mistakes.md') > 0)
  }
  check('startTest 后 sessionId 已记入条目', JSON.parse(await fsp.readFile(path.join(tmpRoot, goalId, 'goal.json'), 'utf8')).chapters[0].tests[0].sessionId === 'sess-t-1')

  // 错题本计数（^## 块）
  await fsp.writeFile(chAbs('01-mistakes.md'), '# 第 1 章错题本\n## 考点：缩放因子 ｜ 错于 2026-09-22 ｜ 来源 讲义问答\n**原题** …\n## 考点：KV cache ｜ 错于 2026-09-22 ｜ 来源 01-test-01.md\n**原题** …\n')
  await fsp.writeFile(path.join(tmpRoot, goalId, 'goal-mistakes.md'), '# 目标错题本\n## 考点：整卷时间分配 ｜ 错于 2026-09-22 ｜ 来源 goal-test-01.md\nx\n')
  {
    const row = await rowNow()
    check('错题计数=按 ## 块（章 2 条 / 目标 1 条）', row.chapters[0].mistakes === 2 && row.goalMistakes === 1, { m: row.chapters[0].mistakes, gm: row.goalMistakes })
  }

  // readTestFile 四个 scope + 借道拒绝 + 未知 scope
  const rtf = await callRpc('study.readTestFile', { goalId, scope: 'chapter-test', chapter_index: 1, test_n: 1 })
  check('readTestFile chapter-test → 正文+路径+标题', rtf.json.ok === true && rtf.json.filePath.indexOf('/chapters/01-test-01.md') > 0 && rtf.json.title === '第 1 章测试 01 · 注意力机制' && /题目与解析正文/.test(rtf.json.content), rtf.json && { ok: rtf.json.ok, t: rtf.json.title })
  check('readTestFile chapter-mistakes → 01-mistakes.md', (await callRpc('study.readTestFile', { goalId, scope: 'chapter-mistakes', chapter_index: 1 })).json.filePath.indexOf('/chapters/01-mistakes.md') > 0)
  check('readTestFile goal-mistakes → 目标根目录', (await callRpc('study.readTestFile', { goalId, scope: 'goal-mistakes' })).json.filePath.indexOf('/goal-mistakes.md') > 0)
  check('readTestFile 未知 scope → error', /未知 scope/.test((await callRpc('study.readTestFile', { goalId, scope: 'bogus' })).json.error || ''))
  {
    const goalJsonAbs = path.join(tmpRoot, goalId, 'goal.json')
    const gjCur = JSON.parse(await fsp.readFile(goalJsonAbs, 'utf8'))
    const savedFile = gjCur.chapters[0].tests[0].file
    gjCur.chapters[0].tests[0].file = '../goal.json'
    await fsp.writeFile(goalJsonAbs, JSON.stringify(gjCur))
    check('goal.json 被改坏(file 带相对路径) ⇒ basename 全等拦下，读不出目录外文件', /不合法/.test((await callRpc('study.readTestFile', { goalId, scope: 'chapter-test', chapter_index: 1, test_n: 1 })).json.error || ''))
    gjCur.chapters[0].tests[0].file = savedFile
    await fsp.writeFile(goalJsonAbs, JSON.stringify(gjCur))
  }

  // 目标卷派发 + 采纳
  const injG = injected.length
  const rGT = await callRpc('study.generateGoalTest', { goalId, requirements: '案例题占三成' })
  check('🎯 派发目标卷 → 注入目标会话 + goal-test-01.md', rGT.json.ok === true && rGT.json.test_n === 1 && rGT.json.file === 'goal-test-01.md' && injected[injG].id === 'sess-goal-1', rGT.json)
  {
    const t = injected[injG].msg.content[0].text
    check('目标卷指令=依据(全课程总览+全部 ready 章讲义路径)+goal 维度错题本', /目标测试（覆盖全课程）/.test(t) && /全部讲义\(出卷前用 read 逐份读完\)/.test(t) && t.indexOf(gj.chapters[0].file) > 0 && /goal-mistakes\.md/.test(t) && /goal-test-01\.md/.test(t) && /案例题占三成/.test(t), t.slice(0, 260))
  }
  check('goal-test 未落盘 → readTestFile 报「文件还不存在」', /文件还不存在/.test((await callRpc('study.readTestFile', { goalId, scope: 'goal-test', test_n: 1 })).json.error || ''))
  await fsp.writeFile(path.join(tmpRoot, goalId, 'goal-test-01.md'), '# 目标测试 01\n' + LONG)
  check('目标卷采纳 → goalTests ready', (await rowNow()).goalTests.some((x) => x.n === 1 && x.status === 'ready'), (await rowNow()).goalTests)

  // /study-file 的 scope 分支（兜底页）+ 旧行为不变
  {
    const pTest = await callPage('/study-file?goalId=' + encodeURIComponent(goalId) + '&scope=chapter-test&chapter=1&test=1')
    check('测试卷 scope 页 200 + 标题 + 注入不执行 + CSP', pTest.code === 200 && pTest.text.indexOf('<title>第 1 章测试 01 · 注意力机制</title>') > 0 && pTest.text.indexOf('<h1>第 1 章测试 01</h1>') > 0 && pTest.text.indexOf('<script>alert(2)</script>') < 0 && pTest.text.indexOf('&lt;script&gt;') >= 0 && String(pTest.headers['content-security-policy']).indexOf("default-src 'none'") === 0, { code: pTest.code, head: pTest.text.slice(0, 140) })
    check('错题本 scope 页 200', (await callPage('/study-file?goalId=' + encodeURIComponent(goalId) + '&scope=goal-mistakes')).text.indexOf('<h1>目标错题本</h1>') > 0)
    check('scope 页缺 test → 404', (await callPage('/study-file?goalId=' + encodeURIComponent(goalId) + '&scope=chapter-test&chapter=1')).code === 404)
    check('scope 页未知 scope → 404', (await callPage('/study-file?goalId=' + encodeURIComponent(goalId) + '&scope=nope')).code === 404)
    check('无 scope 参数仍走旧讲义页（行为逐字不变）', (await callPage('/study-file?goalId=' + encodeURIComponent(goalId) + '&chapter=1&format=raw')).code === 200)
  }

  // study.deleteTest：删卷 + 删测试文件 + 物理删该卷陪练会话目录（不可逆；宿主无删除会话 API）
  {
    const goalAbsDir = path.join(tmpRoot, goalId)
    const delSid = 'sess-del-1'
    const delTranscript = mockPersistence.locate({ cwd: goalAbsDir, id: delSid }).path
    await fsp.mkdir(path.dirname(delTranscript), { recursive: true })
    await fsp.writeFile(delTranscript, 'dummy-transcript-bytes-not-real-zstd')
    // 章卷 02（generating，盘上无 01-test-02.md）绑到这条真实会话目录
    await callRpc('study.recordTestSession', { goalId, chapter_index: 1, test_n: 2, sessionId: delSid })
    const rd2 = await callRpc('study.deleteTest', { goalId, chapter_index: 1, test_n: 2 })
    check('deleteTest 章卷：ok + 从 goal.json 摘除条目', rd2.json.ok === true && !(await rowNow()).chapters[0].test.some((x) => x.n === 2), rd2.json)
    check('deleteTest 物理删除该卷陪练会话目录', rd2.json.sessionRemoved === true && (await fsp.stat(path.dirname(delTranscript)).catch(() => undefined)) === undefined, { sessionRemoved: rd2.json.sessionRemoved })
    // 章卷 01（ready，盘上有 01-test-01.md，绑的是不存在的假会话 sess-t-1）
    const f1 = chAbs('01-test-01.md')
    check('前置：01-test-01.md 在盘', (await fsp.stat(f1).catch(() => undefined)) !== undefined)
    const rd1 = await callRpc('study.deleteTest', { goalId, chapter_index: 1, test_n: 1 })
    check('deleteTest ready 卷：测试文件被 unlink', rd1.json.ok === true && (await fsp.stat(f1).catch(() => undefined)) === undefined, rd1.json)
    check('deleteTest 假会话(盘无目录)：sessionRemoved 假 + note 说明，不推翻删除', rd1.json.sessionRemoved !== true && /未找到该会话/.test(rd1.json.note || ''), rd1.json)
    check('deleteTest 不动错题本（01-mistakes.md 仍在）', (await fsp.stat(chAbs('01-mistakes.md')).catch(() => undefined)) !== undefined)
    // 目标卷：绑假会话后删除，goalTests 清空且 goal-test-01.md 消失
    await callRpc('study.recordTestSession', { goalId, test_n: 1, sessionId: 'sess-g-del' })
    const rg = await callRpc('study.deleteTest', { goalId, test_n: 1 })
    check('deleteTest 目标卷：scope=goal + goalTests 清空 + 文件删除', rg.json.ok === true && rg.json.scope === 'goal' && ((await rowNow()).goalTests || []).length === 0 && (await fsp.stat(path.join(goalAbsDir, 'goal-test-01.md')).catch(() => undefined)) === undefined, rg.json)
    // 不存在的卷 → 报错，且不误伤
    check('deleteTest 不存在的目标卷 → error', /没有目标测试/.test((await callRpc('study.deleteTest', { goalId, test_n: 42 })).json.error || ''))
  }

  // study_test_generate（外部会话派发口）：缺 goal_id 拒绝 + 路由 + 透传错误
  {
    const tt = registeredTools.find((x) => x.name === 'study_test_generate')
    check('study_test_generate 已注册且 goal_id 为 required', !!tt && /goal_id/.test(JSON.stringify(tt.parameters)) && /required/.test(JSON.stringify(tt.parameters)), tt && JSON.stringify(tt.parameters))
    let noGoal
    try { noGoal = await tt.execute({}) } catch (e) { noGoal = { ok: false, error: String((e && e.message) || e) } }
    check('缺 goal_id → schema required 直接拒绝（严禁猜目标）', noGoal.ok === false && /goal_id/.test(noGoal.error || ''), noGoal)
    const noGoalDirect = await tt.execute({ goal_id: '' })
    check('handler 层兜底：goal_id 空串穿过 schema 也被拒并指引 study_plan_status', noGoalDirect.ok === false && /study_plan_status/.test(noGoalDirect.error || ''), noGoalDirect)
    const badCh = await tt.execute({ goal_id: goalId, chapter_index: '2' })
    check('chapter_index 字符串→数字路由；未就绪错误原样透传', badCh.ok === false && /未就绪/.test(badCh.error || ''), badCh)
    const injTT = injected.length
    const okG = await tt.execute({ goal_id: goalId, requirements: '外部会话要卷' })
    check('不带 chapter_index ⇒ 派发目标卷(n=2) + message 指向蓝图确认', okG.ok === true && okG.test_n === 2 && injected[injTT].id === 'sess-goal-1' && /蓝图/.test(okG.message || ''), okG)
    const st = await (registeredTools.find((x) => x.name === 'study_plan_status')).execute({})
    const srow = st.goals.find((x) => x.id === goalId)
    check('study_plan_status 回带 tests_ready/goal_tests_ready/mistakes_total', srow.tests_ready === 2 && srow.goal_tests_ready === 1 && srow.mistakes_total === 3, srow && { t: srow.tests_ready, g: srow.goal_tests_ready, m: srow.mistakes_total })
  }
}

  // ── M4 前置：用真 locate 造出该目标的会话 transcript（目标会话 + 章节会话 + 空 subagent 会话）
  const goalAbsDir = path.join(tmpRoot, goalId)
  const ev = (type, seq, data, extra) => JSON.stringify(Object.assign({ type, seq, time: 1788000100000 + seq, data }, extra || {}))
  async function makeSession(sid, cwd, rows) {
    const abs = mockPersistence.locate({ cwd, id: sid }).path
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    const gm = /\.v(\d+)\./.exec(path.basename(abs))   // 宿主校验：代际文件名 vN 必须与 header version 一致
    const lines = [JSON.stringify({ type: 'session', version: gm ? Number(gm[1]) : 0, id: sid, createdAt: 1788000000000, cwd, delegationDepth: 0, agentPreset: 'standard' }), ...rows]
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
    // 宿主 rc.2 的 sessionPersistence 无 inspect() ⇒ 与插件侧同口径按能力降级，只保证字节可读
    if (typeof mockPersistence.inspect === 'function') {
      const v = await mockPersistence.inspect(sid)
      if (!v || !v.meta) throw new Error('测试前置数据未被宿主认账: ' + sid)
    } else if (!mockPersistence.locate({ cwd: goalAbsDir, id: sid }).path) {
      throw new Error('测试前置数据不可定位: ' + sid)
    }
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
  check('教学偏好随包旅行(D34: meta/teaching-prefs.md 入包)', zentries.has('meta/teaching-prefs.md') && /先总后分/.test(zentries.get('meta/teaching-prefs.md').toString('utf8')), [...zentries.keys()].filter((k) => k.startsWith('meta/')))
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
  await fsp.rm(prefsAbs, { force: true })
  await fsp.writeFile(path.join(tmpRoot, 'index.json'), JSON.stringify({ goals: [] }, null, 2))
  const insp = await callRpc('study.inspectImport', { path: rE.json.path })
  check('inspectImport 预览 ok 且无冲突', insp.json && insp.json.ok === true && insp.json.canImport === true && insp.json.conflicts.length === 0, insp.json && insp.json.conflicts)
  check('预览给出每条身份与动作', insp.json.plan.sessions.length === 3 && insp.json.plan.sessions.every((x) => x.identity === 'fresh' && x.action === 'create'), insp.json.plan.sessions.map((x) => [x.identity, x.action]))
  check('预览列出会话/附件/章节计数', insp.json.plan.sessionCount === 3 && insp.json.plan.attachments === 1 && insp.json.plan.chapters === 2, insp.json.plan)
  const imp = await callRpc('study.importGoal', { path: rE.json.path, confirm: true })
  check('importGoal ok 且 goalId 沿用包内值', imp.json && imp.json.ok === true && imp.json.goalId === exportedGoalId, imp.json)
  check('导入还原了目标目录树', !!(await fsp.stat(path.join(goalAbsDir, 'goal.json')).catch(() => undefined)) && !!(await fsp.stat(path.join(goalAbsDir, 'demo.py')).catch(() => undefined)), imp.json)
  {
    const prefsBack = await fsp.readFile(prefsAbs, 'utf8').catch(() => '')
    check('导入重建全局教学偏好(D34: meta/ → _meta/)', /先总后分/.test(prefsBack) && (prefsBack.match(/先总后分/g) || []).length === 1, prefsBack)
    await fsp.appendFile(prefsAbs, '- 2026-09-20 本机独有偏好行\n')
    const impAgain = await callRpc('study.importGoal', { path: rE.json.path, confirm: true })
    const prefsMerged = await fsp.readFile(prefsAbs, 'utf8').catch(() => '')
    check('二次导入=偏好行级并集不重复且保留本机行(D34)', impAgain.json && impAgain.json.ok === true && /本机独有偏好行/.test(prefsMerged) && (prefsMerged.match(/先总后分/g) || []).length === 1, prefsMerged)
  }
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
  check('导入自检 verified 与宿主能力一致(rc.2 无 inspect ⇒ false 属诚实降级)', imp.json.ok === true && imp.json.verified === (typeof mockPersistence.inspect === 'function'), { verified: imp.json.verified, hostInspect: typeof mockPersistence.inspect })
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
  check('快进行数正确（宿主有 inspect 时再加认账）', (await rowsOf('sess-goal-1', goalAbsDir)) === baseRows + 3 && (typeof mockPersistence.inspect !== 'function' || !!(await mockPersistence.inspect('sess-goal-1'))), await rowsOf('sess-goal-1', goalAbsDir))
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
  check('8 个工具注册', names.join(',') === 'study_goal_export,study_goal_import,study_plan_approve,study_plan_create,study_plan_reject,study_plan_research,study_plan_status,study_test_generate', names)
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
