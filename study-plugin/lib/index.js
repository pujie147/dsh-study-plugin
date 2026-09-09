// ============================================================================
// study-plugin — 宿主半（静态持久化版，M1）
// 形态: profile 组合插件（cordis patch row 挂载，DSH 启动时自动装载，任何模式/会话可见）。
// M1: /study-rpc webServer prefix 路由（学习区面板全部 study.* RPC）+ README 同步。
// M2: 追加 ctx.inject(['tools'], sctx => sctx.tools.register(defineTool(...)))
//     注册 study_plan_status/create/research/approve/reject（@deepseek-ai/dsh-tools）。
//
// 与动态版 src/host.js 的对照（契约完全一致，仅基础设施不同）:
//   - fs 服务(fsService.resolve/stat/readText/writeText) → node:fs/promises（宿主平面受信）
//   - harness.handle('study.*', fn)                     → handlers['study.*'] + webServer 路由分发
//   - ctx.get('agents'|'workspaceRegistry')             → ctx.inject([...]) 注入同名服务
//   - console.log/error                                  → 同（宿主进程 console 可用）
// ============================================================================
import { promises as fsp } from 'node:fs'
import os from 'node:os'
import path from 'node:path'

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

  ctx.inject(['webServer', 'agents', 'workspaceRegistry'], (sctx) => {
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
        sessionId: undefined, workspaceId: undefined, completedAt: undefined
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
      g.updatedAt = nowISO()
      await saveGoal(g)
      await clearDraftFile(await goalDir(g))
    }

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

    // ── /study-rpc 路由（同源、loopback 守卫；面板经 fetch 调用） ───────────
    const handle = async (req, res) => {
      if (req.method !== 'POST') {
        res.writeHead(405, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('method not allowed')
        return
      }
      const remote = String((req.socket && req.socket.remoteAddress) || '')
      if (remote !== '127.0.0.1' && remote !== '::1' && remote !== '::ffff:127.0.0.1') {
        res.writeHead(403, { 'content-type': 'text/plain; charset=utf-8' })
        res.end('forbidden')
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
      '章节: draft(待生成讲义) → generating(生成中) → ready(讲义就绪)。',
      '说明: 产品不设章节小测验、错题本与上一章复习环节（已按需求移除）；学习闭环 = 讲义 → 独立章节会话教学与多轮问答 → 问答要点沉淀到 NN-qa.md。',
      '',
      '## 会话模型（重要）',
      '1. 每个学习目标有一个「目标总会话」：负责联网调研产出课程草案、以及把每章讲义写文件。打开方式: 学习区 → 该目标 → 📄 打开会话。',
      '2. 每章一个「章节独立会话」：讲义就绪后点 📖 开始学习 创建并进入；本章讲解/问答都在该会话进行。AI 每次回答后会检查是否有值得补充到讲义的内容，有则询问是否回写。回写时：总结写入讲义（带链接），详细内容写入 NN-notes/ 目录下的独立文件，同主题复用同一文件。',
      '3. 主聊天（本会话）负责管理：查看进度、创建目标、批准/退回草案；学习行为发生在目标/章节会话里。',
      '',
      '## 左侧「学习区」面板按钮',
      '- ＋ 添加学习目标: 主题/目标水平/附加要求 → 「✓ 创建并调研」= 先建文档 → 打开目标总会话 → 会话内 AI 联网调研 → 草案自动待批准',
      '- 📄 打开会话: 切换到该目标总会话（首次打开后该会话即可接收调研/讲义任务）',
      '- ✓ 批准 / 重新调研: 处理待批准草案（退回会清空草案文件，避免旧草案被重新采纳）',
      '- 生成讲义: 在目标会话中生成某章讲义 md；讲义文件出现后自动标记「讲义就绪」',
      '- 继续生成: 讲义「生成中」且未产出时点击，重新发送生成任务（会话未激活会退回「待生成」并提示）',
      '- 📖 开始学习: 为该章创建独立会话并进入（每章一个）；AI 每次回答后检查是否值得回写——总结入讲义（带链接），详细内容入 NN-notes/ 目录',
      '- 删除: 仅标记 deleted（文件保留）',
      '',
      '## 对话入口（在聊天里直接管理）',
      '可用工具: study_plan_status(进度总览与下一步) / study_plan_create(创建目标) / study_plan_research(发起调研) / study_plan_approve(批准草案) / study_plan_reject(退回草案)。',
      '注: 常驻版 M1 阶段该组工具仍由动态版提供——在「创造模式」会话按 plugin/INSTALL.txt 激活一次即可（全局生效，任何模式可用）；M2 完成后由常驻插件直接提供，无需激活。',
      '示例问法: 「看看我的学习进度」「帮我建一个学 XX 的计划（目标: …）」「开始调研」「草案可以，批准」「草案不行，XX 方向重做」。',
      '注意: 创建后需要先把目标总会话打开过一次（📄 打开会话），chat 工具才能向它注入调研任务。',
      '',
      '## 重启与恢复',
      '1. 数据都在 ~/.dsh/study-work；目标对应的工作区/会话（id 记录在 goal.json 的 workspaceId/sessionId 与 storages 中）在 DSH 重启后仍然存在。',
      '2. 常驻插件随 DSH 进程自动装载，重启后面板无需任何操作；仅 study_plan_* 聊天工具（M2 前）需在创造模式会话激活一次。',
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
