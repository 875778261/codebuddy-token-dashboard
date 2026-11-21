import type { SourceState } from '../core/completeness'
import { SOURCE_META, type SourceId } from '../core/types'
import { CopyPath, importPathOf } from './importPaths'

/**
 * 「没读到的源」条：只回答一件事——另外那几个源在哪，拖哪个文件夹能补上。
 *
 * 它不做告警（告警在顶栏一行与数据体检的端结论里），所以快照与示例下也照常显示：
 * 快照可能来自另一台机器，看完这里正好回本机补源。
 * 用户已经说过「我没有这个源」的不再贴路径，但留一个恢复入口，否则点了就再也回不来。
 */
export function MissingSources({
  states,
  onDecline,
  onRestore,
}: {
  states: SourceState[]
  onDecline: (source: SourceId) => void
  onRestore: (source: SourceId) => void
}) {
  const missing = states.filter((s) => !s.loaded && !s.declined)
  const declined = states.filter((s) => !s.loaded && s.declined)
  if (!missing.length && !declined.length) return null

  return (
    <section className="card missing-card">
      <div className="card-head">
        <div>
          <h3>没读到的源</h3>
          <div className="sub">
            {missing.length ? '把下面任一路径拖进窗口就能补上；已读入的那份不会重读' : '剩下的源你都说过没有了'}
          </div>
        </div>
        <div className="tools">{missing.length ? `${missing.length} 个` : '都齐了'}</div>
      </div>

      {missing.length ? (
        <div className="miss-list">
          {missing.map((st) => (
            <div className="miss-row" key={st.source}>
              <i className={`src-dot ${st.source}`} />
              <b className="miss-name">{SOURCE_META[st.source].label}</b>
              <code className="miss-path">{importPathOf(st.source).value}</code>
              <span className="miss-actions">
                <CopyPath value={importPathOf(st.source).value} />
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => onDecline(st.source)}
                  title={`声明「我没有 ${SOURCE_META[st.source].label} 的数据」，之后不再提示`}
                >
                  我没有
                </button>
              </span>
            </div>
          ))}
        </div>
      ) : null}

      {declined.length ? (
        <div className="miss-restore">
          已声明没有：
          {declined.map((st) => (
            <span key={st.source}>
              {SOURCE_META[st.source].label}
              <button type="button" className="btn ghost tiny" onClick={() => onRestore(st.source)}>
                恢复提示
              </button>
            </span>
          ))}
        </div>
      ) : null}

      <div className="card-foot">这些都是本机路径。数据只在浏览器里读，不会上传。</div>
    </section>
  )
}
