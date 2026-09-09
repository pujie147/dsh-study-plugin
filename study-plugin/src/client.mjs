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
      try {
        const r = await fn()
        if (r && r.ok === false) setError(String(r.error || '操作失败'))
        await refresh()
      } catch (e) {
        setError(String((e && e.message) || e))
      } finally {
        setBusyKey(null)
      }
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

    const openGoalSession = async (g) => {
      if (!workspacesSvc || !sessionsSvc) { setError('会话服务不可用'); return }
      setBusyKey('open:' + g.id)
      setError('')
      try {
        const wsId = g.workspaceId
        let sessionId
        if (wsId) {
          try {
            sessionId = unwrapSessionId(await workspacesSvc.connectWorkspace(wsId))
          } catch (e2) {
            sessionId = undefined
          }
        }
        if (!sessionId) {
          const r = await call('study.ensureGoalWorkspace', { goalId: g.id })
          if (!r || r.ok !== true) { setError(String((r && r.error) || '无法建立目标工作区')); return }
          sessionId = unwrapSessionId(await workspacesSvc.connectWorkspace(r.workspaceId))
        }
        if (sessionId) sessionsSvc.open(sessionId)
        else setError('未能取得会话 id')
      } catch (e) {
        setError('打开会话失败: ' + String((e && e.message) || e))
      } finally {
        setBusyKey(null)
      }
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
        let sessionId
        try {
          sessionId = unwrapSessionId(await workspacesSvc.connectWorkspace(r.workspaceId))
        } catch (e2) {
          sessionId = undefined
        }
        if (sessionId) {
          sessionsSvc.open(sessionId)
          call('study.startResearch', { goalId: goalId, sessionId: sessionId }).catch(() => {})
        } else {
          setError('目标已创建，但未能自动打开会话——请点目标行「打开会话」')
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
          const created = await sessionsSvc.create({ workspaceId: wsId })
          sid = unwrapSessionId(created)
          if (!sid) { setError('创建章节会话失败: 未返回会话 id'); return }
          const rec = await call('study.recordChapterSession', { goalId: g.id, chapter_index: c.index, sessionId: sid })
          if (!rec || rec.ok !== true) { setError(String((rec && rec.error) || '记录章节会话失败')); return }
          call('study.startChapter', { goalId: g.id, chapter_index: c.index, sessionId: sid }).catch(() => {})
        }
        if (sid) sessionsSvc.open(sid)
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
            React.createElement('button', { type: 'button', className: 'stuiIconBtn', title: '刷新', onClick: () => refresh() }, '⟳'),
            React.createElement('button', { type: 'button', className: 'stuiIconBtn', title: '收起', onClick: () => setOpenBoth(false) }, '✕')
          )
        ),
        React.createElement('div', { className: 'stuiBody' },
          error !== '' && React.createElement('div', { className: 'stuiErr' }, '⚠ ' + error),
          view === 'form' ? React.createElement('div', { className: 'stuiForm' },
            React.createElement('label', null, '学习主题 *', React.createElement('input', { className: 'stuiInput', value: form.topic, placeholder: '如：Transformer 基础', onChange: (e) => setForm({ ...form, topic: e.target.value }) })),
            React.createElement('label', null, '目标水平', React.createElement('input', { className: 'stuiInput', value: form.target_level, placeholder: '如：能读懂论文与实现', onChange: (e) => setForm({ ...form, target_level: e.target.value }) })),
            React.createElement('label', null, '附加要求（可选）', React.createElement('input', { className: 'stuiInput', value: form.requirements, placeholder: '如：中文讲义，从直觉讲起', onChange: (e) => setForm({ ...form, requirements: e.target.value }) })),
            React.createElement('div', { className: 'stuiRow' },
              React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: busyKey !== null, onClick: () => createGoal() }, busyKey === 'create' ? '创建中…' : '✓ 创建并调研'),
              React.createElement('button', { type: 'button', className: 'stuiAct', onClick: () => setView('list') }, '取消')
            ),
            React.createElement('div', { className: 'stuiMeta' }, '创建后打开该目标专属会话，由会话 AI 联网调研并按自然章节产出课程草案，待你批准')
          ) : goals.length === 0 ? React.createElement('div', { className: 'stuiEmpty' }, '还没有学习目标\n点下方「＋ 添加学习目标」开始') :
            React.createElement(React.Fragment, null,
              goals.map((g) => {
                const exp = expanded[g.id] === true
                const hasDraft = g.draft && Array.isArray(g.draft.chapters) && g.draft.chapters.length > 0
                const chapterList = g.chapters || []
                const goalBusy = busyKey === g.id || busyKey === 'create'
                const opening = busyKey === 'open:' + g.id
                return React.createElement('div', { key: g.id, className: 'stuiGoal' },
                  React.createElement('div', { className: 'stuiGoalHead' },
                    React.createElement('span', { className: 'stuiGoalTitle', title: g.id, onClick: () => setExpanded({ ...expanded, [g.id]: !exp }) },
                      exp ? '▾ ' : '▸ ', g.title),
                    React.createElement('span', { className: 'stuiChip', 'data-tone': toneOf(g.status) }, labelOf(g.status)),
                    React.createElement('button', {
                      type: 'button', className: 'stuiOpen', disabled: opening || goalBusy,
                      onClick: () => openGoalSession(g)
                    }, opening ? '切换中…' : '📄 打开会话')
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
                        React.createElement('button', { type: 'button', className: 'stuiAct', disabled: goalBusy, onClick: () => doAction(g.id, () => call('study.rejectDraft', { goalId: g.id, reason: '用户重新考虑' })) }, '重新调研'),
                        delBtn(g)
                      ),
                      g.status === 'research_failed' && React.createElement('div', { className: 'stuiRow' },
                        React.createElement('button', { type: 'button', className: 'stuiAct', 'data-tone': 'primary', disabled: goalBusy, onClick: () => doAction(g.id, () => call('study.retryResearch', { goalId: g.id })) }, '重试调研'),
                        delBtn(g)
                      ),
                      g.status === 'researching' && React.createElement('div', { className: 'stuiMeta' }, '⏳ 目标会话 AI 正在联网调研…完成后自动转入待批准'),
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
                      (g.status === 'approved' || g.status === 'active' || g.status === 'completed') && React.createElement('div', { className: 'stuiRow' }, delBtn(g))
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
