// transcript-sweep.mjs — 用本机真实 DSH 会话日志全量校验帧处理层
// 运行: node test/transcript-sweep.mjs        （无 ~/.dsh/sessions 时自动跳过，返回 0）
// 断言: 每个 transcript 都能 (1) 结构切帧 (2) 读出 header (3) 重写 cwd 后除 header 外逐行不变、
//       帧数不变、尾帧逐字节相同 —— 这是导出/导入最脆弱的一层，光靠合成数据不够。
import assert from 'node:assert/strict'
import fsp from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import * as P from '../lib/portable.js'

const root = path.join(os.homedir(), '.dsh', 'sessions')
const exists = await fsp.stat(root).then((s) => s.isDirectory()).catch(() => false)
if (!exists) {
  console.log('transcript-sweep: 本机无 ' + root + '，跳过（此测试只在有 DSH 数据的机器上有意义）')
  process.exit(0)
}

const files = []
async function walk(dir) {
  for (const e of await fsp.readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) await walk(p)
    else if (e.name === 'session.jsonl.zstd' || e.name === 'session.jsonl') files.push(p)
  }
}
await walk(root)

let checked = 0
let rewritten = 0
let torn = 0
let plain = 0
let bytes = 0
const problems = []
for (const f of files) {
  const buf = await fsp.readFile(f)
  bytes += buf.length
  if (f.endsWith('.jsonl')) { plain++; continue }
  let lines
  try {
    const d = P.decodeTranscript(buf)
    if (d.torn) torn++
    lines = d.text.split('\n').filter(Boolean)
    P.readSessionHeader(buf)
  } catch (e) {
    problems.push(path.relative(root, f) + ': ' + e.message)
    continue
  }
  if (lines.length) {
    const hdr = JSON.parse(lines[0])
    assert.equal(hdr.type, 'session', '首行必须是 session header: ' + f)
    assert.ok(typeof hdr.id === 'string' && hdr.id.length > 0, 'header.id 缺失: ' + f)
  }
  const before = P.scanZstdFrames(buf)
  const rw = await P.rewriteTranscriptCwd(buf, 'C:\\sweep\\target\\goal-x')
  const after = P.scanZstdFrames(rw.bytes)
  assert.equal(after.frames.length, before.frames.length, '帧数必须不变: ' + f)
  assert.equal(after.tornStart, before.tornStart, '撕裂标记必须一致: ' + f)
  const l2 = P.decodeTranscript(rw.bytes).text.split('\n').filter(Boolean)
  assert.equal(l2.length, lines.length, '逻辑行数必须不变: ' + f)
  assert.deepEqual(l2.slice(1), lines.slice(1), 'header 之外必须逐行不变: ' + f)
  assert.equal(P.readSessionHeader(rw.bytes).cwd, 'C:\\sweep\\target\\goal-x', 'cwd 必须被改写: ' + f)
  assert.equal(P.readSessionHeader(rw.bytes).id, JSON.parse(lines[0]).id, 'id 必须保持: ' + f)
  checked++
  if (rw.changed) rewritten++
}

console.log('transcript-sweep: 本机 transcript ' + files.length + ' 个 / ' + (bytes / 1048576).toFixed(1) + ' MB')
console.log('  帧路径校验通过 ' + checked + ' 个（其中 ' + rewritten + ' 个发生了 header 重写）')
if (plain) console.log('  明文 jsonl 跳过 ' + plain + ' 个（该根用 compression:none，导入时由 jsonlToZstdFrames 转换）')
if (torn) console.log('  ⚠ 含未完成尾帧（崩溃残留）' + torn + ' 个 —— 导出会照抄完整帧并在 manifest 记 warning')
if (problems.length) {
  console.error('  ✗ 无法处理的 transcript ' + problems.length + ' 个:')
  for (const p of problems.slice(0, 10)) console.error('    - ' + p)
  process.exit(1)
}
console.log('  ✓ 全部通过')
