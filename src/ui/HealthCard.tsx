import type { Dataset, SourceId } from '../core/types'
import type { Aggregates } from '../core/aggregate'
import type { SourceFreshness } from '../core/freshness'
import { SOURCE_META, SOURCE_ORDER } from '../core/types'
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

export function HealthCard({
  dataset,
  agg,
  freshness,
  onExport,
}: {
  dataset: Dataset
  agg: Aggregates
  freshness: Partial<Record<SourceId, SourceFreshness>>
  onExport: () => void
}) {
  const sc = dataset.selfCheck
  const cov = dataset.coverage
  const days = cov.first && cov.last ? dayList(new Date(`${cov.first}T00:00:00`).getTime(), new Date(`${cov.last}T00:00:00`).getTime()) : []
  const missing = new Set(cov.missingDays)
  const identityFail = sc.inputEqCachePlusMiss.fail + sc.totalEqInputPlusOutput.fail
  const identityOk = identityFail === 0
  const coveragePct = days.length ? (days.length - missing.size) / days.length : 0
  const sources = SOURCE_ORDER.filter((s) => dataset.bySource[s])

  // 跨源自检：合并后的请求数必须等于逐条会话求和（防合并层重复计数/丢数据）
  const actualRequests = dataset.sessions.reduce((a, s) => a + s.requests.length, 0)
  const sumBySource = sources.reduce((a, s) => a + (dataset.bySource[s]?.selfCheck.requestsWithUsage ?? 0), 0)
  const mergeConsistent = actualRequests === sumBySource
  const creditCoverage = agg.totals.requests ? agg.totals.creditKnownRequests / agg.totals.requests : 0

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>数据体检</h3>
          <div className="sub">每份数据自己查一遍，合并后再核对一次。缺什么直接写出来</div>
        </div>
        <div className="tools">
          <button type="button" className="btn ghost" onClick={onExport}>
            导出快照
          </button>
        </div>
      </div>

      {/* 宽卡两栏：左=自检与覆盖，右=逐源溯源，避免单列在两倍宽里空一半 */}
      <div className="health-cols">
        <div className="health-col">
          <div className="checks">
            <Check
              label="加总对得上"
              value={identityOk ? '全部对得上' : '有对不上的'}
              sub={identityOk ? `${fmtInt(sc.inputEqCachePlusMiss.ok)} 条记录` : `${fmtInt(identityFail)} 条对不上`}
              bad={!identityOk}
            />
            <Check
              label="合并没重复计数"
              value={mergeConsistent ? '一致' : '不一致'}
              sub={`合并 ${fmtInt(actualRequests)} · 各源合计 ${fmtInt(sumBySource)}`}
              bad={!mergeConsistent}
            />
            <Check label="读到的请求" value={fmtInt(sc.requestsWithUsage)} sub={`共 ${fmtInt(sc.requestsTotal)} 条记录`} />
            <Check
              label="重复记录已去掉"
              value={fmtInt(sc.duplicateRequests)}
              sub="同一条被写了两遍"
              warn={sc.duplicateRequests > 0}
            />
            <Check label="读不出来的行" value={fmtInt(sc.parseErrors)} sub="文件或某一行出错" bad={sc.parseErrors > 0} />
            <Check label="可能是同一个项目" value={fmtInt(sc.suspectedDuplicateProjects)} sub="路径写法不同，只提示不合并" warn={sc.suspectedDuplicateProjects > 0} />
            <Check label="没写明模型的会话" value={fmtInt(sc.sessionsUnknownModel)} sub="CodeBuddy 记录里没有这个字段" warn={sc.sessionsUnknownModel > 0} />
          </div>

          <div style={{ fontSize: 11, color: 'var(--ink-3)', display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
            <span>
              覆盖 {cov.first ?? '—'} → {cov.last ?? '—'} · 有记录 {cov.daysWithData}/{cov.daysInRange} 天（{fmtPct(coveragePct, 0)}）
            </span>
            <span>
              窗口内 {agg.totals.activeDays}/{agg.days.length} 天有记录
            </span>
          </div>
          <CoverageStrip days={days} missing={missing} />
          <div className="card-foot" style={{ marginTop: 2 }}>
            灰色为<b>无记录日</b>：两源当天都没有请求，通常是多工具切换使用的正常结果，不是数据缺失；看板不做插值。
          </div>
        </div>

        <div className="health-col">
          <div className="src-blocks">
            {sources.map((s) => {
              const summary = dataset.bySource[s]!
              const ssc = summary.selfCheck
              const fail = ssc.inputEqCachePlusMiss.fail + ssc.totalEqInputPlusOutput.fail
              const scannedTs = Date.parse(summary.info.scannedAt)
              const fresh = freshness[s]
              return (
                <div className="src-block" key={s}>
                  <div className="src-title">
                    <span className={`src-dot ${s}`} />
                    <b>{SOURCE_META[s].label}</b>
                    {fresh ? <em className={`fresh-tag${fresh.fresh ? ' fresh' : ''}`}>{fresh.fresh ? '本次刷新' : '缓存'}</em> : null}
                    <span>
                      {fmtInt(ssc.requestsWithUsage)} 请求 · {fmtInt(summary.coverage.daysWithData)} 天
                    </span>
                  </div>
                  <div
                    className="src-line"
                    title={`${fmtInt(summary.info.convIndexCount)} 个会话索引 · ${fmtInt(summary.info.sessionMetaCount)} 条会话元数据`}
                  >
                    {fmtInt(summary.info.projectCount)} 个项目 · {summary.info.elapsedMs} 毫秒读完
                    {Number.isFinite(scannedTs) ? ` · ${fmtDateTime(scannedTs)} 读过` : ''}
                  </div>
                  <div className="src-line ellipsis" title={summary.info.historyRoots.join('\n')}>
                    {summary.info.historyRoots[0] ?? '没有记录数据在哪'}
                    {summary.info.historyRoots.length > 1 ? ` 等 ${summary.info.historyRoots.length} 个位置` : ''}
                    {summary.info.sessionsDb ? ` · 会话库 ${summary.info.sessionsDb}` : ''}
                  </div>
                  <div
                    className="src-line"
                    title="加总对不上：字段之和与总数不相等 · 写到一半：读取时文件还在写 · 没有积分字段：该条记录不带 credit"
                  >
                    加总对不上 {fmtInt(fail)} · 写到一半 {fmtInt(ssc.inFlightSkipped)} · 没有积分字段 {fmtInt(ssc.requestsWithoutCredit)}
                    {ssc.usageZeroFallbacks ? ` · 记录全是 0 的 ${fmtInt(ssc.usageZeroFallbacks)}` : ''}
                    {ssc.subAgentSessions ? ` · subagent ${fmtInt(ssc.subAgentSessions)}` : ''}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="src-line" style={{ marginTop: 6 }}>
            积分覆盖率 {fmtPct(creditCoverage, 0)}（{fmtInt(sc.requestsWithoutCredit)} 条没有积分字段）
          </div>
          <div style={{ color: 'var(--ink-4)', fontSize: 11 }}>数据生成于 {fmtDateTime(new Date(dataset.generatedAt).getTime())}</div>

          <details className="health-more">
            <summary>已知缺口 5 条：不是 bug，是数据本身记不全</summary>
            <ul className="health-list">
              <li>CodeBuddy 的代码补全只记了耗时，没有 token 和积分，算不进去。</li>
              <li>CodeBuddy 在选中代码里提问，不写进请求记录，会少算。</li>
              <li>WorkBuddy 的会话标题约四成缺失，先留空。</li>
              <li>两边共用一个积分账户：合并后的积分只是下限，差额补不出来。</li>
              <li>本地没有单价，只显示积分，不折算成钱。</li>
            </ul>
          </details>
        </div>
      </div>
    </section>
  )
}
