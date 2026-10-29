/**
 * 极简只读 SQLite 解析器。
 *
 * 为什么不用 sql.js：`codebuddy-sessions.vscdb` 只有一张 `ItemTable(key TEXT, value)`，
 * 为了一个键值表引入 1.5MB WASM 不划算，也让单文件离线产物变脆。
 * 这里只实现「表 b-tree 遍历 + 记录解码 + overflow 页」，足以覆盖 VS Code 家族的
 * state/sessions 库；不支持的形态（索引页、虚拟表、加密库）会显式抛错而不是静默截断。
 */

const utf8 = new TextDecoder('utf-8')

export type SqliteValue = string | number | null | Uint8Array

function readVarint(buf: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0
  let shift = 0
  let p = pos
  for (let i = 0; i < 9; i++) {
    const byte = buf[p++]
    if (byte === undefined) throw new Error('varint 越界')
    if (i === 8) {
      value = value * 256 + byte
      break
    }
    value = value * 128 + (byte & 0x7f)
    if ((byte & 0x80) === 0) break
    shift += 7
    if (shift > 63) throw new Error('varint 过长')
  }
  return { value, next: p }
}

function readInt(buf: Uint8Array, pos: number, size: number): number {
  switch (size) {
    case 0:
      return 0
    case 1:
      return (buf[pos] << 24) >> 24
    case 2:
      return (((buf[pos] << 8) | buf[pos + 1]) << 16) >> 16
    case 3:
      return (((buf[pos] << 16) | (buf[pos + 1] << 8) | buf[pos + 2]) << 8) >> 8
    case 4:
      return (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]
    case 6: {
      const hi = (buf[pos] << 24) | (buf[pos + 1] << 16) | (buf[pos + 2] << 8) | buf[pos + 3]
      const lo = (buf[pos + 4] << 8) | buf[pos + 5]
      return hi * 65536 + lo
    }
    case 8: {
      const view = new DataView(buf.buffer, buf.byteOffset + pos, 8)
      return Number(view.getBigInt64(0))
    }
    default:
      throw new Error(`未知整数宽度 ${size}`)
  }
}

function parseRecord(payload: Uint8Array): SqliteValue[] {
  const header = readVarint(payload, 0)
  const headerSize = header.value
  let pos = header.next
  const types: number[] = []
  while (pos < headerSize) {
    const t = readVarint(payload, pos)
    types.push(t.value)
    pos = t.next
  }
  let body = headerSize
  const values: SqliteValue[] = []
  for (const t of types) {
    if (t === 0) {
      values.push(null)
    } else if (t >= 1 && t <= 6) {
      values.push(readInt(payload, body, t))
      body += t
    } else if (t === 7) {
      const view = new DataView(payload.buffer, payload.byteOffset + body, 8)
      values.push(view.getFloat64(0))
      body += 8
    } else if (t === 8) {
      values.push(0)
    } else if (t === 9) {
      values.push(1)
    } else if (t >= 12) {
      const len = t % 2 === 0 ? (t - 12) / 2 : (t - 13) / 2
      const slice = payload.subarray(body, body + len)
      values.push(t % 2 === 0 ? slice : utf8.decode(slice))
      body += len
    } else {
      throw new Error(`保留的 serial type ${t}`)
    }
  }
  return values
}

export class SqliteReader {
  private readonly bytes: Uint8Array
  private readonly pageSize: number
  private readonly usable: number
  private readonly pageCount: number

  constructor(bytes: Uint8Array) {
    const magic = utf8.decode(bytes.subarray(0, 15))
    if (magic !== 'SQLite format 3') throw new Error('不是有效的 SQLite 文件')
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    const rawPageSize = view.getUint16(16)
    this.pageSize = rawPageSize === 1 ? 65536 : rawPageSize
    const reserved = bytes[20]
    this.usable = this.pageSize - reserved
    this.pageCount = Math.floor(bytes.byteLength / this.pageSize)
    this.bytes = bytes
  }

