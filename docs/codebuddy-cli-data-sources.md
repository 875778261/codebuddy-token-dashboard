# CodeBuddy CLI 本地数据源勘察报告

> 勘察日期：2026-11-20　机器：`HUAWEI`（win32）　CodeBuddy CLI **2.185.0**（`codebuddy --version`）
> 方法：**全部结论来自本机真实文件的解析结果**，不引用二手整理。
> 复核脚本（随本报告落盘，可直接重跑）：`scripts/cli-truth.py`（Python 独立实现）+ `scripts/verify-cli.ts`（浏览器同一份 TS 代码）→ `npm run verify:cli`。

---

## 0. 裁定结论

**CLI 的用量只在日志里，不在会话文件里；而日志按天轮转。**

- ✅ **主数据源**：`~/.codebuddy/logs/<YYYY-MM-DD>/<cwd名>__<hash>.log`。一条 `[ModelProvider] {…"event_name":"agent.model_call.completed"…}` = 一次真实 API 调用，字段齐全：`input_tokens / output_tokens / total_tokens / cached_read_tokens / cached_write_tokens / model / conversation_id / conversation_request_id / trace_id`。
- ✅ **逐请求积分也在日志里**：`[SessionManager][credit] Credit received: rootRequestId=…, source=…, credit=…`，与调用一一对应。
- ✅ **项目归属接近 100%**：每份 .log 首行 `Workspace Path: <cwd>`，实测 26/26 份日志都有。
- ❌ **`projects/<编码cwd>/<sessionId>.jsonl` 是空壳**：26 个项目目录 / 5 个 jsonl 文件，只有 2 个非空，内容全是 `providerData.skipRun:true` 的用户回显，**`"usage"` 出现 0 次**。claude-code 式的「会话文件带 usage」在这里不成立。
- ❌ **没有会话标题**：日志里没有任何标题类事件（`SessionManager` 只有 `credit` 一种），jsonl 里也没有 `ai-title`。标题一律留空。
- ❌ **CLI 不提供导出用量的命令**：`--output-format json` 只对「本次 `-p` 运行」有效，拿不到历史。
- ⚠️ **日志会轮转**：本机只有当天一个日期目录（CLI 今天才开始用，无法据此判定保留天数；同源的 WorkBuddy 保留 4 天）。这是本项目第一个「过了就真没了」的源 → 见 [ADR 0007](adr/0007-archive-unrebuildable-source.md)。

本机实测基线（可直接当回归真值）：**73 份日志 / 319 次请求 / 33 个会话 / 11,430,910 token / 已知积分 69.76**，逐日逐会话与 Python 独立实现完全一致。

---

## 1. 本机数据全景（实测）

| # | 位置 | 实际内容 | 用量价值 |
|---|---|---|---|
| **A** | `~/.codebuddy/logs/<YYYY-MM-DD>/<cwd名>__<hash>.log` | 73 份 / 8 MB+ / 目前只有 1 个日期目录 | ★★★★★ **唯一权威** |
| **B** | `~/.codebuddy/traces/<pid>/trace_*.jsonl` | `trace_start` 里带 `agent.kind` / `parentSessionId` | ★★ 只用来判定辅助 agent（`totalTokens` 实测 `0`） |
| **C** | `~/.codebuddy/projects/<编码cwd>/<sessionId>.jsonl` | 26 项目 / 5 文件 / 137 KB，**0 条 usage** | ☆ 未来兼容：若某天写入 usage，解析器可优先用它 |
| **D** | `~/.codebuddy/history.jsonl` | 2 行（`/stats`、`/model`） | ☆ 只有 prompt 与 project，无用量、无 sessionId |
| **E** | `~/.codebuddy/sessions/` | 空 | ☆ |
| **F** | `~/.codebuddy/models.json` | 自定义模型配置，**含明文 apiKey** | ☆ 必须**不要**读进页面 |

访问边界（实现据此收口）：扫描 `~/.codebuddy` 时只进 `logs/` 与 `traces/`，其余目录一律跳过。`projects/` 尤其要跳过——它的 `*.jsonl` 形状与 WorkBuddy 完全一致，会被误认成 WorkBuddy 数据。

---

## 2. 日志行的两种形态

时间戳前缀 `[YYYY/MM/DD HH:MM:SS.mmm]` 是**本机时区**，跨文件可排序——这是积分配对能成立的前提。

### 2.1 一次模型调用

```
[2026/11/20 12:01:05.475] [Info] [pid=14912] [ModelProvider]  {"model":"deepseek-v4.1-flash","step":1,"attempt_no":1,"time_to_first_token_ms":2290,"input_tokens":25976,"output_tokens":32,"total_tokens":26008,"cached_read_tokens":3328,"cached_write_tokens":0,"finish_reason":"stop","event_id":"01a1f71d-75c2-…","event_name":"agent.model_call.completed","service":"agent-cli","duration_ms":2803,"conversation_id":"01a1f71d-5729-…","conversation_request_id":"01a1f71d577373c5…","conversation_message_id":"01a1f71d6ace7d99…","trace_id":"4b50923c…"}
```

