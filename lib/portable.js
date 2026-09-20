// ============================================================================
// study-plugin — lib/portable.js
// 目标可携化（导出/导入）用到的底层工具：ZIP 读写 + 会话 transcript zstd 帧处理。
// 只用 Node 内置模块（node:zlib / node:crypto / node:path），不引第三方依赖 ——
// 与插件既有的「纯 JS、零依赖、宿主平面受信」约定一致。
//
// ZIP：仅用 store(0) 与 deflate(8) 两种方法（Node 内置 zlib 即可读写），
//       文件名带 UTF-8 flag；条目名一律正斜杠、解包前做 zip-slip 防御。
// 会话 transcript：逐字节搬运 session.jsonl.zstd（最高保真）；仅在跨路径导入时
//       重写「第 1 帧 = header 行」，其余帧原样拼接（与宿主 scanZstdFrames 同一套规则）。
// ============================================================================
import * as zlib from 'node:zlib'
import { createHash } from 'node:crypto'
import { promisify } from 'node:util'
import path from 'node:path'

const ZSTD_MAGIC = 0xfd2fb528
// 与宿主 dsh-session-persistence-jsonl 一致：写出带 content checksum 的独立帧。
// 必须用异步 zstdCompress —— 同步 zstdCompressSync 会写成 single-segment 帧（描述符不同）。
const ZSTD_CHECKSUM_OPTIONS = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
const zstdCompressAsync = promisify(zlib.zstdCompress)

// ── 杂项 ────────────────────────────────────────────────────────────────────
export function sha256Hex(buf) {
  return createHash('sha256').update(buf).digest('hex')
}

export function utf8(s) {
  return Buffer.from(String(s), 'utf8')
}

// ── CRC32（ZIP 用；Node 24 的 zlib 提供 crc32，缺失时回落到查表实现）────────
let crc32Impl
if (typeof zlib.crc32 === 'function') {
  crc32Impl = (buf) => zlib.crc32(buf) >>> 0
} else {
  const TABLE = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    TABLE[n] = c >>> 0
  }
  crc32Impl = (buf) => {
    let c = 0xffffffff
    for (let i = 0; i < buf.length; i++) c = TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
    return (c ^ 0xffffffff) >>> 0
  }
}
export function crc32(buf) {
  return crc32Impl(buf)
}

// ── ZIP 写 ───────────────────────────────────────────────────────────────────
function dosDateTime(d) {
  const date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate()
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (Math.floor(d.getSeconds() / 2))
  return { date: date & 0xffff, time: time & 0xffff }
}

/**
 * 打包成 zip。entries: [{ name, data:Uint8Array, store?:boolean, mtime?:Date }]
 * store=true 的条目（已经是 zstd 的 transcript）不重复压缩。
 */