  get pages() {
    return this.pageCount
  }

  private pageStart(pageNo: number): number {
    return (pageNo - 1) * this.pageSize
  }

  private readPayload(cellStart: number): Uint8Array {
    const size = readVarint(this.bytes, cellStart)
    const payloadSize = size.value
    let cursor = size.next
    cursor = readVarint(this.bytes, cursor).next // rowid

    const maxLocal = this.usable - 35
    if (payloadSize <= maxLocal) {
      return this.bytes.subarray(cursor, cursor + payloadSize)
    }
    const out = new Uint8Array(payloadSize)
    out.set(this.bytes.subarray(cursor, cursor + maxLocal), 0)
    let filled = maxLocal
    const overflowPos = cursor + maxLocal
    let next = new DataView(
      this.bytes.buffer,
      this.bytes.byteOffset + overflowPos,
      4,
    ).getUint32(0)
    let guard = 0
    while (next > 0 && filled < payloadSize) {
      if (++guard > 10000) throw new Error('overflow 链异常')
      const start = this.pageStart(next)
      next = new DataView(this.bytes.buffer, this.bytes.byteOffset + start, 4).getUint32(0)
      const chunk = Math.min(this.usable - 4, payloadSize - filled)
      out.set(this.bytes.subarray(start + 4, start + 4 + chunk), filled)
      filled += chunk
    }
    return out
  }

  private walk(pageNo: number, out: SqliteValue[][]): void {
    const start = this.pageStart(pageNo)
    const headerOffset = start + (pageNo === 1 ? 100 : 0)
    const type = this.bytes[headerOffset]
    const cellCount = (this.bytes[headerOffset + 3] << 8) | this.bytes[headerOffset + 4]
    const view = new DataView(this.bytes.buffer, this.bytes.byteOffset, this.bytes.byteLength)

    if (type === 0x05) {
      // interior table page
      for (let i = 0; i < cellCount; i++) {
        const ptrPos = headerOffset + 12 + i * 2
        const cell = start + ((this.bytes[ptrPos] << 8) | this.bytes[ptrPos + 1])
        this.walk(view.getUint32(cell), out)
      }
      const rightMost = view.getUint32(headerOffset + 8)
      if (rightMost > 0) this.walk(rightMost, out)
      return
    }
    if (type === 0x0d) {
      // leaf table page
      for (let i = 0; i < cellCount; i++) {
        const ptrPos = headerOffset + 8 + i * 2
        const cell = start + ((this.bytes[ptrPos] << 8) | this.bytes[ptrPos + 1])
        out.push(parseRecord(this.readPayload(cell)))
      }
      return
    }
    throw new Error(`不支持的 b-tree 页类型 0x${type.toString(16)}`)
  }

  /** 读取整张表（不做索引优化，VS Code 的 vscdb 规模足够） */
  readTable(name: string): SqliteValue[][] {
    const master: SqliteValue[][] = []
    this.walk(1, master)
    const table = master.find((r) => r[0] === 'table' && r[1] === name)
    if (!table) throw new Error(`库中不存在表 ${name}`)
    const rootPage = Number(table[3])
    if (!rootPage) throw new Error(`表 ${name} 没有根页`)
    const rows: SqliteValue[][] = []
    this.walk(rootPage, rows)
    return rows
  }
}

/** 读取 kv 表，返回 [key, textValue] */
export function readKeyValueTable(bytes: Uint8Array, table = 'ItemTable'): Array<[string, string]> {
  const reader = new SqliteReader(bytes)
  const rows = reader.readTable(table)
  const out: Array<[string, string]> = []
  for (const row of rows) {
    const key = row[0]
    const value = row[1]
    if (typeof key !== 'string' || value == null) continue
    if (typeof value === 'string') out.push([key, value])
    else if (value instanceof Uint8Array) out.push([key, utf8.decode(value)])
    else out.push([key, String(value)])
  }
  return out
}
