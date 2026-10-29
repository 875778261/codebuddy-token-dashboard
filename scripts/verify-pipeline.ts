/**
 * 浏览器管线（与 src/core 完全同一份代码）在 Node 中跑真实数据，
 * 与 Python 独立实现逐字段比对。任何差异都是解析 bug，而不是"数据不一致"。
 *
 *   npm run verify
 */
import { readFile, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { buildDataset } from '../src/core/parse'
import { aggregate, makeWindow } from '../src/core/aggregate'
import { defaultPaths, readLocalData } from './local-files'

const PY_OUT = path.resolve('.tmp-py-out.json')
const { root: DATA_ROOT, dbPath: SESSIONS_DB } = defaultPaths()

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

function stable(v: unknown): string {
  return JSON.stringify(v, (_k, val) => {
    if (val && typeof val === 'object' && !Array.isArray(val)) {
      return Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([x], [y]) => x.localeCompare(y)))
    }
    return val
  })
}

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = stable(actual)
  const e = stable(expected)
  if (a !== e) fail(`${label} 不一致\n  TS : ${a}\n  PY : ${e}`)
  console.log(`  ✓ ${label} = ${a.length > 90 ? a.slice(0, 90) + '…' : a}`)
}

async function main() {
  console.log('读取真实数据：', DATA_ROOT)
  if (!existsSync(DATA_ROOT)) fail(`数据根不存在：${DATA_ROOT}`)

  const read = await readLocalData(DATA_ROOT, SESSIONS_DB)
  const dataset = buildDataset({
    files: read.files,
    sessionMeta: read.sessionMeta,
    sources: {
      historyRoots: read.roots,
      sessionsDb: read.dbPath ? path.basename(read.dbPath) : undefined,
      scannedAt: new Date().toISOString(),
    },
    elapsedMs: read.elapsedMs,
  })

  const agg = aggregate(dataset, makeWindow('all', dataset.coverage.first))
  const tsSummary = {
    sessionCount: dataset.sessions.length,
    requestsTotal: dataset.selfCheck.requestsTotal,
    requestsWithUsage: dataset.selfCheck.requestsWithUsage,
    inFlightSkipped: dataset.selfCheck.inFlightSkipped,
    total: agg.totals.total,
    input: agg.totals.input,
    output: agg.totals.output,
    cache: agg.totals.cache,
    cacheMiss: agg.totals.cacheMiss,
    credit: Math.round(agg.totals.credit * 100) / 100,
    identityInput: dataset.selfCheck.inputEqCachePlusMiss,
    identityTotal: dataset.selfCheck.totalEqInputPlusOutput,
    parseErrors: dataset.selfCheck.parseErrors,
    sessionsWithoutCwd: dataset.selfCheck.sessionsWithoutCwd,
    sessionsWithoutModel: dataset.selfCheck.sessionsUnknownModel,
    typeCounts: dataset.sessions
      .flatMap((s) => s.requests)
      .reduce<Record<string, number>>((acc, r) => {
        acc[r.type] = (acc[r.type] ?? 0) + 1
        return acc
      }, {}),
  }

  console.log('\n[TS 管线汇总]')
  for (const [k, v] of Object.entries(tsSummary)) console.log(`  ${k}: ${JSON.stringify(v)}`)

  if (!existsSync(PY_OUT)) {
    console.log('\n（未找到 Python 基准 .tmp-py-out.json，跳过比对；先运行 python scripts/ground-truth.py）')
    return
  }

  const py = JSON.parse(await readFile(PY_OUT, 'utf8'))
  console.log('\n[对照 Python 独立实现]')
  for (const key of Object.keys(py.summary)) {
    assertEq(key, tsSummary[key as keyof typeof tsSummary], py.summary[key])
  }

  // 逐日、逐会话再对一遍，防止"总数对但明细错"
  const tsDaily: Record<string, { total: number; requests: number; credit: number }> = {}
  for (const d of agg.days) {
    if (!d.requests) continue
    tsDaily[d.key] = { total: d.total, requests: d.requests, credit: Math.round(d.credit * 100) / 100 }
  }
  const pyDaily = Object.fromEntries(
    Object.entries(py.daily).map(([k, v]) => {
      const o = v as { total: number; requests: number; credit: number }
      return [k, { total: o.total, requests: o.requests, credit: Math.round(o.credit * 100) / 100 }]
    }),
  )
  assertEq('daily 天数', Object.keys(tsDaily).length, Object.keys(pyDaily).length)
  for (const key of Object.keys(tsDaily)) {
    assertEq(`daily[${key}]`, tsDaily[key], pyDaily[key])
  }

  const tsBySession = Object.fromEntries(
    dataset.sessions.map((s) => [
      s.id,
      { total: s.totals.total, requests: s.requests.length, credit: Math.round(s.totals.credit * 100) / 100 },
    ]),
  )
  assertEq('会话数（明细）', Object.keys(tsBySession).length, py.sessions.length)
  for (const s of py.sessions as Array<{ id: string; total: number; requestCount: number; credit: number }>) {
    assertEq(`session[${s.id.slice(0, 8)}]`, tsBySession[s.id], {
      total: s.total,
      requests: Number(s.requestCount),
      credit: Math.round(s.credit * 100) / 100,
    })
  }

  // 快照往返：导出再导入必须等价
  const { serializeDataset, parseSnapshot } = await import('../src/core/snapshot')
  const roundTrip = parseSnapshot(serializeDataset(dataset))
  assertEq('快照往返 sessions', roundTrip.sessions.length, dataset.sessions.length)
  assertEq(
    '快照往返 tokens',
    roundTrip.sessions.reduce((a, s) => a + s.totals.total, 0),
    dataset.sessions.reduce((a, s) => a + s.totals.total, 0),
  )

  await writeFile('.tmp-ts-out.json', JSON.stringify({ summary: tsSummary }, null, 1), 'utf8')
  console.log('\n全量比对通过：TS 管线与 Python 真值完全一致。')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
