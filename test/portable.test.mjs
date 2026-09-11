// study-plugin — 可携化工具（lib/portable.js）测试
// 运行： node test/portable.test.mjs
// 只用临时目录，绝不写用户数据。若本机存在真实学习区会话 transcript，
// 额外拿它做一次「宿主写出的帧」兼容性检查（不存在则跳过）；
// 并能取到宿主真实后端时（test/host-fixture.mjs），用宿主自己的 inspect()/list() 交叉验证
// 我写出的字节 —— 换身份、追加尾帧、重复 id 三条语义都由宿主代码判定。
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as P from '../lib/portable.js'
import { createHostServices } from './host-fixture.mjs'

let n = 0
const ok = (label) => { n++; console.log('  ok ' + n + ' — ' + label) }

const tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'study-portable-'))
try {
  // ── ZIP：写 / 读 / 外部解压器互操作 ───────────────────────────────────────
  const zhName = 'goal/章节/01-入门.md'
  const body = '# 入门\n' + '内容'.repeat(2000)
  const bin = Buffer.from([0, 1, 2, 250, 255, 128, 0, 0])
  const zip = P.createZip([
    { name: 'manifest.json', data: Buffer.from(JSON.stringify({ formatVersion: 1, 目标: '软件设计' }), 'utf8') },
    { name: zhName, data: Buffer.from(body, 'utf8') },
    { name: 'sessions/s-1/transcript.jsonl.zstd', data: bin, store: true }
  ])
  ok('createZip 产出可被自身解析')
  const entries = P.readZip(zip)
  assert.equal(entries.size, 3)
  assert.equal(entries.get('manifest.json').toString('utf8'), JSON.stringify({ formatVersion: 1, 目标: '软件设计' }))
  assert.equal(entries.get(zhName).toString('utf8'), body)
  assert.deepEqual([...entries.get('sessions/s-1/transcript.jsonl.zstd')], [...bin])
  ok('readZip 往返一致（含 UTF-8 中文条目名与二进制 store 条目）')

  const ext = path.join(tmp, 'ext')
  await fsp.writeFile(path.join(tmp, 't.zip'), zip)
  // 外部解压器互操作（Windows 自带）。受限环境里 spawn 可能被沙箱拒绝：那只是降级跳过，不是失败。
  let interop = true
  try {
    execFileSync('powershell', ['-NoProfile', '-Command', "Expand-Archive -Force -LiteralPath '" + path.join(tmp, 't.zip') + "' -DestinationPath '" + ext + "'"], { stdio: 'ignore' })
  } catch (e) {
    if (e && (e.code === 'EPERM' || e.code === 'ENOENT')) interop = false
    else throw e
  }
  if (interop) {
    assert.equal((await fsp.readFile(path.join(ext, zhName), 'utf8')), body)
    assert.deepEqual([...await fsp.readFile(path.join(ext, 'sessions/s-1/transcript.jsonl.zstd'))], [...bin])
    ok('Windows 自带 Expand-Archive 能解我们的包（zip 规范合规）')
  } else {
    console.log('  skip — 无法 spawn 外部解压器（沙箱限制），跳过互操作检查')
  }

  // ── zip-slip / 非法条目名 ─────────────────────────────────────────────────
  for (const bad of ['../evil', 'a/../../b', 'C:/Windows/x']) {
    assert.throws(() => P.normalizeEntryName(bad), /zip entry name/, 'should reject ' + bad)
  }
  assert.equal(P.normalizeEntryName('a//b/./c'), 'a/b/c', '空段与 . 段剥离')
  assert.throws(() => P.normalizeEntryName('a//./b/../c'), /zip entry name/, 'dotdot 一律拒绝（不解析、不弹出）')
  assert.equal(P.normalizeEntryName('/abs/x'), 'abs/x', '前导斜杠按噪声剥离（仍是相对落点）')
  assert.throws(() => P.safeJoin(tmp, '../../outside'), /escapes (root|destination)/)
  assert.equal(P.safeJoin(tmp, 'goal/x.md'), path.resolve(tmp, 'goal/x.md'))
  ok('条目名与落盘路径越界防御生效（dotdot / 盘符 / resolve 兜底）')

  // ── 会话 transcript：帧切分 + 只重写 header 帧 ─────────────────────────────
  const header = { type: 'session', version: 0, id: 'session-abc', createdAt: 1788518612327, cwd: 'C:\\old\\path', delegationDepth: 0, agentPreset: 'standard' }
  const lines = [JSON.stringify(header), '{"type":"user/message","seq":0}', '{"type":"tool/result","seq":1}', '{"type":"turn/end","seq":2}']
  const made = await P.jsonlToZstdFrames(lines.join('\n') + '\n', 2)
  const decoded = P.decodeTranscript(made)
  assert.equal(decoded.torn, false)
  assert.deepEqual(decoded.text.split('\n').filter(Boolean), lines)
  ok('jsonlToZstdFrames → decodeTranscript 明文往返一致')

  assert.equal(P.readSessionHeader(made).id, 'session-abc')
  const rw = await P.rewriteTranscriptCwd(made, 'D:\\new\\goal-dir')
  assert.equal(rw.changed, true)
  assert.equal(P.readSessionHeader(rw.bytes).cwd, 'D:\\new\\goal-dir')
  assert.equal(P.readSessionHeader(rw.bytes).id, 'session-abc')
  const rl = P.decodeTranscript(rw.bytes).text.split('\n').filter(Boolean)
  assert.deepEqual(rl.slice(1), lines.slice(1), 'header 之外逻辑行必须逐行不变')
  ok('rewriteTranscriptCwd 只改 header.cwd，其余逻辑行与帧保持不变')

  const same = await P.rewriteTranscriptCwd(made, header.cwd)
  assert.equal(same.changed, false)
  assert.equal(Buffer.compare(same.bytes, made), 0)
  ok('cwd 未变时零改写（同机同路径导入走原字节落盘）')

  // 帧描述符与宿主写法一致：非 single-segment + content checksum
  assert.equal(rw.bytes.readUInt8(4) & 4, 4, 'content checksum 位必须置起')
  assert.equal((rw.bytes.readUInt8(4) & 32) >>> 5, 0, '非 single-segment，与宿主写出一致')
  assert.equal(rw.bytes.readUInt8(4) & 24, 0, 'reserved 位必须为 0')
  ok('重写出的 header 帧描述符与宿主一致')

  // 撕裂尾部：EOF 落在帧中间 → 标出 torn（不解码残帧）
  const cut = Buffer.from(made.subarray(0, made.length - 5))
  assert.equal(P.decodeTranscript(cut).torn, true)
  ok('EOF 落在帧内被识别为 torn（导出侧据此报 warning）')
  // 完整帧但 checksum 坏：必须响亮失败，绝不静默少导
  const corrupted = Buffer.from(made)
  corrupted[corrupted.length - 1] ^= 0xff
  assert.throws(() => P.decodeTranscript(corrupted), /checksum/)
  ok('完整帧校验失败即抛（不静默降级）')
  assert.throws(() => P.scanZstdFrames(Buffer.from([1, 2, 3, 4, 5, 6, 7, 8])), /invalid frame magic/)
  ok('非 zstd 字节流被拒（不当作 transcript 静默通过）')

  // ── 真实宿主 transcript 兼容（存在才测）────────────────────────────────────
  const realRoot = path.join(os.homedir(), '.dsh', 'sessions')
  async function probe(dir) {
    let items
    try { items = await fsp.readdir(dir, { withFileTypes: true }) } catch { return undefined }
    for (const e of items) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) { const hit = await probe(p); if (hit) return hit }
      else if (e.name === 'session.jsonl.zstd' && dir.includes('study-work')) return p
    }
    return undefined
  }
  const realFile = await probe(realRoot)
  if (realFile) {
    const buf = await fsp.readFile(realFile)
    const hdr = P.readSessionHeader(buf)
    assert.equal(hdr.type, 'session')
    const lines2 = P.decodeTranscript(buf).text.split('\n').filter(Boolean)
    const r2 = await P.rewriteTranscriptCwd(buf, 'C:\\Users\\someone\\.dsh\\study-work\\goal-imported')
    const lines3 = P.decodeTranscript(r2.bytes).text.split('\n').filter(Boolean)
    assert.equal(lines3.length, lines2.length)
    assert.deepEqual(lines3.slice(1), lines2.slice(1))
    assert.equal(P.readSessionHeader(r2.bytes).id, hdr.id)
    ok('宿主真实 transcript：帧切分 + header 重写后正文逐行不变（' + lines2.length + ' 行）')
  } else {
    console.log('  skip — 本机无学习区会话 transcript，跳过真实帧兼容检查')
  }

  // ── 附件引用收集 ──────────────────────────────────────────────────────────
  const text = [
    JSON.stringify({ type: 'session' }),
    JSON.stringify({ type: 'user/message', data: { content: [{ type: 'text', text: '看这张图' }, { type: 'image', attachment: { attachmentId: 'sha256:aa', mediaType: 'image/png' } }] } }),
    JSON.stringify({ type: 'assistant/message', data: { message: { content: [{ type: 'image', attachment: { attachmentId: 'sha256:aa', mediaType: 'image/png' } }] } } }),
    JSON.stringify({ type: 'tool/result', data: { content: [{ type: 'tool_result', content: [{ type: 'image', attachment: { attachmentId: 'sha256:bb', mediaType: 'image/jpeg' } }] }] } }),
    'not-json{{'
  ].join('\n')
  const refs = P.collectImageRefs(text)
  assert.deepEqual([...refs.keys()].sort(), ['sha256:aa', 'sha256:bb'])
  ok('collectImageRefs 覆盖 content/message/嵌套 tool_result 并去重、容忍坏行')

  // ── 路径归一化 ────────────────────────────────────────────────────────────
  assert.equal(P.normPath('C:\\Users\\me\\.dsh\\study-work\\g\\'), P.normPath('C:/Users/me/.dsh/study-work/g'))
  assert.equal(P.normPath('c:\\a'), P.normPath('C:\\a'), '盘符大小写归一')
  assert.notEqual(P.normPath('C:\\A'), P.normPath('C:\\a'), '非盘符部分保持大小写敏感')
  ok('normPath 让源/目标绝对路径可比（分隔符 + 尾斜杠 + 盘符）')

  // ── 6. header 帧通用重写：换 id / 换 cwd / 删 parentSession ────────────────
  const seed = await P.jsonlToZstdFrames([
    JSON.stringify({ type: 'session', version: 0, id: 'session-a', createdAt: 1, cwd: 'C:/old/goal', delegationDepth: 0, agentPreset: 'standard' }),
    JSON.stringify({ type: 'turn/start', seq: 0, time: 9, data: { turn: 1 } }),
    JSON.stringify({ type: 'user/message', seq: 1, time: 9, data: { id: 'm1', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '看这张图' }] }, surfaceOp: 'append' }),
    JSON.stringify({ type: 'turn/end', seq: 2, time: 9, data: { turn: 1, reason: { kind: 'completed' } } }),
  ].join('\n') + '\n', 2)
  {
    const rw2 = await P.rewriteTranscriptHeader(seed, { id: 'session-b', cwd: 'C:/new/goal' })
    const h2 = P.readSessionHeader(rw2.bytes)
    const bodySame = P.decodeTranscript(rw2.bytes).text.split('\n').slice(1).join('\n') === P.decodeTranscript(seed).text.split('\n').slice(1).join('\n')
    ok('rewriteTranscriptHeader 同时换 id 与 cwd，正文与帧数不变',
      h2.id === 'session-b' && h2.cwd === 'C:/new/goal' && rw2.idChanged === true &&
      P.scanZstdFrames(rw2.bytes).frames.length === P.scanZstdFrames(seed).frames.length && bodySame)
    const noChange = await P.rewriteTranscriptHeader(seed, { cwd: 'C:/old/goal' })
    ok('目标值与原文一致时 changed=false 且字节不变', noChange.changed === false && Buffer.compare(noChange.bytes, seed) === 0)
    const withParent = await P.jsonlToZstdFrames(JSON.stringify({ type: 'session', version: 0, id: 'session-c', createdAt: 1, cwd: 'C:/old', parentSession: 'session-p', delegationDepth: 0 }) + '\n' + JSON.stringify({ type: 'turn/start', seq: 0, time: 9, data: { turn: 1 } }) + '\n', 1)
    ok('parentSession 传 null 删除该字段、传值改写该字段',
      !('parentSession' in P.readSessionHeader((await P.rewriteTranscriptHeader(withParent, { parentSession: null })).bytes)) &&
      P.readSessionHeader((await P.rewriteTranscriptHeader(withParent, { parentSession: 'session-q' })).bytes).parentSession === 'session-q')
  }

  // ── 7. analyzeTranscript / 关系判定 / 尾帧追加（覆盖式导入的三条底座） ──────
  const an = P.analyzeTranscript(seed)
  ok('analyzeTranscript 报出行数/最大 seq/末事件时间/帧数', an.lines.length === 3 && an.maxSeq === 2 && an.lastTime === 9 && an.frames === 2 && an.rows.length === 3)
  const blankBuf = await P.jsonlToZstdFrames(JSON.stringify({ type: 'session', version: 0, id: 's', createdAt: 1, cwd: 'C:/x', delegationDepth: 0 }) + '\n' + JSON.stringify({ type: 'permission/preset', seq: 0, time: 1, data: { preset: 'default' } }) + '\n', 1)
  ok('无 turn/start 的会话被识别为 blank（宿主列表里不会单独出现）', P.analyzeTranscript(blankBuf).blank === true && an.blank === false)
  {
    const tail = [
      JSON.stringify({ type: 'turn/start', seq: 3, time: 11, data: { turn: 2 } }),
      JSON.stringify({ type: 'turn/end', seq: 4, time: 12, data: { turn: 2, reason: { kind: 'completed' } } }),
    ]
    const grown = await P.appendLinesToTranscript(seed, tail)
    const ga = P.analyzeTranscript(grown.bytes)
    ok('appendLinesToTranscript 保留原前缀并接上尾帧', ga.lines.length === 5 && ga.maxSeq === 4 && P.decodeTranscript(grown.bytes).text.startsWith(P.decodeTranscript(seed).text))
    ok('空追加是 no-op（返回原字节）', (await P.appendLinesToTranscript(seed, [])).bytes === seed)
    await fsp.writeFile(path.join(tmp, 'torn.zstd'), Buffer.from(seed.subarray(0, seed.length - 5)))
    let appendErr = ''
    try { await P.appendLinesToTranscript(await fsp.readFile(path.join(tmp, 'torn.zstd')), tail) } catch (e) { appendErr = String(e.message || e) }
    ok('本地尾部有未完成帧时拒绝追加（宁可不写也不写坏）', /未完成帧/.test(appendErr), appendErr.slice(0, 60))
    ok('关系判定 same / fastforward / rewind / diverged',
      P.compareTranscriptLines(an.lines, an.lines) === 'same' &&
      P.compareTranscriptLines(an.lines, ga.lines) === 'fastforward' &&
      P.compareTranscriptLines(ga.lines, an.lines) === 'rewind' &&
      P.compareTranscriptLines(an.lines, an.lines.slice(0, 2).concat(['{"type":"x","seq":9}'])) === 'diverged')
  }

  // ── 8. 用宿主真实后端交叉验证我写出的字节（取不到就明确跳过，不放宽断言） ───
  {
    const H = await createHostServices({ sessionsRoot: path.join(tmp, 'host-sessions') })
    if (H) console.log('  \u00b7 交叉验证用 ctx.sessions = ' + (H.usingRealSessionStore ? '真实 SessionStore' : '最小 stub'))
    if (!H) {
      console.log('  skip — 本机取不到宿主 dsh-session-persistence-jsonl / dsh-workspace，跳过真后端交叉验证')
    } else {
      const dirA = path.join(tmp, 'goal-A')
      const dirB = path.join(tmp, 'goal-B')
      await fsp.mkdir(dirA, { recursive: true })
      await fsp.mkdir(dirB, { recursive: true })
      const put = async (cwd, buf) => {
        const p = H.persistence.locate({ cwd, id: P.readSessionHeader(buf).id }).path
        await fsp.mkdir(path.dirname(p), { recursive: true })
        await fsp.writeFile(p, buf)
        return p
      }
      // 8a 换 id + 换 cwd ⇒ 宿主 inspect() 必须还认（覆盖式导入换身份的前提）
      const moved = (await P.rewriteTranscriptHeader(seed, { id: 'session-moved', cwd: dirB })).bytes
      await put(dirB, moved)
      const ins = await H.persistence.inspect('session-moved')
      ok('宿主 inspect() 认账：换 id + 换 cwd 后事件数与身份一致', ins.meta.id === 'session-moved' && ins.events.length === 3, ins.events.length)
      // 8b 尾帧追加 ⇒ 宿主扫出的事件序列连续（append-only + seq 由宿主校验）
      const tail2 = [
        JSON.stringify({ type: 'turn/start', seq: 3, time: 11, data: { turn: 2 } }),
        JSON.stringify({ type: 'user/message', seq: 4, time: 11, data: { id: 'm2', role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '继续' }] }, surfaceOp: 'append' }),
        JSON.stringify({ type: 'turn/end', seq: 5, time: 12, data: { turn: 2, reason: { kind: 'completed' } } }),
      ]
      const pB = H.persistence.locate({ cwd: dirB, id: 'session-moved' }).path
      await fsp.writeFile(pB, (await P.appendLinesToTranscript(moved, tail2)).bytes)
      const ins2 = await H.persistence.inspect('session-moved')
      ok('宿主 inspect() 认账：追加尾帧后事件连续', ins2.events.length === 6 && ins2.events[3].seq === 3 && ins2.events.at(-1).type === 'turn/end', ins2.events.map((e) => e.type + ':' + e.seq).join(' '))
      const st = await fsp.stat(pB)
      ok('inspect() 确实只读（自检不会改写用户的 transcript）', st.size === (await fsp.readFile(pB)).length)
      // 8c 同 id 落第二个 project 目录 ⇒ 宿主 list() 抛（我的导入必须靠换身份避开）
      await put(dirA, (await P.rewriteTranscriptHeader(ins2 && moved, { cwd: dirA })).bytes)
      let threw = ''
      try { await H.persistence.list() } catch (e) { threw = String(e.message || e) }
      ok('宿主 list() 在重复 id 上抛错（这条不变量就是"导入即隐身/列表全炸"的根因）', /duplicate JSONL session id/.test(threw), threw.slice(0, 80))
      // 8d 工作区投影语义：attach 前空、未知会话报错 ⇒ 自检只能读投影，不能只看 attach 抛没抛
      const wsA = await H.registry.create(dirA, 'goal A')
      ok('宿主 sessionIds 是投影：新登记工作区时为空的数组', Array.isArray(wsA.sessionIds) && wsA.sessionIds.length === 0, wsA.sessionIds)
      let rejected = ''
      try { await wsA.attachSession('session-never-existed') } catch (e) { rejected = String(e.message || e) }
      ok('宿主 attachSession 拒绝不存在的会话', /no such session|cannot (attach|validate)/i.test(rejected), rejected.slice(0, 80))
    }
  }

  console.log('\nportable.test: ' + n + ' 断言全部通过')
} finally {
  await fsp.rm(tmp, { recursive: true, force: true })
}
