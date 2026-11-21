/**
 * 兜底采集：浏览器选不了 AppData 时，用 Node 直接读文件并产出快照 JSON，
 * 再在页面上「导入快照 JSON」（或直接把 json 拖进窗口）即可。
 *
 *   npm run collect            # 输出到当前目录
 *   npm run collect -- out.json
 */
import path from 'node:path'
import { writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import type { Dataset, SourceId } from '../src/core/types'
import { buildDataset } from '../src/core/parse'
import { parseCli } from '../src/core/cliParse'
import { mergeSlices } from '../src/core/merge'
import { serializeDataset, snapshotFileName } from '../src/core/snapshot'
import { fmtCredit, fmtInt, fmtTokens } from '../src/core/format'
import { defaultCliRoot, defaultPaths, readCliData, readLocalData } from './local-files'

const outArg = process.argv[2]

const { root, dbPath } = defaultPaths()
const cliRoot = defaultCliRoot()
const slices: Dataset[] = []
const scannedAt = new Date().toISOString()

// ---- CodeBuddy IDE ----
if (existsSync(root)) {
  console.log(`CodeBuddy 数据目录：${root}`)
  const read = await readLocalData(root, dbPath)
  if (read.files.length) {
    console.log(`会话库：${read.dbPath ?? '未找到（标题与项目路径将缺失）'}`)
    slices.push(
      buildDataset({
        files: read.files,
        sessionMeta: read.sessionMeta,
        sources: {
          historyRoots: read.roots,
          sessionsDb: read.dbPath ? path.basename(read.dbPath) : undefined,
          scannedAt,
        },
        elapsedMs: read.elapsedMs,
      }),
    )
  } else {
    console.warn('没有找到任何 history/**/index.json，跳过 CodeBuddy IDE。')
  }
} else {
  console.warn(`CodeBuddy 数据根不存在，跳过：${root}`)
}

// ---- CodeBuddy CLI ----
if (existsSync(cliRoot)) {
  console.log(`CodeBuddy CLI 数据目录：${cliRoot}`)
  const read = await readCliData(cliRoot)
  console.log(`CLI 日志：${fmtInt(read.logs.length)} 个文件（日志按天轮转，早于保留窗口的部分读不到）`)
  if (read.logs.length) {
    slices.push(
      await parseCli(read.logs, read.traces, {
        sources: { historyRoots: read.roots, scannedAt },
        elapsedMs: read.elapsedMs,
      }),
    )
  }
} else {
  console.warn(`CodeBuddy CLI 数据根不存在，跳过：${cliRoot}`)
}

if (!slices.length) {
  console.error('没有找到任何可读的用量数据。可用 CB_DATA / CB_CLI_HOME 环境变量指定目录。')
  process.exit(1)
}

const ds = mergeSlices(slices)
const out = path.resolve(outArg ?? snapshotFileName(new Date(), Object.keys(ds.bySource) as SourceId[]))
await writeFile(out, serializeDataset(ds), 'utf8')

const total = ds.sessions.reduce((a, s) => a + s.totals.total, 0)
const credit = ds.sessions.reduce((a, s) => a + s.totals.credit, 0)
console.log('')
console.log(`会话 ${fmtInt(ds.sessions.length)} · 请求 ${fmtInt(ds.selfCheck.requestsWithUsage)} · Token ${fmtTokens(total)} · 积分 ${fmtCredit(credit)}`)
for (const [source, summary] of Object.entries(ds.bySource)) {
  const sc = summary!.selfCheck
  console.log(
    `  ${source}: 请求 ${fmtInt(sc.requestsWithUsage)} · 归档 ${fmtInt(sc.archiveRequests)} · 解析错误 ${fmtInt(sc.parseErrors)}`,
  )
}
console.log(`自检：恒等式 ${ds.selfCheck.inputEqCachePlusMiss.fail + ds.selfCheck.totalEqInputPlusOutput.fail === 0 ? '通过' : '有反例'} · 在途跳过 ${ds.selfCheck.inFlightSkipped} · 积分配不上 ${ds.selfCheck.creditUnpaired}`)
console.log(`快照已写入：${out}`)
console.log('下一步：在页面点「导入快照 JSON」，或把这个文件拖进窗口。')
