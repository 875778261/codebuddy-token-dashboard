import type { Dataset } from '../core/types'
import type { Aggregates } from '../core/aggregate'
import { dayList, fmtDateTime, fmtInt, fmtPct } from '../core/format'
import { CoverageStrip } from './widgets'

function Check({ label, value, sub, bad, warn }: { label: string; value: string; sub?: string; bad?: boolean; warn?: boolean }) {
  return (
    <div className={`check${bad ? ' bad' : ''}`}>
      <div className="k">
        <span className={`dot${bad ? ' bad' : warn ? ' warn' : ''}`} />
        {label}
      </div>
      <div className="v">
        {value}
        {sub ? <small>{sub}</small> : null}
      </div>
    </div>
  )
}

export function HealthCard({ dataset, agg, onExport }: { dataset: Dataset; agg: Aggregates; onExport: () => void }) {
  const sc = dataset.selfCheck
  const cov = dataset.coverage
  const days = cov.first && cov.last ? dayList(new Date(`${cov.first}T00:00:00`).getTime(), new Date(`${cov.last}T00:00:00`).getTime()) : []
  const missing = new Set(cov.missingDays)
  const identityOk = sc.inputEqCachePlusMiss.fail === 0 && sc.totalEqInputPlusOutput.fail === 0
  const coveragePct = days.length ? (days.length - missing.size) / days.length : 0

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>数据体检</h3>
          <div className="sub">解析自检 + 覆盖缺口，缺什么就说缺什么</div>
        </div>
        <div className="tools">
          <button type="button" className="btn ghost" onClick={onExport}>
            导出快照
          </button>
        </div>
      </div>

      {/* 宽卡两栏：左=自检与覆盖，右=来源与已知缺口，避免单列在两倍宽里空一半 */}
      <div className="health-cols">
        <div className="health-col">
          <div className="checks">
            <Check
              label="两条恒等式"
              value={identityOk ? '全部成立' : '存在反例'}
              sub={identityOk ? `${fmtInt(sc.inputEqCachePlusMiss.ok)} 条` : `fail ${sc.inputEqCachePlusMiss.fail + sc.totalEqInputPlusOutput.fail}`}
              bad={!identityOk}
            />
            <Check label="请求解析" value={fmtInt(sc.requestsWithUsage)} sub={`/${fmtInt(sc.requestsTotal)} 条带 usage`} />
            <Check label="在途请求跳过" value={fmtInt(sc.inFlightSkipped)} sub="无 usage/无 startedAt" warn={sc.inFlightSkipped > 0} />
            <Check label="解析错误" value={fmtInt(sc.parseErrors)} sub="文件级" bad={sc.parseErrors > 0} />
            <Check label="项目路径缺失" value={fmtInt(sc.sessionsWithoutCwd)} sub="会话级" warn={sc.sessionsWithoutCwd > 0} />
            <Check label="模型未记录" value={fmtInt(sc.sessionsUnknownModel)} sub="会话级" warn={sc.sessionsUnknownModel > 0} />
          </div>

          <div style={{ fontSize: 11, color: 'var(--ink-3)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span>
              覆盖 {cov.first ?? '—'} → {cov.last ?? '—'} · 有数据 {cov.daysWithData}/{cov.daysInRange} 天（{fmtPct(coveragePct, 0)}）
            </span>
            <span>
              窗口内 {agg.totals.activeDays}/{agg.days.length} 天有记录
            </span>
          </div>
          <CoverageStrip days={days} missing={missing} />
          <div className="card-foot" style={{ marginTop: 2 }}>
            灰色为历史空档：可能来自 history 清理、跨设备使用或本地未打开 CodeBuddy，看板不做插值。
          </div>
        </div>

        <div className="health-col">
          <div style={{ fontSize: 11, color: 'var(--ink-3)', lineHeight: 1.9 }}>
            <div>
              <b style={{ color: 'var(--ink-2)' }}>采集源</b> · {dataset.sources.projectCount} 个项目索引 / {dataset.sources.convIndexCount} 个会话索引 /{' '}
              {dataset.sources.sessionMetaCount} 条会话元数据 · {dataset.sources.elapsedMs} ms
            </div>
            <div className="src">
              {dataset.sources.historyRoots.length > 0
                ? dataset.sources.historyRoots.slice(0, 2).map((r) => `history: ${r}`).join('\n')
                : '未记录 history 根'}
              {dataset.sources.historyRoots.length > 2 ? ` （等 ${dataset.sources.historyRoots.length} 处）` : ''}
              {dataset.sources.sessionsDb ? `　会话库: ${dataset.sources.sessionsDb}` : '　会话库: 未提供'}
            </div>
            <div style={{ color: 'var(--ink-4)' }}>数据生成于 {fmtDateTime(new Date(dataset.generatedAt).getTime())}</div>
          </div>

          <div style={{ marginTop: 10 }}>
            <b style={{ fontSize: 11, color: 'var(--ink-2)' }}>已知缺口（口径限制，不是 bug）</b>
            <ul className="health-list">
              <li>代码补全（Inline Completion）在扩展日志里只有耗时、没有 token 与积分，永久无法计入。</li>
              <li>Inline Chat / 选中代码提问不写入 history 的 requests[]，会少算。</li>
              <li>云端会话正文不落本地；换机/换账号后需要重新扫描，跨机数据需靠快照合并。</li>
              <li>扩展日志会被轮转，早于首次启动目录的 step 级明细（含 thinkingTokens）已丢失。</li>
              <li>本地没有单价表，只能给积分，不能换算人民币。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
