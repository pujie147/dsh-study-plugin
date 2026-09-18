// study-plugin client bundle (built by scripts/build-client.mjs — DO NOT EDIT BY HAND)
window.__ModuleLoader__.load({
  id: "study-plugin",
  factory: (require) => {
    const React = require("react");
    const STUI_CSS = ".stuiWrap[class$=_footerActions]{flex-wrap:wrap}.stuiBackdrop{position:fixed;inset:0;z-index:29}.stuiPanel{position:fixed;z-index:30;display:flex;flex-direction:column;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-base,#fff);border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);overflow:hidden;width:360px;max-width:calc(100vw - 24px);max-height:min(70vh,680px);color:var(--dsw-alias-label-primary,#222);font-size:13px;line-height:1.5;font-family:inherit}.stuiHeader{display:flex;align-items:center;justify-content:space-between;gap:8px;padding:10px 12px;border-bottom:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.25));flex:none}.stuiTitle{font-size:14px;font-weight:600;display:flex;align-items:center;gap:6px}.stuiIconBtn{background:none;border:none;cursor:pointer;color:var(--dsw-alias-label-secondary,#888);border-radius:6px;width:24px;height:24px;display:inline-flex;align-items:center;justify-content:center;padding:0}.stuiIconBtn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.15))}.stuiBody{overflow-y:auto;padding:8px;display:flex;flex-direction:column;gap:6px;min-height:80px}.stuiAdd{display:flex;gap:6px;align-items:center;justify-content:center;border:1px dashed var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:10px;padding:6px;cursor:pointer;background:none;color:var(--dsw-alias-label-primary);font-size:13px}.stuiAdd:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.12))}.stuiGoal{border:1px solid var(--dsw-alias-border-l1,rgba(128,128,128,.2));border-radius:10px;padding:6px 8px;background:var(--dsw-alias-bg-base,rgba(128,128,128,.04))}.stuiGoalHead{display:flex;align-items:center;gap:6px;user-select:none}.stuiGoalTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;font-weight:500;cursor:pointer}.stuiChip{font-size:11px;padding:1px 6px;border-radius:999px;background:rgba(128,128,128,.15);color:var(--dsw-alias-label-secondary,#666);flex:none;white-space:nowrap}.stuiChip[data-tone=busy]{background:rgba(59,130,246,.18);color:#2563eb}.stuiChip[data-tone=ok]{background:rgba(34,197,94,.16);color:#16a34a}.stuiChip[data-tone=warn]{background:rgba(245,158,11,.18);color:#d97706}.stuiChip[data-tone=err]{background:rgba(239,68,68,.16);color:#dc2626}.stuiDetail{margin-top:6px;display:flex;flex-direction:column;gap:4px;padding-left:2px}.stuiMeta{color:var(--dsw-alias-label-tertiary,#999);font-size:11px}.stuiChRow{display:flex;align-items:center;gap:6px;padding:2px 0}.stuiChTitle{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.stuiAct{font-size:12px;border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:none;border-radius:8px;padding:2px 8px;cursor:pointer;color:var(--dsw-alias-label-primary)}.stuiAct:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}.stuiAct:disabled{opacity:.5;cursor:default}.stuiAct[data-tone=primary]{background:#2563eb;border-color:#2563eb;color:#fff}.stuiAct[data-tone=danger]{color:#dc2626;border-color:rgba(239,68,68,.4)}.stuiDraftOv{font-size:12px;color:var(--dsw-alias-label-secondary,#666);margin:4px 0}.stuiForm{display:flex;flex-direction:column;gap:6px;padding:4px 0}.stuiForm label{font-size:12px;color:var(--dsw-alias-label-secondary,#888);display:flex;flex-direction:column;gap:2px}.stuiInput{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.4));border-radius:8px;background:var(--dsw-alias-bg-base);color:var(--dsw-alias-label-primary);padding:5px 8px;font-size:13px;font-family:inherit;width:100%;box-sizing:border-box}.stuiInput:focus{outline:1px solid #2563eb}.stuiRow{display:flex;gap:6px;align-items:center}.stuiErr{color:#dc2626;font-size:12px;padding:4px;border-radius:8px;background:rgba(239,68,68,.1)}.stuiEmpty{color:var(--dsw-alias-label-tertiary,#999);font-size:12px;text-align:center;padding:16px 8px;white-space:pre-line}.stuiLayer{flex:none;align-items:center;width:100%;height:42px;margin:8px 0 0;display:flex;position:relative}.stuiLayer.stuiRail{width:36px;height:36px;margin:0}.stuiBadge{width:calc(100% + 4px);height:42px;color:var(--dsw-alias-label-primary);cursor:pointer;background:0 0;border:none;border-radius:12px;align-items:center;gap:8px;margin:0 -2px;padding:0 10px 0 8px;font-family:inherit;font-size:14px;display:inline-flex;overflow:hidden}.stuiBadge:hover,.stuiBadge[data-active]{background:var(--dsw-alias-interactive-bg-hover)}.stuiRail .stuiBadge{border-radius:50%;justify-content:center;gap:0;width:36px;height:36px;padding:0}.stuiBadgeLabel{text-overflow:ellipsis;white-space:nowrap;min-width:0;overflow:hidden}.stuiBadgeCount{color:var(--dsw-alias-label-tertiary);font-variant-numeric:tabular-nums;flex:none;margin-left:auto;font-size:12px;line-height:16px}.stuiOpen{border:1px solid var(--dsw-alias-border-l2,rgba(128,128,128,.35));background:none;border-radius:8px;padding:2px 8px;cursor:pointer;color:var(--dsw-alias-label-secondary);font-size:12px;flex:none}.stuiOpen:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(128,128,128,.14))}.stuiGoalBody{margin-top:4px}";
    (function () {
      if (typeof document === "undefined") return
      var tagId = "study-plugin/client.css"
      if (document.querySelector('style[data-plugin-css="' + tagId + '"]') !== null) return
      var tag = document.createElement("style")
      tag.dataset.plugin = "study-plugin"
      tag.dataset.pluginCss = tagId
      tag.textContent = STUI_CSS
      document.head.appendChild(tag)
    })();
// ============================================================================
// study-plugin — 客户端半（静态持久化版，源码；构建产物 lib/client.js 由
// scripts/build-client.mjs 生成：window.__ModuleLoader__.load banner + CSS 内联 + react externals）
//
// 与动态版 src/client.js 的差异（仅基础设施，UI 逻辑逐字保留）:
//   styles.insert('…')   → 构建期把 CSS 内联为 <style data-plugin-css> 标签
//   host.call(m, a)      → fetch('/study-rpc', POST {method, args})
//   ctx.get('timer')     → setInterval + ctx.effect（浏览器侧无需 timer 服务）
// ============================================================================
const inject = ['slots', 'sessions', 'workspaces']

function apply(ctx) {
  const slots = ctx.get('slots')
  if (slots === undefined) return

  let ui = { open: false }
  let activeRefresh = null

  const toneOf = (status) => {
    if (status === 'researching' || status === 'generating') return 'busy'
    if (status === 'draft_pending' || status === 'research_failed') return 'warn'
    if (status === 'completed' || status === 'ready') return 'ok'
    return undefined
  }
  const labelOf = (status) => {
    const map = {
      researching: '调研中…', research_failed: '调研失败', draft_pending: '待批准',
      approved: '已批准', active: '学习中', completed: '已完成', generating: '生成中…',
      draft: '待生成', ready: '讲义就绪', done: '讲义就绪', deleted: '已删除'
    }
    return map[status] || status
  }
  const call = async (method, args) => {
    const r = await fetch('/study-rpc', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: method, args: args === undefined ? {} : args })
    })
    if (!r.ok) throw new Error('study RPC HTTP ' + r.status)
    return r.json()
  }

  const hhmm = (iso) => {
    try { return new Date(String(iso)).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) } catch (e) { return String(iso) }
  }

  const errText = (e) => String((e && e.message) || e)
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

  // 有界轮询（先判后睡，条件已满足时不留延迟）。不用 list.subscribe()：点击闭包里挂
  // disposer 容易泄漏，而宿主的 getSnapshot 自带 memoize，轮询几乎免费。
  const waitFor = async (pred, timeoutMs, stepMs) => {
    const deadline = Date.now() + timeoutMs
    for (;;) {
      try { if (pred()) return true } catch (e) {}
      if (Date.now() >= deadline) return false
      await sleep(stepMs || 150)
    }
  }

  // 宿主的浏览器侧服务名是其私有演进面：connectWorkspace / openSession 在 dsh 0.1.5-rc.1
  // 从 workspaces 迁到了 uiWorkspace。ctx.get 是惰性的（未提供返回 undefined 而不抛），所以
  // 这里在调用时才取。反过来，uiWorkspace 绝不能写进模块级 inject —— 那是硬激活门，一旦某个
  // 安装没装 dsh-client-ui-workspace，apply() 就永不执行，整个面板消失。
  // 只缓存成功：瞬时取空（HMR/reload）若被缓存成 undefined，会永久关掉首选路径。
  let uiWorkspaceCache
  const getUiWorkspace = () => {
    if (uiWorkspaceCache) return uiWorkspaceCache
    let svc
    try { svc = ctx.get('uiWorkspace') } catch (e) { svc = undefined }
    if (svc) uiWorkspaceCache = svc
    return svc
  }

  const StudyApp = (props) => {
    const sessionsHook = props.useSessions
    const workspacesSvc = props.workspaces
    const sessionsSvc = props.sessions
    const wide = props.wide !== false
    const [goals, setGoals] = React.useState([])
    const [error, setError] = React.useState('')
    const [view, setView] = React.useState('list')
    const [expanded, setExpanded] = React.useState({})
    const [confirmDel, setConfirmDel] = React.useState(null)
    const [busyKey, setBusyKey] = React.useState(null)
    const [form, setForm] = React.useState({ topic: '', target_level: '', requirements: '' })
    const [notice, setNotice] = React.useState('')
    const [ioList, setIoList] = React.useState([])
    const [ioDir, setIoDir] = React.useState('')
    const [ioBusy, setIoBusy] = React.useState(false)
    const [impPath, setImpPath] = React.useState('')
    const [impPreview, setImpPreview] = React.useState(null)
    const [impMode, setImpMode] = React.useState('overwrite')
    const [impForce, setImpForce] = React.useState(false)
    const [sync, setSync] = React.useState(null)          // study.syncGetConfig 结果
    const [remoteList, setRemoteList] = React.useState(null) // study.syncListRemote 结果
    const [patInput, setPatInput] = React.useState('')
    const [clientIdInput, setClientIdInput] = React.useState('')
    const [devFlow, setDevFlow] = React.useState(null)     // { userCode, verificationUri, status }
    const [inspMap, setInspMap] = React.useState({})        // goalId → study.syncInspect 结果
    const [syncBusy, setSyncBusy] = React.useState(null)
    const [syncErr, setSyncErr] = React.useState('')
    const [takeOverHint, setTakeOverHint] = React.useState('')   // 绑定命中「固定仓已被本账号占用」时的提示文案
    const [anchor, setAnchor] = React.useState(undefined)
    const [open, setOpen] = React.useState(ui.open)
    const rootRef = React.useRef(null)

    const setOpenBoth = (v) => { ui.open = v; setOpen(v) }

    const refresh = React.useCallback(async () => {
      try {
        const r = await call('study.list')
        if (r && Array.isArray(r.goals)) { setGoals(r.goals); setError('') }
      } catch (e) { setError(String((e && e.message) || e)) }
    }, [])

    React.useEffect(() => {
      activeRefresh = refresh
      return () => { if (activeRefresh === refresh) activeRefresh = null }
    }, [refresh])

    React.useEffect(() => {
      if (ui.open) refresh()
    }, [ui.open, refresh])

    React.useLayoutEffect(() => {
      if (!open) return
      const place = () => {
        const node = rootRef.current
        const rect = node && typeof node.getBoundingClientRect === 'function' ? node.getBoundingClientRect() : undefined
        if (rect !== undefined) setAnchor({ left: Math.max(4, rect.left), bottom: (typeof window !== 'undefined' ? window.innerHeight : 900) - rect.top + 8 })
      }
      place()
      if (typeof window !== 'undefined') {
        window.addEventListener('resize', place)
        return () => window.removeEventListener('resize', place)
      }
      return undefined
    }, [open])

    const doAction = async (key, fn) => {
      setBusyKey(key)
      setError('')
      let msg = ''
      try {
        const r = await fn()
        if (r && r.ok === false) msg = String(r.error || '操作失败')
      } catch (e) {
        msg = String((e && e.message) || e)
      }
      await refresh()
      // 刷新会清掉 error，动作失败的原因必须留在面板上（否则用户只看到"没反应"）
      if (msg !== '') setError(msg)
      setBusyKey(null)
    }

    const unwrapSessionId = (v) => {
      if (typeof v === 'string' && v.length > 0) return v
      if (v && typeof v === 'object') {
        if (typeof v.sessionId === 'string') return v.sessionId
        if (v.value && typeof v.value.sessionId === 'string') return v.value.sessionId
        if (v.result && typeof v.result.sessionId === 'string') return v.result.sessionId
        if (v.result && v.result.value && typeof v.result.value.sessionId === 'string') return v.result.value.sessionId
      }
      return undefined
    }

    const sessionsSnapshot = () => {
      try {
        return sessionsSvc && sessionsSvc.list && typeof sessionsSvc.list.getSnapshot === 'function'
          ? sessionsSvc.list.getSnapshot()
          : undefined
      } catch (e) { return undefined }
    }
    // 会话是否还在客户端镜像里（= 宿主仍存在该会话；open() 只认已列出的会话）
    const sessionIsLive = (sid) => {
      const snap = sessionsSnapshot()
      return !!(snap && snap.byId && snap.byId[sid])
    }
    // 新宿主快照带 phase，只有 ready 才可信；形状不认识（没有 phase 字段）就当已就绪。
    // 把「镜像还没追上」误读成「会话已销毁」会白建一个新会话，破坏 D10 的幂等。
    const mirrorSettled = () => {
      const snap = sessionsSnapshot()
      return !snap || snap.phase === undefined || snap.phase === 'ready'
    }

    // 镜像可能落后于宿主（DSH 刚重启 / 另一端刚建工作区）：拉一次再判定
    const refreshMirror = async (svc) => {
      if (svc && typeof svc.refresh === 'function') { try { await svc.refresh() } catch (e2) {} }
    }

    // 客户端镜像是否已认得该工作区。快照形状不认识就当作可见，不阻塞正常路径。
    const workspaceVisible = (wsId) => {
      let snap
      try {
        snap = workspacesSvc && workspacesSvc.list && typeof workspacesSvc.list.getSnapshot === 'function'
          ? workspacesSvc.list.getSnapshot()
          : undefined
      } catch (e) { return true }
      if (!snap || !Array.isArray(snap.items)) return true
      return snap.items.some((it) => it && (it.workspaceId === wsId || it.id === wsId))
    }
    const waitForWorkspaceVisible = (wsId) => workspaceVisible(wsId)
      ? Promise.resolve(true)
      : waitFor(() => workspaceVisible(wsId), 1500, 150)

    // 在目标工作区取一个会话（复用空白会话，否则新建）。三段兜底，按「方法是否存在」挑路：
    //   1) uiWorkspace.connectWorkspace —— 新版宿主（dsh 0.1.5-rc.1 起把它从 workspaces 迁走）
    //   2) workspaces.connectWorkspace  —— 旧版宿主
    //   3) sessions.create({workspaceId}) —— 两者都缺席时的最后手段
    // 任一层都不许把 TypeError 冒到面板上。
    const connectGoalWorkspace = async (wsId) => {
      const ui = getUiWorkspace()
      const attempts = []
      if (ui && typeof ui.connectWorkspace === 'function') attempts.push((id) => ui.connectWorkspace(id))
      if (workspacesSvc && typeof workspacesSvc.connectWorkspace === 'function') attempts.push((id) => workspacesSvc.connectWorkspace(id))
      let lastErr
      for (const run of attempts) {
        try {
          return unwrapSessionId(await run(wsId))
        } catch (e) {
          lastErr = e
          // 新宿主只认已进镜像的工作区：study.ensureGoalWorkspace 刚建好的可能还没推过来
          if (!/unknown workspace|no such workspace|not found/i.test(errText(e))) continue
          if (await waitForWorkspaceVisible(wsId)) { try { return unwrapSessionId(await run(wsId)) } catch (e2) { lastErr = e2 } }
        }
      }
      if (!sessionsSvc || typeof sessionsSvc.create !== 'function') {
        throw new Error(attempts.length ? '连接工作区失败: ' + errText(lastErr) : '宿主未提供工作区连接能力')
      }
      try { return unwrapSessionId(await sessionsSvc.create({ workspaceId: wsId })) }
      catch (e3) { throw new Error('在目标工作区新建会话失败: ' + errText(e3)) }
    }

    // 打开会话：优先宿主的 uiWorkspace.openSession（与点侧栏等价，顺带收起右侧面板），
    // 退回 sessions.open。都失败只说明宿主不认这套 API —— 返回 false 让调用方决定措辞。
    const openSessionInUi = (sid) => {
      const ui = getUiWorkspace()
      if (ui && typeof ui.openSession === 'function') { try { ui.openSession(sid); return true } catch (e) {} }
      if (sessionsSvc && typeof sessionsSvc.open === 'function') { try { sessionsSvc.open(sid); return true } catch (e) {} }
      return false
    }

    // 打开该目标的「目标总会话」（= 产出草案的那个会话），返回其会话 id。仅当它已被销毁/从未记录
    // 时，才在目标工作区新建一个会话并记回 goal.json。失败返回 undefined（错误已展示）。
    const openGoalSession = async (g) => {
      if (!sessionsSvc) { setError('会话服务不可用'); return undefined }
      setBusyKey('open:' + g.id)
      setError('')
      try {
        const recorded = g.sessionId ? String(g.sessionId) : ''
        if (recorded && !sessionIsLive(recorded)) {
          await refreshMirror(sessionsSvc)
          if (!mirrorSettled()) await waitFor(() => sessionIsLive(recorded) || mirrorSettled(), 1500, 150)
        }
        if (recorded && sessionIsLive(recorded)) {
          if (!openSessionInUi(recorded)) setError('宿主未能切换到该会话，请在左侧会话列表手动打开')
          return recorded
        }
        let wsId = g.workspaceId
        if (!wsId) {
          const r = await call('study.ensureGoalWorkspace', { goalId: g.id })
          if (!r || r.ok !== true) { setError(String((r && r.error) || '无法建立目标工作区')); return undefined }
          wsId = r.workspaceId
        }
        const sessionId = await connectGoalWorkspace(wsId)
        if (!sessionId) { setError('未能取得会话 id'); return undefined }
        const rec = await call('study.recordGoalSession', { goalId: g.id, sessionId: sessionId })
        if (!rec || rec.ok !== true) { setError(String((rec && rec.error) || '记录目标会话失败')); return undefined }
        // 账已记上，切换失败不该把整个动作判死 —— 降级成提示
        if (!openSessionInUi(sessionId)) setNotice('目标会话已就绪，但宿主未能自动切换：请在左侧会话列表手动打开')
        await refresh()
        return sessionId
      } catch (e) {
        setError('打开会话失败: ' + errText(e))
        return undefined
      } finally {
        setBusyKey(null)
      }
    }

    // 派发调研（唯一 owner 在宿主：study.dispatchResearch → chatResearch）。status='researching' 只是
    // 建档初值，不代表指令已发出；所以这里先保证目标会话存在且活着（必要时重建），再派发。
    const dispatchResearch = async (g) => {
      const sid = g.sessionId ? String(g.sessionId) : ''
      if (!sid || !sessionIsLive(sid)) {
        const made = await openGoalSession(g)
        if (!made) return { ok: false, error: '目标会话未就绪，派发已取消' }
      }
      return await call('study.dispatchResearch', { goalId: g.id })
    }

    const createGoal = async () => {
      if (!form.topic.trim()) { setError('请填写主题'); return }
      setBusyKey('create')
      setError('')
      try {
        const r = await call('study.createGoal', {
          topic: form.topic.trim(),
          target_level: form.target_level.trim() || '未说明',
          requirements: form.requirements.trim()
        })
        if (!r || r.ok !== true) { setError(String((r && r.error) || '创建失败')); return }
        const goalId = r.goalId
        let sessionId, why = ''
        try {
          sessionId = await connectGoalWorkspace(r.workspaceId)
        } catch (e2) {
          sessionId = undefined
          why = errText(e2)
        }
        if (sessionId) {
          openSessionInUi(sessionId)
          call('study.startResearch', { goalId: goalId, sessionId: sessionId }).catch(() => {})
        } else {
          setError('目标已创建，但未能自动打开会话' + (why ? '：' + why : '') + '——请点目标行「打开会话」')
        }
        setView('list')
        setForm({ topic: '', target_level: '', requirements: '' })
        await refresh()
      } catch (e) {
        setError('创建失败: ' + String((e && e.message) || e))
      } finally {
        setBusyKey(null)
      }
    }

    const openChapterSession = async (g, c) => {
      if (!sessionsSvc) { setError('会话服务不可用'); return }
      setBusyKey('ch:' + g.id + ':' + c.index)
      setError('')
      try {
        let sid = c.sessionId
        if (!sid) {
          let wsId = g.workspaceId
          if (!wsId) {
            const r = await call('study.ensureGoalWorkspace', { goalId: g.id })
            if (!r || r.ok !== true) { setError(String((r && r.error) || '无法建立工作区')); return }
            wsId = r.workspaceId
          }
          // 章节要的是独立新会话（不是复用空白会话），所以直接 create；宿主不提供就明说
          if (typeof sessionsSvc.create !== 'function') { setError('宿主未提供会话创建能力'); return }
          const created = await sessionsSvc.create({ workspaceId: wsId })
          sid = unwrapSessionId(created)
          if (!sid) { setError('创建章节会话失败: 未返回会话 id'); return }
          const rec = await call('study.recordChapterSession', { goalId: g.id, chapter_index: c.index, sessionId: sid })
          if (!rec || rec.ok !== true) { setError(String((rec && rec.error) || '记录章节会话失败')); return }
          call('study.startChapter', { goalId: g.id, chapter_index: c.index, sessionId: sid }).catch(() => {})
        }
        if (sid && !openSessionInUi(sid)) setError('宿主未能切换到章节会话，请在左侧会话列表手动打开')
        await refresh()
      } catch (e) {
        setError('打开章节会话失败: ' + String((e && e.message) || e))
      } finally {
        setBusyKey(null)
      }
    }

    const delBtn = (g) => React.createElement('button', {
      type: 'button', className: 'stuiAct', 'data-tone': 'danger', disabled: busyKey !== null,
      onClick: () => { if (confirmDel === g.id) { setConfirmDel(null); doAction(g.id, () => call('study.deleteGoal', { goalId: g.id })) } else { setConfirmDel(g.id) } }
    }, confirmDel === g.id ? '确认删除?' : '删除')

    // ── M4 导出 / 导入 ────────────────────────────────────────────────────
    const fmtBytes = (b) => {
      const x = Number(b) || 0
      if (x < 1024) return x + ' B'
      if (x < 1024 * 1024) return (x / 1024).toFixed(1) + ' KB'
      return (x / 1024 / 1024).toFixed(2) + ' MB'
    }
    const loadExports = async () => {
      const r = await call('study.listExports', {})
      if (r && r.ok === true) { setIoList(r.exports || []); setIoDir(r.dir || '') }
      else setError(String((r && r.error) || '读取导出列表失败'))
    }
    const doExport = async (g) => {
      setBusyKey('export:' + g.id)
      setError('')
      setNotice('')
      try {
        const r = await call('study.exportGoal', { goalId: g.id })
        if (!r || r.ok !== true) { setError(String((r && r.error) || '导出失败')); return }
        setNotice('✅ 已导出 ' + r.file + '（' + fmtBytes(r.bytes) + '，会话 ' + r.counts.sessions + ' 个 / 附件 ' + r.counts.attachments + ' 个）')
        await loadExports()
        setView('io')
      } catch (e) {
        setError('导出失败: ' + String((e && e.message) || e))
      } finally {
        setBusyKey(null)
      }
    }
    const doReattach = async (g) => {
      await doAction('reattach:' + g.id, () => call('study.reattachGoalSessions', { goalId: g.id }))
    }
    const ACTION_LABEL = {
      create: '新增', append: '追加尾帧', replace: '整份替换', noop: '不变',
      rewind: '回退（包更旧）', diverged: '与本地分叉', liveBlocked: '会话正打开·挡',
      skippedByRequest: '按选择跳过', skippedDiverged: '分叉·本次不动',
    }
    const IDENTITY_LABEL = { fresh: '沿用原 id', update: '原地更新', adopt: '续用上次映射', reissue: '换发新身份' }
    const previewWith = async (mode, force) => {
      const p = impPath.trim()
      if (!p) { setError('先填导出包的绝对路径（或 exports 目录里的文件名）'); return }
      setIoBusy(true)
      setError('')
      setImpPreview(null)
      try {
        const arg = /\.zip$/i.test(p) && /[\\/]/.test(p) ? { path: p } : { file: p }
        const r = await call('study.inspectImport', Object.assign({}, arg, { mode: mode, force: !!force }))
        if (!r || r.ok !== true) { setError(String((r && r.error) || '预览失败')); return }
        setImpPreview(Object.assign({}, r, { arg: arg, mode: mode, force: !!force }))
      } catch (e) {
        setError('预览失败: ' + String((e && e.message) || e))
      } finally {
        setIoBusy(false)
      }
    }
    const doPreviewImport = () => previewWith(impMode, impForce)
    const pickMode = (m) => {
      setImpMode(m)
      if (impPath.trim()) previewWith(m, impForce)
    }
    const toggleForce = () => {
      const f = !impForce
      setImpForce(f)
      if (impPreview) previewWith(impMode, f)
    }
    const doConfirmImport = async () => {
      if (!impPreview) return
      setIoBusy(true)
      setError('')
      try {
        const arg = Object.assign({}, impPreview.arg, { confirm: true, mode: impPreview.mode, force: !!impPreview.force })
        const r = await call('study.importGoal', arg)
        if (!r || r.ok !== true) { setError(String((r && r.error) || '导入失败') + (r && r.rolledBack ? '（已回滚，未留下半成品）' : '')); return }
        const ap = r.applied || {}
        const bits = ['新增 ' + (ap.create || 0), '追加 ' + (ap.append || 0), '替换 ' + (ap.replace || 0), '不变 ' + (ap.noop || 0)]
        if (r.remap && r.remap.length) bits.push('换身份 ' + r.remap.length)
        setNotice('✅ ' + (r.idempotent ? '已是最新（无改动）：' : '已导入/更新目标「') + (r.title || r.goalId) + '」' + bits.join(' · ') + '，附件 ' + r.attachments + ' 个。重启 DSH 后左栏分组与会话列表才会完整刷新。')
        setImpPreview(null)
        await refresh()
      } catch (e) {
        setError('导入失败: ' + String((e && e.message) || e))
      } finally {
        setIoBusy(false)
      }
    }
    const doDeleteExport = async (item) => {
      await call('study.deleteExport', { file: item.file })
      await loadExports()
    }

    // ── M5 GitHub 同步 ─────────────────────────────────────────────────────
    const SYNC_STATUS_LABEL = { upToDate: '✓ 已同步', localAhead: '⬆ 本地待推', remoteAhead: '⬇ 远端待拉', conflicted: '⚠ 真分叉', remoteMissing: '☁ 远端还没有' }
    const SYNC_STATUS_TONE = { upToDate: 'ok', localAhead: 'busy', remoteAhead: 'busy', conflicted: 'warn', remoteMissing: undefined }
    const BIND_LABEL = { unbound: '未绑定', 'account-only': '已授权账号，待定位仓库', ready: '已就绪', invalid: '凭据已失效，需重绑' }
    const withSyncBusy = async (key, fn) => {
      setSyncBusy(key); setSyncErr('')
      try { const r = await fn(); setSyncBusy(null); return r }
      catch (e) { setSyncBusy(null); setSyncErr(errText(e)); return { ok: false, error: errText(e) } }
    }
    const loadSync = async () => {
      const r = await call('study.syncGetConfig')
      if (r && r.ok === true) { setSync(r); setSyncErr(''); setClientIdInput((v) => (v || ((r.config || {}).clientId || ''))) }
      else setSyncErr(String((r && r.error) || '读取同步配置失败'))
    }
    const openSyncView = () => {
      const next = view === 'sync' ? 'list' : 'sync'
      setView(next)
      if (next === 'sync') { loadSync(); setInspMap({}); setTakeOverHint('') }
    }
    const loadRemote = async () => {
      const r = await withSyncBusy('remote', () => call('study.syncListRemote', {}))
      if (r && r.ok === true) setRemoteList(r)
      else if (r && r.needRebind) { setRemoteList(null); setSyncErr('GitHub 凭据已失效，请先重绑') ; await loadSync() }
      else setSyncErr(String((r && r.error) || '列出远端目标失败'))
    }
    const doBindPat = () => withSyncBusy('pat', async () => {
      const token = patInput.trim()
      if (!token) { setSyncErr('先粘贴 GitHub token'); return }
      const r = await call('study.syncBindPat', { token: token })
      if (r && r.ok === true) { setPatInput(''); setTakeOverHint(''); setSync(r); setSyncErr(''); await loadRemote() }
      else if (r && r.needTakeOver) { setTakeOverHint(String(r.error || '')); setSyncErr(''); await loadSync() }
      else setSyncErr(String((r && r.error) || '绑定失败'))
    })
    const doStartDevice = () => withSyncBusy('dev', async () => {
      const want = clientIdInput.trim()
      const have = (sync && sync.config && sync.config.clientId) || ''
      if (want && want !== have) {
        const s = await call('study.syncSetConfig', { clientId: want })
        if (!s || s.ok !== true) { setSyncErr(String((s && s.error) || '保存 client_id 失败')); return }
        setSync(Object.assign({}, sync, { config: Object.assign({}, (sync && sync.config) || {}, { clientId: want }) }))
      }
      const r = await call('study.syncStartDeviceFlow', {})
      if (r && r.ok === true) setDevFlow({ userCode: r.userCode, verificationUri: r.verificationUri, status: 'pending' })
      else setSyncErr(String((r && r.error) || '发起设备码失败'))
    })
    const doPollDevice = () => withSyncBusy('devpoll', async () => {
      const r = await call('study.syncPollDeviceFlow', {})
      if (r && r.needTakeOver) { setDevFlow(null); setTakeOverHint(String(r.error || '')); setSyncErr(''); await loadSync(); return }
      if (!r || r.ok !== true) { setSyncErr(String((r && r.error) || '轮询失败')); if (r && r.error) setDevFlow(null); return }
      if (r.status === 'pending') { setDevFlow((d) => (d ? Object.assign({}, d, { status: 'pending' }) : d)); return }
      if (r.status === 'authorized') { setDevFlow(null); setTakeOverHint(''); setSync(Object.assign({}, sync, { bound: true, bindState: 'ready', config: r.config })); await loadSync(); await loadRemote() }
    })
    const doTakeOver = () => withSyncBusy('takeover', async () => {
      const r = await call('study.syncTakeOver', {})
      if (r && r.ok === true) { setTakeOverHint(''); setSyncErr(''); await loadSync(); await loadRemote() }
      else setSyncErr(String((r && r.error) || '接管失败'))
    })
    const doRebind = () => withSyncBusy('rebind', async () => {
      const r = await call('study.syncRebind', {})
      if (r && r.ok === true) { setSyncErr(''); await loadSync(); await loadRemote() } else setSyncErr(String((r && r.error) || '重绑失败'))
    })
    const doUnbind = () => withSyncBusy('unbind', async () => {
      const r = await call('study.syncUnbind', {})
      if (r && r.ok === true) { setRemoteList(null); setInspMap({}); await loadSync() } else setSyncErr(String((r && r.error) || '解绑失败'))
    })
    const inspectGoal = async (goalId) => {
      const r = await call('study.syncInspect', { goalId: goalId })
      setInspMap((m) => Object.assign({}, m, { [goalId]: r && r.ok === true ? r : { ok: false, error: (r && r.error) || '检查失败' } }))
    }
    const inspectAll = () => withSyncBusy('inspectAll', async () => {
      for (const g of goals) await inspectGoal(g.id)
    })
    const afterSyncAction = async (goalId) => { await inspectGoal(goalId); await loadRemote() }
    const doSyncPush = (goalId, force) => withSyncBusy('push:' + goalId, async () => {
      const r = await call('study.syncPush', force ? { goalId: goalId, force: true } : { goalId: goalId })
      if (!r || r.ok !== true) setSyncErr(String((r && r.error) || '推送失败'))
      await afterSyncAction(goalId)
    })
    const doSyncPull = (remoteGoalId, discardLocal) => withSyncBusy('pull:' + remoteGoalId, async () => {
      const r = await call('study.syncPull', discardLocal ? { remoteGoalId: remoteGoalId, discardLocal: true } : { remoteGoalId: remoteGoalId })
      if (!r || r.ok !== true) setSyncErr(String((r && r.error) || '拉取失败'))
      const lid = (goals.find((g) => g.id === remoteGoalId) || {}).id || remoteGoalId
      await afterSyncAction(lid)
      if (r && r.ok === true) await refresh()
    })

    const syncGoalRow = (g) => {
      const insp = inspMap[g.id]
      if (!insp) {
        return React.createElement('div', { key: g.id, className: 'stuiChRow' },
          React.createElement('span', { className: 'stuiChTitle', title: g.title }, g.title),
          React.createElement('button', { type: 'button', className: 'stuiAct', disabled: syncBusy !== null, onClick: () => inspectGoal(g.id) }, '☁ 检查同步状态')
        )
      }
      if (insp.ok === false) {
        return React.createElement('div', { key: g.id, className: 'stuiChRow' },
          React.createElement('span', { className: 'stuiChTitle', title: g.title }, g.title),
          React.createElement('span', { className: 'stuiErr' }, '⚠ ' + insp.error)
        )
      }
      const st = insp.status
      const rgid = insp.remoteGoalId || g.id
      const busy = syncBusy !== null
      const remote = insp.remote || {}
      return React.createElement('div', { key: g.id, className: 'stuiGoal' },
        React.createElement('div', { className: 'stuiChRow' },
          React.createElement('span', { className: 'stuiChTitle', title: g.title }, g.title),
          React.createElement('span', { className: 'stuiChip', 'data-tone': SYNC_STATUS_TONE[st] }, SYNC_STATUS_LABEL[st] || st),
          (st === 'localAhead' || st === 'remoteMissing') && React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: busy, onClick: () => doSyncPush(g.id, false) }, busy && syncBusy === 'push:' + g.id ? '推送中…' : '⬆ 推送到仓库'),
          st === 'remoteAhead' && React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: busy, onClick: () => doSyncPull(rgid, false) }, busy && syncBusy === 'pull:' + rgid ? '拉取中…' : '⬇ 拉取到本地'),
          st === 'conflicted' && React.createElement('button', { type: 'button', className: 'stuiAct', disabled: busy, onClick: () => inspectGoal(g.id) }, '⟳ 重新检查')
        ),
        st === 'conflicted' && React.createElement('div', { className: 'stuiDetail' },
          React.createElement('div', { className: 'stuiMeta' }, '⚠ 仓库版与本地版各自都有改动。仓库最新：' + (remote.exportedAt || '未知') + ' · 设备 ' + (remote.deviceId || '?') + ' · ' + fmtBytes(remote.bytes || 0) + '；本地：' + ((insp.local || {}).exportedAt || '未知') + '。二选一：'),
          React.createElement('div', { className: 'stuiRow' },
            React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'danger', disabled: busy, title: '用本地覆盖仓库（force push），仓库版会丢失', onClick: () => doSyncPush(g.id, true) }, '🔼 覆盖仓库（用本地）'),
            React.createElement('button', { type: 'button', className: 'stuiAct', disabled: busy, title: '放弃本地未推的改动，拉仓库版落地（不删本地多出的文件）', onClick: () => doSyncPull(rgid, true) }, '🔽 放弃本地（拉仓库）')
          )
        )
      )
    }

    const syncView = () => {
      if (!sync) return React.createElement('div', { className: 'stuiForm' },
        React.createElement('div', { className: 'stuiMeta' }, '正在读取同步配置…'),
        React.createElement('div', { className: 'stuiRow' },
          React.createElement('button', { type: 'button', className: 'stuiAct', onClick: () => loadSync() }, '⟳ 重试'),
          React.createElement('button', { type: 'button', className: 'stuiAct', onClick: () => setView('list') }, '← 返回目标列表')
        )
      )
      const cfg = sync.config || {}
      const bs = sync.bindState || (sync.bound ? 'ready' : 'unbound')
      const noFetch = sync.fetch === false
      return React.createElement('div', { className: 'stuiForm' },
        React.createElement('div', { className: 'stuiRow' },
          React.createElement('button', { type: 'button', className: 'stuiAct', onClick: () => setView('list') }, '← 返回目标列表'),
          React.createElement('button', { type: 'button', className: 'stuiAct', onClick: () => loadSync() }, '⟳ 刷新')
        ),
        noFetch && React.createElement('div', { className: 'stuiErr' }, '⚠ 宿主 Node 无 fetch，GitHub 同步不可用（其余功能不受影响）'),
        React.createElement('div', { className: 'stuiMeta' }, '绑定状态：' + (BIND_LABEL[bs] || bs) + (cfg.repo && cfg.repo.fullName ? ' · 仓库 ' + cfg.repo.fullName : '') + (cfg.auth && cfg.auth.account ? ' · 账号 ' + cfg.auth.account : '') + (cfg.auth && cfg.auth.tokenHint ? ' · token ' + cfg.auth.tokenHint : '')),
        bs === 'invalid' && React.createElement('div', { className: 'stuiRow' },
          React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: syncBusy !== null || noFetch, onClick: () => doRebind() }, syncBusy === 'rebind' ? '重绑中…' : '🔗 重新绑定（复用已存凭据）')
        ),
        bs === 'account-only' && React.createElement('div', { className: 'stuiDetail' },
          React.createElement('div', { className: 'stuiDraftOv' }, takeOverHint || ('已授权账号' + (cfg.auth && cfg.auth.account ? ' ' + cfg.auth.account : '') + '，但固定同步仓 dsh-study-sync 尚未定位成功。若它已在你的账号下存在且没有学习区的认领标记，可在下方明示「接管」——本插件只会补写认领标记并在 study-goals/ 前缀下同步，绝不删除该仓现有的任何内容。')),
          React.createElement('div', { className: 'stuiRow' },
            React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: syncBusy !== null || noFetch, onClick: () => doTakeOver() }, syncBusy === 'takeover' ? '接管中…' : '✅ 接管这个已有仓库（只补标记，不删内容）'),
            React.createElement('button', { type: 'button', className: 'stuiAct', disabled: syncBusy !== null, onClick: () => { setTakeOverHint(''); doUnbind() } }, '↩ 放弃（换账号或先给那个仓改名）')
          )
        ),
        (bs === 'unbound' || bs === 'account-only') && React.createElement('div', { className: 'stuiDetail' },
          React.createElement('div', { className: 'stuiDraftOv' }, '用 GitHub 账号绑定固定同步仓 dsh-study-sync。两种授权方式：设备码（OAuth，推荐）或直接粘贴 fine-grained PAT（仅 Contents 读写）。token 只存本机、绝不回显明文。'),
          React.createElement('input', { className: 'stuiInput', value: clientIdInput, placeholder: 'GitHub OAuth App 的 client_id（设备码方式需要；见 README）', onChange: (e) => setClientIdInput(e.target.value) }),
          React.createElement('div', { className: 'stuiRow' },
            React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: syncBusy !== null || noFetch, onClick: () => doStartDevice() }, syncBusy === 'dev' ? '申请中…' : '🔑 用 GitHub 设备码授权')
          ),
          devFlow && React.createElement('div', { className: 'stuiMeta' },
            '请在浏览器打开 ', React.createElement('a', { href: devFlow.verificationUri, target: '_blank', rel: 'noreferrer' }, devFlow.verificationUri),
            ' 并输入代码 ', React.createElement('strong', null, devFlow.userCode), ' 完成授权后点下方按钮确认。'),
          devFlow && React.createElement('div', { className: 'stuiRow' },
            React.createElement('button', { type: 'button', className: 'stuiAct', disabled: syncBusy !== null, onClick: () => doPollDevice() }, syncBusy === 'devpoll' ? '查询中…' : (devFlow.status === 'pending' ? '✅ 我已在浏览器授权，确认' : '✅ 确认授权')),
            React.createElement('button', { type: 'button', className: 'stuiAct', disabled: syncBusy !== null, onClick: () => setDevFlow(null) }, '取消')
          ),
          React.createElement('input', { className: 'stuiInput', type: 'password', value: patInput, placeholder: '或粘贴 fine-grained PAT（github_pat_…）', onChange: (e) => setPatInput(e.target.value) }),
          React.createElement('div', { className: 'stuiRow' },
            React.createElement('button', { type: 'button', className: 'stuiAct', disabled: syncBusy !== null || noFetch || !patInput.trim(), onClick: () => doBindPat() }, syncBusy === 'pat' ? '绑定中…' : '🔗 用 PAT 绑定')
          )
        ),
        sync.bound === true && React.createElement(React.Fragment, null,
          React.createElement('div', { className: 'stuiRow' },
            React.createElement('button', { type: 'button', className: 'stuiAct', disabled: syncBusy !== null || noFetch, onClick: () => loadRemote() }, syncBusy === 'remote' ? '读取中…' : '☁ 列出仓库里的目标'),
            React.createElement('button', { type: 'button', className: 'stuiAct', disabled: syncBusy !== null || noFetch || goals.length === 0, onClick: () => inspectAll() }, syncBusy === 'inspectAll' ? '检查中…' : '⇅ 检查本机目标同步状态'),
            React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'danger', disabled: syncBusy !== null, onClick: () => doUnbind() }, '解绑（只清本机）')
          ),
          remoteList && React.createElement('div', { className: 'stuiDetail' },
            React.createElement('div', { className: 'stuiMeta' }, '仓库 ' + (remoteList.repo || '') + '（分支 ' + (remoteList.branch || 'main') + '）里的目标：'),
            (remoteList.goals || []).length === 0 ? React.createElement('div', { className: 'stuiEmpty' }, '（空）同步仓还没有任何目标，首次推送后会出现') :
              (remoteList.goals || []).map((rg) => React.createElement('div', { key: rg.remoteGoalId, className: 'stuiChRow' },
                React.createElement('span', { className: 'stuiChTitle', title: rg.title || rg.remoteGoalId }, (rg.title || rg.remoteGoalId)),
                React.createElement('span', { className: 'stuiChip' }, fmtBytes(rg.bytes || 0)),
                React.createElement('span', { className: 'stuiMeta' }, rg.exportedAt || '')
              ))
          ),
          goals.length === 0 ? React.createElement('div', { className: 'stuiEmpty' }, '本机还没有学习目标') :
            React.createElement('div', { className: 'stuiDetail' },
              React.createElement('div', { className: 'stuiMeta' }, '本机目标：'),
              goals.map(syncGoalRow))
        )
      )
    }

    const ioView = () => React.createElement('div', { className: 'stuiForm' },
      React.createElement('div', { className: 'stuiMeta' }, '导出包目录: ' + (ioDir || '（空）')),
      React.createElement('div', { className: 'stuiRow' },
        React.createElement('button', { type: 'button', className: 'stuiAct', disabled: ioBusy, onClick: () => loadExports() }, '⟳ 刷新'),
        React.createElement('button', { type: 'button', className: 'stuiAct', onClick: () => { setView('list'); setImpPreview(null) } }, '← 返回目标列表')
      ),
      ioList.length === 0 ? React.createElement('div', { className: 'stuiEmpty' }, '还没有导出包\n在目标行点「📤 导出」生成') :
        React.createElement('div', null, ioList.map((it) => React.createElement('div', { key: it.file, className: 'stuiChRow' },
          React.createElement('span', { className: 'stuiChTitle', title: it.file }, it.file),
          React.createElement('span', { className: 'stuiChip' }, fmtBytes(it.bytes)),
          React.createElement('a', { className: 'stuiAct', href: it.downloadUrl, download: it.file, style: { textDecoration: 'none' } }, '⬇ 下载'),
          React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'danger', disabled: ioBusy, onClick: () => doDeleteExport(it) }, '删')
        ))),
      React.createElement('div', { className: 'stuiDraftOv' }, '导入 = 应用一个包（可重复执行）：同一个包再导一次是「更新」而不是复制。目标 / 会话 / 工作区都按这个原则处理；本地比包新的内容不会被悄悄吃掉（需要勾 force）。'),
      React.createElement('input', {
        className: 'stuiInput', value: impPath, placeholder: 'C:\\Users\\me\\Downloads\\study-goal-…-20260909.zip',
        onChange: (e) => { setImpPath(e.target.value); setImpPreview(null) }
      }),
      React.createElement('div', { className: 'stuiRow' },
        [['overwrite', '⤴ 覆盖'], ['merge', '➕ 合并'], ['copy', '📋 另存副本']].map((m) => React.createElement('button', {
          key: m[0], type: 'button', className: 'stuiAct', 'data-tone': impMode === m[0] ? 'primary' : undefined,
          title: m[0] === 'overwrite' ? '目标/会话已存在时按包更新（分叉需勾 force）' : m[0] === 'merge' ? '只新增与快进，本地分叉项不动' : '换一个新 goalId，会话全部换发新身份，绝不碰现有目标',
          disabled: ioBusy, onClick: () => pickMode(m[0])
        }, m[1]))
      ),
      impMode === 'overwrite' && React.createElement('label', { className: 'stuiMeta', style: { display: 'flex', gap: '6px', alignItems: 'center' } },
        React.createElement('input', { type: 'checkbox', checked: impForce, disabled: ioBusy, onChange: () => toggleForce() }),
        '允许覆盖分叉/更旧的本地会话（会吃掉本地历史）'
      ),
      React.createElement('div', { className: 'stuiRow' },
        React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: ioBusy || !impPath.trim(), onClick: () => doPreviewImport() }, ioBusy ? '读取中…' : '🔍 预览这个包')
      ),
      impPreview && React.createElement('div', { className: 'stuiDetail' },
        React.createElement('div', { className: 'stuiMeta' }, '目标: ' + (impPreview.plan.title || '(无标题)') + ' · ' + impPreview.plan.chapters + ' 章 · 会话 ' + impPreview.plan.sessionCount + ' 个 · 附件 ' + impPreview.plan.attachments + ' 个 · ' + fmtBytes(impPreview.plan.bytesTotal)),
        React.createElement('div', { className: 'stuiMeta', style: { wordBreak: 'break-all' } }, '落点: ' + impPreview.plan.dir + (impPreview.plan.goalExists ? (impPreview.plan.sameLineage ? '（已存在·同一目标 ⇒ 更新它）' : '（已存在·不是这个目标 ⚠）') : '（新建）')),
        React.createElement('div', { className: 'stuiMeta' }, '模式: ' + (impPreview.mode === 'overwrite' ? '覆盖' : impPreview.mode === 'copy' ? '另存副本' : '合并') + (impPreview.force ? ' + force' : '') + ' · 源机导出 ' + (impPreview.plan.exportedAt || '?') + ' · 平台 ' + ((impPreview.plan.source || {}).platform || '?') + (impPreview.plan.deviceId ? ' · 设备 ' + impPreview.plan.deviceId : '')),
        React.createElement('div', { className: 'stuiMeta' }, '将执行: ' + Object.keys(impPreview.plan.counts || {}).map((k) => (ACTION_LABEL[k] || k) + ' ' + impPreview.plan.counts[k]).join(' · ')),
        (impPreview.plan.sessions || []).slice(0, 8).map((s) => React.createElement('div', { key: s.remoteId, className: 'stuiMeta' },
          '  · ' + (s.title || s.remoteId) + ' [' + (s.boundTo || '?') + '] · ' + (IDENTITY_LABEL[s.identity] || s.identity) + ' ⇒ ' + (ACTION_LABEL[s.action] || s.action) +
          ' (' + (s.localRows === undefined ? '新' : s.localRows) + '→' + (s.pkgLines || 0) + ' 行)' + (s.detail ? ' ' + s.detail : ''))),
        (impPreview.plan.sessions || []).length > 8 ? React.createElement('div', { className: 'stuiMeta' }, '  …共 ' + impPreview.plan.sessions.length + ' 个会话') : null,
        (impPreview.conflicts || []).length > 0 && React.createElement('div', { className: 'stuiErr' }, '⚠ 冲突: ' + impPreview.conflicts.map((c) => c.kind + '=' + c.detail).join('; ') + ' — ' + ((impPreview.conflicts[0] || {}).hint || '')),
        (impPreview.warnings || []).length > 0 && React.createElement('div', { className: 'stuiMeta' }, '提示: ' + impPreview.warnings.slice(0, 4).join(' / ')),
        React.createElement('div', { className: 'stuiRow' },
          React.createElement('button', {
            type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: ioBusy || impPreview.canImport !== true,
            onClick: () => doConfirmImport()
          }, ioBusy ? '导入中…' : '✓ 确认' + (impPreview.mode === 'copy' ? '另存副本' : impPreview.mode === 'overwrite' ? '覆盖导入' : '合并导入')),
          React.createElement('button', { type: 'button', className: 'stuiAct', disabled: ioBusy, onClick: () => setImpPreview(null) }, '取消')
        )
      )
    )

    const activeCount = goals.filter((g) => g.status === 'researching' || g.status === 'draft_pending' || g.status === 'active').length

    return React.createElement('div', {
      className: wide ? 'stuiLayer' : 'stuiLayer stuiRail',
      ref: rootRef,
      style: { width: '100%' }
    },
      React.createElement('button', {
        type: 'button', className: 'stuiBadge', 'data-active': open || undefined,
        'aria-label': open ? '收起学习区' : '展开学习区',
        'aria-expanded': open || undefined,
        title: '学习区',
        onClick: () => setOpenBoth(!open)
      },
        React.createElement('span', { style: { fontSize: wide ? 15 : 16 } }, '📚'),
        wide && React.createElement('span', { className: 'stuiBadgeLabel' }, '学习区'),
        wide && React.createElement('span', { className: 'stuiBadgeCount' }, activeCount > 0 ? String(activeCount) : '')
      ),
      open && React.createElement('div', { className: 'stuiBackdrop', onClick: () => setOpenBoth(false) }),
      open && anchor !== undefined && React.createElement('div', { className: 'stuiPanel', style: { left: anchor.left, bottom: anchor.bottom } },
        React.createElement('div', { className: 'stuiHeader' },
          React.createElement('span', { className: 'stuiTitle' }, '📚 学习区'),
          React.createElement('span', { className: 'stuiRow' },
            React.createElement('button', {
              type: 'button', className: 'stuiIconBtn', 'data-active': view === 'sync' || undefined,
              title: 'GitHub 同步', onClick: () => openSyncView()
            }, '☁'),
            React.createElement('button', {
              type: 'button', className: 'stuiIconBtn', 'data-active': view === 'io' || undefined,
              title: '导出包 / 导入', onClick: () => { const next = view === 'io' ? 'list' : 'io'; setView(next); setImpPreview(null); if (next === 'io') loadExports() }
            }, '📦'),
            React.createElement('button', { type: 'button', className: 'stuiIconBtn', title: '刷新', onClick: () => refresh() }, '⟳'),
            React.createElement('button', { type: 'button', className: 'stuiIconBtn', title: '收起', onClick: () => setOpenBoth(false) }, '✕')
          )
        ),
        React.createElement('div', { className: 'stuiBody' },
          error !== '' && React.createElement('div', { className: 'stuiErr' }, '⚠ ' + error),
          syncErr !== '' && React.createElement('div', { className: 'stuiErr' }, '⚠ ' + syncErr),
          notice !== '' && React.createElement('div', { className: 'stuiMeta' }, notice),
          view === 'sync' ? syncView() :
          view === 'io' ? ioView() :
          view === 'form' ? React.createElement('div', { className: 'stuiForm' },
            React.createElement('label', null, '学习主题 *', React.createElement('input', { className: 'stuiInput', value: form.topic, placeholder: '如：Transformer 基础', onChange: (e) => setForm({ ...form, topic: e.target.value }) })),
            React.createElement('label', null, '目标水平', React.createElement('input', { className: 'stuiInput', value: form.target_level, placeholder: '如：能读懂论文与实现', onChange: (e) => setForm({ ...form, target_level: e.target.value }) })),
            React.createElement('label', null, '附加要求（可选）', React.createElement('input', { className: 'stuiInput', value: form.requirements, placeholder: '如：中文讲义，从直觉讲起', onChange: (e) => setForm({ ...form, requirements: e.target.value }) })),
            React.createElement('div', { className: 'stuiRow' },
              React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: busyKey !== null, onClick: () => createGoal() }, busyKey === 'create' ? '创建中…' : '✓ 创建并调研'),
              React.createElement('button', { type: 'button', className: 'stuiAct', onClick: () => setView('list') }, '取消')
            ),
            React.createElement('div', { className: 'stuiMeta' }, '创建后打开该目标专属会话，由会话 AI 联网调研并按自然章节产出课程草案，待你批准')
          ) : React.createElement(React.Fragment, null,
            // 添加按钮属于整个列表视图（含空态）：空态提示文案就指着它，之前被关在
            // goals.length>0 的分支里，新装/删空/首帧未加载时面板没有任何创建入口。
            goals.length === 0 ? React.createElement('div', { className: 'stuiEmpty' }, '还没有学习目标\n点下方「＋ 添加学习目标」开始') :
              goals.map((g) => {
                const exp = expanded[g.id] === true
                const hasDraft = g.draft && Array.isArray(g.draft.chapters) && g.draft.chapters.length > 0
                const chapterList = g.chapters || []
                const goalBusy = busyKey === g.id || busyKey === 'create'
                const opening = busyKey === 'open:' + g.id
                // status='researching' 是建档初值；只有宿主记下"指令已注入"才算真在调研
                const awaitingResearch = g.status === 'researching' && g.researchDispatched !== true
                return React.createElement('div', { key: g.id, className: 'stuiGoal' },
                  React.createElement('div', { className: 'stuiGoalHead' },
                    React.createElement('span', { className: 'stuiGoalTitle', title: g.id, onClick: () => setExpanded({ ...expanded, [g.id]: !exp }) },
                      exp ? '▾ ' : '▸ ', g.title),
                    React.createElement('span', { className: 'stuiChip', 'data-tone': awaitingResearch ? 'warn' : toneOf(g.status) }, awaitingResearch ? '待调研' : labelOf(g.status)),
                    React.createElement('button', {
                      type: 'button', className: 'stuiOpen', disabled: opening || goalBusy,
                      onClick: () => openGoalSession(g)
                    }, opening ? '切换中…' : '📄 打开会话'),
                    React.createElement('button', {
                      type: 'button', className: 'stuiIconBtn', title: '导出为 zip（目标全部内容 + 全部会话）',
                      disabled: goalBusy || busyKey === 'export:' + g.id,
                      onClick: () => doExport(g)
                    }, busyKey === 'export:' + g.id ? '⏳' : '📤')
                  ),
                  exp && React.createElement('div', { className: 'stuiGoalBody' },
                    React.createElement('div', { className: 'stuiDetail' },
                      React.createElement('div', { className: 'stuiMeta' }, '目标: ' + (g.target_level || '未说明')),
                      React.createElement('div', { className: 'stuiMeta' }, '💡 目标与每章都有独立会话：点「打开会话」进目标总会话；章节讲义就绪后点「开始学习」进该章会话')
                    ),
                    React.createElement('div', { className: 'stuiDetail' },
                      g.status === 'draft_pending' && hasDraft && React.createElement('div', { className: 'stuiDraftOv' }, '草案: ' + ((g.draft && g.draft.overview) || '')),
                      g.status === 'draft_pending' && hasDraft && React.createElement('div', { className: 'stuiRow' },
                        React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: goalBusy, onClick: () => doAction(g.id, () => call('study.approveDraft', { goalId: g.id })) }, '✓ 批准'),
                        React.createElement('button', {
                          type: 'button', className: 'stuiAct', disabled: goalBusy,
                          // 名副其实：退回并清空草案后立刻把调研重新派发（旧行为只退回，目标就此停在「调研中」）
                          onClick: () => doAction(g.id, async () => {
                            const rj = await call('study.rejectDraft', { goalId: g.id, reason: '用户重新考虑' })
                            if (!rj || rj.ok !== true) return rj
                            return await dispatchResearch(g)
                          })
                        }, '重新调研')
                      ),
                      g.status === 'research_failed' && React.createElement('div', { className: 'stuiRow' },
                        React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: goalBusy, onClick: () => doAction(g.id, () => call('study.retryResearch', { goalId: g.id })) }, '重试调研')
                      ),
                      g.status === 'researching' && React.createElement('div', { className: 'stuiMeta' },
                        awaitingResearch
                          ? '⚠️ 调研还没开始：建档时状态就被预置为「调研中」，但目标会话从未收到过指令。点下面按钮派发调研。'
                          : '⏳ 目标会话 AI 正在联网调研…完成后自动转入待批准' + (g.researchDispatchedAt ? '（派发于 ' + hhmm(g.researchDispatchedAt) + '）' : '')),
                      g.status === 'researching' && React.createElement('div', { className: 'stuiRow' },
                        React.createElement('button', {
                          type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: goalBusy,
                          onClick: () => doAction(g.id, () => dispatchResearch(g))
                        }, busyKey === g.id ? '派发中…' : (awaitingResearch ? '▶ 开始调研' : '🔁 重新调研'))),
                      chapterList.map((c) => {
                        const chBusy = busyKey === g.id + ':' + c.index || busyKey === 'ch:' + g.id + ':' + c.index
                        const readyForLearn = c.status === 'ready' || c.status === 'done'
                        return React.createElement('div', { key: c.index, className: 'stuiChRow' },
                          React.createElement('span', { className: 'stuiChTitle', title: c.file }, String(c.index).padStart(2, '0') + '. ' + c.title),
                          React.createElement('span', { className: 'stuiChip', 'data-tone': toneOf(c.status) }, labelOf(c.status)),
                          c.status === 'draft' && React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: chBusy, onClick: () => doAction(g.id + ':' + c.index, () => call('study.generateChapter', { goalId: g.id, chapter_index: c.index })) }, busyKey === g.id + ':' + c.index ? '生成中…' : '生成讲义'),
                          c.status === 'generating' && React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: chBusy, onClick: () => doAction(g.id + ':' + c.index, () => call('study.continueChapter', { goalId: g.id, chapter_index: c.index })) }, busyKey === g.id + ':' + c.index ? '继续中…' : '继续生成'),
                          readyForLearn && React.createElement('button', { type: 'button', className: 'stuiAct', disabled: chBusy, onClick: () => openChapterSession(g, c) }, chBusy ? '打开中…' : '📖 开始学习')
                        )
                      }),
                      (g.status === 'approved' || g.status === 'active' || g.status === 'completed') && chapterList.length === 0 && React.createElement('div', { className: 'stuiMeta' }, '章节待生成'),
                      (g.status === 'approved' || g.status === 'active' || g.status === 'completed') && React.createElement('div', { className: 'stuiMeta', style: { wordBreak: 'break-all' } }, '📁 ' + g.path),
                      React.createElement('div', { className: 'stuiRow' },
                        React.createElement('button', { type: 'button', className: 'stuiAct', disabled: goalBusy, onClick: () => doExport(g) }, busyKey === 'export:' + g.id ? '导出中…' : '📤 导出 zip'),
                        g.sessionId && React.createElement('button', { type: 'button', className: 'stuiAct', disabled: goalBusy, onClick: () => doReattach(g) }, '🔗 重新绑定会话'),
                        delBtn(g)
                      )
                    )
                  )
                )
              }),
              React.createElement('button', { type: 'button', className: 'stuiAdd', onClick: () => setView('form') }, '＋ 添加学习目标')
            )
        )
      )
    )
  }

  slots.inject('sidebar.footer.action', () => slots.register(
    { name: 'sidebar.footer.action', id: 'study-panel', inject: () => ({
      workspaces: ctx.get('workspaces'),
      sessions: ctx.get('sessions')
    }) },
    (props) => React.createElement(StudyApp, Object.assign({}, props))
  ))

  ctx.effect(() => {
    const id = setInterval(() => {
      if (ui.open && activeRefresh) activeRefresh()
    }, 2500)
    return () => clearInterval(id)
  }, 'study-plugin: panel refresh')
}

    return { apply, inject };
  },
});
