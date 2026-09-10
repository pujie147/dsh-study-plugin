// study-plugin — 可携化工具（lib/portable.js）测试
// 运行： node test/portable.test.mjs
// 只用临时目录，绝不写用户数据。若本机存在真实学习区会话 transcript，
// 额外拿它做一次「宿主写出的帧」兼容性检查（不存在则跳过）。
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import * as P from '../lib/portable.js'

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

  console.log('\nportable.test: ' + n + ' 断言全部通过')
} finally {
  await fsp.rm(tmp, { recursive: true, force: true })
}