export function createZip(entries) {
  const locals = []
  const centrals = []
  let offset = 0
  for (const e of entries) {
    const name = normalizeEntryName(e.name)
    const data = Buffer.isBuffer(e.data) ? e.data : Buffer.from(e.data)
    const when = dosDateTime(e.mtime instanceof Date ? e.mtime : new Date())
    const useStore = e.store === true
    const comp = useStore ? data : zlib.deflateRawSync(data, { level: 6 })
    const method = useStore ? 0 : 8
    const crc = crc32(data)
    const nameBuf = utf8(name)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0)
    head.writeUInt16LE(useStore ? 10 : 20, 4)
    head.writeUInt16LE(0x0800, 6) // UTF-8 文件名
    head.writeUInt16LE(method, 8)
    head.writeUInt16LE(when.time, 10)
    head.writeUInt16LE(when.date, 12)
    head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(comp.length, 18)
    head.writeUInt32LE(data.length, 22)
    head.writeUInt16LE(nameBuf.length, 26)
    head.writeUInt16LE(0, 28)
    locals.push(head, nameBuf, comp)

    const cen = Buffer.alloc(46)
    cen.writeUInt32LE(0x02014b50, 0)
    cen.writeUInt16LE(20, 4)      // version made by (DOS, zip 2.0)
    cen.writeUInt16LE(useStore ? 10 : 20, 6)
    cen.writeUInt16LE(0x0800, 8)
    cen.writeUInt16LE(method, 10)
    cen.writeUInt16LE(when.time, 12)
    cen.writeUInt16LE(when.date, 14)
    cen.writeUInt32LE(crc, 16)
    cen.writeUInt32LE(comp.length, 20)
    cen.writeUInt32LE(data.length, 24)
    cen.writeUInt16LE(nameBuf.length, 28)
    cen.writeUInt16LE(0, 30)
    cen.writeUInt16LE(0, 32)
    cen.writeUInt16LE(0, 34)
    cen.writeUInt16LE(0, 36)
    cen.writeUInt32LE(0o644 << 16, 38)
    cen.writeUInt32LE(offset, 42)
    centrals.push({ cen, nameBuf })
    offset += head.length + nameBuf.length + comp.length
  }
  const cdStart = offset
  let cdSize = 0
  const parts = locals.slice()
  for (const c of centrals) {
    parts.push(c.cen, c.nameBuf)
    cdSize += c.cen.length + c.nameBuf.length
  }
  const eocd = Buffer.alloc(22)
  eocd.writeUInt32LE(0x06054b50, 0)
  eocd.writeUInt16LE(0, 4)
  eocd.writeUInt16LE(0, 6)
  eocd.writeUInt16LE(centrals.length, 8)
  eocd.writeUInt16LE(centrals.length, 10)
  eocd.writeUInt32LE(cdSize, 12)
  eocd.writeUInt32LE(cdStart, 16)
  eocd.writeUInt16LE(0, 20)
  parts.push(eocd)
  return Buffer.concat(parts)
}

/** 条目名：强制相对、正斜杠、无 . / .. 段。 */
export function normalizeEntryName(raw) {
  const s = String(raw).replace(/\\/g, '/').replace(/^\/+/, '')
  const out = []
  for (const seg of s.split('/')) {
    if (seg === '' || seg === '.') continue
    if (seg === '..') throw new Error('zip entry name escapes root: ' + raw)
    if (/^[A-Za-z]:/.test(seg)) throw new Error('zip entry name has drive prefix: ' + raw)
    out.push(seg)
  }
  if (!out.length) throw new Error('empty zip entry name')
  return out.join('/')
}

/** zip 条目名 → 安全相对路径（用于落盘；越界即抛）。 */
export function safeJoin(rootDir, entryName) {
  const rel = normalizeEntryName(entryName)
  const abs = path.resolve(rootDir, rel)
  const root = path.resolve(rootDir)
  if (abs !== root && !abs.startsWith(root + path.sep)) throw new Error('zip entry escapes destination: ' + entryName)
  return abs
}

// ── ZIP 读 ───────────────────────────────────────────────────────────────────
/**
 * 解析 zip（支持 store/deflate；条目名 → 未压缩字节）。CRC 不符即抛（宁可失败也不要半包）。
 */
export function readZip(buf) {
  if (!Buffer.isBuffer(buf)) buf = Buffer.from(buf)
  let eocd = -1
  const scanFrom = Math.max(0, buf.length - 66000)
  for (let i = buf.length - 22; i >= scanFrom; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break }
  }
  if (eocd < 0) throw new Error('不是有效的 zip（找不到中央目录结尾）')
  const count = buf.readUInt16LE(eocd + 10)
  let p = buf.readUInt32LE(eocd + 16)
  const entries = new Map()
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('zip 中央目录损坏 @' + p)
    const method = buf.readUInt16LE(p + 10)
    const crc = buf.readUInt32LE(p + 16)
    const compSize = buf.readUInt32LE(p + 20)
    const nameLen = buf.readUInt16LE(p + 28)
    const extraLen = buf.readUInt16LE(p + 30)
    const commentLen = buf.readUInt16LE(p + 32)
    const localOff = buf.readUInt32LE(p + 42)
    const name = normalizeEntryName(buf.toString('utf8', p + 46, p + 46 + nameLen))
    p += 46 + nameLen + extraLen + commentLen
    if (buf.readUInt32LE(localOff) !== 0x04034b50) throw new Error('zip 本地头损坏: ' + name)
    const lNameLen = buf.readUInt16LE(localOff + 26)
    const lExtraLen = buf.readUInt16LE(localOff + 28)
    const dataStart = localOff + 30 + lNameLen + lExtraLen
    const raw = buf.subarray(dataStart, dataStart + compSize)
    let data
    if (method === 0) data = Buffer.from(raw)
    else if (method === 8) data = Buffer.from(zlib.inflateRawSync(raw))
    else throw new Error('zip 条目不支持的压缩方法 ' + method + ': ' + name)
    if (crc32(data) !== (crc >>> 0)) throw new Error('zip 条目 CRC 校验失败: ' + name)
    entries.set(name, data)
  }
  return entries
}

