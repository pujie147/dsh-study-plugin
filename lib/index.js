// ============================================================================
// study-plugin — 宿主半（静态持久化版，M1+M2）
// 形态: profile 组合插件（cordis patch row 挂载，DSH 启动时自动装载，任何模式/会话可见）。
// M1: /study-rpc webServer prefix 路由（学习区面板全部 study.* RPC）+ README 同步。
// M2: study_plan_* 五个聊天工具（defineTool(@deepseek-ai/dsh-tools) + sctx.tools.register）。
//
// 与动态版 src/host.js 的对照（契约完全一致，仅基础设施不同）:
//   - fs 服务(fsService.resolve/stat/readText/writeText) → node:fs/promises（宿主平面受信）
//   - harness.handle('study.*', fn)                     → handlers['study.*'] + webServer 路由分发
//   - harness.defineTool + registerTool(ctx, tool)       → defineTool 静态版 + sctx.tools.register
//   - ctx.get('agents'|'workspaceRegistry')             → ctx.inject([...]) 注入同名服务
//   - console.log/error                                  → 同（宿主进程 console 可用）
// ============================================================================
import { promises as fsp } from 'node:fs'
import { randomUUID, createHash } from 'node:crypto'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import * as P from './portable.js'

// ── M2 前置：静态 defineTool 解析（带降级）。解析失败只缺聊天工具，绝不拖垮 M1 路由/面板。
let defineTool
try {
  defineTool = (await import('@deepseek-ai/dsh-tools')).defineTool
} catch {
  try {
    const { createRequire } = await import('node:module')
    const resolved = createRequire(new URL('./package.json', import.meta.url)).resolve('@deepseek-ai/dsh-tools')
    defineTool = (await import(pathToFileURL(resolved).href)).defineTool
  } catch {
    defineTool = undefined
  }
}

const name = 'study-engine'
export { name }

const errText = (e) => {
  const m = e && e.message ? String(e.message) : String(e)
  return m.length > 400 ? m.slice(0, 400) : m
}
const slug = (s, fallback) => {
  const out = String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
  return out || fallback || 'item'
}
const pad2 = (n) => String(n).padStart(2, '0')
const nowISO = () => new Date().toISOString()
let msgSeq = 0
const nextMsgId = () => 'study-' + Date.now().toString(36) + '-' + (msgSeq++).toString(36)

function stripUndefined(v) {
  if (Array.isArray(v)) {
    for (let i = 0; i < v.length; i++) v[i] = stripUndefined(v[i])
    return v
  }
  if (v !== null && typeof v === 'object') {
    for (const k of Object.keys(v)) {
      if (v[k] === undefined) delete v[k]
      else v[k] = stripUndefined(v[k])
    }
    return v
  }
  return v
}
/** HTML 文本转义：一切外来内容先过这里再拼标签（& 必须最先替换）。 */
function escapeHtml(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}
function makeUserMessage(text) {
  return {
    id: nextMsgId(),
    role: 'user',
    content: [{ type: 'text', text: String(text) }],
    source: { kind: 'user' }
  }
}

