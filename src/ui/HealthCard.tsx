import type { Dataset } from '../core/types'
import type { Aggregates } from '../core/aggregate'
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

export function HealthCard({ dataset, agg, onExport }: { dataset: Dataset; agg: Aggregates; onExport: () => void }) {
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
          <div className="sub">逐源自检 + 跨源一致性；缺什么就说缺什么</div>
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
              label="两条恒等式"
              value={identityOk ? '全部成立' : '存在反例'}
              sub={identityOk ? `${fmtInt(sc.inputEqCachePlusMiss.ok)} 条` : `fail ${fmtInt(identityFail)}`}
              bad={!identityOk}
            />
            <Check
              label="跨源请求合计"
              value={mergeConsistent ? '一致' : '不一致'}
              sub={`合并 ${fmtInt(actualRequests)} / Σ各源 ${fmtInt(sumBySource)}`}
              bad={!mergeConsistent}
            />
            <Check label="请求解析" value={fmtInt(sc.requestsWithUsage)} sub={`/${fmtInt(sc.requestsTotal)} 条带 usage`} />
            <Check
              label="源内重复丢弃"
              value={fmtInt(sc.duplicateRequests)}
              sub="(session, message) 重试双写"
              warn={sc.duplicateRequests > 0}
            />
            <Check label="解析错误" value={fmtInt(sc.parseErrors)} sub="文件/行级" bad={sc.parseErrors > 0} />
            <Check label="疑似同项目" value={fmtInt(sc.suspectedDuplicateProjects)} sub="归一后同 key 不同原串，只告警" warn={sc.suspectedDuplicateProjects > 0} />
            <Check label="模型未记录" value={fmtInt(sc.sessionsUnknownModel)} sub="多为 CodeBuddy 缺 selectedModelId" warn={sc.sessionsUnknownModel > 0} />
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
            灰色为<b>无记录日</b>：两源当天都没有请求，通常是多工具切换使用的正常结果，不是数据缺失；看板不做插值。
          </div>
        </div>

        <div className="health-col">
          <div className="src-blocks">
            {sources.map((s) => {
              const summary = dataset.bySource[s]!
              const ssc = summary.selfCheck
              const fail = ssc.inputEqCachePlusMiss.fail + ssc.totalEqInputPlusOutput.fail
              return (
                <div className="src-block" key={s}>
                  <div className="src-title">
                    <span className={`src-dot ${s}`} />
                    <b>{SOURCE_META[s].label}</b>
                    <span>
                      {fmtInt(ssc.requestsWithUsage)} 请求 · {fmtInt(summary.coverage.daysWithData)} 天
                    </span>
                  </div>
                  <div className="src-line">
                    {fmtInt(summary.info.projectCount)} 项目 · {fmtInt(summary.info.convIndexCount)} 索引 · {fmtInt(summary.info.sessionMetaCount)} 元数据 ·{' '}
                    {summary.info.elapsedMs} ms
                  </div>
                  <div className="src-line ellipsis" title={summary.info.historyRoots.join('\n')}>
                    {summary.info.historyRoots[0] ?? '未记录数据根'}
                    {summary.info.historyRoots.length > 1 ? ` 等 ${summary.info.historyRoots.length} 处` : ''}
                    {summary.info.sessionsDb ? ` · 会话库 ${summary.info.sessionsDb}` : ''}
                  </div>
                  <div className="src-line">
                    恒等式 fail {fmtInt(fail)} · 在途跳过 {fmtInt(ssc.inFlightSkipped)} · 无 credit {fmtInt(ssc.requestsWithoutCredit)}
                    {ssc.usageZeroFallbacks ? ` · usage 全零回落 ${fmtInt(ssc.usageZeroFallbacks)}` : ''}
                    {ssc.subAgentSessions ? ` · subagent ${fmtInt(ssc.subAgentSessions)}` : ''}
                  </div>
                </div>
              )
            })}
          </div>

          <div className="src-line" style={{ marginTop: 6 }}>
            合并积分覆盖 {fmtPct(creditCoverage, 0)} 请求（缺 credit {fmtInt(sc.requestsWithoutCredit)} 条）
          </div>
          <div style={{ color: 'var(--ink-4)', fontSize: 11 }}>数据生成于 {fmtDateTime(new Date(dataset.generatedAt).getTime())}</div>

          <div style={{ marginTop: 10 }}>
            <b style={{ fontSize: 11, color: 'var(--ink-2)' }}>已知缺口（口径限制，不是 bug）</b>
            <ul className="health-list">
              <li>CodeBuddy 的代码补全（Inline Completion）只有耗时、没有 token 与积分，永久无法计入。</li>
              <li>CodeBuddy Inline Chat 不写入 history 的 requests[]，会少算。</li>
              <li>
                WorkBuddy 的 <code>workbuddy.db</code> 首版不读：会话标题沿用 jsonl 的 ai-title（约 6 成），缺失留空。
              </li>
              <li>两端共用积分账户：合并后的积分只是账号消耗下限，差额无法用本地数据补全或外推。</li>
              <li>本地没有单价表，只能给积分，不能换算人民币。</li>
            </ul>
          </div>
        </div>
      </div>
    </section>
  )
}