export function readJsonEntry(entries, name) {
  const buf = entries.get(name)
  if (buf === undefined) return undefined
  return JSON.parse(buf.toString('utf8'))
}

// ── 会话 transcript（zstd 多帧） ────────────────────────────────────────────
/**
 * 复刻宿主 scanZstdFrames：按帧结构切分（不解压），返回帧区间与"最后一个不完整帧起点"。
 */
export function scanZstdFrames(buffer, maxFrames = Number.POSITIVE_INFINITY) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) >>> 0 !== ZSTD_MAGIC) throw new Error('corrupt Zstandard session log: invalid frame magic at byte ' + offset)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error('corrupt Zstandard session log: reserved frame-header bit at byte ' + (offset - 1))
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : (1 << contentSizeFlag)
    const remaining = (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    if (buffer.length - offset < remaining) return { frames, tornStart: start }
    offset += remaining
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error('corrupt Zstandard session log: reserved block type at byte ' + (offset - 3))
      const payloadBytes = blockType === 1 ? 1 : blockSize
      if (buffer.length - offset < payloadBytes) return { frames, tornStart: start }
      offset += payloadBytes
      if (lastBlock) break
    }
    if (checksum) {
      if (buffer.length - offset < 4) return { frames, tornStart: start }
      offset += 4
    }
    frames.push({ start, end: offset })
    if (frames.length === maxFrames) return { frames }
  }
  return { frames }
}

function decompressFrame(frameBuf) {
  return zlib.zstdDecompressSync(frameBuf).toString('utf8')
}

function compressFrame(text) {
  return zstdCompressAsync(utf8(text), ZSTD_CHECKSUM_OPTIONS)
}

/** 明文：整份 transcript 解压后拼接（逻辑 JSONL 文本）。 */
export function decodeTranscript(buf) {
  const { frames, tornStart } = scanZstdFrames(buf)
  if (tornStart !== undefined) {
    // 崩溃尾部：尽量恢复已完整帧，交由调用方记 warning
    return { text: frames.map((f) => decompressFrame(buf.subarray(f.start, f.end))).join(''), torn: true }
  }
  return { text: frames.map((f) => decompressFrame(buf.subarray(f.start, f.end))).join(''), torn: false }
}

/** 只解第 1 帧拿 header（元数据用，成本恒定）。 */
export function readSessionHeader(buf) {
  const { frames } = scanZstdFrames(buf, 1)
  if (!frames.length) throw new Error('transcript 无有效帧')
  const text = decompressFrame(buf.subarray(frames[0].start, frames[0].end))
  const line = text.split('\n').filter(Boolean)[0]
  if (!line) throw new Error('transcript 首帧无 header 行')
  const header = JSON.parse(line)
  if (header.type !== 'session') throw new Error('transcript 首行不是 session header')
  return header
}

/**
 * 重写 header 帧的身份字段（id / cwd / parentSession），其余帧逐字节保留。
 *
 * 为什么可以只改第 1 帧：宿主把 transcript 写成「独立 zstd 帧的拼接」，
 * 且第 1 帧只含 header 行（见 encodeMaterialization：headerFrame + eventFrame）。
 *
 * 注意：换 id 后**必须**按 `sessionPersistence.locate({cwd,id})` 反推的新路径落盘 ——
 * 宿主 assertStoredIdentity 会用 header 的 id+cwd 反推物理路径并校验一致性。
 *
 * @param {Buffer} buf 原 transcript 字节
 * @param {{id?:string, cwd?:string, parentSession?:string|null}} patch 要改的字段；null = 删除该字段
 * @returns {Promise<{bytes:Buffer, header:object, changed:boolean, idChanged:boolean}>}
 */