export function apply(ctx, config) {
  const BASE = (config && config.workRoot) || (os.homedir() + '/.dsh/study-work')
  const INDEX = BASE + '/index.json'
  const README_PATH = BASE + '/README.md'

  // ── M4 前置：可携化（导出/导入）需要的宿主服务。单独一条 inject ——
  // 服务缺席时只有导出/导入降级为「服务不可用」，面板与 study_plan_* 不受影响（同 M2 手法）。
  const portableDeps = { persistence: undefined, sessions: undefined, attachments: undefined, ready: false }
  ctx.inject(['sessionPersistence', 'sessions', 'attachments'], (pctx) => {
    portableDeps.persistence = pctx.sessionPersistence
    portableDeps.sessions = pctx.sessions
    portableDeps.attachments = pctx.attachments
    const missing = []
    if (!portableDeps.persistence) missing.push('sessionPersistence')
    if (!portableDeps.sessions) missing.push('sessions')
    if (!portableDeps.attachments) missing.push('attachments')
    portableDeps.ready = missing.length === 0
    if (portableDeps.ready) console.log('study-plugin: portable deps ready (导出/导入可用)')
    else console.error('study-plugin: 可携化服务缺席，导出/导入将报错: ' + missing.join(', '))
  })

  ctx.inject(['webServer', 'agents', 'workspaceRegistry', 'tools'], (sctx) => {
    const agents = sctx.agents
    const wsRegistry = sctx.workspaceRegistry

    function injectToSession(sessionId, text) {
      const agent = (agents && sessionId) ? agents.get(sessionId) : undefined
      if (!agent || typeof agent.followup !== 'function') throw new Error('会话代理未激活，请先打开该会话')
      agent.followup(makeUserMessage(text))
      return true
    }

    async function readJson(absPath) {
      let st
      try { st = await fsp.stat(absPath) } catch { return undefined }
      if (!st) return undefined
      return JSON.parse(await fsp.readFile(absPath, 'utf8'))
    }
    async function writeJson(absPath, data) {
      await fsp.mkdir(path.dirname(absPath), { recursive: true })
      await fsp.writeFile(absPath, JSON.stringify(data, null, 2))
    }
    async function readTextFile(absPath) {
      let st
      try { st = await fsp.stat(absPath) } catch { return undefined }
      if (!st) return undefined
      return fsp.readFile(absPath, 'utf8')
    }
    async function readIndex() {
      const idx = await readJson(INDEX)
      return idx && Array.isArray(idx.goals) ? idx : { goals: [] }
    }
    async function writeIndex(idx) { await writeJson(INDEX, idx) }
    async function loadGoal(goalId) {
      const idx = await readIndex()
      const row = (idx.goals || []).find((g) => g.id === goalId)
      if (!row) return undefined
      return readJson(row.path + '/goal.json')
    }
    async function saveGoal(goal) {
      const abs = BASE + '/' + goal.dir + '/goal.json'
      await writeJson(abs, goal)
      const idx = await readIndex()
      const row = (idx.goals || []).find((g) => g.id === goal.id)
      if (row) {
        row.status = goal.status
        row.title = goal.title
        row.updatedAt = goal.updatedAt
        await writeIndex(idx)
      }
    }
    async function goalDir(goal) { return BASE + '/' + goal.dir }

    async function adoptDraftFile(goal) {
      if (goal.status !== 'researching') return false
      const raw = await readTextFile((await goalDir(goal)) + '/draft.json')
      if (raw === undefined || raw.trim() === '') return false
      let data
      try {
        data = JSON.parse(raw)
      } catch (e) {
        return false
      }
      if (!data || !Array.isArray(data.chapters) || !data.chapters.length) return false
      goal.draft = {
        course: String(data.course || goal.topic || ''),
        overview: String(data.overview || ''),
        chapters: data.chapters.map((c, i) => ({
          index: i + 1,
          title: String(c.title || ('第' + (i + 1) + '章')),
          summary: String(c.summary || ''),
          est_hours: c.est_hours === undefined || c.est_hours === null ? undefined : Math.max(0.5, Number(c.est_hours) || 1),
          focus_points: Array.isArray(c.focus_points) ? c.focus_points.map(String) : []
        })),
        created_at: nowISO(),
        approved: false,
        lastError: undefined
      }
      goal.status = 'draft_pending'
      goal.updatedAt = nowISO()
      await saveGoal(goal)
      return true
    }

    async function adoptChapterFiles(goal) {
      let changed = false
      for (const ch of (goal.chapters || [])) {
        if (ch.status !== 'draft' && ch.status !== 'generating') continue
        const raw = await readTextFile((await goalDir(goal)) + '/chapters/' + ch.file)
        if (raw !== undefined && raw.trim().length > 200) {
          ch.status = 'ready'
          changed = true
        }
      }
      if (changed) {
        if (goal.status === 'approved') goal.status = 'active'
        goal.updatedAt = nowISO()
        await saveGoal(goal)
      }
    }

    async function clearDraftFile(absDir) {
      try {
        const p = absDir + '/draft.json'
        let st
        try { st = await fsp.stat(p) } catch { return }
        if (st !== undefined) await fsp.writeFile(p, '')
      } catch (e) {}
    }

    const researchInstruction = (g, absDir) => {
      const dir = absDir.replace(/\\/g, '/')
      return '你是课程规划 AI。请为「' + g.topic + '」规划一套学习课程（目标水平: ' + (g.target_level || '未说明') + (g.requirements ? '；附加要求: ' + g.requirements : '') + '）。\n'
        + '步骤: 1) 使用网络搜索工具(如 web_search/web_fetch)调研该主题公认的学习路径与关键知识点(2-5 次检索)；若检索工具不可用则基于你的知识。\n'
        + '2) 按主题的自然知识结构(不要按学时)切分为若干章节(通常 5-10 章)，从基础到目标水平递进。\n'
        + '3) 把结果以 JSON 写入文件 ' + dir + '/draft.json，结构: {"course":"课程名","overview":"总体路径说明(一两句)","chapters":[{"title":"章节标题","summary":"本章学什么/为什么","est_hours":建议学习小时数(可省),"focus_points":[3-6个核心知识点字符串]}]}。若你没有文件写入工具，则把同一 JSON 作为纯文本回复(不要用代码围栏)。\n'
        + '4) 完成后用一句话回复: 草案已生成(共 N 章)，并列出每章标题。'
    }
    const retryInstruction = (g, absDir, reason) => {
      const dir = absDir.replace(/\\/g, '/')
      return '请重新为「' + g.topic + '」调研并规划课程(目标: ' + (g.target_level || '未说明') + ')。上次意见: ' + (reason || '请更贴近主题自然结构') + '。\n'
        + '步骤同前: 联网调研 → 按自然章节切分 → 将 JSON 写入 ' + dir + '/draft.json（结构不变；无文件工具则纯文本回复 JSON）。完成后一句话列出章节。'
    }

    async function createGoalDoc(topicRaw, targetRaw, reqRaw) {
      const topic = String(topicRaw || '').trim()
      if (!topic) throw new Error('主题不能为空')
      const goalId = 'goal-' + Date.now().toString(36) + '-' + slug(topic, 'study')
      const absDir = BASE + '/' + goalId
      const now = nowISO()
      const goal = {
        id: goalId, dir: goalId, title: topic, topic: topic,
        target_level: String(targetRaw || '').trim() || '未说明',
        requirements: String(reqRaw || '').trim(),
        status: 'researching', createdAt: now, updatedAt: now,
        diagnostic: undefined, draft: undefined, chapters: [], reviewItems: [],
        sessionId: undefined, workspaceId: undefined, completedAt: undefined,
        // research = { dispatchedAt, sessionId, source }：调研指令「已派发」的事实；status=researching 本身不代表 AI 在跑
        research: undefined
      }
      await writeJson(absDir + '/goal.json', goal)
      const idx = await readIndex()
      idx.goals.push({ id: goal.id, title: goal.title, status: goal.status, createdAt: now, updatedAt: now, path: absDir })
      await writeIndex(idx)
      let workspaceId = ''
      if (wsRegistry) {
        try {
          let ws = await wsRegistry.resolveByPath(absDir)
          if (!ws) ws = await wsRegistry.create(absDir, topic)
          workspaceId = String(ws && ws.id)
          if (workspaceId) {
            goal.workspaceId = workspaceId
            await writeJson(absDir + '/goal.json', goal)
          }
        } catch (e) {}
      }
      return { goalId: goalId, workspaceId: workspaceId, absDir: absDir }
    }

    async function approveGoal(g) {
      if (!g.draft || !Array.isArray(g.draft.chapters) || !g.draft.chapters.length) throw new Error('没有可批准的草案：请先调研并生成草案')
      g.chapters = g.draft.chapters.map((c) => ({
        index: c.index, title: c.title, summary: c.summary || '', est_hours: c.est_hours, focus_points: c.focus_points || [],
        file: pad2(c.index) + '-' + slug(c.title, 'chapter') + '.md', status: 'draft', sessionId: undefined,
        qaFile: pad2(c.index) + '-qa.md'
      }))
      g.draft.approved = true
      g.draft.approved_at = nowISO()
      g.status = 'approved'
      g.updatedAt = nowISO()
      await saveGoal(g)
      return (g.chapters || []).length
    }

    async function rejectGoal(g, reasonRaw) {
      const reason = String(reasonRaw || '')
      g.draft = g.draft ? Object.assign(g.draft, { rejected: true, reject_reason: reason || '用户重新考虑', approved: false }) : undefined
      g.status = 'researching'
      g.research = undefined // 退回后草案已清空，等于「未派发」；面板据此给出「开始调研」出口
      g.updatedAt = nowISO()
      await saveGoal(g)
      await clearDraftFile(await goalDir(g))
    }

    // 「调研指令已派发」是事实，必须由真正注入成功的地方记录（status='researching' 只是建档初值）
    async function markResearchDispatched(g, sessionId, source) {
      g.research = { dispatchedAt: nowISO(), sessionId: String(sessionId || ''), source: String(source || '') }
      g.updatedAt = nowISO()
      await saveGoal(g)
    }
    const researchDispatched = (g) => !!(g && g.research && g.research.dispatchedAt)
    const researchDispatchedAt = (g) => (g && g.research && g.research.dispatchedAt) || undefined

    async function listSummary() {
      const idx = await readIndex()
      const out = []
      for (const row of (idx.goals || [])) {
        const g = await readJson(row.path + '/goal.json')
        if (!g || g.status === 'deleted') continue
        try { await adoptDraftFile(g) } catch (e) {}
        try { await adoptChapterFiles(g) } catch (e) {}
        out.push({
          id: g.id,
          title: g.title,
          status: g.status || 'unknown',
          target_level: g.target_level || '',
          requirements: g.requirements || '',
          updatedAt: g.updatedAt,
          workspaceId: g.workspaceId || undefined,
          sessionId: g.sessionId || undefined,
          researchDispatched: researchDispatched(g),
          researchDispatchedAt: researchDispatchedAt(g),
          draft: g.draft ? {
            overview: g.draft.overview || '',
            approved: g.draft.approved === true,
            lastError: g.draft.lastError || '',
            chapters: Array.isArray(g.draft.chapters) ? g.draft.chapters.map((c) => ({ index: c.index, title: c.title, summary: c.summary, est_hours: c.est_hours === undefined ? null : c.est_hours, focus_points: c.focus_points || [] })) : []
          } : null,
          chapters: Array.isArray(g.chapters) ? g.chapters.map((c) => ({
            index: c.index,
            title: c.title,
            file: c.file,
            status: c.status === 'done' ? 'ready' : (c.status || 'draft'),
            sessionId: c.sessionId || undefined,
            lastError: c.lastError || ''
          })) : [],
          path: row.path
        })
      }
      return out
    }

    // ------------------------------------------------------------------ RPC（学习区面板 study.*，与动态版同契约）
    const handlers = {}

    handlers['study.list'] = async () => stripUndefined({ goals: await listSummary() })

    handlers['study.createGoal'] = async (args) => {
      try {
        const r = await createGoalDoc(args && args.topic, args && args.target_level, args && args.requirements)
        return { ok: true, goalId: r.goalId, workspaceId: r.workspaceId }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    }

    handlers['study.startResearch'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const sessionId = String((args && args.sessionId) || '')
      if (sessionId) g.sessionId = sessionId
      g.status = 'researching'
      g.updatedAt = nowISO()
      await saveGoal(g)
      await clearDraftFile(await goalDir(g))
      const absDir = await goalDir(g)
      try {
        injectToSession(sessionId, researchInstruction(g, absDir))
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
      await markResearchDispatched(g, sessionId, 'panel-create')
      return { ok: true }
    }

    handlers['study.retryResearch'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      if (!g.sessionId) return { ok: false, error: '尚未记录目标会话，请先点「打开会话」' }
      g.status = 'researching'
      g.updatedAt = nowISO()
      await saveGoal(g)
      const absDir = await goalDir(g)
      await clearDraftFile(absDir)
      const reason = (g.draft && g.draft.reject_reason) ? String(g.draft.reject_reason) : ''
      try {
        injectToSession(g.sessionId, retryInstruction(g, absDir, reason))
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
      await markResearchDispatched(g, g.sessionId, 'panel-retry')
      return { ok: true }
    }

    handlers['study.approveDraft'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      try {
        const n = await approveGoal(g)
        return { ok: true, chapters: n }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    }

    handlers['study.rejectDraft'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      try {
        await rejectGoal(g, args && args.reason)
        return { ok: true }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    }

    const buildGenInstruction = (g, ch, absDir) => {
      const absCh = absDir.replace(/\\/g, '/') + '/chapters/' + ch.file
      return '请撰写第 ' + ch.index + ' 章「' + ch.title + '」的讲义。\n'
        + '定位: ' + (ch.summary || '') + '；核心知识点: ' + (ch.focus_points || []).join('、') + '；学习者目标: ' + (g.target_level || '') + '。\n'
        + (g.requirements ? '风格要求: ' + g.requirements + '\n' : '')
        + '把完整 Markdown 讲义写入文件 ' + absCh + '（若工具允许写文件）；结构: 标题→本章学习目标→正文(分节、示例/类比/常见误区)→动手练习→本章小结。中文。若无写文件工具，请在回复中输出完整 Markdown。'
    }

    handlers['study.generateChapter'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const idx = Number(args && args.chapter_index)
      const ch = (g.chapters || []).find((c) => c.index === idx)
      if (!ch) return { ok: false, error: '章节不存在' }
      ch.status = 'generating'
      g.updatedAt = nowISO()
      await saveGoal(g)
      const absDir = await goalDir(g)
      const instruction = buildGenInstruction(g, ch, absDir)
      if (ch.sessionId) {
        try { injectToSession(ch.sessionId, instruction); return { ok: true, mode: 'session' } } catch (e) {}
      }
      try {
        if (g.sessionId) { injectToSession(g.sessionId, instruction); return { ok: true, mode: 'goal-session' } }
      } catch (e) {}
      ch.status = 'draft'
      g.updatedAt = nowISO()
      await saveGoal(g)
      return { ok: false, error: '没有可用会话执行讲义生成，请先打开目标或章节会话后再试' }
    }

    handlers['study.continueChapter'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const idx = Number(args && args.chapter_index)
      const ch = (g.chapters || []).find((c) => c.index === idx)
      if (!ch) return { ok: false, error: '章节不存在' }
      const absDir = await goalDir(g)
      const chPath = absDir.replace(/\\/g, '/') + '/chapters/' + ch.file
      try {
        const raw = await readTextFile(chPath)
        if (raw !== undefined && raw.trim().length > 200) {
          ch.status = 'ready'
          if (g.status === 'approved') g.status = 'active'
          g.updatedAt = nowISO()
          await saveGoal(g)
          return { ok: true, result: 'ready', message: '讲义其实已生成完毕，已标记「讲义就绪」' }
        }
      } catch (e) {}
      const sessionId = String(ch.sessionId || g.sessionId || '')
      const agent = (agents && sessionId) ? agents.get(sessionId) : undefined
      if (!sessionId || !agent) {
        ch.status = 'draft'
        g.updatedAt = nowISO()
        await saveGoal(g)
        return { ok: false, need_open: true, error: '会话未激活：已改回「待生成」。请先打开' + (ch.sessionId ? '该章节会话' : '该目标会话（📄 打开会话）') + '，再点「生成讲义」继续' }
      }
      ch.status = 'generating'
      g.updatedAt = nowISO()
      await saveGoal(g)
      try {
        injectToSession(sessionId, buildGenInstruction(g, ch, absDir))
      } catch (e) {
        ch.status = 'draft'
        g.updatedAt = nowISO()
        await saveGoal(g)
        return { ok: false, need_open: true, error: '注入失败，已改回「待生成」：' + errText(e) }
      }
      return { ok: true, result: 'generating', message: '已重新发送讲义生成任务' }
    }

    handlers['study.recordChapterSession'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const idx = Number(args && args.chapter_index)
      const ch = (g.chapters || []).find((c) => c.index === idx)
      if (!ch) return { ok: false, error: '章节不存在' }
      ch.sessionId = String((args && args.sessionId) || '')
      g.updatedAt = nowISO()
      await saveGoal(g)
      return { ok: true }
    }

    handlers['study.startChapter'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const idx = Number(args && args.chapter_index)
      const ch = (g.chapters || []).find((c) => c.index === idx)
      if (!ch) return { ok: false, error: '章节不存在' }
      const sessionId = String((args && args.sessionId) || ch.sessionId || '')
      if (sessionId) ch.sessionId = sessionId
      g.updatedAt = nowISO()
      await saveGoal(g)
      const absDir = await goalDir(g)
      const chDir = absDir.replace(/\\/g, '/') + '/chapters'
      const filePath = chDir + '/' + ch.file
      const qaFilePath = chDir + '/' + pad2(idx) + '-qa.md'
      const notesDir = chDir + '/' + pad2(idx) + '-notes'
      const instruction = '你是本章学习教练。这是学习目标「' + g.topic + '」的第 ' + ch.index + ' 章「' + ch.title + '」。\n'
        + '本章讲义文件: ' + filePath + '\n'
        + '本章补充目录: ' + notesDir + '\n\n'
        + '## 教学流程\n'
        + '1) 先用 read 工具读取讲义文件，基于讲义内容给出本章学习目标与关键要点概览。\n'
        + '2) 等待学习者提问，逐点讲解、举例、设问。你的讲解应以讲义为基础，但可以展开补充。\n'
        + '3) 【重要·回写机制】每次回答后，自检你的回答是否包含讲义中没有的有价值补充内容（新示例、新角度、易错点、实战技巧、深入解析等）。\n'
        + '   - 如果有，在回答末尾附上：💡 *这个回答中有内容可以补充到讲义，是否回写？（回复「回写」即可）*\n'
        + '   - 如果回答内容完全在讲义范围内，无需提示回写。\n'
        + '   - 学习者回复「回写」时，严格按以下步骤操作：\n'
        + '     ① 为补充内容确定一个简短主题名（如"梯度消失问题"），转为文件名 slug（如 jidu-xiaoshi.md）。\n'
        + '     ② 检查 ' + notesDir + '/ 下是否已存在该主题的 .md 文件：\n'
        + '        - 已存在 → 用 edit 在文件末尾追加一个新段落（带日期标题 ## 来自问答 YYYY-MM-DD），写入详细内容。\n'
        + '        - 不存在 → 用 write 创建新文件，标题为该主题名，内容为详细补充（含示例、解释、图示描述等完整信息）。\n'
        + '     ③ 在讲义文件的相关小节末尾，用 edit 插入一行总结性引用（不超过 2-3 句话），格式严格为：\n'
        + '        `> 💡 [补充：主题名](' + pad2(idx) + '-notes/slug.md) — 一句话概括核心要点`\n'
        + '        注意：只插入这一行总结+链接，绝不把详细内容直接写入讲义正文，以保持讲义结构清晰。\n'
        + '     ④ 告知学习者：「✅ 已补充到讲义，详细内容见 [主题名](链接)」。\n'
        + '4) 学习者说「结束」时总结本章要点，并询问是否把问答要点写入 ' + qaFilePath + '。中文交流。'
      try {
        injectToSession(sessionId, instruction)
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
      return { ok: true }
    }

    // 面板「打开讲义」的数据口：确认讲义已生成并回出绝对路径 —— 路径交给 client 侧的
    // betterSidebar 服务（DSH-better-sidebar）开成右侧页签，它不在时客户端才 window.open
    // /study-file，由服务端渲染正文。
    // ch.file 来自 goal.json（AI 生成/导入可变），basename 全等校验防借道读出目录外的文件。
    handlers['study.readChapter'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const idx = Number(args && args.chapter_index)
      const ch = (g.chapters || []).find((c) => c.index === idx)
      if (!ch) return { ok: false, error: '章节不存在' }
      const absDir = await goalDir(g)
      const filePath = absDir.replace(/\\/g, '/') + '/chapters/' + ch.file
      const fileName = path.basename(String(ch.file || ''))
      if (!fileName || fileName !== ch.file) return { ok: false, error: '章节文件名不合法' }
      const content = await readTextFile(filePath)
      if (content === undefined) return { ok: false, error: '讲义文件还不存在：请先点「生成讲义」' }
      return { ok: true, content: content, filePath: filePath, title: ch.title }
    }

    handlers['study.deleteGoal'] = async (args) => {
      const goalId = String(args && args.goalId)
      const idx = await readIndex()
      const row = (idx.goals || []).find((g) => g.id === goalId)
      if (!row) return { ok: false, error: '目标不存在' }
      idx.goals = (idx.goals || []).filter((g) => g.id !== goalId)
      await writeIndex(idx)
      try {
        const g = await readJson(row.path + '/goal.json')
        if (g) {
          g.status = 'deleted'
          g.updatedAt = nowISO()
          await writeJson(row.path + '/goal.json', g)
        }
      } catch (e) {}
      return { ok: true }
    }

    handlers['study.ensureGoalWorkspace'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const absDir = await goalDir(g)
      if (!wsRegistry) return { ok: false, error: '工作区注册表服务不可用' }
      try {
        let ws = await wsRegistry.resolveByPath(absDir)
        if (!ws) ws = await wsRegistry.create(absDir, g.title || g.topic)
        const wid = String(ws && ws.id)
        if (!wid) return { ok: false, error: '工作区创建失败' }
        if (g.workspaceId !== wid) {
          g.workspaceId = wid
          g.updatedAt = nowISO()
          await saveGoal(g)
        }
        return { ok: true, workspaceId: wid, path: absDir }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    }

    handlers['study.recordGoalSession'] = async (args) => {
      const g = await loadGoal(String(args && args.goalId))
      if (!g) return { ok: false, error: '目标不存在' }
      const sessionId = String((args && args.sessionId) || '')
      if (!sessionId) return { ok: false, error: '缺少 sessionId' }
      g.sessionId = sessionId
      g.updatedAt = nowISO()
      await saveGoal(g)
      return { ok: true, sessionId: sessionId }
    }

    // 面板「▶ 开始调研 / 🔁 重新调研」的派发口：直接复用聊天侧 chatResearch（它是派发调研的
    // 唯一 owner —— 会解析目标会话、按 reject_reason 选首次/重试指令、记录派发事实）。
    handlers['study.dispatchResearch'] = async (args) => {
      const r = await chatResearch({ goal_id: String((args && args.goalId) || ''), source: 'panel' })
      return r && r.ok === true ? { ok: true, sessionId: r.session_id, message: r.message } : (r || { ok: false, error: '派发失败' })
    }

    // ══════════════════════════════════════════════════════════════════
    // M4: 目标可携化 —— 导出 zip / 从 zip 导入
    // 契约（详见仓库 docs/design/export-import-scope.md，2026-09-09 确认）:
    //   导出 = 目标目录整棵树（goal/chapters/notes/工作区内任意文件）
    //          + 该目标工作区「项目目录」下全部会话 transcript（逐字节 zstd 原文）
    //          + 会话正文引用的附件对象（内容寻址）
    //          + 工作区登记 row（仅作信息，导入侧走公开 API 重建，绝不覆盖全局 workspace.json）
    //          + manifest.json（格式版本 / 文件 sha256 / 会话 header / 路径改写信息 / warnings）
    //   导入 = 落盘（跨路径时只重写会话 header 帧的 cwd）→ 宿主 inspect() 自检 → 失败回滚
    //          → index.json 合并 + workspaceRegistry.create + ws.attachSession
    // 明确不含: 凭据/设置/日志/缓存(session_projcache)/插件快照/.mnemon 工作区记忆/其它目标
    // ══════════════════════════════════════════════════════════════════
    const EXPORTS_DIR = BASE + '/exports'
    // v2：会话带 remoteId/maxSeq/lastTime/rows/blank/origin，包带 deviceId —— 为覆盖式同步铺垫。
    // v1 的包仍可导入（缺字段按 unknown 处理）。
    const EXPORT_FORMAT_VERSION = 2
    const SUPPORTED_FORMAT_VERSIONS = [1, 2]
    const SYNC_FILE = '.study-sync.json'          // 设备本地身份账本：导出排除、绝不从包恢复
    const DEVICE_FILE = BASE + '/device.json'
    const MAX_BACKUP_BYTES = 64 * 1024 * 1024     // 事务内保留被覆盖 transcript 原字节的总预算
    const MAX_GOAL_FILE_BYTES = 20 * 1024 * 1024
    const MAX_ZIP_BYTES = 400 * 1024 * 1024
    const MAX_DECODE_BYTES = 60 * 1024 * 1024
    const SKIP_DIRS = ['.mnemon', '.git', '.idea', '.vscode', 'node_modules', '__pycache__', '.venv', 'venv', '.pytest_cache', '.dsh-tmp']
    const SKIP_FILE_RE = /(^|[\\/])(Thumbs\.db|desktop\.ini|\.DS_Store)$|[.~](tmp|lock|part|swp|bak)$/i

    async function statOpt(p) { try { return await fsp.stat(p) } catch { return undefined } }
    const expandHomePath = (p) => {
      const s = String(p || '').trim()
      if (s === '~') return os.homedir()
      if (s.startsWith('~/') || s.startsWith('~\\')) return path.join(os.homedir(), s.slice(2))
      return s
    }
    const safeSeg = (s) => String(s).replace(/[^A-Za-z0-9_-]/g, '_')
    const stampNow = () => {
      const d = new Date()
      return String(d.getFullYear()) + pad2(d.getMonth() + 1) + pad2(d.getDate()) + '-' + pad2(d.getHours()) + pad2(d.getMinutes()) + pad2(d.getSeconds())
    }

    /** 目标目录整棵树 → zip 条目（goal/<相对路径>）。 */
    async function walkGoalDir(absDir, relDir, entries, warnings) {
      let items
      try { items = await fsp.readdir(absDir, { withFileTypes: true }) } catch { return }
      for (const it of items) {
        const abs = path.join(absDir, it.name)
        const rel = relDir ? relDir + '/' + it.name : it.name
        if (it.isDirectory()) {
          if (SKIP_DIRS.includes(it.name)) { warnings.push('跳过目录 ' + rel + '/（非学习内容）'); continue }
          await walkGoalDir(abs, rel, entries, warnings)
          continue
        }
        if (!it.isFile()) { warnings.push('跳过非常规文件 ' + rel); continue }
        if (rel === SYNC_FILE) continue  // 设备本地身份账本：不随包旅行（导入侧自己生成）
        if (SKIP_FILE_RE.test(rel)) continue
        const st = await statOpt(abs)
        if (!st) continue
        if (st.size > MAX_GOAL_FILE_BYTES) { warnings.push('跳过大文件 ' + rel + '（' + st.size + ' B > ' + MAX_GOAL_FILE_BYTES + ' B）'); continue }
        entries.push({ name: 'goal/' + rel, data: await fsp.readFile(abs), mtime: st.mtime })
      }
    }

    /** 由目标目录绝对路径 → 宿主会话「项目目录」（不自己复刻 projectKey，走 locate）。 */
    function projectDirOf(absCwd) {
      const pp = portableDeps.persistence
      if (!pp || typeof pp.locate !== 'function') throw new Error('会话持久化服务不可用，无法定位会话目录')
      const loc = pp.locate({ cwd: absCwd, id: 'study-probe' })
      return path.dirname(path.dirname(loc.path))
    }
    function sessionTargetPath(absCwd, sessionId) {
      const pp = portableDeps.persistence
      if (!pp || typeof pp.locate !== 'function') throw new Error('会话持久化服务不可用，无法定位会话文件')
      return pp.locate({ cwd: absCwd, id: sessionId }).path
    }

    // 会话正文的文件名由宿主决定，且随版本演进（实测：新版宿主把 session.jsonl.zstd
    // 换成了分代命名的 session.v3.jsonl.zstd）。导出侧要"扫目录读出每条会话"，读之前还
    // 不知道 id，没法直接用 locate ⇒ 退而按候选名逐个试。导入侧走 locate，天然跟着宿主走。
    // 顺序：先宿主当前的分代名，再历史名；打包内部仍统一叫 transcript.jsonl.zstd（格式不变）。
    const TRANSCRIPT_NAMES = ['session.v3.jsonl.zstd', 'session.jsonl.zstd', 'session.v3.jsonl', 'session.jsonl']
    const isTranscriptName = (name) => TRANSCRIPT_NAMES.indexOf(name) >= 0
    async function findTranscriptName(dirAbs) {
      for (const name of TRANSCRIPT_NAMES) {
        try { const st = await fsp.stat(path.join(dirAbs, name)); if (st && st.isFile() && st.size) return name } catch {}
      }
      return ''
    }
    async function readTranscriptIn(dirAbs) {
      const name = await findTranscriptName(dirAbs)
      if (!name) return undefined
      const bytes = await fsp.readFile(path.join(dirAbs, name)).catch(() => undefined)
      if (!bytes || !bytes.length) return undefined
      return { bytes, kind: /\.jsonl$/.test(name) ? 'jsonl' : 'zstd', name }
    }

    // ── 可携化身份层（云同步铺垫） ──────────────────────────────────────────
    // 三条宿主事实决定了这层的设计（详见 docs/design/import-overwrite-sync.md）：
    //   1) session id 在 sessions 根内**全局唯一**，同 id 出现在两个 project 目录会让宿主
    //      JsonlSessionPersistence.list()(:1085)/loadStored()(:1331) 直接抛错，连带打爆 session.list；
    //   2) archivedSessionIds / session_projcache 都**按 id 键控** ⇒ 沿用源 id 就继承源会话的状态；
    //   3) 日志是 append-only 且按 seq 校验（实测：seq 不连续 ⇒ "corrupt session log: seq gap"）。
    // 所以：远端身份（remoteId）随包旅行，本地身份（localId）由本机决定，二者用账本挂钩。

    /** 本机设备 id（一次性生成；导出包只带它的值）。 */
    async function deviceId() {
      try {
        const j = await readJson(DEVICE_FILE)
        if (j && typeof j.deviceId === 'string' && j.deviceId) return j.deviceId
      } catch {}
      const id = 'dev-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10)
      await writeJson(DEVICE_FILE, { deviceId: id, createdAt: nowISO() }).catch(() => {})
      return id
    }

    /** 空/损坏账本一律当作没有（账本是缓存性质的东西，不该挡住导入）。 */
    async function readSyncLedger(absDir) {
      try {
        const j = await readJson(path.join(absDir, SYNC_FILE))
        if (!j || typeof j !== 'object') return { v: 1, remoteGoalId: '', sessions: [] }
        if (!Array.isArray(j.sessions)) j.sessions = []
        return j
      } catch { return { v: 1, remoteGoalId: '', sessions: [] } }
    }
    async function writeSyncLedger(absDir, ledger) {
      ledger.v = 1
      ledger.updatedAt = nowISO()
      await writeJson(path.join(absDir, SYNC_FILE), ledger)
    }
    const ledgerLocalOf = (ledger, remoteId) => {
      const e = (ledger && Array.isArray(ledger.sessions) ? ledger.sessions : []).find((x) => x && x.remoteId === remoteId)
      return e && e.localId ? String(e.localId) : ''
    }
    const ledgerRemoteOf = (ledger, localId) => {
      const e = (ledger && Array.isArray(ledger.sessions) ? ledger.sessions : []).find((x) => x && x.localId === localId)
      return e && e.remoteId ? String(e.remoteId) : ''
    }

    /** 宿主用 fs.realpath 作为 workspace/会话 cwd 的规范形态，我按同一套来，别自己发明。 */
    async function canonicalDirOf(p) {
      try { return await fsp.realpath(p) } catch { return String(p) }
    }

    /** 只读第 1 帧拿 header（扫全根用，成本与文件大小无关）。 */
    async function readHeaderCheap(abs) {
      const fh = await fsp.open(abs, 'r')
      try {
        let pos = 0
        const chunks = []
        for (;;) {
          const buf = Buffer.alloc(Math.min(65536, 4194304))
          const { bytesRead } = await fh.read(buf, 0, buf.length, pos)
          if (!bytesRead) break
          chunks.push(buf.subarray(0, bytesRead))
          const joined = Buffer.concat(chunks)
          try {
            const { frames } = P.scanZstdFrames(joined, 1)
            if (frames.length) return P.readSessionHeader(joined)
          } catch { return undefined }
          pos += bytesRead
          if (joined.length > 8 * 1024 * 1024) return undefined  // header 帧不可能这么大
        }
        return undefined
      } finally { await fh.close().catch(() => {}) }
    }

    /**
     * 全根会话索引：id → [{cwd, path}]。**导入前必查**（约束 1）。
     * 主路径走宿主 sessionPersistence.list()（它自带 header 校验，且是宿主的权威视图）；
     * 库已经处于「有重复 id」坏状态时它会抛 ⇒ 退化成自己扫盘，至少能看清是谁占了。
     */
    async function globalSessionIndex() {
      const byId = new Map()
      const push = (id, cwd, p) => {
        if (!id) return
        if (!byId.has(id)) byId.set(id, [])
        byId.get(id).push({ cwd: cwd || '', path: p })
      }
      const pp = portableDeps.persistence
      let degraded = ''
      if (pp && typeof pp.list === 'function') {
        try {
          for (const h of await pp.list()) push(String(h.id), h.cwd, undefined)
          return { byId, degraded: '' }
        } catch (e) { degraded = '宿主 list() 失败（库内可能已有重复 id）：' + errText(e) }
      } else degraded = '宿主 sessionPersistence.list() 不可用'
      let root = ''
      try { root = path.dirname(projectDirOf(BASE)) } catch {}
      if (!root) return { byId, degraded: degraded + '；且无法定位 sessions 根目录' }
      for (const pk of await fsp.readdir(root, { withFileTypes: true }).catch(() => [])) {
        if (!pk.isDirectory()) continue
        const pdir = path.join(root, pk.name)
        for (const sd of await fsp.readdir(pdir, { withFileTypes: true }).catch(() => [])) {
          if (!sd.isDirectory()) continue
          const dirAbs = path.join(pdir, sd.name)
          const tName = await findTranscriptName(dirAbs)
          if (!tName) continue
          let h = await readHeaderCheap(path.join(dirAbs, tName)).catch(() => undefined)
          if (!h && /\.jsonl$/.test(tName)) { try { h = JSON.parse((await fsp.readFile(path.join(dirAbs, tName), 'utf8')).split('\n').filter(Boolean)[0]) } catch {} }
          if (h) push(String(h.id), h.cwd, dirAbs)
        }
      }
      return { byId, degraded }
    }

    /** 收集该目标工作区项目目录下的全部会话（含 subagent / 孤儿 / 已归档）。 */
    async function collectSessions(absDir, g, warnings) {
      const sessions = []
      const ledger = await readSyncLedger(absDir)
      const remoteOf = (localId) => ledgerRemoteOf(ledger, localId)
      let projectDir = ''
      try { projectDir = projectDirOf(absDir) } catch (e) { warnings.push(errText(e)); return { sessions, projectDir } }
      let dirs
      try { dirs = await fsp.readdir(projectDir, { withFileTypes: true }) } catch {
        warnings.push('该目标还没有会话目录（' + path.basename(projectDir) + ' 不存在）')
        return { sessions, projectDir }
      }
      const archived = (() => { try { return (wsRegistry && Array.isArray(wsRegistry.archivedSessionIds)) ? wsRegistry.archivedSessionIds : [] } catch { return [] } })()
      const boundOf = (sid) => {
        if (!sid) return 'unbound'
        if (g.sessionId && g.sessionId === sid) return 'goal'
        const ch = (g.chapters || []).find((c) => c.sessionId === sid)
        return ch ? 'chapter-' + ch.index : 'unbound'
      }
      for (const it of dirs) {
        if (!it.isDirectory()) continue
        const dirAbs = path.join(projectDir, it.name)
        const t = await readTranscriptIn(dirAbs)
        let kind = t ? t.kind : 'zstd', bytes = t ? t.bytes : undefined
        if (bytes === undefined) {
          // 无 transcript（会话从未 append 过任何事件）——仍带出目录里的其他产物
          for (const extra of await fsp.readdir(dirAbs).catch(() => [])) {
            const st = await statOpt(path.join(dirAbs, extra))
            if (st && st.isFile() && st.size <= MAX_GOAL_FILE_BYTES) {
              warnings.push('会话目录 ' + it.name + ' 无 transcript，附带产物 ' + extra + ' 已入包')
            }
          }
          warnings.push('跳过无 transcript 的会话目录 ' + it.name)
          continue
        }
        let header
        try {
          header = kind === 'zstd' ? P.readSessionHeader(bytes) : JSON.parse(bytes.toString('utf8').split('\n').filter(Boolean)[0])
        } catch (e) { warnings.push('会话目录 ' + it.name + ' transcript 读不出 header，已跳过: ' + errText(e)); continue }
        const sid = String(header.id || it.name)
        // 存活会话先 flush，再重读 —— 否则包里只有上次 flush 的前缀（宿主自带导出同一手法）
        try {
          const live = portableDeps.sessions && typeof portableDeps.sessions.get === 'function' ? portableDeps.sessions.get(sid) : undefined
          if (live && typeof portableDeps.sessions.flush === 'function') { await portableDeps.sessions.flush(live); const t2 = await readTranscriptIn(dirAbs); if (t2) { bytes = t2.bytes; kind = t2.kind } }
        } catch (e) { warnings.push('会话 ' + sid + ' flush 失败，包内可能是上次落盘的前缀: ' + errText(e)) }
        const rec = {
          id: sid,
          // remoteId = 这条会话的「稳定身份」：本机若是导入来的，账本里存着包里原本的 id，
          // 就沿用它继续当远端身份导出 ⇒ A→B→A 往返时同一会话始终认得出（幂等的前提）。
          remoteId: remoteOf(sid) || sid,
          dirName: it.name,
          encoding: kind,
          entry: 'sessions/' + safeSeg(sid) + '/transcript.' + (kind === 'zstd' ? 'jsonl.zstd' : 'jsonl'),
          cwd: header.cwd || '',
          createdAt: header.createdAt,
          parentSession: header.parentSession,
          agentPreset: header.agentPreset,
          delegationDepth: header.delegationDepth,
          title: '',
          lines: 0,
          rows: 0,
          frames: 0,
          maxSeq: undefined,
          lastTime: undefined,
          blank: false,
          compressedBytes: bytes.length,
          logicalBytes: 0,
          archived: archived.indexOf(sid) >= 0,
          boundTo: boundOf(sid),
          sha256: P.sha256Hex(bytes)
        }
        if (rec.dirName !== safeSeg(sid)) warnings.push('会话目录名与 header id 不一致（' + rec.dirName + ' vs ' + sid + '），按 header id 入包')
        if (bytes.length <= MAX_DECODE_BYTES) {
          try {
            const a = kind === 'zstd' ? P.analyzeTranscript(bytes)
              : (() => { const text = bytes.toString('utf8'); const rows = text.split('\n').filter(Boolean); return { header, lines: rows.slice(1), rows: rows.slice(1).map((l) => { try { const o = JSON.parse(l); return { type: o.type, seq: typeof o.seq === 'number' ? o.seq : o.seq0, time: o.time ?? o.time0 } } catch { return { bad: true } } }), frames: 0, torn: false, logicalBytes: Buffer.byteLength(text, 'utf8'), maxSeq: undefined, lastTime: undefined, hasTurnStart: false, blank: true } })()
            rec.rows = a.lines.length
            rec.lines = a.lines.length + 1
            rec.logicalBytes = a.logicalBytes
            rec.frames = a.frames
            rec.maxSeq = a.maxSeq
            rec.lastTime = a.lastTime
            rec.blank = a.blank
            rec.origin = a.header.origin || (header.origin || '')
            if (a.torn) warnings.push('会话 ' + sid + ' 末尾有未完成帧（崩溃残留），已按完整帧导出')
            for (const l of a.lines) { try { const o = JSON.parse(l); if (o.type === 'session/title') rec.title = String((o.data && o.data.title) || o.title || '') } catch {} }
            rec._refs = P.collectImageRefs([JSON.stringify(a.header)].concat(a.lines).join('\n'))
          } catch (e) { warnings.push('会话 ' + sid + ' 正文解码失败（原字节仍照抄入包）: ' + errText(e)) }
        } else {
          warnings.push('会话 ' + sid + ' 超过 ' + MAX_DECODE_BYTES + ' B，未解正文（原字节照抄入包，附件引用未收集）')
        }
        rec._bytes = bytes
        sessions.push(rec)
      }
      return { sessions, projectDir }
    }

    /** 组装一个目标的导出包（不落盘）。 */
    async function buildGoalBundle(goalId) {
      const warnings = []
      const g = await loadGoal(goalId)
      if (!g) throw new Error('目标不存在: ' + goalId)
      const absDir = await goalDir(g)
      const selfLedger = await readSyncLedger(absDir)
      const idx = await readIndex()
      const row = (idx.goals || []).find((r) => r.id === goalId)
      const entries = []
      await walkGoalDir(absDir, '', entries, warnings)
      const collected = await collectSessions(absDir, g, warnings)
      const sessions = collected.sessions
      // 会话目录内的其他产物（DSH 语义把会话目录留给未来产物）
      for (const s of sessions) {
        const dirAbs = path.join(collected.projectDir, s.dirName)
        for (const extra of await fsp.readdir(dirAbs).catch(() => [])) {
          if (isTranscriptName(extra)) continue
          const st = await statOpt(path.join(dirAbs, extra))
          if (st && st.isFile() && st.size <= MAX_GOAL_FILE_BYTES) {
            entries.push({ name: 'sessions/' + safeSeg(s.id) + '/files/' + extra, data: await fsp.readFile(path.join(dirAbs, extra)), mtime: st.mtime })
            warnings.push('会话 ' + s.id + ' 的自有产物已入包: ' + extra)
          }
        }
      }
      // 附件（内容寻址）
      const attachments = []
      const refMap = new Map()
      for (const s of sessions) { for (const [id, ref] of (s._refs || [])) if (!refMap.has(id)) refMap.set(id, ref) }
      for (const s of sessions) {
        entries.push({ name: s.entry, data: s._bytes, store: s.encoding === 'zstd' })
        delete s._bytes
        delete s._refs
      }
      for (const [id, ref] of refMap) {
        const sha = String(id).startsWith('sha256:') ? String(id).slice(7) : ''
        const entry = 'attachments/objects/' + (sha.slice(0, 2) || 'xx') + '/' + (sha || safeSeg(id))
        const svc = portableDeps.attachments
        if (!svc || typeof svc.readImage !== 'function') { warnings.push('附件服务不可用，图片 ' + id + ' 未入包（导入后会话里的图片引用将悬空）'); continue }
        try {
          const stored = await svc.readImage(ref)
          const data = stored && stored.data ? Buffer.from(stored.data) : undefined
          if (!data) { warnings.push('附件 ' + id + ' 读不到字节，未入包'); continue }
          entries.push({ name: entry, data })
          attachments.push({ attachmentId: id, mediaType: String(ref.mediaType || ''), sha256: sha, bytes: data.length, entry })
        } catch (e) { warnings.push('附件 ' + id + ' 读取失败: ' + errText(e)) }
      }
      // 工作区登记（仅信息；导入走 API 重建）
      let workspace = undefined
      try {
        const ws = (g.workspaceId && wsRegistry && wsRegistry.get) ? wsRegistry.get(String(g.workspaceId)) : undefined
        const resolved = ws || (wsRegistry && wsRegistry.resolveByPath ? await wsRegistry.resolveByPath(absDir) : undefined)
        if (resolved) workspace = {
          id: String(resolved.id),
          path: String(resolved.path || absDir),
          title: String(resolved.title || g.title || ''),
          sessionIds: Array.isArray(resolved.sessionIds) ? resolved.sessionIds.map(String) : [],
          createdAt: resolved.createdAt,
          updatedAt: resolved.updatedAt
        }
      } catch (e) { warnings.push('工作区登记读取失败（不影响导出）: ' + errText(e)) }

      const files = entries.map((e) => ({ name: e.name, bytes: e.data.length, sha256: P.sha256Hex(e.data) }))
      const goalJson = entries.find((e) => e.name === 'goal/goal.json')
      const manifest = {
        formatVersion: EXPORT_FORMAT_VERSION,
        kind: 'study-goal-export',
        tool: 'study-plugin',
        exportedAt: nowISO(),
        deviceId: await deviceId(),
        sync: {
          // 目标的稳定身份：本机若是导入来的，账本里存着包里原本的 goalId ⇒ 往返时认得出同一个目标
          remoteGoalId: String(selfLedger.remoteGoalId || g.id),
          note: '会话的稳定身份见每条 sessions[].remoteId；本机 localId↔remoteId 记在目标目录的 ' + SYNC_FILE
        },
        source: {
          platform: process.platform,
          dshHome: path.dirname(BASE),
          studyWorkRoot: BASE,
          sessionsRoot: collected.projectDir ? path.dirname(collected.projectDir) : '',
          user: os.userInfo ? (() => { try { return os.userInfo().username } catch { return '' } })() : ''
        },
        goal: {
          id: g.id, dir: g.dir, title: g.title, topic: g.topic, status: g.status,
          chapterCount: (g.chapters || []).length,
          goalJsonSha: goalJson ? P.sha256Hex(goalJson.data) : ''
        },
        indexRow: row ? { id: row.id, title: row.title, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt } : undefined,
        sessions,
        attachments,
        workspace,
        files,
        warnings
      }
      entries.unshift({ name: 'manifest.json', data: Buffer.from(JSON.stringify(manifest, null, 2), 'utf8') })
      return { zip: P.createZip(entries), manifest }
    }

    handlers['study.exportGoal'] = async (args) => {
      try {
        const goalId = String((args && args.goalId) || '')
        const { zip, manifest } = await buildGoalBundle(goalId)
        await fsp.mkdir(EXPORTS_DIR, { recursive: true })
        const stem = 'study-goal-' + manifest.goal.dir + '-' + stampNow()
        // 同一秒内连续导出很常见（面板连点/脚本循环）⇒ 名字必须唯一，绝不静默覆盖上一个包
        let file = stem + '.zip', n = 1
        while (await statOpt(path.join(EXPORTS_DIR, file))) file = stem + '-' + (n++) + '.zip'
        await fsp.writeFile(path.join(EXPORTS_DIR, file), zip)
        return stripUndefined({
          ok: true,
          file,
          path: path.join(EXPORTS_DIR, file),
          dir: EXPORTS_DIR,
          downloadUrl: '/study-export?file=' + encodeURIComponent(file),
          bytes: zip.length,
          goal: { id: manifest.goal.id, title: manifest.goal.title, status: manifest.goal.status, chapters: manifest.goal.chapterCount },
          counts: {
            files: manifest.files.length,
            sessions: manifest.sessions.length,
            sessionBytes: manifest.sessions.reduce((a, s) => a + s.compressedBytes, 0),
            attachments: manifest.attachments.length
          },
          warnings: manifest.warnings
        })
      } catch (e) { return { ok: false, error: errText(e) } }
    }

    handlers['study.listExports'] = async () => {
      try {
        const names = await fsp.readdir(EXPORTS_DIR).catch(() => [])
        const out = []
        for (const name of names) {
          if (!/\.zip$/i.test(name)) continue
          const st = await statOpt(path.join(EXPORTS_DIR, name))
          if (!st || !st.isFile()) continue
          out.push({ file: name, bytes: st.size, mtime: st.mtime.toISOString(), downloadUrl: '/study-export?file=' + encodeURIComponent(name) })
        }
        out.sort((a, b) => String(b.mtime).localeCompare(String(a.mtime)))
        return stripUndefined({ ok: true, dir: EXPORTS_DIR, exports: out })
      } catch (e) { return { ok: false, error: errText(e) } }
    }

    handlers['study.deleteExport'] = async (args) => {
      try {
        const name = path.basename(String((args && args.file) || ''))
        if (!/^[A-Za-z0-9._\u4e00-\u9fff-]+\.zip$/i.test(name)) return { ok: false, error: '非法导出文件名' }
        const abs = path.join(EXPORTS_DIR, name)
        if (!(await statOpt(abs))) return { ok: false, error: '文件不存在' }
        await fsp.unlink(abs)
        return { ok: true }
      } catch (e) { return { ok: false, error: errText(e) } }
    }

    /** 读包 + 校验（格式版本、逐条目 sha256）。 */
    async function readExport(ref) {
      let abs = ''
      if (ref && ref.path) abs = path.resolve(expandHomePath(ref.path))
      else if (ref && ref.file) {
        const raw = String(ref.file)
        const name = path.basename(raw)
        if (!name || name !== raw || !/^[A-Za-z0-9._\u4e00-\u9fff-]+\.zip$/i.test(name)) throw new Error('非法导出文件名（只接受 exports 目录内的裸文件名）')
        abs = path.join(EXPORTS_DIR, name)
      } else throw new Error('缺少 file（exports 目录内文件名）或 path（zip 绝对路径）')
      const st = await statOpt(abs)
      if (!st || !st.isFile()) throw new Error('找不到导出包: ' + abs)
      if (st.size > MAX_ZIP_BYTES) throw new Error('导出包过大（' + st.size + ' B > ' + MAX_ZIP_BYTES + ' B）')
      const entries = P.readZip(await fsp.readFile(abs))
      const manifest = P.readJsonEntry(entries, 'manifest.json')
      if (!manifest || manifest.kind !== 'study-goal-export') throw new Error('不是学习区目标导出包（manifest.json 缺失或 kind 不符）')
      if (!SUPPORTED_FORMAT_VERSIONS.includes(manifest.formatVersion)) throw new Error('导出格式版本不支持: ' + manifest.formatVersion + '（本插件认 ' + SUPPORTED_FORMAT_VERSIONS.join(' / ') + '）')
      for (const s of (manifest.sessions || [])) if (!s.remoteId) s.remoteId = s.id   // v1 包：稳定身份就是它当时的 id
      const bad = []
      for (const f of (manifest.files || [])) {
        const buf = entries.get(f.name)
        if (buf === undefined) { bad.push(f.name + '（缺条目）'); continue }
        if (P.sha256Hex(buf) !== f.sha256) bad.push(f.name + '（sha256 不符）')
      }
      if (bad.length) throw new Error('导出包校验失败: ' + bad.slice(0, 5).join('; ') + (bad.length > 5 ? ' 等 ' + bad.length + ' 项' : ''))
      return { abs, entries, manifest }
    }

    /**
     * 导入解析：算出目标落点 + 每条会话的**本地身份** + 每条的落盘动作。
     * 预览与真写入共用这一个函数 ⇒ 「预览说什么，写入就做什么」，不存在第二套判定。
     * 决策依据见 docs/design/import-overwrite-sync.md（D17–D21）。
     */
    async function resolveImport(manifest, opts) {
      const mode = opts.mode === 'overwrite' ? 'overwrite' : opts.mode === 'copy' || opts.mode === 'rename' ? 'copy' : 'merge'
      const force = opts.force === true
      const srcId = String(manifest.goal.id)
      const remoteGoalId = String((manifest.sync && manifest.sync.remoteGoalId) || srcId)
      const srcCwds = [...new Set((manifest.sessions || []).map((s) => String(s.cwd || '')).filter(Boolean))]

      // 1) 目标 id / 目录（copy 永远换新 id，merge/overwrite 沿用远端 id ⇒ 幂等的前提）
      let goalId = mode === 'copy'
        ? 'goal-' + Date.now().toString(36) + '-' + slug(manifest.goal.title || manifest.goal.topic || 'study', 'study')
        : srcId
      if (mode !== 'copy' && opts.goalId) goalId = String(opts.goalId)
      if (!/^[A-Za-z0-9._\u4e00-\u9fff-]+$/.test(goalId)) throw new Error('目标 id 含非法字符: ' + goalId)
      const absDir = BASE + '/' + goalId
      // canonical：对**父目录**做 realpath 再拼 goalId ⇒ 不创建目录也能拿到宿主会用的规范形态
      const canonicalDir = path.join(await canonicalDirOf(path.dirname(absDir)), path.basename(absDir))

      const conflicts = []
      const warnings = []
      const gi = await globalSessionIndex()
      if (gi.degraded) warnings.push(gi.degraded)
      // 归档集按 id 全局键控且**宿主没有取消归档 API** ⇒ 沿用被归档过的 id 就等于把会话藏起来
      let archivedSet = new Set()
      try { archivedSet = new Set(((wsRegistry && wsRegistry.archivedSessionIds) || []).map(String)) } catch {}

      // 2) 目标目录已存在时：是不是同一个目标的血缘？
      const dirExists = !!(await statOpt(absDir))
      const existingLedger = dirExists ? await readSyncLedger(absDir) : { v: 1, sessions: [] }
      let existingGoal = undefined
      if (dirExists) existingGoal = await readJson(path.join(absDir, 'goal.json')).catch(() => undefined)
      const sameLineage = !dirExists || mode === 'copy'
        || String(existingLedger.remoteGoalId || '') === remoteGoalId
        || String((existingGoal && existingGoal.id) || '') === goalId && !existingLedger.remoteGoalId
      if (dirExists && mode !== 'copy') {
        if (!sameLineage && force) warnings.push('同名目录 ' + goalId + ' 血缘不同（不是这个包导出的目标），已按 force 覆盖')
        else if (!sameLineage) conflicts.push({ kind: 'goalUnrelated', detail: absDir, hint: '同名目录已存在但血缘不同（不是这个目标导出的）：带 force 才会覆盖，或改用「另存为副本」' })
      }
      const idx = await readIndex()
      if ((idx.goals || []).some((r) => r.id === goalId && r.status === 'active') && mode !== 'copy') {
        warnings.push('index.json 已有同 id 目标 ⇒ 本次按覆盖式同步处理（不会新增第二份）')
      }
      if (!(manifest.files || []).some((f) => f.name === 'goal/goal.json')) {
        conflicts.push({ kind: 'packageNoGoal', detail: absDir, hint: '包里连 goal/goal.json 都没有，不是一个可导入的目标包' })
      }

      // 3) 逐条会话定身份 + 定动作
      const sessions = []
      const usedLocalIds = new Set()
      for (const s of (manifest.sessions || [])) {
        const remoteId = String(s.remoteId || s.id)
        const item = {
          remoteId, pkgId: s.id, title: s.title || '', boundTo: s.boundTo || 'unbound',
          encoding: s.encoding || 'zstd', entry: s.entry, fromCwd: String(s.cwd || ''),
          pkgLines: s.rows, pkgMaxSeq: s.maxSeq, pkgLastTime: s.lastTime, pkgBytes: s.compressedBytes,
          pkgSha: s.sha256, blank: !!s.blank, archivedAtSource: !!s.archived, origin: s.origin || '',
          pkgParent: String(s.parentSession || ''),
        }
        const occOf = (id) => gi.byId.get(id) || []
        const atTarget = (id) => occOf(id).some((o) => {
          try { return sessionTargetPath(canonicalDir, id) === (o.path || sessionTargetPath(o.cwd || canonicalDir, id)) } catch { return false }
        })
        const mappedId = ledgerLocalOf(existingLedger, remoteId)
        // 候选顺序：账本里已分配的本地 id（幂等的关键）→ 包里的 id → 换新 id。
        // 淘汰条件：该 id 已被别的 project 目录占用（约束 1）；或它在宿主归档集里（约束 2）。
        /**
       * 不依赖账本的身份兜底：账本可能被手删/写失败（见导入返回的对应告警），
       * 此时"本机这条就是包里的同一条会话"仍可从**内容**认出来 —— 逐行相同（除 header）
       * 且不在归档集里 ⇒ 复用它，避免每次导入都多留一份副本席位。
       */
      async function findContentTwin(cwd, s) {
        const pkgBuf = (opts._entries || new Map()).get(s.entry)
        if (pkgBuf === undefined || pkgBuf.length > MAX_DECODE_BYTES) return ''
        let pkgLines
        try {
          pkgLines = s.encoding === 'jsonl' ? pkgBuf.toString('utf8').split('\n').filter(Boolean).slice(1) : P.analyzeTranscript(pkgBuf).lines
        } catch { return '' }
        let pdir = ''
        try { pdir = projectDirOf(cwd) } catch { return '' }
        for (const it of await fsp.readdir(pdir, { withFileTypes: true }).catch(() => [])) {
          if (!it.isDirectory()) continue
          const t = await readTranscriptIn(path.join(pdir, it.name))
          if (!t) continue
          const buf = t.bytes
          if (buf.length > MAX_DECODE_BYTES) continue
          let h, lines
          try { h = P.readSessionHeader(buf); lines = P.analyzeTranscript(buf).lines } catch { continue }
          const id = String(h.id || '')
          if (!id || usedLocalIds.has(id) || archivedSet.has(id)) continue
          if (P.compareTranscriptLines(lines, pkgLines) === 'same') return id
        }
        return ''
      }
      const candidates = []
        if (mappedId) candidates.push({ id: mappedId, from: 'ledger' })
        if (s.id !== mappedId) candidates.push({ id: s.id, from: 'pkg' })
        let chosen = null, why = ''
        for (const c of candidates) {
          const occ = occOf(c.id)
          if (occ.length && !atTarget(c.id)) { why = 'id ' + c.id + ' 已被别的目录占用（沿用会让宿主 list() 抛重复）'; continue }
          if (occ.length && atTarget(c.id)) { chosen = { id: c.id, identity: 'update' }; break }
          if (archivedSet.has(c.id)) { why = 'id ' + c.id + ' 在宿主归档集里（沿用会被隐藏，宿主没有取消归档 API）'; continue }
          chosen = { id: c.id, identity: c.from === 'ledger' ? 'adopt' : 'fresh' }
          break
        }
        if (!chosen) {
          const twin = await findContentTwin(canonicalDir, s)
          if (twin) chosen = { id: twin, identity: 'update' }
        }
        if (!chosen) { chosen = { id: 'session-' + randomUUID(), identity: 'reissue' }; why = why || '包内 id 与本机已有会话冲突' }
        if (usedLocalIds.has(chosen.id)) { chosen = { id: 'session-' + randomUUID(), identity: 'reissue' }; why = '包内 id 重复，换发新身份' }
        usedLocalIds.add(chosen.id)
        item.localId = chosen.id
        item.identity = chosen.identity
        if (chosen.identity === 'reissue') item.why = why
        item.targetPath = sessionTargetPath(canonicalDir, item.localId)
        item.targetDir = path.dirname(item.targetPath)

        // 3a) 该会话在本机是否正被打开 —— 宿主 write-behind 会覆盖我的写入，硬冲突
        const liveId = [item.localId, s.id].find((id) => { try { return !!(portableDeps.sessions && portableDeps.sessions.get && portableDeps.sessions.get(id)) } catch { return false } })
        // 3b) 与本地文件的行级关系 ⇒ 动作（尊重 append-only）
        let action = 'create', detail = ''
        const localBuf = await fsp.readFile(item.targetPath).catch(() => undefined)
        if (localBuf) {
          item.localBytes = localBuf.length
          item.localSha = P.sha256Hex(localBuf)
          if (item.localSha === item.pkgSha) action = 'noop'
          else if (liveId) action = 'liveBlocked'
          else {
            let rel = 'unknown'
            try {
              const la = localBuf.length <= MAX_DECODE_BYTES ? P.analyzeTranscript(localBuf) : undefined
              const pkg = await decodeEntry(s)
              if (la && pkg) {
                rel = P.compareTranscriptLines(la.lines, pkg.lines)
                item.localRows = la.lines.length
                item.localMaxSeq = la.maxSeq
                item.torn = !!(la.torn || pkg.torn)
              }
            } catch (e) { warnings.push('会话 ' + remoteId + ' 行级比对失败: ' + errText(e)) }
            if (rel === 'same') action = 'noop'
            else if (rel === 'fastforward' && !item.torn) action = 'append'
            else if (rel === 'rewind') { action = 'rewind'; detail = '包里比本地旧（本地 ' + (item.localRows || '?') + ' 行 > 包 ' + (item.pkgLines || '?') + ' 行）' }
            else if (rel === 'diverged') { action = 'diverged'; detail = '两边各自写了不同事件（首个差异行起分叉）' }
            else { action = 'replace'; item.blind = rel === 'unknown'; detail = item.torn ? '尾部有未完成帧，需整份替换（修复）' : '无法按行比对（超大或明文），按整份替换处理' }
          }
        } else if (liveId) action = 'liveBlocked'
        item.action = action
        item.detail = detail
        if (liveId) item.liveId = liveId
        sessions.push(item)
      }
      async function decodeEntry(s) {
        const buf = (opts._entries || new Map()).get(s.entry)
        if (buf === undefined) return undefined
        if ((s.encoding || 'zstd') === 'zstd') { if (buf.length > MAX_DECODE_BYTES) return undefined; return P.analyzeTranscript(buf) }
        const lines = buf.toString('utf8').split('\n').filter(Boolean)
        return { lines: lines.slice(1), torn: false }
      }
      // 4) 模式策略（merge 保守、overwrite 可覆盖但要为"真分叉/回退"付 force）
      const isDiverging = (it) => it.action === 'rewind' || it.action === 'diverged' || (it.action === 'replace' && it.blind)
      for (const b of sessions.filter((it) => it.action === 'liveBlocked')) {
        conflicts.push({ kind: 'sessionLive', detail: b.remoteId + ' → ' + b.localId, hint: '该会话在本机正被打开，宿主回写会盖掉导入结果；先在 GUI 关掉那个会话再导入' })
      }
      if (mode === 'merge') {
        for (const it of sessions) if (isDiverging(it)) { it.plannedAction = it.action; it.action = 'skippedDiverged' }
      } else if (!force) {
        for (const it of sessions) if (isDiverging(it)) conflicts.push({ kind: 'sessionDiverged', detail: it.remoteId, hint: (it.detail || '与本地内容有差异') + '；带 force=true 才会覆盖' })
      }
      const count = {}
      for (const it of sessions) count[it.action] = (count[it.action] || 0) + 1

      const plan = {
        goalId, dir: canonicalDir, srcGoalId: srcId, remoteGoalId, mode, force,
        title: manifest.goal.title || '', status: manifest.goal.status || '',
        chapters: manifest.goal.chapterCount || 0,
        goalExists: dirExists, sameLineage,
        sessions, sessionCount: sessions.length, counts: count,
        reissue: sessions.filter((x) => x.identity === 'reissue').length,
        attachments: (manifest.attachments || []).length,
        files: (manifest.files || []).length,
        bytesTotal: (manifest.files || []).reduce((a, f) => a + f.bytes, 0),
        fromCwds: srcCwds,
        hiddenByHostRule: sessions.filter((x) => x.blank || x.origin === 'subagent').map((x) => ({ localId: x.localId, reason: x.blank ? '空会话（无 turn/start）' : 'subagent 子会话' })),
        agentPresets: [...new Set((manifest.sessions || []).map((s) => s.agentPreset).filter(Boolean))],
        exportedAt: manifest.exportedAt, source: manifest.source || {}, deviceId: manifest.deviceId || '',
        restartNeeded: true,
      }
      return { goalId, absDir, canonicalDir, conflicts, warnings, resolution: { mode, force, sessions, plan, ledger: existingLedger, remoteGoalId, globalIds: gi }, plan }
    }

    handlers['study.inspectImport'] = async (args) => {
      try {
        const { entries, manifest } = await readExport(args || {})
        const r = await resolveImport(manifest, Object.assign({}, args || {}, { _entries: entries }))
        return stripUndefined({ ok: true, canImport: r.conflicts.length === 0, goalId: r.goalId, dir: r.canonicalDir, conflicts: r.conflicts, warnings: r.warnings, plan: r.plan })
      } catch (e) { return { ok: false, error: errText(e) } }
    }

    /**
     * 导入 = apply-package（幂等 upsert）。可重复执行：同一 remoteId 永远落到同一 localId，
     * 内容一致时是 no-op，包更新了就走 append-only 追加尾帧。
     * 事务性：任何一步失败 ⇒ restore() 还原被覆盖的字节、删掉本次自建的目录与索引/工作区登记。
     */
    handlers['study.importGoal'] = async (args) => {
      const tx = { backups: new Map(), createdDirs: [], indexSnapshot: '', workspaceId: '', wsCreated: false }
      let backupBytes = 0
      const ensureDir = async (dir) => {
        const missing = []
        let up = path.resolve(dir)
        while (up !== path.dirname(up) && !(await statOpt(up))) { missing.unshift(up); up = path.dirname(up) }
        await fsp.mkdir(dir, { recursive: true })
        for (const m of missing) if (!tx.createdDirs.includes(m)) tx.createdDirs.push(m)
      }
      const stage = async (p, nextBuf) => {
        if (!tx.backups.has(p)) {
          const prev = await fsp.readFile(p).catch(() => null)
          if (prev === null) tx.backups.set(p, null)
          else {
            if (backupBytes + prev.length > MAX_BACKUP_BYTES) throw new Error('回滚预算不足（已 ' + backupBytes + ' B + ' + prev.length + ' B > ' + MAX_BACKUP_BYTES + ' B），拒绝覆盖 ' + path.basename(p))
            backupBytes += prev.length
            tx.backups.set(p, prev)
          }
        }
        await ensureDir(path.dirname(p))
        await fsp.writeFile(p, nextBuf)
      }
      const restore = async () => {
        for (const [p, buf] of tx.backups) { try { if (buf === null) await fsp.unlink(p); else await fsp.writeFile(p, buf) } catch {} }
        if (tx.indexSnapshot) { try { await writeIndex(JSON.parse(tx.indexSnapshot)) } catch {} }
        if (tx.wsCreated && tx.workspaceId && wsRegistry && typeof wsRegistry.delete === 'function') { try { await wsRegistry.delete(tx.workspaceId) } catch {} }
        for (const d of tx.createdDirs.slice().reverse()) { try { await fsp.rm(d, { recursive: true, force: true }) } catch {} }
      }
      try {
        const a = args || {}
        const { entries, manifest } = await readExport(a)
        const resolved = await resolveImport(manifest, Object.assign({}, a, { _entries: entries }))
        const { goalId, conflicts, warnings, resolution } = resolved
        const canonicalDir = resolution.plan.dir
        const items = resolution.sessions
        const mode = resolution.mode, force = resolution.force
        const skip = new Set((Array.isArray(a.skipSessions) ? a.skipSessions : []).map(String))
        for (const it of items) if (skip.has(it.remoteId) || skip.has(it.pkgId)) it.action = 'skippedByRequest'
        if (a.confirm !== true) {
          return stripUndefined({ ok: false, preview: true, needConfirm: true, canImport: conflicts.length === 0, goalId, dir: canonicalDir, conflicts, warnings, plan: resolution.plan, mode, force })
        }
        if (conflicts.length) {
          return { ok: false, error: '导入被冲突挡住: ' + conflicts.map((c) => c.kind + '=' + c.detail).join(', '), conflicts, warnings, hint: conflicts[0] && conflicts[0].hint, plan: resolution.plan }
        }
        // 身份表：包里的两种写法（pkgId / remoteId）→ 本机 localId，供 goal.json 与 parentSession 重映射
        const idMap = new Map()
        for (const it of items) { idMap.set(it.pkgId, it.localId); idMap.set(it.remoteId, it.localId) }
        const localIds = items.map((it) => it.localId)

        tx.indexSnapshot = (await readTextFile(INDEX)) || ''
        // 1) 目标目录树（包里有的逐个覆盖；本地多余文件**不动** —— prune 明确不做）
        await ensureDir(canonicalDir)
        let goalFilesWritten = 0, goalFilesSame = 0, goalJsonWritten = 0
        for (const f of manifest.files) {
          if (!f.name.startsWith('goal/')) continue
          const rel = f.name.slice('goal/'.length)
          if (rel === SYNC_FILE) continue
          const dest = P.safeJoin(canonicalDir, rel)
          const same = await fsp.readFile(dest).then((b) => P.sha256Hex(b) === f.sha256).catch(() => false)
          if (same) { goalFilesSame++; continue }
          await stage(dest, entries.get(f.name))
          goalFilesWritten++
          if (rel === 'goal.json') goalJsonWritten++   // goal.json 必然与包里不同（它带本机身份），不计入"非幂等"
        }
        // 2) 会话：按解析出来的 action 落盘
        const applied = {}
        for (const it of items) {
          if (it.action === 'skippedByRequest' || it.action === 'skippedDiverged') { applied[it.action] = (applied[it.action] || 0) + 1; continue }
          const raw = entries.get(it.entry)
          if (raw === undefined) throw new Error('包内缺少会话条目 ' + it.entry)
          const kind = it.encoding === 'jsonl' ? 'jsonl' : 'zstd'
          if (it.action === 'noop') { applied.noop = (applied.noop || 0) + 1; continue }
          if (it.action === 'append') {
            // 快进：同 id、同目录，只在末尾补包多出来的行 ⇒ 不动一个已有字节
            const localBuf = await fsp.readFile(it.targetPath)
            const la = P.analyzeTranscript(localBuf)
            const pkgLines = kind === 'zstd' ? P.analyzeTranscript(raw).lines : raw.toString('utf8').split('\n').filter(Boolean).slice(1)
            const tail = pkgLines.slice(la.lines.length)
            if (!tail.length) { applied.noop = (applied.noop || 0) + 1; continue }
            const r = await P.appendLinesToTranscript(localBuf, tail)
            await stage(it.targetPath, r.bytes)
            it.newSha = P.sha256Hex(r.bytes)
            applied.append = (applied.append || 0) + 1
            continue
          }
          const patch = { cwd: canonicalDir }
          if (it.localId !== it.pkgId) patch.id = it.localId
          const parentLocal = it.pkgParent ? idMap.get(it.pkgParent) : undefined
          if (it.pkgParent && parentLocal && parentLocal !== it.pkgParent) patch.parentSession = parentLocal
          let data
          if (kind === 'zstd') data = (await P.rewriteTranscriptHeader(raw, patch)).bytes
          else {
            const lines = raw.toString('utf8').split('\n').filter(Boolean)
            const first = JSON.parse(lines[0])
            const next = Object.assign({}, first, { cwd: canonicalDir })
            if (patch.id) next.id = patch.id
            if (patch.parentSession) next.parentSession = patch.parentSession
            data = await P.jsonlToZstdFrames(JSON.stringify(next) + '\n' + lines.slice(1).join('\n') + '\n')
            if (!lines.slice(1).length) data = (await P.rewriteTranscriptHeader(await P.jsonlToZstdFrames(JSON.stringify(next) + '\n'), {})).bytes
          }
          await stage(it.targetPath, data)
          it.newSha = P.sha256Hex(data)
          applied[it.action] = (applied[it.action] || 0) + 1
        }
        // 3) 附件（内容寻址 ⇒ 重新落盘后 attachmentId 不变，会话引用继续有效）
        let attachCount = 0
        const svc = portableDeps.attachments
        for (const ref of (manifest.attachments || [])) {
          const buf = entries.get(ref.entry)
          if (buf === undefined) { warnings.push('附件条目缺失: ' + ref.attachmentId); continue }
          if (!svc || typeof svc.saveImage !== 'function') { warnings.push('附件服务不可用，图片 ' + ref.attachmentId + ' 未落盘'); continue }
          try { await svc.saveImage({ data: new Uint8Array(buf), mediaType: ref.mediaType }); attachCount++ }
          catch (e) { warnings.push('附件 ' + ref.attachmentId + ' 落盘失败: ' + errText(e)) }
        }
        // 4) goal.json：换成本机身份（**不能**照抄包里的远端 id）+ index.json 合并
        const goalPath = path.join(canonicalDir, 'goal.json')
        const g = await readJson(goalPath)
        if (!g) throw new Error('包内 goal/goal.json 缺失或不可解析')
        const remapId = (sid) => (sid ? (idMap.get(String(sid)) || String(sid)) : sid)
        g.id = goalId
        g.dir = goalId
        g.sessionId = remapId(g.sessionId)
        if (Array.isArray(g.chapters)) for (const c of g.chapters) c.sessionId = remapId(c.sessionId)
        if (g.research && g.research.sessionId) g.research.sessionId = remapId(g.research.sessionId)
        g.workspaceId = undefined
        g.updatedAt = nowISO()
        await writeJson(goalPath, g)
        const idx = await readIndex()
        idx.goals = (idx.goals || []).filter((r) => r.id !== goalId)
        idx.goals.unshift({ id: goalId, title: g.title || manifest.goal.title || '', status: g.status || manifest.goal.status || 'researching', createdAt: g.createdAt || manifest.goal.createdAt, updatedAt: g.updatedAt, path: canonicalDir })
        await writeIndex(idx)
        // 5) 工作区：先解析复用，没有才创建；标题按需刷新；席位重挂（走公开 API，绝不手改全局文件）
        let wsId = '', ws = undefined
        const attachFail = []
        if (wsRegistry) {
          try {
            ws = await wsRegistry.resolveByPath(canonicalDir)
            if (!ws) { ws = await wsRegistry.create(canonicalDir, resolution.plan.title || g.topic || goalId); tx.wsCreated = true }
            else if (typeof ws.setTitle === 'function' && String(ws.title || '') !== String(resolution.plan.title || g.title || '')) { await ws.setTitle(resolution.plan.title || g.title || goalId) }
            wsId = String(ws && ws.id)
            tx.workspaceId = wsId
            if (!wsId) throw new Error('工作区登记未返回 id')
            const seatsBefore = Array.isArray(ws.sessionIds) ? ws.sessionIds.map(String) : []
            for (const sid of localIds) {
              try { if (typeof ws.attachSession === 'function') await ws.attachSession(sid) }
              catch (e) { attachFail.push(sid + ': ' + errText(e)) }
            }
            // 摘掉两类幽灵席位：① 账本里被本次换掉的旧本地身份；② transcript 已不在盘上的（早先删过/回滚过留下的）。
            // 只摘席位、绝不删文件 —— 删除会话不是本插件的职责（宿主也没有删除 API）。
            const superseded = (resolution.ledger.sessions || []).map((e) => String(e.localId || '')).filter((id) => id && localIds.indexOf(id) < 0)
            const ghosts = seatsBefore.filter((id) => localIds.indexOf(id) < 0 && !(resolution.globalIds.byId.has(id)))
            const toDetach = [...new Set(superseded.concat(ghosts))]
            for (const sid of toDetach) { try { if (typeof ws.detachSession === 'function') await ws.detachSession(sid) } catch {} }
            if (ghosts.length) warnings.push('摘除 ' + ghosts.length + ' 个 transcript 已不存在的幽灵席位')
            if (superseded.length) warnings.push('摘除上次导入留下的旧席位 ' + superseded.length + ' 个（对应 transcript 仍在盘上，会转入 Ungrouped，如需清理由宿主侧删除会话）')
            g.workspaceId = wsId
            await writeJson(goalPath, g)
          } catch (e) { warnings.push('工作区登记失败（文件与会话已落盘，可用「🔗 重新绑定会话」重试）: ' + errText(e)) }
        } else warnings.push('工作区注册表不可用，未登记工作区')
        for (const m of attachFail) warnings.push('会话挂到工作区失败: ' + m)
        // 6) 自检：① 宿主 inspect() 读得懂（非修改式）② 宿主自己的可见投影 ws.sessionIds 认账
        const verifyFail = []
        const pp = portableDeps.persistence
        for (const it of items) {
          if (it.action === 'skippedByRequest' || it.action === 'skippedDiverged') continue
          try {
            if (pp && typeof pp.inspect === 'function') { const v = await pp.inspect(it.localId); if (!v || !v.meta) verifyFail.push(it.localId + ': inspect 返回空') }
          } catch (e) { verifyFail.push(it.localId + ': ' + errText(e)) }
        }
        const projected = ws && Array.isArray(ws.sessionIds) ? ws.sessionIds.map(String) : []
        const notShown = localIds.filter((id) => projected.indexOf(id) < 0)
        if (notShown.length) verifyFail.push('工作区投影里没有这些会话（宿主不会显示）: ' + notShown.slice(0, 3).join(', ') + (attachFail.length ? '；attach 失败: ' + attachFail.slice(0, 2).join(' | ') : ''))
        if (verifyFail.length) {
          await restore()
          return { ok: false, error: '导入自检未通过，已全部回滚: ' + verifyFail.slice(0, 3).join('; '), rolledBack: true, warnings, conflicts }
        }
        // 7) 设备本地身份账本（下次同步靠它认出同一个会话；不随包旅行）
        const ledger = {
          v: 1, deviceId: manifest.deviceId || '', remoteGoalId: resolution.remoteGoalId,
          remoteSource: (manifest.source && (manifest.source.dshHome || manifest.source.studyWorkRoot)) || '',
          appliedFrom: { ref: a.file || a.path || '', exportedAt: manifest.exportedAt || '', at: nowISO() },
          sessions: items.filter((it) => it.action !== 'skippedByRequest').map((it) => ({
            remoteId: it.remoteId, localId: it.localId, pkgId: it.pkgId, title: it.title || '',
            boundTo: it.boundTo || 'unbound', appliedSha: it.newSha || it.pkgSha || '',
            appliedSeq: it.pkgMaxSeq, appliedRows: it.pkgLines, appliedAt: nowISO(), lastAction: it.action,
          })),
        }
        try { await writeSyncLedger(canonicalDir, ledger) }
        catch (e) { warnings.push('身份账本写入失败（本次导入不受影响，但下次同步会被当成首次）: ' + errText(e)) }
        if (resolution.plan.hiddenByHostRule.length) {
          warnings.push(resolution.plan.hiddenByHostRule.length + ' 条会话按宿主规则不会在工作区里单独出现：' + resolution.plan.hiddenByHostRule.map((h) => String(h.localId).slice(8, 16) + '…(' + h.reason + ')').join('，'))
        }
        return stripUndefined({
          ok: true, goalId, dir: canonicalDir, title: g.title, mode,
          sessions: localIds.length, applied,
          remap: items.filter((it) => it.identity === 'reissue' || it.identity === 'adopt').map((it) => ({ remoteId: it.remoteId, pkgId: it.pkgId, localId: it.localId, why: it.why || '' })),
          goalFiles: { written: goalFilesWritten, same: goalFilesSame, goalJson: goalJsonWritten },
          skipped: skip.size, attachments: attachCount, workspaceId: wsId || undefined,
          idempotent: items.every((it) => it.action === 'noop' || it.action === 'skippedDiverged') && goalFilesWritten === goalJsonWritten,
          verified: !!(pp && typeof pp.inspect === 'function'),
          restartNeeded: true, warnings,
        })
      } catch (e) {
        await restore().catch(() => {})
        return { ok: false, error: errText(e), rolledBack: true }
      }
    }

    /** 重启后/换机后的修复入口：重建工作区登记并把 goal.json 里的会话挂回去。 */
    handlers['study.reattachGoalSessions'] = async (args) => {
      try {
        const g = await loadGoal(String((args && args.goalId) || ''))
        if (!g) return { ok: false, error: '目标不存在' }
        if (!wsRegistry) return { ok: false, error: '工作区注册表服务不可用' }
        const absDir = await goalDir(g)
        let ws = (g.workspaceId && wsRegistry.get) ? wsRegistry.get(String(g.workspaceId)) : undefined
        if (!ws) ws = await wsRegistry.resolveByPath(absDir)
        if (!ws) ws = await wsRegistry.create(absDir, g.title || g.topic)
        const wsId = String(ws && ws.id)
        if (!wsId) return { ok: false, error: '工作区创建失败' }
        const ids = [g.sessionId, ...(g.chapters || []).map((c) => c.sessionId)].filter(Boolean).map(String)
        const failed = []
        for (const sid of ids) { try { await ws.attachSession(sid) } catch (e) { failed.push(sid + ': ' + errText(e)) } }
        if (g.workspaceId !== wsId) { g.workspaceId = wsId; g.updatedAt = nowISO(); await saveGoal(g) }
        // 以宿主自己的可见投影为准判定成败（attach 不抛 ≠ 会显示）
        const projected = Array.isArray(ws.sessionIds) ? ws.sessionIds.map(String) : []
        const notShown = ids.filter((id) => projected.indexOf(id) < 0)
        return stripUndefined({
          ok: failed.length === 0 && notShown.length === 0,
          workspaceId: wsId, attached: ids.length - notShown.length, failed,
          notShown: notShown.length ? notShown : undefined,
          error: notShown.length ? '宿主工作区投影里仍看不到 ' + notShown.length + ' 条会话（多为 header.cwd 与工作区路径不一致或 header 读不出）' : undefined,
          archived: ids.filter((id) => { try { return (wsRegistry.archivedSessionIds || []).indexOf(id) >= 0 } catch { return false } }),
        })
      } catch (e) { return { ok: false, error: errText(e) } }
    }

    // ══════════════════════════════════════════════════════════════════════
    // M5 GitHub 同步 —— 通道 = 本仓 v2 导出包；仓库/鉴权/冲突模型见
    // docs/design/github-sync.md。要点：
    //   · 固定仓名 dsh-study-sync（private，认领标记 .study-sync-owner.json），不选仓
    //   · 每目标 <prefix>/<remoteGoalId>/bundle.zip + bundle.meta.json；meta 最后推 = 提交点
    //   · 并发靠 Contents API 的 sha 前置条件（CAS）；409 ⇒ 重读重判，绝不盲写
    //   · 冲突判据 = 双基线指纹（baseLocalDigest/baseRemoteDigest 记在目标账本），
    //     会话向量（remoteId→maxSeq/rows）可判快进时不升冲突
    //   · fetch 缺席/服务不可得只让本层报错，不拖垮其它功能（沿用降级模式）
    // ══════════════════════════════════════════════════════════════════════
    const SYNC_CFG_FILE = BASE + '/sync-config.json'
    const SYNC_TMP_DIR = BASE + '/sync-tmp'
    const GH_REPO_NAME = 'dsh-study-sync'
    const GH_REPO_DESC = 'DSH 学习区同步仓（study-plugin 自动创建/维护）'
    const GH_PREFIX = 'study-goals'
    const GH_MARKER_FILE = '.study-sync-owner.json'
    const GH_BUNDLE_FILE = 'bundle.zip'
    const GH_META_FILE = 'bundle.meta.json'
    const MAX_SYNC_ZIP_BYTES = 50 * 1024 * 1024   // Contents API 单文件上限 100MB，留一倍余量
    const DEFAULT_API_BASE = 'https://api.github.com'
    const DEFAULT_WEB_BASE = 'https://github.com'
    // 官方设备码 OAuth App 的 client_id（公开值、无 client_secret，可安全内嵌公开仓）。
    // 已在 https://github.com/settings/developers 建 App 并勾选 "Device flow enabled" ⇒ 用户零配置一键绑定。
    // 若此 App 被撤销：留空即降级为「高级选项」手填 client_id 或 PAT 绑定（PAT 不受影响）。
    const DEFAULT_CLIENT_ID = 'Ov23lifBR5oTwAIOVycn'

    const gitBlobSha = (buf) => createHash('sha1').update('blob ' + buf.length + '\0').update(buf).digest('hex')
    const b64 = (s) => Buffer.from(s, 'utf8').toString('base64')
    const unb64 = (s) => Buffer.from(String(s || '').replace(/\s+/g, ''), 'base64')

    /** 内容指纹：逐文件 sha + 会话向量排序聚合；manifest 自身的 exportedAt/deviceId 不参与 ⇒ 重复导出不产生假"本地有改动"。 */
    function contentDigestOf(manifest) {
      const files = (manifest.files || []).map((f) => f.name + ':' + f.sha256).sort()
      const vec = (manifest.sessions || []).map((s) => String(s.remoteId || s.id) + ':' + (s.maxSeq === undefined ? '-' : s.maxSeq) + ':' + (s.rows === undefined ? '-' : s.rows)).sort()
      return P.sha256Hex(P.utf8(files.join('\n') + '\n#\n' + vec.join('\n')))
    }
    const sessionVec = (arr) => new Map((arr || []).map((s) => [String(s.remoteId || s.id), { maxSeq: s.maxSeq, rows: s.rows }]))
    /** a ⊒ b：a 覆盖 b 的全部会话且每条都不比 b 旧（多出会话只许是空的），⇒ 单向快进成立。 */
    function vecCovers(a, b) {
      for (const [id, t] of b) {
        const s = a.get(id)
        if (!s) return false
        const sm = s.maxSeq == null ? 0 : s.maxSeq, tm = t.maxSeq == null ? 0 : t.maxSeq
        if (sm < tm) return false
        if (sm === tm && (s.rows || 0) < (t.rows || 0)) return false
      }
      return true
    }

    async function loadSyncCfg() {
      let cfg
      try { cfg = await readJson(SYNC_CFG_FILE) } catch { cfg = undefined }
      if (!cfg || typeof cfg !== 'object') cfg = { v: 2 }
      cfg.v = 2
      if (cfg.clientId === undefined && DEFAULT_CLIENT_ID) cfg.clientId = DEFAULT_CLIENT_ID
      cfg.endpoints = Object.assign({ api: DEFAULT_API_BASE, web: DEFAULT_WEB_BASE }, cfg.endpoints || {})
      return cfg
    }
    async function saveSyncCfg(cfg) { await writeJson(SYNC_CFG_FILE, cfg) }
    /** 任何进 RPC 返回值的配置视图都必须先过这里：token 原文绝不出门。 */
    function redactSyncCfg(cfg) {
      const out = JSON.parse(JSON.stringify(cfg || {}))
      if (out.auth && out.auth.token) {
        out.auth.tokenHint = '••••' + String(out.auth.token).slice(-4)
        delete out.auth.token
      }
      delete out.clientSecret
      return out
    }

    class GhError extends Error {
      constructor(what, res) {
        const d = res && res.data
        const detail = typeof d === 'string' ? d.slice(0, 160) : ((d && (d.message || '')) + (d && Array.isArray(d.errors) && d.errors.length ? ' ' + JSON.stringify(d.errors[0]).slice(0, 120) : ''))
        super(what + ' 失败: HTTP ' + (res && res.status) + (detail ? ' — ' + detail : ''))
        this.status = res && res.status
        this.data = d
      }
    }
    /** 固定仓名已被账号自己占用但没有学习区认领标记：可受控「接管」，而不是硬拒。code 供上层分岔出接管入口。 */
    class RepoOccupiedError extends Error {
      constructor(owner, detail) {
        super('账号 ' + owner + ' 下 ' + GH_REPO_NAME + ' 已存在，但' + (detail || '不是本插件的同步仓') + '。确认这是你自己的仓库后可点「接管」：只补写认领标记并在 ' + GH_PREFIX + '/ 前缀下同步，绝不删除它现有的任何内容。想避开请先把那个仓改名或换一个 GitHub 账号。')
        this.code = 'repoOccupied'
      }
    }
    async function ghReq(url, opt) {
      if (typeof fetch !== 'function') throw new Error('宿主 Node 无 fetch 全局，GitHub 同步不可用（其余功能不受影响）')
      const res = await fetch(url, Object.assign({ redirect: 'error' }, opt))
      const text = await res.text()
      let data
      try { data = JSON.parse(text) } catch { data = text }
      return { status: res.status, data }
    }
    async function ghApi(cfg, method, p, body, extraHeaders) {
      const headers = Object.assign({ accept: 'application/vnd.github+json' }, extraHeaders || {})
      const tok = cfg && cfg.auth && cfg.auth.token
      if (tok) headers.authorization = 'Bearer ' + tok
      if (body !== undefined) { headers['content-type'] = 'application/json'; body = JSON.stringify(body) }
      return ghReq(String(cfg.endpoints.api).replace(/\/+$/, '') + p, { method, headers, body })
    }
    /** 绑定状态机的公共尾段：验证 token → 定位或创建固定仓 → 落盘。硬失败不落盘（PAT 场景）；仓被账号自己占用时保留 account-only（token 待续接管），其它失败保留 auth 待续（设备码场景）。 */
    async function bindWithToken(cfg, token, kind, tokenMeta) {
      const next = Object.assign({}, cfg, { auth: Object.assign({ kind, token, obtainedAt: nowISO() }, tokenMeta || {}) })
      const u = await ghApi(next, 'GET', '/user')
      if (u.status === 401) throw new Error('凭据无效（401）：token 可能已撤销或权限不足')
      if (!(u.status >= 200 && u.status < 300) || !u.data || !u.data.login) throw new GhError('识别账号', u)
      next.auth.account = String(u.data.login)
      next.auth.accountId = u.data.id
      try {
        await locateOrCreateRepo(next)
      } catch (e) {
        if (e && e.code === 'repoOccupied') await saveSyncCfg(next)   // 存 account-only，让「接管」能复用这个 token
        throw e
      }
      await saveSyncCfg(next)
      return next
    }
    /** 固定仓名 + 认领标记：404 建仓 / 有标记采用 / 无标记受控接管 / 422 竞态重走。绝不静默写别人的仓。 */
    async function locateOrCreateRepo(cfg, opts) {
      const takeOver = !!(opts && opts.takeOver)
      const owner = cfg.auth.account
      const path_ = '/repos/' + owner + '/' + GH_REPO_NAME
      let r = await ghApi(cfg, 'GET', path_)
      if (r.status === 404) {
        const created = await ghApi(cfg, 'POST', '/user/repos', { name: GH_REPO_NAME, description: GH_REPO_DESC, private: true, auto_init: false, has_issues: false, has_wiki: false, has_projects: false })
        if (created.status === 422) {
          r = await ghApi(cfg, 'GET', path_)   // 竞态：别的设备刚建好 ⇒ 重走采用分支
          if (r.status !== 200) throw new GhError('定位同步仓', r)
        } else if (!(created.status >= 200 && created.status < 300)) {
          throw new GhError('创建同步仓', created)
        } else r = created
      }
      if (!(r.status >= 200 && r.status < 300)) throw new GhError('定位同步仓', r)
      const repo = r.data
      if (repo.fork || repo.archived) throw new Error(GH_REPO_NAME + ' 仓存在但它是 fork/archived，不适合做同步仓')
      const branch = String(repo.default_branch || 'main')
      // 认领标记：仓根 .study-sync-owner.json 的 kind 字段是唯一判据（仓名/描述可被改，不作数）
      const putMarker = async (sha) => {
        const body = { message: 'study-plugin: init sync repo', content: b64(JSON.stringify({ kind: 'dsh-study-sync', tool: 'study-plugin', createdBy: owner, createdAt: nowISO() }, null, 2)), branch }
        if (sha) body.sha = String(sha)   // 覆盖已存在的同名文件（接管时替换那一个标记，别的内容一律不动）
        const wp = await ghApi(cfg, 'PUT', path_ + '/contents/' + GH_MARKER_FILE, body)
        if (!(wp.status >= 200 && wp.status < 300)) throw new GhError('写入认领标记（token 需要 Contents 写权限）', wp)
      }
      const mk = await ghApi(cfg, 'GET', path_ + '/contents/' + GH_MARKER_FILE + '?ref=' + encodeURIComponent(branch))
      if (mk.status === 200 && mk.data && mk.data.content) {
        let j
        try { j = JSON.parse(unb64(mk.data.content).toString('utf8')) } catch { j = null }
        if (!j || j.kind !== 'dsh-study-sync') {
          if (!takeOver) throw new RepoOccupiedError(owner, '认领标记不是本插件写的')
          await putMarker(mk.data.sha)   // 明示接管：只替换这一个标记文件
        }
      } else if (mk.status === 409) {
        await putMarker(null)   // 409 = 仓是空的（刚建/建仓者没推东西）⇒ 首推认领标记即完成初始化
      } else if (mk.status === 404) {
        if (!takeOver) throw new RepoOccupiedError(owner, '已有内容但没有学习区的认领标记')
        await putMarker(null)   // 明示接管：补写标记（新建文件），不删除任何已有内容
      } else throw new GhError('读取认领标记', mk)
      cfg.repo = { fullName: owner + '/' + GH_REPO_NAME, owner, name: GH_REPO_NAME, branch, prefix: GH_PREFIX, repoId: repo.id, boundAt: nowISO() }
      delete cfg.invalidAt
    }
    const goalPathOf = (rgid) => GH_PREFIX + '/' + safeSeg(rgid)

    /** 远端 meta 读取：null = 该目标从没推过。同时带回 zip 的 Contents sha（CAS 前置条件用）。 */
    async function fetchRemoteMeta(cfg, rgid) {
      const p = '/' + goalPathOf(rgid) + '/' + GH_META_FILE
      const base = '/repos/' + cfg.repo.owner + '/' + cfg.repo.name
      const r = await ghApi(cfg, 'GET', base + '/contents' + p + '?ref=' + encodeURIComponent(cfg.repo.branch))
      if (r.status === 404) return null
      if (!(r.status >= 200 && r.status < 300)) throw new GhError('读取远端 meta', r)
      let meta
      try { meta = JSON.parse(unb64(r.data.content).toString('utf8')) } catch { throw new Error('远端 ' + GH_META_FILE + ' 不是合法 JSON') }
      const zr = await ghApi(cfg, 'GET', base + '/contents/' + goalPathOf(rgid) + '/' + GH_BUNDLE_FILE + '?ref=' + encodeURIComponent(cfg.repo.branch))
      if (!(zr.status >= 200 && zr.status < 300)) throw new GhError('远端有 meta 但缺 bundle.zip', zr)
      return { meta, zipSha: String(zr.data.sha), zipBytes: Number(zr.data.size || 0) }
    }

    async function fetchRemoteZip(cfg, zipBlobSha, expectSize) {
      if (expectSize > MAX_SYNC_ZIP_BYTES) throw new Error('远端包过大（' + expectSize + ' B > ' + MAX_SYNC_ZIP_BYTES + ' B）')
      const base = '/repos/' + cfg.repo.owner + '/' + cfg.repo.name
      const r = await ghApi(cfg, 'GET', base + '/git/blobs/' + encodeURIComponent(zipBlobSha))
      if (!(r.status >= 200 && r.status < 300)) throw new GhError('下载远端包', r)
      const buf = unb64(r.data.content)
      if (gitBlobSha(buf) !== String(zipBlobSha)) throw new Error('远端包 sha 校验失败（下载损坏？）')
      return buf
    }

    /** Contents PUT 带 sha 前置条件；返回 409 ⇒ 抛带 status 的 GhError 交给上层重判。 */
    async function ghPutContents(cfg, relPath, contentBuf, message, sha) {
      const base = '/repos/' + cfg.repo.owner + '/' + cfg.repo.name
      const body = { message, content: contentBuf.toString('base64'), branch: cfg.repo.branch }
      if (sha) body.sha = sha
      const r = await ghApi(cfg, 'PUT', base + '/contents/' + relPath, body)
      if (!(r.status >= 200 && r.status < 300)) throw new GhError('提交 ' + relPath, r)
      return r.data   // {commit, content:{sha}}
    }

    /** 同步评估：本地现算包指纹 vs 远端 meta vs 账本双基线 ⇒ 五态。push/pull 内部复用。 */
    async function syncAssess(cfg, goalId) {
      const g = await loadGoal(goalId)
      if (!g) throw new Error('目标不存在: ' + goalId)
      const absDir = await goalDir(g)
      const ledger = await readSyncLedger(absDir)
      const rgid = String(ledger.remoteGoalId || g.id)
      const { zip, manifest } = await buildGoalBundle(goalId)
      const digest = contentDigestOf(manifest)
      const local = {
        digest, exportedAt: manifest.exportedAt, deviceId: manifest.deviceId, bytes: zip.length,
        title: manifest.goal.title, chapters: manifest.goal.chapterCount,
        sessions: (manifest.sessions || []).map((s) => ({ remoteId: String(s.remoteId || s.id), maxSeq: s.maxSeq, rows: s.rows })),
      }
      const remoteWrap = await fetchRemoteMeta(cfg, rgid)
      const remote = remoteWrap ? {
        digest: String(remoteWrap.meta.digest || ''), exportedAt: remoteWrap.meta.exportedAt, deviceId: remoteWrap.meta.deviceId,
        bytes: Number(remoteWrap.meta.zipBytes || remoteWrap.zipBytes), title: remoteWrap.meta.title,
        chapters: Number(remoteWrap.meta.chapters || 0), sessions: remoteWrap.meta.sessions || [],
        zipSha: remoteWrap.zipSha, zipBlobSha: String(remoteWrap.meta.zipBlobSha || ''), meta: remoteWrap.meta,
      } : null
      const base = (ledger.github && ledger.github.repo === cfg.repo.fullName) ? ledger.github : null
      const localChanged = base ? digest !== base.baseLocalDigest : !remote ? false : true
      const remoteChanged = base ? (remote ? remote.digest !== base.baseRemoteDigest : true) : !!remote
      let status
      if (!remote) status = 'remoteMissing'                       // 远端没有这个目标 ⇒ 首推（账本记着远端曾有但被删也算这里）
      else if (remote.digest === digest) status = 'upToDate'      // 字节级内容一致（首绑两台相同内容直接落在这里）
      else if (!localChanged && !remoteChanged) status = 'upToDate'
      else if (localChanged && !remoteChanged) status = 'localAhead'
      else if (!localChanged && remoteChanged) status = 'remoteAhead'
      else {
        const lv = sessionVec(local.sessions), rv = sessionVec(remote.sessions)
        const lCovers = vecCovers(lv, rv), rCovers = vecCovers(rv, lv)
        if (lCovers && !rCovers) status = 'localAhead'             // 严格超集才快进：本地会话覆盖了远端全部进度
        else if (rCovers && !lCovers) status = 'remoteAhead'
        else status = 'conflicted'                                  // 双向各有独占进度，或向量相等但文件内容双向都改 ⇒ 真分叉
      }
      return { goalId: g.id, remoteGoalId: rgid, absDir, ledger, digest, local, remote, base, status }
    }

    /** 成功同步后回写双基线（pull 之后本地内容被身份重写 ⇒ 必须现算，不能沿用 pull 前的 digest）。 */
    async function stampSyncBase(cfg, goalId, remoteGoalId, opts) {
      const g = await loadGoal(goalId)
      if (!g) return
      const absDir = await goalDir(g)
      const ledger = await readSyncLedger(absDir)
      const { manifest } = await buildGoalBundle(goalId)
      const digest = contentDigestOf(manifest)
      ledger.github = Object.assign({}, ledger.github, {
        repo: cfg.repo.fullName, prefix: GH_PREFIX, remoteGoalId,
        baseLocalDigest: digest,
        baseRemoteDigest: opts.remoteDigest === undefined ? digest : opts.remoteDigest,
        lastPushAt: opts.pushAt || (ledger.github && ledger.github.lastPushAt) || '',
        lastPullAt: opts.pullAt || (ledger.github && ledger.github.lastPullAt) || '',
        updatedAt: nowISO(),
      })
      await writeSyncLedger(absDir, ledger)
      return digest
    }

    let deviceFlow = null   // 设备码流程的进程内临时态（不落盘：一次性，重启面板重新发起即可）
    function syncBound(cfg) {
      return !!(cfg && cfg.auth && cfg.auth.token && cfg.repo && cfg.repo.fullName && !cfg.invalidAt)
    }
    /** 所有同步 RPC 的统一守卫：未绑定/服务不可用 ⇒ 结构化返回，不抛。写权限不足留给首推的 403 暴露。 */
    async function requireBind() {
      if (typeof fetch !== 'function') return { cfg: null, err: { ok: false, error: '宿主 Node 无 fetch，GitHub 同步不可用', bound: false } }
      const cfg = await loadSyncCfg()
      if (!syncBound(cfg)) return { cfg, err: { ok: false, error: '尚未绑定 GitHub（先点「🔗 绑定 GitHub」）', bound: false, bindState: bindStateOf(cfg) } }
      return { cfg, err: null }
    }
    function bindStateOf(cfg) {
      if (cfg.invalidAt) return 'invalid'
      if (cfg.auth && cfg.auth.token && cfg.repo) return 'ready'
      if (cfg.auth && cfg.auth.token) return 'account-only'
      return 'unbound'
    }
    /** 401 统一处理：绑定标失效但保留全部配置与账本，重绑成功后照常续用。 */
    async function markInvalid(cfg, e) {
      if (e && e.status === 401) { cfg.invalidAt = nowISO(); await saveSyncCfg(cfg).catch(() => {}) }
    }
    function syncErr(e, extra) {
      const out = Object.assign({ ok: false, error: errText(e) }, extra || {})
      if (e && e.code === 'repoOccupied') { out.needTakeOver = true; out.bound = false; out.bindState = 'account-only' }
      if (e && e.status === 401) { out.needRebind = true; out.bound = true }
      return out
    }

    // ── study.sync* RPC ─────────────────────────────────────────────────────
    handlers['study.syncGetConfig'] = async () => {
      try {
        const cfg = await loadSyncCfg()
        return stripUndefined({ ok: true, bound: syncBound(cfg), bindState: bindStateOf(cfg), fetch: typeof fetch === 'function', oneClick: !!(cfg.clientId && String(cfg.clientId).trim()), config: redactSyncCfg(cfg) })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncSetConfig'] = async (args) => {
      try {
        const a = args || {}
        const cfg = await loadSyncCfg()
        if (a.autoSync !== undefined) {
          if (['off', 'pull'].indexOf(String(a.autoSync)) < 0) return { ok: false, error: 'autoSync 只接受 off / pull' }
          cfg.autoSync = String(a.autoSync)
        }
        if (a.clientId !== undefined) cfg.clientId = String(a.clientId).trim()
        if (a.apiBase !== undefined || a.webBase !== undefined) {
          cfg.endpoints = cfg.endpoints || { api: DEFAULT_API_BASE, web: DEFAULT_WEB_BASE }
          for (const [k, v] of [['api', a.apiBase], ['web', a.webBase]]) {
            if (v === undefined) continue
            const s = String(v).trim().replace(/\/+$/, '')
            const ok = /^https:\/\/[^/]+$/.test(s) || /^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/.test(s)   // 明文只允许回环（测试 mock），防 token 走 http 出去
            if (!ok) return { ok: false, error: 'endpoint 必须是 https 地址（本机测试可用 http://127.0.0.1:端口）' }
            cfg.endpoints[k] = s
          }
        }
        await saveSyncCfg(cfg)
        return stripUndefined({ ok: true, config: redactSyncCfg(cfg) })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncBindPat'] = async (args) => {
      try {
        const token = String((args && args.token) || '').trim()
        if (!/^[A-Za-z0-9_\-\.]{20,255}$/.test(token)) return { ok: false, error: 'token 形状不对（fine-grained PAT 以 github_pat_ 开头，classic 以 ghp_ 开头，均 ≥20 字符）' }
        const cfg = await loadSyncCfg()
        const bound = await bindWithToken(cfg, token, 'pat', null)
        Object.assign(cfg, bound)
        return stripUndefined({ ok: true, bound: true, config: redactSyncCfg(cfg) })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncStartDeviceFlow'] = async () => {
      try {
        const cfg = await loadSyncCfg()
        const clientId = String(cfg.clientId || '').trim()
        if (!clientId) return { ok: false, error: '本机未配置 GitHub OAuth App 的 client_id（设备码方式需要它；也可改用 fine-grained PAT 绑定）' }
        if (typeof fetch !== 'function') return { ok: false, error: '宿主 Node 无 fetch，GitHub 同步不可用' }
        const r = await ghReq(String(cfg.endpoints.web).replace(/\/+$/, '') + '/login/device/code', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'study-plugin' },
          body: new URLSearchParams({ client_id: clientId, scope: 'repo' }).toString()
        })
        if (!(r.status >= 200 && r.status < 300)) throw new GhError('申请设备码', r)
        const d = r.data
        deviceFlow = { deviceCode: d.device_code, userCode: String(d.user_code || ''), verificationUri: String(d.verification_uri || cfg.endpoints.web + '/login/device'), interval: Math.max(1, Number(d.interval) || 5), expiresAt: Date.now() + Number(d.expires_in || 900) * 1000, startedAt: Date.now(), clientId }
        return stripUndefined({ ok: true, userCode: deviceFlow.userCode, verificationUri: deviceFlow.verificationUri, interval: deviceFlow.interval, expiresIn: Number(d.expires_in || 900) })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncPollDeviceFlow'] = async () => {
      try {
        if (!deviceFlow) return { ok: false, error: '没有进行中的设备码流程' }
        if (Date.now() > deviceFlow.expiresAt) { deviceFlow = null; return { ok: false, error: '设备码已过期，请重新发起绑定' } }
        const cfg = await loadSyncCfg()
        // OAuth App 设备码换取令牌的端点是 /login/oauth/access_token + grant_type=device_code，
        // 不是 /login/oauth/device/poll（后者会返回 GitHub 网页的 422 HTML）。authorization_pending 用 JSON error 字段区分。
        const r = await ghReq(String(cfg.endpoints.web).replace(/\/+$/, '') + '/login/oauth/access_token', {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json', 'user-agent': 'study-plugin' },
          body: new URLSearchParams({ client_id: deviceFlow.clientId, device_code: deviceFlow.deviceCode, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }).toString()
        })
        const d = r.data || {}
        if (d.error === 'authorization_pending' || d.error === 'slow_down') return stripUndefined({ ok: true, status: 'pending' })
        if (d.error === 'access_denied') { deviceFlow = null; return { ok: false, error: '你在 GitHub 上拒绝了本次授权' } }
        if (d.error === 'expired_token') { deviceFlow = null; return { ok: false, error: '设备码已过期，请重新发起绑定' } }
        if (!(r.status >= 200 && r.status < 300) || !d.access_token) throw new GhError('设备码轮询', r)
        deviceFlow = null
        const bound = await bindWithToken(cfg, String(d.access_token), 'device', null)
        Object.assign(cfg, bound)
        return stripUndefined({ ok: true, status: 'authorized', bound: true, config: redactSyncCfg(cfg) })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncRebind'] = async () => {   // 已有 token（配置里存的）重跑定位/建仓：绑定失效恢复入口
      try {
        const cfg = await loadSyncCfg()
        if (!(cfg.auth && cfg.auth.token)) return { ok: false, error: '本机没有可复用的凭据，请重新绑定' }
        if (typeof fetch !== 'function') return { ok: false, error: '宿主 Node 无 fetch，GitHub 同步不可用' }
        await locateOrCreateRepo(cfg)
        await saveSyncCfg(cfg)
        return stripUndefined({ ok: true, bound: syncBound(cfg), config: redactSyncCfg(cfg) })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncTakeOver'] = async () => {   // 明示接管本账号下已存在但无认领标记的固定仓：只补标记，绝不删内容
      try {
        const cfg = await loadSyncCfg()
        if (!(cfg.auth && cfg.auth.token)) return { ok: false, error: '本机没有可复用的凭据，请先重新绑定' }
        if (typeof fetch !== 'function') return { ok: false, error: '宿主 Node 无 fetch，GitHub 同步不可用' }
        await locateOrCreateRepo(cfg, { takeOver: true })
        await saveSyncCfg(cfg)
        return stripUndefined({ ok: true, bound: syncBound(cfg), config: redactSyncCfg(cfg) })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncUnbind'] = async () => {
      try {
        const cfg = await loadSyncCfg()
        delete cfg.auth
        delete cfg.repo
        delete cfg.invalidAt
        await saveSyncCfg(cfg)
        return stripUndefined({ ok: true, bound: false, note: '只清本机的凭据与仓库指向；GitHub 上的数据与各目标账本里的同步基线不动' })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncListRemote'] = async () => {
      try {
        const { cfg, err } = await requireBind()
        if (err) return err
        const base = '/repos/' + cfg.repo.owner + '/' + cfg.repo.name
        const dir = await ghApi(cfg, 'GET', base + '/contents/' + GH_PREFIX + '?ref=' + encodeURIComponent(cfg.repo.branch))
        if (dir.status === 404) return stripUndefined({ ok: true, goals: [], note: '同步仓还没有任何目标（首次推送后会出现）' })
        if (!(dir.status >= 200 && dir.status < 300)) { await markInvalid(cfg, new GhError('', dir)); throw new GhError('列出远端目录', dir) }
        const dirs = (dir.data || []).filter((it) => it && it.type === 'dir')
        const goals = []
        for (const d of dirs) {
          try {
            const rw = await fetchRemoteMeta(cfg, d.name)
            if (rw) goals.push(stripUndefined({
              remoteGoalId: d.name, title: rw.meta.title || '', status: rw.meta.status || '', exportedAt: rw.meta.exportedAt || '',
              deviceId: rw.meta.deviceId || '', bytes: Number(rw.meta.zipBytes || rw.zipBytes), chapters: Number(rw.meta.chapters || 0),
              digest: String(rw.meta.digest || ''),
            }))
          } catch (e) { goals.push(stripUndefined({ remoteGoalId: d.name, title: '', error: errText(e) })) }
        }
        goals.sort((a, b) => String(b.exportedAt).localeCompare(String(a.exportedAt)))
        return stripUndefined({ ok: true, repo: cfg.repo.fullName, branch: cfg.repo.branch, prefix: GH_PREFIX, goals })
      } catch (e) { return syncErr(e) }
    }

    handlers['study.syncInspect'] = async (args) => {
      try {
        const { cfg, err } = await requireBind()
        if (err) return err
        const a = syncAssessResult(await syncAssess(cfg, String((args && args.goalId) || '')))
        return stripUndefined(Object.assign({ ok: true }, a))
      } catch (e) { return syncErr(e) }
    }
    function syncAssessResult(r) {
      const brief = (x) => x ? stripUndefined({ digest: x.digest, exportedAt: x.exportedAt, deviceId: x.deviceId, bytes: x.bytes, title: x.title, chapters: x.chapters, sessions: x.sessions }) : null
      return { status: r.status, goalId: r.goalId, remoteGoalId: r.remoteGoalId, local: brief(r.local), remote: brief(r.remote), base: r.base && stripUndefined({ baseLocalDigest: r.base.baseLocalDigest, baseRemoteDigest: r.base.baseRemoteDigest, lastPushAt: r.base.lastPushAt, lastPullAt: r.base.lastPullAt }) }
    }

    /** 反查：仓库里的某个 remoteGoalId 对应本机哪个目标（账本 remoteGoalId 优先，退回同 id）。 */
    async function findLocalGoalForRemote(rgid) {
      const idx = await readIndex()
      for (const row of (idx.goals || [])) {
        if (String(row.id) === rgid) { /* 先记下，账本命中优先 */ }
        try {
          const g = await loadGoal(row.id)
          if (!g) continue
          const ledger = await readSyncLedger(await goalDir(g))
          if (String(ledger.remoteGoalId || '') === rgid) return row.id
        } catch (e) {}
      }
      // 没有任何账本认领 ⇒ 若本机就有同 id 目标，也算它（首次拉取前的本地目标）
      const direct = (idx.goals || []).find((r) => String(r.id) === rgid)
      return direct ? direct.id : ''
    }

    handlers['study.syncPush'] = async (args) => {
      try {
        const a0 = args || {}
        const force = a0.force === true
        const { cfg, err } = await requireBind()
        if (err) return err
        const goalId = String(a0.goalId || '')
        const r = await syncAssess(cfg, goalId)
        if (r.status === 'conflicted' && !force) return stripUndefined(Object.assign({ ok: false, needChoice: true, error: '仓库版与本地版自上次同步后各自都有改动（真分叉），二选一后再执行', hint: '「用本地覆盖仓库」带 force=true 重推；「放弃本地」走 syncPull discardLocal=true' }, syncAssessResult(r)))
        if (r.status === 'upToDate') return stripUndefined(Object.assign({ ok: true, noop: true, idempotent: true }, syncAssessResult(r)))
        if (r.local.bytes > MAX_SYNC_ZIP_BYTES) return { ok: false, error: '导出包 ' + r.local.bytes + ' B 超过同步上限 ' + MAX_SYNC_ZIP_BYTES + ' B，请改用「📤 导出」手动传' }
        const build = await buildGoalBundle(goalId)
        const gpath = goalPathOf(r.remoteGoalId)
        const base = '/repos/' + cfg.repo.owner + '/' + cfg.repo.name
        const meta = {
          kind: 'dsh-study-sync-bundle', schemaVersion: 1, tool: 'study-plugin',
          remoteGoalId: r.remoteGoalId, goalLocalIdHint: goalId,
          title: build.manifest.goal.title, status: build.manifest.goal.status,
          chapters: build.manifest.goal.chapterCount,
          exportedAt: build.manifest.exportedAt, deviceId: build.manifest.deviceId,
          digest: r.digest, zipBytes: build.zip.length, zipSha256: P.sha256Hex(build.zip),
          zipBlobSha: gitBlobSha(build.zip),
          sessions: (build.manifest.sessions || []).map((s) => ({ remoteId: String(s.remoteId || s.id), maxSeq: s.maxSeq, rows: s.rows })),
          counts: { files: build.manifest.files.length, attachments: build.manifest.attachments.length },
          pushedAt: nowISO(),
        }
        // CAS：zip 先、meta 后 —— 读方以 meta 为提交点，看不到半状态；基线以本地 sha 为前置条件
        try {
          const curZip = await ghApi(cfg, 'GET', base + '/contents/' + gpath + '/' + GH_BUNDLE_FILE + '?ref=' + encodeURIComponent(cfg.repo.branch))
          const curMeta = await ghApi(cfg, 'GET', base + '/contents/' + gpath + '/' + GH_META_FILE + '?ref=' + encodeURIComponent(cfg.repo.branch))
          const zipSha = curZip.status === 200 ? curZip.data.sha : undefined
          const metaSha = curMeta.status === 200 ? curMeta.data.sha : undefined
          await ghPutContents(cfg, gpath + '/' + GH_BUNDLE_FILE, build.zip, 'study-plugin: push ' + (meta.title || meta.remoteGoalId) + ' @ ' + meta.exportedAt, zipSha)
          await ghPutContents(cfg, gpath + '/' + GH_META_FILE, Buffer.from(JSON.stringify(meta, null, 2), 'utf8'), 'study-plugin: meta ' + meta.remoteGoalId + ' @ ' + meta.exportedAt, metaSha)
        } catch (e) {
          if (e instanceof GhError && (e.status === 409 || e.status === 422)) {
            // 竞态：对方刚推过 ⇒ 重读重判；只允许这一轮重试，再撞就交回用户裁决
            if (a0._retried) return stripUndefined(Object.assign({ ok: false, needChoice: true, raced: true, error: '推送连续撞上并发，停止重试', hint: e.message }, syncAssessResult(r)))
            const r2 = await syncAssess(cfg, goalId)
            if (r2.remote && r2.remote.digest === r2.local.digest) return stripUndefined(Object.assign({ ok: true, noop: true, idempotent: true }, syncAssessResult(r2)))
            if (r2.status !== 'conflicted' || force) return handlers['study.syncPush']({ goalId, force, _retried: true })
            return stripUndefined(Object.assign({ ok: false, needChoice: true, raced: true, error: '推送撞上并发：远端刚被另一台设备更新过，且与本地真分叉', hint: e.message }, syncAssessResult(r2)))
          }
          if (e instanceof GhError && e.status === 403 && /buffer too big|too big/i.test(errText(e))) return { ok: false, error: 'GitHub 拒绝大包：' + errText(e) }
          throw e
        }
        await stampSyncBase(cfg, goalId, r.remoteGoalId, { pushAt: nowISO() })
        await markInvalid(cfg, null)
        return stripUndefined(Object.assign({ ok: true, goalId, remoteGoalId: r.remoteGoalId, bytes: meta.zipBytes, pushed: true }, syncAssessResult(await syncAssess(cfg, goalId))))
      } catch (e) { await markInvalid(await loadSyncCfg(), e).catch(() => {}); return syncErr(e) }
    }

    handlers['study.syncPull'] = async (args) => {
      try {
        const a0 = args || {}
        const discardLocal = a0.discardLocal === true
        const { cfg, err } = await requireBind()
        if (err) return err
        const rgid = String(a0.remoteGoalId || '')
        if (!/^[A-Za-z0-9_-]+$/.test(rgid)) return { ok: false, error: '非法 remoteGoalId' }
        const rw = await fetchRemoteMeta(cfg, rgid)
        if (!rw) return { ok: false, error: '仓库里还没有目标 ' + rgid }
        const meta = rw.meta
        // 真分叉（会话内容双向各写各的）默认不覆盖本地：先亮出远端更新时间/设备，交用户二选一。
        // 只有 discardLocal=true（「放弃本地」）才放行到下面按 force 导入。
        if (!discardLocal) {
          const lid = await findLocalGoalForRemote(rgid)
          if (lid) {
            const r = await syncAssess(cfg, lid)
            if (r.status === 'conflicted') {
              return stripUndefined(Object.assign({ ok: false, needChoice: true, error: '仓库版与本地真分叉：请在面板选「放弃本地」或「覆盖仓库」', hint: '放弃本地：带 discardLocal=true 重拉（会吃掉本地这次未推的改动，但不会删本地多出的文件）；覆盖仓库：改用 syncPush force=true' },
                syncAssessResult(r)))
            }
          }
        }
        // 一致性三连：git blob sha → 包内 manifest 的逐文件 sha256 由 readExport 兜底；digest 供基线
        const buf = await fetchRemoteZip(cfg, rw.zipSha, rw.zipBytes || Number(meta.zipBytes || 0))
        if (meta.zipSha256 && P.sha256Hex(buf) !== String(meta.zipSha256)) throw new Error('远端包 sha256 校验失败（传输损坏？）')
        await fsp.mkdir(SYNC_TMP_DIR, { recursive: true })
        let tmp = path.join(SYNC_TMP_DIR, 'pull-' + rgid + '-' + stampNow() + '.zip')
        let n = 1
        while (await statOpt(tmp)) tmp = path.join(SYNC_TMP_DIR, 'pull-' + rgid + '-' + stampNow() + '-' + (n++) + '.zip')
        await fsp.writeFile(tmp, buf)
        const imported = await handlers['study.importGoal']({ path: tmp, mode: 'overwrite', confirm: true, force: discardLocal })
        await fsp.unlink(tmp).catch(() => {})
        if (!imported || imported.ok !== true) {
          return stripUndefined(Object.assign({ ok: false, stage: 'import', error: imported && imported.error, remote: { exportedAt: meta.exportedAt, deviceId: meta.deviceId, title: meta.title } },
            imported.conflicts ? { conflicts: imported.conflicts, hint: '仓库版与本地真分叉：确认「放弃本地」请带 discardLocal=true 重拉' } : {}))
        }
        await stampSyncBase(cfg, imported.goalId, rgid, { pullAt: nowISO(), remoteDigest: String(meta.digest || '') })
        return stripUndefined({ ok: true, pulled: true, goalId: imported.goalId, title: imported.title, applied: imported.applied, idempotent: imported.idempotent, warnings: imported.warnings, remote: { exportedAt: meta.exportedAt, deviceId: meta.deviceId } })
      } catch (e) { await markInvalid(await loadSyncCfg(), e).catch(() => {}); return syncErr(e) }
    }

    /** 开机自动拉（默认关）：只静默做 remoteAhead 快进，conflicted 一律不动只留提示。 */
    async function autoSyncOnce() {
      try {
        const cfg = await loadSyncCfg()
        if (cfg.autoSync !== 'pull' || !syncBound(cfg) || typeof fetch !== 'function') return
        const idx = await readIndex()
        for (const row of (idx.goals || [])) {
          try {
            const r = await syncAssess(cfg, row.id)
            if (r.status === 'remoteAhead') await handlers['study.syncPull']({ remoteGoalId: r.remoteGoalId, discardLocal: false })
          } catch (e) { console.error('study-plugin: 自动同步目标 ' + row.id + ' 失败（不影响使用）: ' + errText(e)) }
        }
      } catch (e) { console.error('study-plugin: 自动同步跳过: ' + errText(e)) }
    }
    sctx.effect(() => {
      const t = setTimeout(() => { autoSyncOnce().catch(() => {}) }, 5000)
      if (typeof t.unref === 'function') t.unref()
      return () => clearTimeout(t)
    }, 'study-plugin: github auto-sync')

    // M4 聊天入口：与面板 RPC 同一实现（D8 语义统一）
    async function chatExport(args) {
      const goalId = String((args && args.goal_id) || '').trim()
      if (!goalId) return { ok: false, error: '缺少 goal_id' }
      const r = await handlers['study.exportGoal']({ goalId })
      if (r && r.ok) r.next = 'zip 已落盘（path 字段）；面板「📦 导出/导入」里也能下载。给别人前先看一眼 manifest.json：里面有本机绝对路径与用户名'
      return r
    }
    async function chatImport(args) {
      const a = args || {}
      const ref = { path: a.path, file: a.file }
      const yes = a.confirm === true || String(a.confirm).toLowerCase() === 'true'
      const force = a.force === true || String(a.force).toLowerCase() === 'true'
      if (yes) {
        return handlers['study.importGoal']({ ...ref, mode: a.mode || 'merge', force, confirm: true })
      }
      // 未确认 → 走 importGoal 的预览分支（同一实现，语义与面板一致）
      const r = await handlers['study.importGoal']({ ...ref, mode: a.mode || 'merge', force })
      if (r && r.ok) {
        const c = (r.plan && r.plan.counts) || {}
        r.summary = Object.keys(c).map((k) => k + '=' + c[k]).join(' ')
        r.next = r.canImport
          ? '预览无误。要真正写入请再调一次 study_goal_import 并带 confirm=true（mode=overwrite 覆盖式更新 / merge 只新增与快进 / copy 另存副本）。包内容与会话身份会记进目标目录的 .study-sync.json，重复导入同一包是无改动。'
          : '不能直接写入：看 conflicts。分叉或包比本地旧 ⇒ 需要 force=true（会吃掉本地历史）；会话正被打开 ⇒ 先在 GUI 关掉它；不想动现有目标 ⇒ 用 mode=copy。'
      }
      return r
    }

    // -------------------------------------------------------------- 聊天工具（study_plan_*，M2）
    async function chatStatus() {
      const idx = await readIndex()
      const out = []
      for (const row of (idx.goals || [])) {
        const g = await readJson(row.path + '/goal.json')
        if (!g || g.status === 'deleted') continue
        try { await adoptDraftFile(g) } catch (e) {}
        try { await adoptChapterFiles(g) } catch (e) {}
        const chapters = Array.isArray(g.chapters) ? g.chapters : []
        const done = chapters.filter((c) => c.status === 'done').length
        const next = chapters.find((c) => c.status !== 'done')
        let nextAction = ''
        if (g.status === 'researching') {
          nextAction = researchDispatched(g)
            ? '调研指令已派发（' + researchDispatchedAt(g) + ' → 目标会话）：等该会话写出 draft.json 后自动转「待批准」；久无产出可在学习区点「🔁 重新调研」或对我说「重新调研」'
            : '调研尚未开始：建档只是把状态预置为「调研中」，目标会话还没收到过指令。请在左侧「学习区」展开该目标点「▶ 开始调研」，或对我说「开始调研」'
        } else if (g.status === 'draft_pending') nextAction = '草案待批准（批准后生成章节；不满意可让我重新调研）'
        else if (g.status === 'research_failed') nextAction = '上次调研失败，可让我重新调研'
        else if (g.status === 'approved' || g.status === 'active' || g.status === 'completed') {
          if (!chapters.length) nextAction = '章节待生成'
          else if (!next) nextAction = '全部章节已学完'
          else if (next.status === 'draft') nextAction = '下一步：生成第 ' + next.index + ' 章「' + next.title + '」讲义（可在学习区点「生成讲义」）'
          else if (next.status === 'generating') nextAction = '第 ' + next.index + ' 章讲义生成中…'
          else if (next.status === 'ready') nextAction = '下一步：开始学习第 ' + next.index + ' 章「' + next.title + '」（学习区点「📖 开始学习」）'
        }
        out.push({
          id: g.id,
          title: g.title,
          status: g.status,
          target_level: g.target_level || '',
          requirements: g.requirements || '',
          updatedAt: g.updatedAt || '',
          chapters_done: done,
          chapters_total: chapters.length,
          next_chapter: next ? { index: next.index, title: next.title, status: next.status } : null,
          next_action: nextAction,
          draft_pending: g.status === 'draft_pending' && !!(g.draft && Array.isArray(g.draft.chapters) && g.draft.chapters.length),
          research_dispatched: researchDispatched(g),
          research_dispatched_at: researchDispatchedAt(g) || '',
          session_ready: !!(g.sessionId || (g.workspaceId && wsRegistry && wsRegistry.get && wsRegistry.get(String(g.workspaceId)) && Array.isArray(wsRegistry.get(String(g.workspaceId)).sessionIds) && wsRegistry.get(String(g.workspaceId)).sessionIds.length)),
          dir: row.path
        })
      }
      out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
      return { ok: true, goals: out }
    }

    async function chatCreate(args) {
      try {
        const r = await createGoalDoc(args && args.topic, args && args.target_level, args && args.requirements)
        return {
          ok: true,
          goal_id: r.goalId,
          workspace_id: r.workspaceId,
          dir: r.absDir,
          next: '请先在左侧「学习区」打开该目标的会话一次（点目标行「📄 打开会话」），随后告诉我「开始调研」'
        }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    }

    async function chatResearch(args) {
      const goalId = String((args && args.goal_id) || '').trim()
      if (!goalId) return { ok: false, error: '缺少 goal_id（创建目标时返回）' }
      const g = await loadGoal(goalId)
      if (!g) return { ok: false, error: '目标不存在: ' + goalId }
      const absDir = await goalDir(g)
      let sessionId = g.sessionId ? String(g.sessionId) : ''
      if (!sessionId && agents && wsRegistry) {
        try {
          let ws = g.workspaceId ? wsRegistry.get(String(g.workspaceId)) : undefined
          if (!ws) ws = await wsRegistry.resolveByPath(absDir)
          if (ws && Array.isArray(ws.sessionIds)) {
            for (const id of ws.sessionIds) {
              if (agents.get(id)) { sessionId = String(id); break }
            }
          }
        } catch (e) {}
      }
      if (!sessionId) {
        return { ok: false, need_open: true, error: '目标会话尚未就绪：请先在左侧「学习区」点该目标的「📄 打开会话」一次，再让我重试' }
      }
      const agent = agents ? agents.get(sessionId) : undefined
      if (!agent || typeof agent.followup !== 'function') {
        return { ok: false, need_open: true, error: '目标会话代理未激活：请打开该目标会话（若已打开，请在该会话中随便发一条消息），然后让我重试' }
      }
      g.sessionId = sessionId
      g.status = 'researching'
      g.updatedAt = nowISO()
      await saveGoal(g)
      await clearDraftFile(absDir)
      const reason = (g.draft && g.draft.reject_reason) ? String(g.draft.reject_reason) : ''
      const text = reason ? retryInstruction(g, absDir, reason) : researchInstruction(g, absDir)
      try {
        injectToSession(sessionId, text)
      } catch (e) {
        return { ok: false, need_open: true, error: errText(e) }
      }
      await markResearchDispatched(g, sessionId, (args && args.source) ? String(args.source) : 'chat')
      return { ok: true, goal_id: goalId, session_id: sessionId, message: '调研指令已发送到该目标会话，AI 完成后草案会自动进入「待批准」' }
    }

    async function chatApprove(args) {
      const g = await loadGoal(String((args && args.goal_id) || '').trim())
      if (!g) return { ok: false, error: '目标不存在' }
      try {
        const n = await approveGoal(g)
        return { ok: true, goal_id: g.id, chapters: n, message: '草案已批准，共 ' + n + ' 章' }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    }

    async function chatReject(args) {
      const g = await loadGoal(String((args && args.goal_id) || '').trim())
      if (!g) return { ok: false, error: '目标不存在' }
      try {
        const reason = String((args && args.reason) || '').trim()
        await rejectGoal(g, reason)
        return { ok: true, goal_id: g.id, message: '草案已退回' + (reason ? '（意见: ' + reason + '）' : '') + '。要我重新调研吗？' }
      } catch (e) {
        return { ok: false, error: errText(e) }
      }
    }

    // ── /study-rpc 路由（POST only + 1MB body 上限；面板经 fetch 调用） ───────
    // 刻意不判定请求来源：局域网鉴权由宿主侧插件统一承担，这里再判断一次只会把
    // 远程面板挡死（客户端用相对路径 fetch，远程页面的请求必然带远程 IP 进来）。
    const handle = async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      let body = ''
      let aborted = false
      req.on('data', (c) => {
        body += c
        if (body.length > 1000000) { aborted = true; try { req.destroy() } catch {} }
      })
      req.on('end', async () => {
        if (aborted) { try { res.writeHead(413); res.end('too large') } catch {} return }
        let result
        try {
          const parsed = JSON.parse(body || '{}')
          const fn = handlers[String(parsed.method || '')]
          if (typeof fn !== 'function') result = { ok: false, error: 'unknown method: ' + String(parsed.method) }
          else result = await fn(parsed.args || {})
        } catch (e) {
          result = { ok: false, error: errText(e) }
        }
        try {
          res.writeHead(200, { 'content-type': 'application/json; charset=utf-8' })
          res.end(JSON.stringify(result === undefined ? null : result))
        } catch {}
      })
    }

    sctx.effect(() => {
      const dispose = sctx.webServer.register({ kind: 'prefix', path: '/study-rpc', handler: handle })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'study-plugin: /study-rpc route')

    // ── /study-export 路由（GET 下载导出的 zip；只认 exports 目录内的 .zip）
    const handleFile = async (req, res) => {
      if (req.method !== 'GET') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      try {
        const u = new URL(req.url || '', 'http://127.0.0.1')
        const raw = String(u.searchParams.get('file') || '')
        const name = path.basename(raw)
        if (!name || name !== raw || !/^[A-Za-z0-9._\u4e00-\u9fff-]+\.zip$/i.test(name)) {
          res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('bad file name')
          return
        }
        const abs = path.join(EXPORTS_DIR, name)
        const st = await statOpt(abs)
        if (!st || !st.isFile()) {
          res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' })
          res.end('not found')
          return
        }
        const buf = await fsp.readFile(abs)
        res.writeHead(200, {
          'content-type': 'application/zip',
          'content-length': String(buf.length),
          'content-disposition': 'attachment; filename="' + name.replace(/[^\x20-\x7e]/g, '_') + '"; filename*=UTF-8\'\'' + encodeURIComponent(name)
        })
        res.end(buf)
      } catch (e) {
        try { res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' }); res.end(errText(e)) } catch {}
      }
    }

    sctx.effect(() => {
      const dispose = sctx.webServer.register({ kind: 'prefix', path: '/study-export', handler: handleFile })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'study-plugin: /study-export route')

    // ── /study-file 路由（GET 看章节讲义；不接收任何客户端给出的路径） ────────
    // 落点只能由 goalId + chapter_index 经 goal.json 反查得到，且 ch.file 必须过 basename
    // 全等校验 ⇒ 读不到 study-work 之外的文件。默认出自包含 HTML（client 侧没有 betterSidebar
    // 服务或其 features 不含 openFile 时，面板 window.open 它即可看讲义），format=raw 出 Markdown 原文。
    const mdInlineHtml = (s) => {
      let out = escapeHtml(String(s == null ? '' : s))
      out = out.replace(/`([^<`]+?)`/g, (m, p1) => '<code>' + p1 + '</code>')
      out = out.replace(/\*\*([^<]+?)\*\*/g, (m, p1) => '<strong>' + p1 + '</strong>')
      return out
    }
    const mdToHtml = (md) => {
      const out = []
      let inFence = false
      for (const ln of String(md == null ? '' : md).split(/\r?\n/)) {
        if (/^```/.test(ln)) {
          out.push(inFence ? '</code></pre>' : '<pre><code>')
          inFence = !inFence
          continue
        }
        if (inFence) { out.push(escapeHtml(ln) + '\n'); continue }
        const h = ln.match(/^(#{1,6})\s+([\s\S]*)$/)
        if (h) { out.push('<h' + h[1].length + '>' + mdInlineHtml(h[2]) + '</h' + h[1].length + '>'); continue }
        if (/^>\s?/.test(ln)) { out.push('<blockquote>' + mdInlineHtml(ln.replace(/^>\s?/, '')) + '</blockquote>'); continue }
        if (/^\s*[-*+]\s+/.test(ln)) { out.push('<li>' + mdInlineHtml(ln.replace(/^\s*[-*+]\s+/, '')) + '</li>'); continue }
        if (ln.trim() === '') continue
        out.push('<p>' + mdInlineHtml(ln) + '</p>')
      }
      if (inFence) out.push('</code></pre>')
      return out.join('')
    }
    const handleStudyFile = async (req, res) => {
      const fail = (code, msg) => { try { res.writeHead(code, { 'content-type': 'text/plain; charset=utf-8' }); res.end(msg) } catch {} }
      if (req.method !== 'GET') return fail(405, 'method not allowed')
      try {
        const u = new URL(req.url || '', 'http://127.0.0.1')
        const goalId = String(u.searchParams.get('goalId') || '')
        const chapterParam = u.searchParams.get('chapter')
        const idx = Number(chapterParam)
        if (!goalId || chapterParam === null || !Number.isInteger(idx)) return fail(400, 'bad request')
        const g = await loadGoal(goalId)
        if (!g) return fail(404, 'goal not found')
        const ch = (g.chapters || []).find((c) => c.index === idx)
        if (!ch) return fail(404, 'chapter not found')
        const fileName = path.basename(String(ch.file || ''))
        if (!fileName || fileName !== ch.file) return fail(400, 'bad chapter file name')
        const abs = (await goalDir(g)).replace(/\\/g, '/') + '/chapters/' + fileName
        const content = await readTextFile(abs)
        if (content === undefined) return fail(404, 'chapter file not found')
        if (u.searchParams.get('format') === 'raw') {
          res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8' })
          return res.end(content)
        }
        res.writeHead(200, {
          'content-type': 'text/html; charset=utf-8',
          'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; img-src data: https:",
          'x-content-type-options': 'nosniff'
        })
        res.end('<!DOCTYPE html><html lang="zh"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>' + escapeHtml(ch.title || '') +
          '</title><style>body{max-width:820px;margin:32px auto;padding:0 20px;font:15px/1.75 system-ui,sans-serif;color:#222;background:#fff}' +
          'pre{background:rgba(128,128,128,.12);padding:10px 12px;border-radius:8px;overflow-x:auto}' +
          'code{font-family:ui-monospace,Consolas,monospace}blockquote{margin:6px 0;padding-left:10px;border-left:3px solid rgba(128,128,128,.45);color:#555}' +
          'li{margin-left:18px}h1,h2,h3{line-height:1.35}small{color:#999;word-break:break-all}' +
          '@media (prefers-color-scheme:dark){body{background:#1e1f22;color:#dfe1e5}blockquote,small{color:#9aa0a6}}</style></head><body>' +
          '<small>' + escapeHtml(abs) + '</small>' + mdToHtml(content) + '</body></html>')
      } catch (e) {
        fail(500, errText(e))
      }
    }

    sctx.effect(() => {
      const dispose = sctx.webServer.register({ kind: 'prefix', path: '/study-file', handler: handleStudyFile })
      return () => { if (typeof dispose === 'function') dispose() }
    }, 'study-plugin: /study-file route')

    // ── M2: study_plan_* 聊天工具（全局注册，所有会话可见；defineTool 不可用时仅缺这组工具） ──
    sctx.effect(() => {
      if (typeof defineTool !== 'function') {
        console.error('study-plugin: 未能解析 @deepseek-ai/dsh-tools，study_plan_* 聊天工具未注册（面板与 RPC 不受影响）')
        return
      }
      const specs = [
        ['study_plan_status',
          '列出本会话全部学习目标的最新状态与下一步建议（含草案待批准、章节进度）。当用户问学习进度/学到哪了/接下来学什么/继续学习时调用。',
          {}, chatStatus],
        ['study_plan_create',
          '创建新学习目标（仅建文档与工作区，不自动调研）。当用户想学某主题/要一份学习计划时先与用户确认主题、目标水平与要求后调用，然后引导用户打开目标会话并提示可继续用 study_plan_research 触发联网调研。',
          {
            topic: { type: 'string', required: true, description: '学习主题，如 Transformer 基础' },
            target_level: { type: 'string', required: true, description: '目标水平，如 能读懂论文并动手实现' },
            requirements: { type: 'string', description: '附加要求，如 中文讲义、重直觉。可省略' }
          }, chatCreate],
        ['study_plan_research',
          '对已有目标发起（或重发）联网调研：在该目标专属会话中注入课程规划任务，产出草案 draft.json 后状态自动变待批准。当用户说 开始调研/重新调研/重试调研 时调用。',
          { goal_id: { type: 'string', required: true, description: '目标 id（创建或状态查询返回）' } }, chatResearch],
        ['study_plan_approve',
          '批准某目标的课程草案：写入章节清单（状态=已批准/学习中）。当用户说 批准/计划没问题/按这个来 时调用。',
          { goal_id: { type: 'string', required: true, description: '目标 id' } }, chatApprove],
        ['study_plan_reject',
          '退回某目标的课程草案并记录修改意见（状态回到调研中，草案文件被清空）。当用户对草案不满意、要求按新方向重做时调用，随后通常继续 study_plan_research。',
          {
            goal_id: { type: 'string', required: true, description: '目标 id' },
            reason: { type: 'string', description: '修改意见，如 章节太多，合并到6章' }
          }, chatReject],
        ['study_goal_export',
          '把一个学习目标导出为 zip：含该目标目录下全部内容 + 该目标工作区的会话 transcript 与会话引用的附件，落在 ~/.dsh/study-work/exports/。当用户说 导出目标/备份目标/打包这个目标 时调用。',
          { goal_id: { type: 'string', required: true, description: '要导出的目标 id' } }, chatExport],
        ['study_goal_import',
          '应用一个导出的 zip（幂等 upsert，可重复执行）。不带 confirm 时只返回预览与分类计数（新增/追加尾帧/整份替换/不变/需 force）。模式：overwrite=目标与会话已存在时按包更新（面板默认，也是"覆盖"语义）；merge=只新增与快进、本地分叉项不动（缺省）；copy=另存为新 goalId 且会话全部换发新身份。分叉或包比本地旧时必须带 force=true。当用户说 导入目标/恢复备份/同步这个包 时调用。',
          {
            path: { type: 'string', description: 'zip 的绝对路径（与 file 二选一）' },
            file: { type: 'string', description: '~/.dsh/study-work/exports/ 里的文件名' },
            mode: { type: 'string', description: 'overwrite | merge（缺省） | copy' },
            force: { type: 'string', description: 'true 才允许覆盖分叉/比本地更旧的会话内容' },
            confirm: { type: 'string', description: 'true 才真正写入' }
          }, chatImport]
      ]
      const disposers = []
      for (const [toolName, description, parameters, run] of specs) {
        try {
          disposers.push(sctx.tools.register(defineTool({
            name: toolName,
            description: description,
            parameters: parameters,
            output: {
              schema: { type: 'object', additionalProperties: true },
              render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }]
            },
            execute: async (args) => stripUndefined(await run(args || {}))
          })))
          console.log('study-plugin: tool registered: ' + toolName)
        } catch (e) {
          console.error('study-plugin: register tool failed ' + toolName + ': ' + errText(e))
        }
      }
      return () => { for (const d of disposers) { try { d() } catch {} } }
    }, 'study-plugin: study_plan_* tools')

    // ------------------------------------------------------------------ README 同步
    const README_LINES = [
      '# 📚 学习区（study-work）使用说明',
      '',
      '数据根目录: ~/.dsh/study-work（本文件即 README）。',
      '学习区面板由**常驻插件 study-plugin**（profile 组合插件）提供：DSH 启动时自动装载，任何模式/任何会话可见，进程重启不丢失；数据、工作区与会话全部保留。',
      '',
      '## 目录结构',
      '- index.json —— 目标注册表 { goals: [ {id,title,status,path} ] }',
      '- <goal>/goal.json —— 目标状态机主文件（status/draft/chapters/sessionId/workspaceId）',
      '- <goal>/draft.json —— 目标会话 AI 联网调研后写出的课程草案（JSON），由插件采纳后转入待批准',
      '- <goal>/chapters/NN-<slug>.md —— 第 NN 章讲义（讲义文件由会话 AI 写出，轮询采纳标记为 ready）',
      '- <goal>/chapters/NN-qa.md —— 本章多轮问答的要点沉淀（由章节会话 AI 写回，属于学习内容的一部分）',
      '- <goal>/chapters/NN-notes/ —— 本章补充内容目录（问答回写产生）；每个主题一个 .md 文件，同主题多次回写会追加到同一文件',
      '- plugin/ —— 动态版恢复快照（路线 A 备份；常驻版可用时此目录仅作回退手段）',
      '',
      '## 状态机',
      '目标: researching(调研中) → draft_pending(草案待批准) → approved(已批准) → active(学习中) → completed(已完成)；也可 researching ← 拒绝/重调研。',
      '注意: status=researching 有两种真相，由 goal.json 的 research.dispatchedAt 区分——有值 = 调研指令已注入目标会话（面板显示「调研中…」+「🔁 重新调研」）；无值 = 建档后的初值，会话还没收到过任何指令（面板显示「待调研」+「▶ 开始调研」）。建档即置 researching，所以"调研中"不代表 AI 在跑。',
      '章节: draft(待生成讲义) → generating(生成中) → ready(讲义就绪)。',
      '说明: 产品不设章节小测验、错题本与上一章复习环节（已按需求移除）；学习闭环 = 讲义 → 独立章节会话教学与多轮问答 → 问答要点沉淀到 NN-qa.md。',
      '',
      '## 会话模型（重要）',
      '1. 每个学习目标有一个「目标总会话」：负责联网调研产出课程草案、以及把每章讲义写文件。打开方式: 学习区 → 该目标 → 📄 打开会话。建档不会自动调研：必须派发一次（学习区「▶ 开始调研」，或在聊天里说「开始调研」），目标会话里才会有活干。',
      '2. 每章一个「章节独立会话」：讲义就绪后点 📖 开始学习 创建并进入；本章讲解/问答都在该会话进行。AI 每次回答后会检查是否有值得补充到讲义的内容，有则询问是否回写。回写时：总结写入讲义（带链接），详细内容写入 NN-notes/ 目录下的独立文件，同主题复用同一文件。',
      '3. 主聊天（本会话）负责管理：查看进度、创建目标、批准/退回草案；学习行为发生在目标/章节会话里。',
      '',
      '## 左侧「学习区」面板按钮',
      '- ＋ 添加学习目标: 主题/目标水平/附加要求 → 「✓ 创建并调研」= 先建文档 → 打开目标总会话 → 会话内 AI 联网调研 → 草案自动待批准',
      '- 📄 打开会话: 切换到该目标的「目标总会话」（即产出课程草案的那个会话）；只有它未记录或已被销毁时，才在目标工作区新建一个会话并把 id 记回 goal.json',
      '- ▶ 开始调研 / 🔁 重新调研: 「调研中」状态下的派发口。未派发（chip 显示「待调研」）时点它会向目标会话注入调研指令；已派发时按钮变「重新调研」，用于久无产出或想换方向时重发（退回过的目标会带上退回意见）。会话不可用时红字会告诉你要先「打开会话」',
      '- ✓ 批准 / 重新调研: 处理待批准草案（退回会清空草案文件，避免旧草案被重新采纳）',
      '- 生成讲义: 在目标会话中生成某章讲义 md；讲义文件出现后自动标记「讲义就绪」',
      '- 继续生成: 讲义「生成中」且未产出时点击，重新发送生成任务（会话未激活会退回「待生成」并提示）',
      '- 📖 开始学习: 为该章创建独立会话并进入（每章一个）；AI 每次回答后检查是否值得回写——总结入讲义（带链接），详细内容入 NN-notes/ 目录',
      '- 📤 导出: 把该目标打成 zip（目标目录全部内容 + 该工作区全部会话 transcript + 会话引用的附件 + manifest.json），落在 exports/ 并可下载',
      '- 📦 导出/导入（面板顶部）: 看导出包列表、下载、填 zip 路径做「预览」再「确认」；导入有三种模式（⤴ 覆盖 / ➕ 合并 / 📋 另存副本），默认「覆盖」',
      '- 删除: 仅标记 deleted（文件保留）',
      '',
      '## 导出 / 导入（可携化，为云同步铺垫）',
      '1. 导出包 = `study-goal-<goalId>-<时间戳>.zip`（同秒再导不会互相覆盖，自动加 -2/-3），内含: `manifest.json`（格式版本 v2/逐文件 sha256/每条会话的 remoteId+maxSeq+行数+blank/源机路径与 deviceId）、`goal/**`（目标目录整棵树）、`sessions/<会话id>/transcript.jsonl.zstd`（逐字节原文）、`attachments/objects/**`（内容寻址图片）、`workspace.json`（仅该目标登记信息）。',
      '2. 不含: 凭据与设置（settings.yaml/.credentials.yaml）、日志、皮肤、profile 插件本体、`storages/session_projcache.json`（可再生自愈缓存）、`study-work/plugin/`（动态版快照）、本目标 `.mnemon/` 运行时记忆、设备本地身份账本 `.study-sync.json`、其它目标数据。',
      '3. 导入 = 应用一个包（幂等 upsert）：目标/会话/工作区都是「有则更新、无则新增」。会话身份受宿主规则约束——id 在 sessions 根内全局唯一（重复会让宿主 list() 直接抛错），且归档集与投影缓存都按 id 键控（沿用源 id 会继承源会话的归档态而"导入即隐身"）。因此规则是：**同一目标目录里的同一条会话沿用原 id（原地更新或追加）；换了目录、撞了 id、或该 id 在宿主归档集里 ⇒ 一律换发新 id**。映射记在目标目录的 `.study-sync.json`，下次导入靠它认出同一个会话 ⇒ 重复导入同一个包 = 无改动。',
      '4. 会话落盘规则: 内容一致 ⇒ 不动；本地是包的前缀 ⇒ 只追加尾帧（尊重宿主 append-only 与 seq 连续校验，也不污染投影缓存）；包比本地旧、或与本地分叉 ⇒ 默认不动/被挡，必须勾 force；该会话在本机正被打开 ⇒ 硬冲突（宿主回写会盖掉导入结果），force 也不放行。',
      '5. 写完先按宿主自己的视图自检: `sessionPersistence.inspect()` 逐条读得懂，且工作区投影 `ws.sessionIds` 认账（attach 不抛 ≠ 会显示）。任一不过 ⇒ 整体回滚：还原被覆盖的字节、删掉本次自建的目录、恢复 index.json 与工作区登记。顺手摘除幽灵席位。',
      '6. 模式: `overwrite`（包为准，面板默认）/ `merge`（只新增与快进，本地分叉项不动）/ `copy`（新 goalId + 会话全部换身份，绝不碰现有目标）。本地比包多的文件不会被删除（镜像式 prune 明确不做，留到真上云时再定）。',
      '7. 导入/迁移后仍建议重启 DSH 再看左栏（宿主分组与投影缓存在启动期定型）。若会话没挂上，用该目标行「🔗 重新绑定会话」调 `study.reattachGoalSessions`（它同样以宿主投影为准判定成败）。',
      '8. 隐私: manifest.json 里有源机绝对路径、用户名与 deviceId，公开发布前请先看一遍。',
      '',
      '## 对话入口（在聊天里直接管理）',
      '可用工具: study_plan_status(进度总览与下一步) / study_plan_create(创建目标) / study_plan_research(发起调研) / study_plan_approve(批准草案) / study_plan_reject(退回草案) / study_goal_export(导出 zip) / study_goal_import(预览与导入 zip，支持 mode=overwrite|merge|copy 与 force)。',
      '注: 该组工具由本常驻插件直接提供，DSH 启动即全局可用，任何模式无需激活。',
      '示例问法: 「看看我的学习进度」「帮我建一个学 XX 的计划（目标: …）」「开始调研」「草案可以，批准」「草案不行，XX 方向重做」。',
      '注意: 聊天工具创建的目标只建档不调研；先「📄 打开会话」建立目标总会话，再点「▶ 开始调研」（或直接对我说「开始调研」）才会真正开始。',
      '',
      '## 重启与恢复',
      '1. 数据都在 ~/.dsh/study-work；目标对应的工作区/会话（id 记录在 goal.json 的 workspaceId/sessionId 与 storages 中）在 DSH 重启后仍然存在。',
      '2. 常驻插件（面板 + study_plan_* 聊天工具）随 DSH 进程自动装载，重启后无需任何激活操作。',
      '3. 若常驻插件不可用（如回退到旧版本），可退而求其次：直接用文件工具读写上述 JSON，并在目标/章节会话中继续学习，面板仅作展示。',
      '',
      '## 提示',
      '- 讲义/草案内容以文件为准；插件只是轮询采纳会话 AI 写出的文件，不会覆盖它们。',
      '- 想调整已批准课程：把目标退回（研究 状态）让目标会话 AI 重写 draft.json 后再批准；旧章节文件不会被自动删除。'
    ]
    const README_TEXT = README_LINES.join('\n')
    async function syncReadme() {
      try {
        await fsp.mkdir(BASE, { recursive: true })
        await fsp.writeFile(README_PATH, README_TEXT)
        console.log('study-plugin: README.md synced')
      } catch (e) {
        console.error('study-plugin: README write failed: ' + errText(e))
      }
    }
    syncReadme()
  })
}
