import type { Dataset, EndId, SourceId } from './types'
import { END_ORDER, END_OF_SOURCE, SOURCE_ORDER, sourcesOfEnd } from './types'

/**
 * 「数据完整度」的唯一判定处。
 *
 * 口径（GLOSSARY「已读入 / 未读入」）：
 * - **已读入** = 该源有切片且请求数 > 0。有目录句柄但 0 条不算——那恰好说明路径选错了。
 * - **未读入** = 该源没有数据；其中被用户标记「我没有这个源」的，不再提示。
 * - 端不完整 ≠ 源未读入：CodeBuddy 端只有 CLI 时端是"能比"，但端内仍缺 IDE。
 * 两级都要说，因为这两个问题的答案不同（见 ADR 0006）。
 */
export interface SourceState {
  source: SourceId
  requests: number
  loaded: boolean
  /** 用户主动声明「我没有这个源」 */
  declined: boolean
}

export function sourceStates(dataset: Dataset | null, declined: readonly SourceId[]): SourceState[] {
  return SOURCE_ORDER.map((source) => {
    const requests = dataset?.bySource[source]?.selfCheck.requestsWithUsage ?? 0
    return { source, requests, loaded: requests > 0, declined: declined.includes(source) }
  })
}

/** 需要提示的源：没数据、且用户没说过「我没有」 */
export function promptingSources(states: SourceState[]): SourceId[] {
  return states.filter((s) => !s.loaded && !s.declined).map((s) => s.source)
}

export interface EndGap {
  end: EndId
  /** 这个端里已经读到数据的源 */
  loaded: SourceId[]
  /** 这个端里还没读到、且在提示的源 */
  missing: SourceId[]
}

/** 端层：谁缺、缺的是端内哪个源 */
export function endGaps(states: SourceState[]): EndGap[] {
  return END_ORDER.map((end) => {
    const own = states.filter((s) => END_OF_SOURCE[s.source] === end)
    return {
      end,
      loaded: own.filter((s) => s.loaded).map((s) => s.source),
      missing: own.filter((s) => !s.loaded && !s.declined).map((s) => s.source),
    }
  })
}

/** 该源是否属于「这个端一个源都没读到」——端对比因此缺席，与「端内少一个源」不是一回事 */
export function endHasNoData(gap: EndGap): boolean {
  return gap.loaded.length === 0
}

/** 端内完整性：sourcesOfEnd 是唯一归组入口，避免这里另抄一份映射 */
export function sourcesInEnd(end: EndId): SourceId[] {
  return sourcesOfEnd(end)
}