- `total_tokens == input_tokens + output_tokens`，实测 319/319 成立。
- `input_tokens` **包含** `cached_read_tokens`（上例 3328 ≤ 25976），所以 `cache + miss == input` 恒成立。
- `cached_write_tokens` 独立于 input，不计入任何恒等式（与 IDE 侧的 `cachedWriteTokens` 语义一致）。
- `event_id` 与 `conversation_message_id` 本机 319/319 唯一；`attempt_no` 全为 1（重试会拿到新 `event_id`，视为新请求）。

### 2.2 一次积分

```
[2026/11/20 12:01:05.455] [Info] [pid=14912] [SessionManager][credit] Credit received: rootRequestId=01a1f71d577373c5…, source=raw_model_stream_event, credit=0.74
[2026/11/20 12:01:05.473] [Info] [pid=14912] [SessionManager][credit] Credit received: rootRequestId=01a1f71d577373c5…, source=response_done, credit=0.74
```

- `rootRequestId` **等于** 模型调用行里的 `conversation_request_id`。
- 同一份值写两遍（`raw_model_stream_event` / `response_done`）：实测 319 次调用 × 2 = 638 行，去重后 319 条。
- 一次用户 turn 内多次调用时，**每条 credit 只保证顺序、没有 messageId**：

```
6 次调用   input_tokens: 25991 … 28387
6 条 credit           : 0.75 / 0.08 / 0.07 / 0.04 / 0.03 / 0.05
```

因此配对规则是「**同一 rootRequestId 内，两个列表各自按时间排序后逐位配对**」，只取 `raw_model_stream_event`（后者兜底）。本机 0 条配不上、0 条重复值歧义。

---

## 3. 会话、turn、项目

| 概念 | 来自 | 实测 |
|---|---|---|
| 会话（Session） | `conversation_id` | 30 个（32 个 id 里有 2 个没有调用行） |
| 用户 turn | `conversation_request_id` | 每会话 1 个 turn（本机都是单轮批处理任务）；一个 turn 最多 40 次调用 |
| 请求（Request） | 每个 `agent.model_call.completed` | 319 条 |
| 项目 | .log 首行 `Workspace Path` | 26 份日志 / 全部命中；同目录多进程会分开成多个 .log，合并后按 cwd 归一 |
| 辅助 agent | `traces/**/trace_*.jsonl` 的 `agent.kind=auxiliary` | 本机 1 个（`conversation_topic`，`parentSessionId` 指向主会话），在日志里是独立 `conversation_id` |

---

## 4. 口径与实现

| 指标 | 口径 |
|---|---|
| 总 Token / 输入 / 输出 | 逐条 `agent.model_call.completed` 求和；`input` 含缓存命中部分 |
| 缓存命中率 | `Σcached_read / Σinput`（合并视图按合并后分子分母重算） |
| 已知积分 | 配对成功的 `credit` 之和 + 覆盖率（有积分的请求数 / 全部请求数） |
| 请求数 | 一条 `agent.model_call.completed` = 1 |
| 会话数 | 按 `conversation_id`；辅助 agent 会话计入并打 `isSubAgent` 标 |
| 项目 | 日志首行 cwd，归一化后与其他源合并 |
| 会话标题 | 无数据源，一律留空 |
| 归档 | 日志轮转掉的部分从 IndexedDB 归档补入，`archiveRequests` 记录补入条数 |

两条恒等式在解析期逐条校验：`total == input + output`、`cached_read <= input`。与 IDE 侧一致的只有这两条，**不要**把 `input == cache + miss + cacheWrite` 套过来（CLI 的 `cached_write_tokens` 不在 input 内）。

---

## 5. 对拍

```bash
npm run verify:cli
```

- `scripts/cli-truth.py`：独立 Python 实现，自己读日志、自己配对 credit、自己按日/按会话聚合；
- `scripts/verify-cli.ts`：跑 `src/core/cliParse.ts`（浏览器里同一份代码），逐字段比对。

本机最近一次：`73 日志 / 319 请求 / 33 会话 / 11,430,910 token / 69.76 积分`，逐日逐会话完全一致。

---

## 6. 已知缺口

- 日志轮转即丢：早于保留窗口的请求只能来自本地归档；清空归档不可恢复。
- 没有会话标题；没有 assistant 正文；没有 subagent 的独立目录（辅助 agent 只能靠 traces 判定）。
- `projects/*.jsonl` 目前是空壳，因此 cwd 只能取日志首行（同一份日志内 cwd 恒定，实测成立）。
- 辅助 agent 的判定依赖 `traces/`：删掉 traces 后仍会计入用量，但不再单独标记。

## 7. 踩过的坑

- **拖入读到 0 条**：`dropScan` 的目录遍历有两支——「入口本身就是文件」与「由父目录枚举出来的文件」。CLI 的判断当时只写在第一支，而 `.codebuddy → logs → 日期 → *.log` 永远走第二支，于是 `cliLogs` 恒为 0，界面报「拖进来的内容里没有用量记录」。同一份规则在 `scanDirectoryHandle` 与 `scanFileList` 里都有，所以「选择文件夹」正常、只有拖拽坏。回归锁：`src/platform/__tests__/dropScan.test.ts`。
- **`.codebuddy/projects` 必须整体不进**：它的 `<sessionId>.jsonl` 与 WorkBuddy 同形，一旦被父目录枚举到就会被判成 WorkBuddy，凭空多出一个源；`models.json` 里还有明文 apiKey。
