/**
 * 兜底采集：浏览器选不了 AppData 时，用 Node 直接读文件并产出快照 JSON，
 * 再在页面上「导入快照 JSON」（或直接把 json 拖进窗口）即可。
 *
 *   npm run collect            # 输出到当前目录
 *   npm run collect -- out.json
 */
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { buildDataset } from '../src/core/parse'
import { serializeDataset, snapshotFileName } from '../src/core/snapshot'
import { fmtCredit, fmtInt, fmtTokens } from '../src/core/format'
import { defaultPaths, readLocalData } from './local-files'

const outArg = process.argv[2]
const out = path.resolve(outArg ?? snapshotFileName())
const { root, dbPath } = defaultPaths()

console.log(`数据目录：${root}`)
const read = await readLocalData(root, dbPath)
if (!read.files.length) {
  console.error('没有找到任何 history/**/index.json，确认路径是否正确（可用 CB_DATA 环境变量覆盖）。')
  process.exit(1)
}
console.log(`会话库：${read.dbPath ?? '未找到（标题与项目路径将缺失）'}`)

const ds = buildDataset({
  files: read.files,
  sessionMeta: read.sessionMeta,
  sources: {
    historyRoots: read.roots,
    sessionsDb: read.dbPath ? path.basename(read.dbPath) : undefined,
    scannedAt: new Date().toISOString(),
  },
  elapsedMs: read.elapsedMs,
})

await writeFile(out, serializeDataset(ds), 'utf8')

const total = ds.sessions.reduce((a, s) => a + s.totals.total, 0)
const credit = ds.sessions.reduce((a, s) => a + s.totals.credit, 0)
console.log('')
console.log(`会话 ${fmtInt(ds.sessions.length)} · 请求 ${fmtInt(ds.selfCheck.requestsWithUsage)} · Token ${fmtTokens(total)} · 积分 ${fmtCredit(credit)}`)
console.log(`自检：恒等式 ${ds.selfCheck.inputEqCachePlusMiss.fail + ds.selfCheck.totalEqInputPlusOutput.fail === 0 ? '通过' : '有反例'} · 在途跳过 ${ds.selfCheck.inFlightSkipped} · 解析错误 ${ds.selfCheck.parseErrors}`)
console.log(`快照已写入：${out}`)
console.log('下一步：在页面点「导入快照 JSON」，或把这个文件拖进窗口。')
