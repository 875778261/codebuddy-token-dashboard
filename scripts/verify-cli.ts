/**
 * CodeBuddy CLI 的真值对拍：浏览器管线（与 src/core 同一份代码）vs 独立 Python 实现。
 * 任何字段不一致都判定为解析 bug，而不是"数据不一致"。
 *
 *   npm run verify:cli
 */
import { execFileSync } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import path from 'node:path'
import { parseCli } from '../src/core/cliParse'
import { aggregate, makeWindow } from '../src/core/aggregate'
import { defaultCliRoot, readCliData } from './local-files'

const PY = path.resolve('scripts/cli-truth.py')
const PY_OUT = path.resolve('.tmp-cli-py.json')

function fail(msg: string): never {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

function assertEq(label: string, actual: unknown, expected: unknown) {
  const a = JSON.stringify(actual)
  const e = JSON.stringify(expected)
  if (a !== e) fail(`${label} 不一致\n  TS : ${a}\n  PY : ${e}`)
  console.log(`  ✓ ${label} = ${a.length > 90 ? a.slice(0, 90) + '…' : a}`)
}

async function main() {
  const root = defaultCliRoot()
  console.log('读取 CLI 日志：', root)
  if (!existsSync(root)) fail(`CLI 数据根不存在：${root}`)

  const read = await readCliData(root)
  const ds = await parseCli(read.logs, read.traces, {
    sources: { historyRoots: read.roots, scannedAt: new Date().toISOString() },
    elapsedMs: read.elapsedMs,
  })

  execFileSync('python', [PY], { stdio: 'inherit' })
  const py = JSON.parse(await readFile(PY_OUT, 'utf8')) as Record<string, unknown>

  const agg = aggregate(ds, makeWindow('all', ds.coverage.first))
  const perSession = Object.fromEntries(
    [...ds.sessions]
      .sort((a, b) => String(a.rawId).localeCompare(String(b.rawId)))
      .map((s) => [s.rawId, { requests: s.totals.requests, total: s.totals.total, input: s.totals.input, output: s.totals.output, cache: s.totals.cache, credit: Number(s.totals.credit.toFixed(6)) }]),
  )
  const perDay = Object.fromEntries(agg.days.filter((d) => d.total > 0).map((d) => [d.key, d.total]))

  console.log('\n逐字段比对：')
  assertEq('日志文件数', read.logs.length, py.logFiles)
  assertEq('请求数', ds.selfCheck.requestsWithUsage, py.requests)
  assertEq('会话数', ds.sessions.length, py.sessions)
  assertEq('Token 合计', agg.totals.total, py.total)
  assertEq('输入', agg.totals.input, py.input)
  assertEq('输出', agg.totals.output, py.output)
  assertEq('缓存命中', agg.totals.cache, py.cache)
  assertEq('已知积分', Number(agg.totals.credit.toFixed(6)), py.credit)
  assertEq('有积分的请求数', agg.totals.creditKnownRequests, py.creditKnown)
  assertEq('没有积分字段', ds.selfCheck.requestsWithoutCredit, py.withoutCredit)
  assertEq('积分配不上', ds.selfCheck.creditUnpaired, py.creditUnpaired)
  assertEq('重复记录', ds.selfCheck.duplicateRequests, py.duplicates)
  assertEq('解析错误', ds.selfCheck.parseErrors, py.parseErrors)
  assertEq('逐日', perDay, py.perDay)
  assertEq('逐会话', perSession, py.perSession)

  const identityFail = ds.selfCheck.totalEqInputPlusOutput.fail + ds.selfCheck.inputEqCachePlusMiss.fail
  if (identityFail > 0) fail(`恒等式有 ${identityFail} 条对不上`)

  console.log('\n✓ CLI 管线与独立实现完全一致')
}

void main()