export async function rewriteTranscriptHeader(buf, patch) {
  const { frames, tornStart } = scanZstdFrames(buf)
  if (!frames.length) throw new Error('transcript 无有效帧')
  const header = readSessionHeader(buf)
  const next = { ...header }
  if (patch && patch.id !== undefined && patch.id !== null) next.id = String(patch.id)
  if (patch && patch.cwd !== undefined && patch.cwd !== null) next.cwd = String(patch.cwd)
  if (patch && patch.parentSession !== undefined) {
    if (patch.parentSession === null) delete next.parentSession
    else next.parentSession = String(patch.parentSession)
  }
  const changed = JSON.stringify(next) !== JSON.stringify(header)
  if (!changed) return { bytes: buf, header, changed: false, idChanged: false }
  const idChanged = String(header.id) !== String(next.id)
  const head = await compressFrame(JSON.stringify(next) + '\n')
  const tail = frames.slice(1).map((f) => buf.subarray(f.start, f.end))
  if (tornStart !== undefined) tail.push(buf.subarray(tornStart))
  return { bytes: Buffer.concat([head, ...tail]), header: next, changed: true, idChanged }
}

/** 只改 cwd 的旧入口（等价于 rewriteTranscriptHeader(buf, {cwd})），保留给既有调用与测试。 */
export async function rewriteTranscriptCwd(buf, newCwd) {
  const r = await rewriteTranscriptHeader(buf, { cwd: newCwd })
  return { bytes: r.bytes, header: r.header, changed: r.changed }
}

/**
 * 分析一份 transcript：给导入决策与包清单用的全部元数据。
 * 行的起始 seq：普通行 `{seq}`，打包行（text-chunks/reasoning-chunks/tool-call-chunks）`{seq0}`。
 * @returns {{header:object, lines:string[], rows:object[], frames:number, torn:boolean,
 *            logicalBytes:number, maxSeq:number|undefined, lastTime:number|undefined,
 *            hasTurnStart:boolean, blank:boolean, origin:string|undefined}}
 */
export function analyzeTranscript(buf) {
  const { frames, tornStart } = scanZstdFrames(buf)
  const { text, torn } = decodeTranscript(buf)
  const all = text.split('\n').filter(Boolean)
  if (!all.length) throw new Error('transcript 无内容行')
  const header = JSON.parse(all[0])
  const lines = all.slice(1)
  let maxSeq, lastTime, hasTurnStart = false
  const rows = []
  for (const line of lines) {
    let o
    try { o = JSON.parse(line) } catch { o = null }
    if (!o || typeof o !== 'object') { rows.push({ bad: true }); continue }
    const seq = typeof o.seq === 'number' ? o.seq : (typeof o.seq0 === 'number' ? o.seq0 : undefined)
    const time = typeof o.time === 'number' ? o.time : (typeof o.time0 === 'number' ? o.time0 : undefined)
    if (seq !== undefined && (maxSeq === undefined || seq > maxSeq)) maxSeq = seq
    if (time !== undefined && (lastTime === undefined || time > lastTime)) lastTime = time
    if (o.type === 'turn/start') hasTurnStart = true
    rows.push({ type: o.type, seq, time })
  }
  return {
    header, lines, rows, frames: frames.length,
    torn: torn || tornStart !== undefined,
    logicalBytes: Buffer.byteLength(text, 'utf8'),
    maxSeq, lastTime, hasTurnStart,
    blank: !hasTurnStart,
    origin: header.origin,
  }
}

/**
 * 两份日志的行级关系（**不含 header 行**，因为 header 的 cwd/id 本来就该不同）。
 * 宿主日志是 append-only 且导出是逐字节搬运 ⇒ 同一会话的两份快照在正常情况下必为前缀关系；
 * 只有真正分叉（各自写了不同事件）才会落到 diverged。
 * @returns {'same'|'fastforward'|'rewind'|'diverged'}
 *   fastforward = 本地是包的真前缀（可只追加尾帧）；rewind = 包比本地旧。
 */
