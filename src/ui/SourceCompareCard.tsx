import type { Aggregates } from '../core/aggregate'
import { fmtCredit, fmtInt, fmtPct, fmtTokens } from '../core/format'
import { SOURCE_META, SOURCE_ORDER, type SourceId } from '../core/types'
import type { Palette } from './theme'

interface Row {
  label: string
  value: (a: Aggregates) => string
  /** 每个源自己的补充说明（例如积分覆盖率），渲染在数值下方 */
  sub?: (a: Aggregates) => string
  /** 两端差异的文案；返回空字符串表示不比较 */
  diff: (a: Aggregates, b: Aggregates) => string
  hint?: string
}

const ratio = (a: number, b: number): string => {
  if (!a || !b) return '—'
  const r = b / a
  return `×${r.toFixed(r >= 10 ? 0 : 2)}`
}

const ROWS: Row[] = [
  {
    label: 'Token',
    value: (a) => fmtTokens(a.totals.total),
    diff: (a, b) => ratio(a.totals.total, b.totals.total),
  },
  {
    label: '请求数',
    value: (a) => fmtInt(a.totals.requests),
    diff: (a, b) => ratio(a.totals.requests, b.totals.requests),
  },
  {
    label: '单次均值',
    value: (a) => fmtTokens(a.totals.avgPerRequest),
    diff: (a, b) => ratio(a.totals.avgPerRequest, b.totals.avgPerRequest),
    hint: '上下文规模差异',
  },
  {
    label: '活跃天数',
    value: (a) => `${a.totals.activeDays} / ${a.days.length} 天`,
    diff: (a, b) => `${b.totals.activeDays - a.totals.activeDays >= 0 ? '+' : ''}${b.totals.activeDays - a.totals.activeDays} 天`,
  },
  {
    label: '缓存命中率',
    value: (a) => fmtPct(a.totals.cacheHitRate),
    diff: (a, b) => `${(b.totals.cacheHitRate - a.totals.cacheHitRate) * 100 >= 0 ? '+' : ''}${((b.totals.cacheHitRate - a.totals.cacheHitRate) * 100).toFixed(1)} pp`,
  },
  {
    label: '已知积分',
    value: (a) => fmtCredit(a.totals.credit),
    sub: (a) => `覆盖 ${fmtPct(creditCoverage(a), 0)} 请求`,
    diff: (a, b) => ratio(a.totals.credit, b.totals.credit),
    hint: '覆盖率按请求数加权，两端不同；带覆盖率才能比',
  },
  {
    label: '每百万 token 积分',
    value: (a) => (a.totals.total ? (a.totals.credit / a.totals.total * 1e6).toFixed(1) : '—'),
    diff: (a, b) => {
      const x = a.totals.total ? a.totals.credit / a.totals.total : 0
      const y = b.totals.total ? b.totals.credit / b.totals.total : 0
      return ratio(x, y)
    },
    hint: '受模型构成影响，跨端不可直接当"效率"',
  },
  {
    label: '会话（主 / sub）',
    value: (a) => `${fmtInt(a.totals.mainSessions)} / ${fmtInt(a.totals.subAgentSessions)}`,
    diff: (a, b) => `${b.totals.mainSessions - a.totals.mainSessions >= 0 ? '+' : ''}${b.totals.mainSessions - a.totals.mainSessions} 主会话`,
    hint: 'subagent 会话不是 CodeBuddy 口径，必须分列',
  },
]

function creditCoverage(a: Aggregates): number {
  return a.totals.requests ? a.totals.creditKnownRequests / a.totals.requests : 0
}