export function compareTranscriptLines(localLines, pkgLines) {
  const a = localLines || [], b = pkgLines || []
  const n = Math.min(a.length, b.length)
  for (let i = 0; i < n; i++) if (a[i] !== b[i]) return 'diverged'
  if (a.length === b.length) return 'same'
  return a.length < b.length ? 'fastforward' : 'rewind'
}

/**
 * 只追加尾帧：把包多出来的行按宿主帧规则编成若干帧拼到本地文件末尾（append-only，
 * 不改一个已有字节 ⇒ 投影缓存的 seq 围栏天然继续有效，这是云同步的日常路径）。
 * @param {Buffer} localBuf 本地文件字节
 * @param {string[]} newLines 要追加的 JSONL 行（不含 header）
 * @param {number} [batchLines] 每帧行数（默认 256，避免单帧过大）
 */
export async function appendLinesToTranscript(localBuf, newLines, batchLines = 256) {
  if (!newLines || !newLines.length) return { bytes: localBuf, appended: 0 }
  const { tornStart } = scanZstdFrames(localBuf)
  if (tornStart !== undefined) throw new Error('本地 transcript 末尾有未完成帧，不能安全追加')
  const parts = [localBuf]
  for (let i = 0; i < newLines.length; i += batchLines) {
    parts.push(await compressFrame(newLines.slice(i, i + batchLines).join('\n') + '\n'))
  }
  return { bytes: Buffer.concat(parts), appended: newLines.length }
}

/** 明文 JSONL（compression:'none' 根）→ 按宿主帧规则重编为 zstd（header 帧 + 每批一行帧）。 */
export async function jsonlToZstdFrames(text, batchLines = 64) {
  const lines = String(text).split('\n').filter(Boolean)
  if (!lines.length) throw new Error('空 transcript')
  const parts = [await compressFrame(lines[0] + '\n')]
  for (let i = 1; i < lines.length; i += batchLines) {
    parts.push(await compressFrame(lines.slice(i, i + batchLines).join('\n') + '\n'))
  }
  return Buffer.concat(parts)
}

/** 从 transcript 明文里收集 image 附件引用（与宿主 collectEventImageRefs 同一套载体）。 */
export function collectImageRefs(text) {
  const refs = new Map()
  const walk = (content) => {
    if (!Array.isArray(content)) return
    const stack = content.slice()
    while (stack.length) {
      const v = stack.pop()
      if (v === null || typeof v !== 'object' || Array.isArray(v)) continue
      if (v.type === 'image' && v.attachment && typeof v.attachment === 'object') {
        const r = v.attachment
        if (typeof r.attachmentId === 'string') refs.set(r.attachmentId, r)
      }
      if (Array.isArray(v.content)) stack.push(...v.content)
    }
  }
  for (const line of String(text).split('\n')) {
    if (!line) continue
    let ev
    try { ev = JSON.parse(line) } catch { continue }
    const d = ev && ev.data
    if (!d || typeof d !== 'object') continue
    if (Array.isArray(d.content)) walk(d.content)
    if (d.message) walk(d.message.content)
    if (Array.isArray(d.inserted)) for (const m of d.inserted) walk(m.content)
    if (d.chunk && d.chunk.type === 'block-end' && d.chunk.block) walk([d.chunk.block])
  }
  return refs
}

/** 源机绝对路径 → 归一化比较用（正斜杠、去尾斜杠、小写盘符）。 */
export function normPath(p) {
  let s = String(p || '').replace(/\\/g, '/').replace(/\/+$/, '')
  if (/^[A-Za-z]:/.test(s)) s = s.charAt(0).toLowerCase() + s.slice(1)
  return s
}

/**
 * 教学偏好行级并集：本机行全保留，包内本机没有的行追加。
 * 偏好是用户资产（一行一条习惯），同步语义 = 只增不丢；无新增时返回 null（调用方不落盘）。
 */
export function mergePrefLines(localText, pkgText) {
  const lines = (s) => String(s || '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean)
  const local = lines(localText)
  const seen = new Set(local)
  const extra = lines(pkgText).filter((l) => !seen.has(l))
  if (!extra.length) return null
  const head = local.length ? local.join('\n') : '# 教学偏好'
  return head + '\n' + extra.join('\n') + '\n'
}