export function SourceCompareCard({
  merged,
  bySource,
  palette,
  onAdd,
  busy,
}: {
  merged: Aggregates
  bySource: Partial<Record<SourceId, Aggregates>>
  palette: Palette
  onAdd: () => void
  busy: boolean
}) {
  const loaded = SOURCE_ORDER.filter((s) => bySource[s])
  const colorOf = (s: SourceId) => (s === 'codebuddy' ? palette.models[0] : palette.models[1])

  if (loaded.length < 2) {
    const only = loaded[0]
    const missing = SOURCE_ORDER.filter((s) => s !== only)[0]
    return (
      <section className="card">
        <div className="card-head">
          <div>
            <h3>端对比</h3>
            <div className="sub">量差 · 同模型效率差 · 切换节奏</div>
          </div>
          <div className="tools">{only ? `只载入 ${SOURCE_META[only].label}` : '没有数据'}</div>
        </div>
        <div className="src-empty">
          <b>{only ? `还缺 ${SOURCE_META[missing].label}，暂时无法对比` : '还没有载入任何数据'}</b>
          <span>
            {only
              ? `${SOURCE_META[only].label} 的统计已经在上面了。再把 ${SOURCE_META[missing].label} 的数据目录加进来，这块会显示两端在量、效率与使用节奏上的差异；已载入的一端不会被重扫。`
              : '载入 CodeBuddy 或 WorkBuddy 任一端即可开始；两端都载入后自动出现端对比。'}
          </span>
          <button type="button" className="btn" onClick={onAdd} disabled={busy}>
            添加数据目录
          </button>
        </div>
        <div className="card-foot">单端视图只显示该端数字；账号积分口径只在双端合并后才有意义。</div>
      </section>
    )
  }

  const cb = bySource.codebuddy!
  const wb = bySource.workbuddy!
  const total = cb.totals.total + wb.totals.total
  const cbShare = total ? cb.totals.total / total : 0

  // 同模型对照：只有跨端同名的模型才可 apples-to-apples
  const shared = merged.models
    .map((m) => ({ key: m.key, cb: cb.models.find((x) => x.key === m.key), wb: wb.models.find((x) => x.key === m.key) }))
    .filter((m) => m.cb && m.wb)
    .slice(0, 6)

  const pattern = merged.days.map((d) => {
    const c = (d.bySource.codebuddy ?? 0) > 0
    const w = (d.bySource.workbuddy ?? 0) > 0
    return c && w ? 'both' : c ? 'cb' : w ? 'wb' : 'none'
  })
  const count = (k: string) => pattern.filter((p) => p === k).length

  return (
    <section className="card">
      <div className="card-head">
        <div>
          <h3>端对比</h3>
          <div className="sub">同一窗口、同一套聚合代码；比率字段各自重算，绝不求和</div>
        </div>
        <div className="tools">合并 {fmtTokens(merged.totals.total)} token</div>
      </div>

      <div className="cmp-body">
        <div className="cmp-split">
          <div className="cmp-bar">
            <i style={{ width: `${cbShare * 100}%`, background: colorOf('codebuddy') }} />
            <i style={{ width: `${(1 - cbShare) * 100}%`, background: colorOf('workbuddy') }} />
          </div>
          <div className="cmp-split-legend">
            <span>
              <i style={{ background: colorOf('codebuddy') }} />
              {SOURCE_META.codebuddy.label} {fmtPct(cbShare, 1)}
            </span>
            <span>
              <i style={{ background: colorOf('workbuddy') }} />
              {SOURCE_META.workbuddy.label} {fmtPct(1 - cbShare, 1)}
            </span>
          </div>
        </div>

        <table className="cmp-table">
          <thead>
            <tr>
              <th className="l">指标</th>
              <th>{SOURCE_META.codebuddy.label}</th>
              <th>{SOURCE_META.workbuddy.label}</th>
              <th>WB / CB</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.label} title={row.hint}>
                <td className="l">{row.label}</td>
                <td className="num">
                  {row.value(cb)}
                  {row.sub ? <small className="cell-sub">{row.sub(cb)}</small> : null}
                </td>
                <td className="num">
                  {row.value(wb)}
                  {row.sub ? <small className="cell-sub">{row.sub(wb)}</small> : null}
                </td>
                <td className="num dim">{row.diff(cb, wb)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="cmp-models">
          <div className="cmp-sub">
            <b>同模型对照</b>
            <span>只比两端都出现的模型；跨模型的「每百万 token 积分」差异主要是模型构成，不是端效率</span>
          </div>
          {shared.length === 0 ? (
            <div className="empty-state">两端没有同名模型，无法做效率对照</div>
          ) : (
            <table className="cmp-table compact">
              <thead>
                <tr>
                  <th className="l">模型</th>
                  <th>CB 命中率</th>
                  <th>WB 命中率</th>
                  <th>CB 积分/M</th>
                  <th>WB 积分/M</th>
                  <th>Token 差</th>
                </tr>
              </thead>
              <tbody>
                {shared.map((m) => (
                  <tr key={m.key}>
                    <td className="l">{m.key}</td>
                    <td className="num">{fmtPct(m.cb!.cacheHitRate, 0)}</td>
                    <td className="num">{fmtPct(m.wb!.cacheHitRate, 0)}</td>
                    <td className="num">{m.cb!.creditPerMillion.toFixed(1)}</td>
                    <td className="num">{m.wb!.creditPerMillion.toFixed(1)}</td>
                    <td className="num dim">{ratio(m.cb!.total, m.wb!.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="cmp-days">
          <div className="cmp-sub">
            <b>切换节奏</b>
            <span>
              两端都有 {count('both')} 天 · 只用 CB {count('cb')} 天 · 只用 WB {count('wb')} 天 · 都没用 {count('none')} 天
            </span>
          </div>
          <div className="cmp-days-strip" role="img" aria-label="每日使用哪一端">
            {merged.days.map((d, i) => (
              <i
                key={d.key}
                className={`cmp-day ${pattern[i]}`}
                style={
                  pattern[i] === 'both'
                    ? { background: `linear-gradient(90deg, ${colorOf('codebuddy')} 50%, ${colorOf('workbuddy')} 50%)` }
                    : pattern[i] === 'cb'
                      ? { background: colorOf('codebuddy') }
                      : pattern[i] === 'wb'
                        ? { background: colorOf('workbuddy') }
                        : undefined
                }
                title={`${d.key} · CB ${fmtTokens(d.bySource.codebuddy ?? 0)} / WB ${fmtTokens(d.bySource.workbuddy ?? 0)}`}
              />
            ))}
          </div>
        </div>
      </div>

      <div className="card-foot">
        积分是<b>已知积分</b>：两端共用同一积分账户，且各端字段覆盖不同，两个数字相加仍是账号消耗的下限，不是「总积分」；也不按比例外推。
      </div>
    </section>
  )
}
