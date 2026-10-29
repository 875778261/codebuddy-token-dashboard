# WorkBuddy 本地数据源勘察报告

> 勘察日期：2026-10-29　机器：`HUAWEI`（win32）　WorkBuddy 桌面版 **5.9.3**（Electron 外壳 + CLI 内核，与 CodeBuddy CN 同源同版本号）
> 方法：**全部结论来自本机真实文件的解析结果**，不引用二手整理。
> 参照实现：`https://token.daeai.cn/`（纯前端 WorkBuddy Token 看板）。其扫描逻辑内联在首页 `<script>` 中，本次已提取逐行对拍，差异见 §3。
> 复核脚本（已随本报告落盘，可直接重跑）：`docs/exploration/wb_verify.py`，参考输出 `docs/exploration/wb_verify_out.json`。

---

## 0. 裁定结论

**WorkBuddy 的数据源比 CodeBuddy IDE 干净一个数量级：单目录、纯 JSONL、逐请求 usage 齐全，还额外带「逐请求积分」。参照实现 token.daeai.cn 只用了其中一半能力。**

- ✅ **主数据源定位准确**：`~/.workbuddy/projects/<项目目录>/<sessionId>.jsonl`，一行一条记录；带 `providerData.usage` 的记录 = 一次真实 API 请求。实测 **12,383 条 / 12,369 条（去重后）**。
- ✅ **无历史包袱**：没有两层字符串化 JSON、不依赖 SQLite、没有 `<uid>` 多级嵌套 —— **浏览器目录选择器可直接吃**（参照站正是这么实现的）。
- ✅ **两条恒等式成立率 99.99%**，可直接作为采集器完整性断言。
- ➕ **参照实现完全没用到 `providerData.rawUsage.credit`** —— 这是**逐请求积分**，覆盖 11,699/12,383（94.5%），合计 **4315.98**。参照站因此做不出积分曲线。
- ➕ **参照实现完全没读 `~/.workbuddy/workbuddy.db`** —— `sessions`(191 行) 提供**会话标题 / 真实 cwd / 状态 / 会话级模型**；`session_usage`(176 行) 提供**上下文占用**与**最终积分**。
- ➕ **必须递归扫 `<sessionId>/subagents/*.jsonl`**：82 个文件贡献 **69.7M token（占 4.8%）**，且与主文件 messageId **零交集**（不重复计入）。
- ❌ 参照实现的「工作空间」取自**目录名**（`d-WORK_SPACE-YLTS-ylts-web`），不可逆、不可排序；每条记录其实都带真实 `cwd`（`d:\WORK_SPACE\YLTS\ylts-web`）。
- ❌ 参照实现**不去重**：14 组 `(sessionId, messageId)` 重复（重试双写），多算 **880,600 token（0.061%）**。
- ⚠️ `usage` 可能**整组全零**（实测 1 例 custom-local 模型），此时必须整组回落到 `rawUsage`，否则该请求的 67,916 token 归零。
- ⚠️ 积分有**两个口径**：jsonl 的 `rawUsage.credit` 覆盖 776 个 turn（4315.98）；`workbuddy.db` 的 `credit_json` 覆盖 264 个 turn（4327.72）。共有 turn 逐条相等率 93.9%，**db 是补写后的最终值，jsonl 是当时值**。
- 🔗 **可与 CodeBuddy 合并成一份统计**（§9）：token 用量零重叠、字段层无损，且**不依赖 `workbuddy.db`**。三处归一化（项目路径 / 模型名 / 会话 ID）是合并前提；实测两源项目交集仅 1 个，合并后是 25 个项目的**并集**。积分因**共用账户**只能给出「账号消耗下限」。

---

## 1. 本机数据全景（实测）

| # | 位置（绝对路径模板） | 实际内容 | 用量价值 |
|---|---|---|---|
| **A** | `%USERPROFILE%\.workbuddy\projects\<项目目录>\<sessionId>.jsonl` | 17 项目 / **189 个主会话文件** / 186.4 MB / **12,383 条 usage 记录** | ★★★★★ **权威** |
| **A'** | `%USERPROFILE%\.workbuddy\projects\<项目目录>\<sessionId>\subagents\agent-*.jsonl` | **82** 个文件 / 26.2 MB / 69.7M token | ★★★★ 必扫 |
| **B** | `%USERPROFILE%\.workbuddy\workbuddy.db` | SQLite：`sessions` 191 行、`session_usage` 176 行 | ★★★★★ **元数据 + 积分终值** |
| **C** | 同上 `projects\<项目目录>\<sessionId>.meta.json` | 29 个，仅 `{codebuddy.ai/hostKind, acpConnectionId}` | ☆ 无用量 |
| **D** | 同上 `projects\<项目目录>\<sessionId>.file-rollback.ndjson` | 59 个，仅 `{v, requestId, commitSeq}` | ☆ 无用量 |
| **E** | 同上 `projects\...\<sessionId>\tool-results\*.txt` | 工具输出快照（60 个附属目录） | ☆ 无用量 |
| **F** | `%USERPROFILE%\.workbuddy\usage-log.json` | **技能使用**记录（`lastUsedDate/recentDates`），15 KB | ☆ 不是 token 用量 |
| **G** | `%USERPROFILE%\.workbuddy\logs\<YYYY-MM-DD>\` | 仅保留 **4 天**（2026-10-26 ~ 10-29）+ 轮转的 `main.log` 等 | ★☆ 含 `totalTokens`，但窗口极短 |
| **H** | `%USERPROFILE%\.workbuddy\traces\<pid>\trace_*.jsonl` | 62 个 trace，span 级，`totalTokens` 字段实测为 0 | ☆ 运行时诊断用 |
| **I** | `%USERPROFILE%\.workbuddy\audit-log\*.jsonl` | 命令安全审计（含 `requestId`/`commandPreview`），**无 token** | ☆ |
| **J** | `%USERPROFILE%\.workbuddy-ai\`（旧产品线） | `workbuddy.db` 全部 0 行；`sessions\*.json` 是 **PID 心跳**，非会话 | ☆ 已废弃 |
| **K** | `%APPDATA%\WorkBuddy`、`%APPDATA%\WorkBuddy AI` | **空目录**（Electron 数据实际落在 `~/.workbuddy/app`） | ☆ |
| **L** | `%LOCALAPPDATA%\WorkBuddy\logs\main.log` | 旧 Electron 外壳日志，最后写入 2026-09-01，已停更 | ☆ |

> **重要**：A 的 17 个「项目目录」是**工作区路径压平后的目录名**（`d:\lhl_code\x` → `d-lhl_code-x`），可作退路；但**每条记录自带 `cwd`，应以 `cwd` 为准**（17 个目录 ↔ 17 个不同 cwd，实测完全一一对应）。

---

## 2. 主数据源实证

### 2.1 目录与记录形态

```
~/.workbuddy/projects/
  d-lhl_code-pic-to-pindou/                     ← 项目目录（cwd 压平）
    255cdecc-889e-477d-b625-04d3380c637b.jsonl  ← 一个会话一个文件（JSONL）
    255cdecc-889e-477d-b625-04d3380c637b.meta.json
    255cdecc-889e-477d-b625-04d3380c637b.file-rollback.ndjson
    255cdecc-.../                                ← 同名附属目录
      tool-results/*.txt
      subagents/agent-*.jsonl                    ← 子智能体独立会话
```

全量 12,383 条 usage 记录的类型分布（**只有两种记录带 usage**）：

| 记录 type | 条数 | 是否带 usage |
|---|---|---|
| `function_call` | 14,533 | **11,578 条带**（工具调用前的模型请求） |
| `function_call_result` | 14,511 | 否 |
| `reasoning` | 8,407 | 否 |
| `message` | 7,145 | **805 条带**（最终回答） |
| `file-history-snapshot` | 5,267 | 否 |
| `credit-usage` | 502 | 否（只有 `credit`，见 §2.5） |
| `session-meta` / `ai-title` / `resend-fork-notice` | 189 / 163 / 37 | 否 |

⇒ **一条 usage 记录 = 一次 API 请求**（`usage.requests` 实测 **12,383/12,383 全部为 1**）。同一 `conversationRequestId`（一次用户提问）内会串起 1~200+ 次请求，因此**不能按 turn 计数**。

### 2.2 usage 字段与口径

```jsonc
// type=function_call / message 记录里的 providerData（节选）
"providerData": {
  "messageId": "445ef775d73f4e609170af8fb0ac706b",
  "conversationRequestId": "b4f18700c2094e01b345a8694c0dbede",  // 一次用户提问
  "model": "gpt-5.6-sol",              // 显示名（看板用这个）
  "requestModelId": "custom-local:gpt-5.6-sol",
  "requestModelName": "gpt-5.6-sol",
  "isSubAgent": true,                  // 可选
  "usage": {                           // ← 归一化后的口径（首选）
    "requests": 1,
    "inputTokens": 32746,              // 含缓存命中部分
    "outputTokens": 332,
    "totalTokens": 33078,
    "inputTokensDetails":  [{ "cached_tokens": 32256 }],
    "outputTokensDetails": [{ "reasoning_tokens": 240 }]
  },
  "rawUsage": {                        // ← 厂商原始口径（含 usage 没有的字段）
    "prompt_tokens": 32746, "completion_tokens": 332, "total_tokens": 33078,
    "prompt_cache_hit_tokens": 32256,  "prompt_cache_miss_tokens": 490,
    "cache_read_input_tokens": 0, "prompt_cache_write_tokens": 0,
    "completion_thinking_tokens": 240,
    "credit": 1.27                     // ★ 逐请求积分
  }
}
// 注意：同一条记录里还有一份 message.usage（snake_case）—— 与上面完全同源，绝不可再累加。
```

`usage` 与 `rawUsage` **1:1 共存（12,383 / 12,383，不存在只有其一的情况）**，但字段覆盖不同：

| 字段 | 可用条数 | 用途 |
|---|---|---|
| `usage.totalTokens / inputTokens / outputTokens` | 12,383 | 主口径 |
| `inputTokensDetails[0].cached_tokens` | 12,219（98.7%） | 缓存命中 |
| `rawUsage.prompt_cache_hit_tokens` | 11,699（94.5%） | 缓存命中（与上一行**逐条相等**，可互为回退） |
| `rawUsage.prompt_cache_miss_tokens` | 11,699 | 缓存未命中，实测 `hit + miss == inputTokens` **11,699/11,699 = 100%** |
| `rawUsage.credit` | 11,699（94.5%） | **逐请求积分** |
| `rawUsage.completion_thinking_tokens` | 11,699 | 思考 token（与 `outputTokensDetails.reasoning_tokens` 11,484/11,699 相等） |

**两条恒等式（全量 12,383 条实测）**：

```
totalTokens == inputTokens + outputTokens     // 12,382/12,383 成立（唯一反例：in 78056 + out 12 = 78068 ≠ total 78061，差 7）
cached <= inputTokens（含等于）                // 12,383/12,383 成立
prompt_cache_hit + prompt_cache_miss == input  // 11,699/11,699 成立（仅对有该字段的记录）
```

### 2.3 全量汇总（实测，已按 `(sessionId, messageId)` 去重）

| 指标 | 实测值 |
|---|---|
| 请求数 | **12,369**（未去重 12,383） |
| 会话 / 项目 | **259** / **17**（会话含 70 个 subagent 会话） |
| 累计 `totalTokens` | **1,436,374,220** |
| `inputTokens` / `outputTokens` | 1,424,873,457 / 11,500,770 |
| `reasoning`（思考） | 6,416,321（占输出 55.8%） |
| 缓存命中 / 未命中 | 1,314,136,466 / 110,736,991（**命中率 92.2%**） |
| 积分 `rawUsage.credit` | **4315.98**（覆盖 11,686/12,369 请求 = 94.5%） |
| 日期范围 | **2026-07-20 ~ 2026-10-29**，区间 102 天内有数据 **77 天**，缺失 **25 天** |
| 单文件体积 | 189 个主 jsonl 合计 186.4 MB（最大 2.6 MB），82 个 subagent 26.2 MB |

Top 项目（按 totalTokens）：`ylts-web` 818.0M / 7,710 请求；`pic-to-pindou` 410.1M / 2,838；`dsh` 79.0M / 444；`workbuddy-auto` 32.1M / 381。

模型分布（请求数 / token）：`hy3` 5,512 / 501.2M、`deepseek-v4.1-flash` 3,451 / 466.6M、`hy4-preview` 725 / 118.0M、`deepseek-v4-flash` 636 / 95.9M、`gpt-5.6-sol` 626 / 57.6M、`hy3-x` 593 / 60.5M、`glm-5.2` 198 / 39.3M、`space-bunny` 156 / 15.4M。

### 2.4 去重：14 组重试双写

| 项 | 实测 |
|---|---|
| `(sessionId, messageId)` 重复组 | **14 组，14 条冗余** |
| 若保留最后一条可少算 | **880,600 token（0.061%）** |
| 重复对的标记 | **无任何标记**（`discard` / `isPartialAborted` / `skipRun` / `error` 全为空） |
| 判据 | 同一 messageId 出现两次，`timestamp` 不同、`totalTokens` 递增 → 判定为**同一请求的重试双写** |

⇒ 采集器应**按 `(sessionId, messageId)` 去重、保留 timestamp 最大者**。不去重的后果是 0.06% 的量级，不影响结论，但会污染「单次请求大小分布」。

### 2.5 积分：三路对拍

| 来源 | 覆盖 | 合计 | 说明 |
|---|---|---|---|
| **A. `rawUsage.credit`**（jsonl，逐请求） | 776 个 turn / 11,699 条请求 | **4315.98** | 首选；粒度最细，可做「每请求积分」 |
| **B. `session_usage.credit_json`**（db，turn → 积分） | 264 个 turn | **4327.72** | turn 级；是**补写后的终值** |
| C. `credit-usage` 记录（jsonl） | 13 个 turn / 502 条 | 156.77 | **残缺**：只保留最近少量 turn，别用 |

A 与 B 共有 264 个 turn，**248 个逐条完全相等（93.9%）**；不等的 16 个里 B 更大（如 `01a176154110764ab24fff6498507700`：A=3.47 / B=26.51），与「重试 + 压缩后补记」一致。
⇒ **积分以 B 为终值、A 为明细**；`credit-usage` 记录（C）判死。

> 注：`session_usage.credit_json` 只覆盖 264/818 turn（32.3%），因为该表按会话滚动写入且历史会话会被清理。**积分不要当总量指标展示。**

**第四路：账号账单（本机不可得，但决定口径）**

CodeBuddy 与 WorkBuddy **共用同一个积分账户**。因此：

- A/B/C 三路都只回答「**这条请求记了多少分**」，不回答「**账号这个月用了多少分**」。
- 任何单产品的 `Σcredit` 都只是账号消耗中「由本产品、在本机、且字段有记录」的那一部分；与官方账单之间的差额由**只看本地文件无法消除**的因素构成：另一产品的消耗、其它设备、代码补全 / Inline Chat 等不落盘的消耗、以及下面说的字段覆盖。
- ⇒ 本看板把积分定位为 **「账号消耗下限」**：合并两源后相加更接近账单真值，但**恒 ≤ 真值**，且**不做任何按比例的补全或外推**。

**「积分不全」是两个互不相干的缺口，必须分开命名**，否则会被当成同一个 bug 去修：

| 缺口 | 性质 | 能否修 |
|---|---|---|
| **字段覆盖缺口** | 5.5% 请求没有 `rawUsage.credit` | 解析层可部分补（db `credit_json` 只覆盖 32% turn，补不全），补完后仍需标注剩余覆盖率 |
| **账号口径偏差** | 共用账户，单产品 ≠ 账号账单 | **不可修**，只能声明；合并后是「下限」而非「真值」 |

### 2.6 独立交叉验证（关键证据）

`workbuddy.db` 的 `session_usage.used` 与 jsonl 里该会话**末轮 `inputTokens`** 独立对拍：

| 项 | 实测 |
|---|---|
| 可比会话 | 175 |
| 完全相等 | **170（97.1%）** |
| 样例 | `bf5db225` 末轮 in=330643 / used=330643；`08df87c0` 319485 / 319485；`a18356ff` 224158 / 224158 |

⇒ 两条完全独立的路径（jsonl 解析 vs 应用自身写入的上下文计数器）在 97% 的会话上**逐字节相等**，可判定 jsonl 的 `usage` 解析正确。

### 2.7 `workbuddy.db` 的 `sessions` 表（会话维表）

```jsonc
{
  "id": "f1e477bf-...", "cwd": "D:/lhl_files/workbuddy-auto",
  "user_id": "fdb42935-...", "title": "WorkBuddy自动签到领积分 · 每日派猫猫",
  "custom_title": null, "status": "completed", "model": "hy3", "mode": "craft",
  "created_at": 1793235140536, "updated_at": 1793235334120,
  "is_playground": 0, "deleted_at": null, "last_activity_at": 1793235333847
}
```

| 项 | 实测 |
|---|---|
| 行数 | 191（deleted 5） |
| 有 `cwd` / 有 `title` | **189 / 191（100% 有标题）** |
| 与 jsonl 会话匹配 | 命中 186；仅 jsonl 73（**全部是 subagent 会话**，不进主表）；仅 db 5（已删除） |
| 时间范围 | 2026-07-20 ~ 2026-10-29 |

⇒ 会话标题、真实路径、状态**唯一可靠来源**；jsonl 里虽有 `ai-title` 记录（163 个）和 `session-meta.meta["codebuddy.ai/sessionTitle"]`（10 个），但覆盖率都低于 db。

---

## 3. 参照实现（token.daeai.cn）口径解剖

从其首页内联脚本还原出的扫描规则如下（原文行为，非推测）：

| 环节 | 参照实现 | 本站建议 | 差异影响 |
|---|---|---|---|
| 扫描范围 | 递归所有 `*.jsonl`（含 subagents） | 相同 | — |
| 请求判据 | `providerData` 存在且 `rawUsage.total_tokens \|\| usage.totalTokens` 非空 | 相同（并要求 `usage` 存在） | — |
| 总量 | `rawUsage.total_tokens \|\| usage.totalTokens` | 相同 | **两实现总量完全一致：1,437,254,820**（未去重） |
| 输入/输出 | `rawUsage.prompt_tokens \|\| usage.inputTokens` | 相同 | — |
| 缓存命中 | `rawUsage.prompt_cache_hit_tokens`，回退 `prompt_tokens_details.cached_tokens` | 相同（回退到 `inputTokensDetails[0].cached_tokens`，实测与前者逐条相等） | — |
| 积分 | **完全未使用** | `rawUsage.credit` + db `credit_json` | 参照站缺一个核心指标 |
| 会话归属 | 文件名（depth=2）或**父会话目录名**（subagent） | `record.sessionId` | 参照站把 subagent 用量并入父会话（会话数 189 vs 259） |
| 工作空间 | **目录名** + `short_ws()` 去掉 `-WorkBuddy-` 前缀 | `record.cwd` 真实路径 | 参照站显示 `d-WORK_SPACE-YLTS-ylts-web` 这类不可读、不可排序的串 |
| 会话标题 | 取文件里**第一条非 `<` 开头的 user 文本**，截 42 字 | db `sessions.title`（100% 覆盖） | 参照站标题是「首轮提示词片段」，不是 AI 标题 |
| 去重 | **无** | `(sessionId, messageId)` 保留最新 | 参照站多算 880,600 token（0.061%） |
| 模型归一 | `MODEL_MERGE={'glm-5.2-x':'glm-5.2'}` | 建议沿用并按需扩展 | — |
| 时间桶 | 分钟级 `Math.floor(ts/60)` | 相同 | — |
| 浏览器取数 | `showDirectoryPicker()` + IndexedDB 存句柄，失败回退 `<input webkitdirectory>`；每 5 分钟静默重扫 | 可直接复用 | 本仓库的 `dropScan`/`browserScan` 已有同类能力 |

**结论**：参照实现是一个**只做 token、不做积分**的极简版；它对 subagent 的合并策略与工作空间命名是两处明确的可改进点。我们的口径在**总量上与其完全对齐**（同一份数据算出同一个数），差异全部来自「多了什么」，不是「算错了」。

---

## 4. handoff 探测清单逐条裁定

| 探测点 | 结论 |
|---|---|
| `%APPDATA%\WorkBuddy` / `WorkBuddy AI` | **存在但为空目录**（Electron 数据实际在 `~/.workbuddy/app`） |
| `%LOCALAPPDATA%\WorkBuddy` | 仅有 `logs\main.log`（2026-09-01 后停更，旧外壳） |
| `%LOCALAPPDATA%\WorkBuddyExtension` | **不存在**（WorkBuddy 不是 VS Code 插件形态） |
| `~/.workbuddy` | **存在，主战场**：`projects/`(权威)、`workbuddy.db`(元数据+积分)、`logs/`(4 天)、`usage-log.json`(技能，非 token) |
| `~/.workbuddy-ai` | **存在，已废弃**：db 全 0 行，`sessions/` 是 PID 心跳 |
| `~/.workbuddy-ai-`、`~/.workbuddy-key-fallback` | 存在但只含 `logs/`、`connector-keys/`，**无用量** |
| `.vscode\extensions\*workbuddy*` | **不存在**（不需要，WorkBuddy 自带 CLI 内核） |
| `state.vscdb` / `codebuddy-sessions.vscdb` 等 VS Code storage | **不存在**（不适用） |
| `%APPDATA%\<产品>\logs\<时间戳>\window<N>\exthost\` | **不存在**；对应物是 `~/.workbuddy/logs/<日期>/`，含 `totalTokens` 但**只留 4 天** |
| 是否有 `notifyStepEnd` 式 step 级日志 | **不需要**：jsonl 本身就是**逐请求**粒度，比 CodeBuddy 的 step 日志更细 |
| 与 CodeBuddy 共用扩展 | **否**。两者同厂商同版本号（5.9.x），数据根完全独立。需分两层说：**token 用量零重叠 → 可直接相加合并**（见 §9）；**积分共用同一账户** → `Σcredit` 只是"账号账单的本机可见部分"，不是单产品归属 |

---

## 5. 数据源定档

### Tier 1 — 必选

| 源 | 提供什么 | 读取方式 |
|---|---|---|
| **A. `projects\**\*.jsonl`** | 逐请求 `inputTokens / outputTokens / totalTokens / cached / reasoning / credit`、`model`、`sessionId`、`cwd`、`timestamp`、`conversationRequestId` | 递归遍历（含 `subagents/`），逐行 JSON，按 `(sessionId, messageId)` 去重 |
| **B. `workbuddy.db` → `sessions`** | `title / custom_title / cwd / status / model / mode / created_at / updated_at` | `sqlite3` 只读 |

这两个源即可支撑全部核心指标：

```
概览卡     : ΣtotalTokens / Σcredit / 请求数 / 会话数 / 活跃天数
每日趋势   : 按 timestamp 聚合（缓存三段堆叠：hit / miss / output + credit 折线）
会话榜     : 按 sessionId 聚合 → B 补 title / cwd / status
项目榜     : 按 cwd 聚合（A 自带，100% 覆盖，无需任何映射）
模型分布   : providerData.model（+ MODEL_MERGE 归一）
缓存命中率 : Σcached / Σinput（92.2%）
请求大小分布: 单条 totalTokens 直方图（先按 (session,messageId) 去重）
0-24 时分布 : timestamp 小时桶
```

### Tier 2 — 增强

| 源 | 提供什么 | 代价 |
|---|---|---|
| **B. `session_usage`** | `used/size`（上下文占用）、`credit_json`（turn 级积分终值） | 一并读，成本≈0；但覆盖仅 32% |
| **`reasoning` 记录** | 思考正文（体积大，不建议入看板） | 8,407 条 |
| **`logs\<日期>\`** | `totalTokens` 日志旁证 | 只留 4 天，价值低 |
| **`ai-title` 记录** | 163 个 AI 生成标题（db 无时的回退） | 顺手可读 |

### Tier 3 — 明确不做

- `usage-log.json`（技能使用，不是 token）
- `audit-log\*`（命令安全审计，无 token）
- `traces\*`（span 级，`totalTokens` 恒为 0）
- `*.file-rollback.ndjson`、`tool-results\*`、`file-history-snapshot`、`blobs`、`changes-*`
- `~/.workbuddy-ai`（旧产品线，0 用量）
- `%LOCALAPPDATA%\WorkBuddy\logs`（已停更）

---

## 6. 已知覆盖缺口（必须在 UI 上明示）

| 缺口 | 说明 | 影响 |
|---|---|---|
| **积分不全 — 字段覆盖** | `rawUsage.credit` 覆盖 94.5% 请求；db `credit_json` 只覆盖 32% 的 turn | 合并后覆盖率必须**按请求数加权**计算，不可把两个百分比直接相加或取平均 |
| **积分不全 — 账号口径** | CodeBuddy 与 WorkBuddy **共用积分账户**（§2.5 第四路） | 单产品 `Σcredit` ≠ 账号账单；合并后是「账号消耗**下限**」，恒 ≤ 真值，不可宣称"总积分" |
| **无记录日（不是缺口）** | 区间 102 天内有数据 77 天；空档集中在 `2026-07-22~07-31`、`2026-10-01~10-07`（长假）及若干零散单日 | **主因是多工具 / 多 agent 切换使用**——当天本机没跑 WorkBuddy，不是数据丢了；会话被删是次因。合并 CodeBuddy 后并集 ≥ 77/102 天，剩余空档基本是长假。**UI 只作中性留白，不画缺口告警** |
| **会话被删即消失** | db 的 `deleted_at` 有 5 条；jsonl 文件被删后无任何残留 | 早期会话不可恢复 |
| **subagent 会话无元数据** | 73 个 subagent 会话不在 `sessions` 表 | 无标题，只能显示模型 + token |
| **自定义模型 usage 全零** | 实测 1 例（`sensenova-6.8-flash-lite`）`usage` 全 0，只有 `rawUsage` 有值 | 必须以 `rawUsage` 回退，否则漏 67,916 token |
| **无单价表** | 本地只有 `credit` 与 `models.json`（含自建模型 endpoint，**含明文 apiKey，请勿采集**） | 不能换算人民币 |
| **日志窗口 4 天** | `~/.workbuddy/logs` 只保留 2026-10-26 起 | 不可作为历史来源 |

---

## 7. 建议的规范化采集契约

```jsonc
// usage.json —— Tier1 两个源即可产出
{
  "generatedAt": "ISO8601",
  "source": { "projectsRoot": "C:/Users/<user>/.workbuddy/projects",
              "sessionsDb": "C:/Users/<user>/.workbuddy/workbuddy.db" },
  "coverage": { "first": "2026-07-20", "last": "2026-10-29",
                "daysWithData": 77, "daysInRange": 102, "missingDays": ["2026-08-02", "..."] },
  "totals":   { "requests": 12369, "sessions": 259, "projects": 17,
                "inputTokens": 1424873457, "outputTokens": 11500770,
                "totalTokens": 1436374220,
                "cacheHitTokens": 1314136466, "cacheMissTokens": 110736991,
                "reasoningTokens": 6416321,
                "credit": 4315.98, "requestsWithCredit": 11686,
                "cacheHitRate": 92.2 },
  "daily":    [ { "date": "2026-10-29", "requests": 11, "totalTokens": 649261,
                  "cacheHitTokens": 0, "cacheMissTokens": 0, "outputTokens": 0, "credit": 0.0 } ],
  "sessions": [ { "sessionId": "...", "title": "...", "cwd": "d:/lhl_code/...",
                  "status": "completed", "model": "hy3", "mode": "craft",
                  "isSubAgent": false, "requests": 424, "totalTokens": 93315262,
                  "credit": 0.0, "startedAt": 1792... , "updatedAt": 1793... } ],
  "selfCheck": { "totalEqInPlusOut": "12382/12383", "cachedLeInput": "12383/12383",
                 "dupMessageIdSkipped": 14, "usageZeroFallback": 1,
                 "subagentFiles": 82, "badLines": 0 }
}
```

**采集顺序**：① 递归扫 `projects/**/*.jsonl` 抽 usage（`subagents/` 不可漏）→ ② 按 `(sessionId, messageId)` 去重保留最新 → ③ 读 `workbuddy.db.sessions` 补 title/cwd/status → ④（可选）读 `session_usage` 补上下文占用与 turn 级积分。

**必须内置的自检**：`total == in + out`、`cached <= input`、`usage.requests == 1`、重复 messageId 计数、`usage` 全零回落计数。任一异常即视为解析 bug，而不是「数据缺失」。

**切片边界**：上面这份 `usage.json` 是**单产品切片**，不得自带跨源归一化，也不得写入任何合计值。合并由看板侧的 `mergeDatasets()` 完成，归一化、去重与积分口径见 **§9**——两边都做归一会让规则打架，且无法判断是哪一层出的错。

---

## 8. 置信度

| 结论 | 置信度 | 反证方式 |
|---|---|---|
| `providerData.usage` 是权威请求级用量 | **高** | 换机看 `usage/rawUsage` 是否仍 1:1 共存 |
| 解析结果与应用自记的上下文占用一致 | **高**（170/175 逐字节相等） | 扩大样本到剩余 4 个不等的会话查明原因 |
| 去重规则（同 messageId 取最新）正确 | 中高 | 若上游出现「同一 messageId 两次都计费」的说明，则本结论需修正 |
| 积分 `rawUsage.credit` 是当时值、db 是终值 | 中高 | 对 16 个不等 turn 逐 stage 追踪 |
| subagent 用量不与主线程重复 | **高**（messageId 交集 0） | 换机复测 |
| 本地无法换算人民币 | 高 | 若能拿到官方单价表则需修正 |
| `Σcredit` 可与官方账号账单对齐 | **低（且永不相等）** | 共用账户，本地只能给出下限；拿当月账单核对必然出现正差额 |
| 交叠项目按「分隔符归一 + 大小写保守」可正确合并 | 中高 | 实测两源仅 1 个交叠项目，样本极小；出现第二个交叠项目时需复测 |

---

## 9. 跨源合并：与 CodeBuddy 合并成一份统计

> 本节是 2026-10-29 追加的**合并口径**，目标形态已从「WorkBuddy 独立看板」改为「**本机 AI 用量总账**」：两源加载后融合成一份 `Dataset`，概览 / 趋势 / 项目榜 / 会话榜 / 模型榜**只有一份数字**。

### 9.1 合并的可行性：字段层无损

`token.summary` 所需的 7 个字段两源齐全，且 WorkBuddy 侧更干净（`hit + miss == input` 100% vs CodeBuddy 的恒等式靠实测兜住）。真正需要扩展的是**归属维度**：

| 维度 | CodeBuddy | WorkBuddy | 合并处理 |
|---|---|---|---|
| 请求时间 | `requests[].startedAt` | 记录 `timestamp` | 直接映射 |
| token / 缓存 / 积分 | `usage.*` | `usage.*`（全零回落 `rawUsage`） | 直接映射；`cacheWrite` WorkBuddy 恒 0 |
| **模型** | **会话级** `selectedModelId`（221 会话中 84 个缺失） | **请求级** `providerData.model` | 请求级优先，会话级回落（§9.3） |
| **项目** | vscdb `cwd` | `record.cwd`（100%） | 归一化后作 key（§9.3） |
| **会话 ID** | `conversationId` | `sessionId`（含 70 个 subagent） | 加源前缀隔离（§9.3） |
| 会话标题 | vscdb `title` | jsonl `ai-title`（63%）/ db `sessions.title`（100%） | 无 db 也能跑，db 只做增强 |
| 请求去重键 | 无需求 | `(sessionId, messageId)`，14 组重试双写 | 记录级新增可选 `key` |

⇒ **接入 `workbuddy.db` 不是前置条件**：请求级 `model` / `cwd` / `credit` 全在 jsonl 里。通用 SQLite 行解码器（`sessions` 表 43 列 / 2.5 MB）是后续增强，不是门槛。

### 9.2 实测：两源的重叠比预期小得多

2026-10-29 探针结果（只读，脚本用完即删）：

| 项 | CodeBuddy（vscdb） | WorkBuddy（jsonl） | WorkBuddy（db） |
|---|---|---|---|
| 带 cwd 的会话 | 133 | 189 | 189 |
| **唯一项目（cwd）** | **9** | **17** | 17 |
| cwd 写法 | 盘符**小写** + **正斜杠**：`d:/WORK_SPACE/YLTS/ylts-web` | 盘符**小写** + **反斜杠**：`d:\WORK_SPACE\YLTS\ylts-web` | 盘符**大写** + **混合斜杠**（136 反 / 53 正） |

- **原始字符串完全相等的项目：0 个。**
- 按末段目录名配对，两源交集 **仅 1 个项目**（`ylts-web`），且差异**只在分隔符**，大小写与盘符写法两源一致。
- 同一源内部「归一后对应多种原始写法」的项目：**0 个**（即源内不会自裂）。
- ⇒ 合并后项目榜是 **并集 25 个项目**（9 + 17 − 1）。合并的价值主要在**并集视图**（看清"哪个项目用了哪个工具"），而不是"重叠相加"。
- ⚠️ **db 的 cwd 不可用于合并**：它把盘符写成大写、斜杠混用，用它会与同源的 jsonl 记录自相分裂。**一律取 `record.cwd`**，db 的 cwd 仅供展示或回退。

模型名实测：

| 项 | 结果 |
|---|---|
| CodeBuddy 唯一模型 | 7（`deepseek-v4.1-flash` 100 会话、`hy3` 17、`glm-5.3-flash` 8、`space-bunny` 6、`hy4-preview` 4、`step-5-preview` 2、`deep-model` 1；另有 **84 个会话无 `selectedModelId`**） |
| WorkBuddy 唯一模型 | 14（`hy3` 5,525 请求 / `deepseek-v4.1-flash` 3,451 / `hy4-preview` 725 / …） |
| **跨源同名（忽略大小写）** | **5 个**：`deepseek-v4.1-flash`、`glm-5.3-flash`、`hy3`、`hy4-preview`、`space-bunny` |
| 单侧独有 | CodeBuddy：`deep-model`、`step-5-preview`；WorkBuddy：`glm-5.2`、`glm-5.2-x`、`glm-5.3`、`gpt-5.6-sol`、`hy3-x`、`deepseek-v4-flash`、`deepseek-v4-pro`、`mimo-v2.6-pro`、`sensenova-6.8-flash-lite` |

⇒ 模型榜**无需跨源映射表**即可干净合并；只需 WorkBuddy 侧沿用参照实现的 `glm-5.2-x → glm-5.2`。合并后的「未记录模型」桶全部来自 CodeBuddy 的 84 个无模型会话，必须在 UI 上标明来源，不要让人以为是 WorkBuddy 的问题。

### 9.3 三处归一化裁定

| # | 对象 | 裁定 | 理由与代价 |
|---|---|---|---|
| 1 | **项目路径** | **大小写绝不归一**（保持原样、区分大小写）；**但统一分隔符 `\`→`/` 并去尾斜杠** | 用户裁定：宁可裂成两行也绝不误并。分隔符统一不属于大小写范畴，且**不可能造成误并**（同一路径的两种写法）；不与 db 的 cwd 混用。实测代价：若不统一分隔符，唯一的交叠项目 `ylts-web` 会在项目榜裂成两行 |
| 2 | **模型名** | 请求级优先 `r.model ?? session.modelId ?? '未记录模型'`；沿用 `MODEL_MERGE = { 'glm-5.2-x': 'glm-5.2' }` | 跨源 5 个同名模型实测已对齐，无需额外映射；CodeBuddy 侧维持会话级（不为此去扫 14,534 个 `messages/*.json`），覆盖率差异在 UI 上标注 |
| 3 | **会话 ID** | 一律加源前缀：`codebuddy:<conversationId>` / `workbuddy:<sessionId>` | 两源都是裸 UUID。撞 ID 概率极低，但现有解析器会把同 ID 会话**静默合并**，后果不可逆；subagent 会话单独打 `isSubAgent` 标 |

**必须留痕，不许静默**：出现「归一后 key 相同、原始字符串不同」时，计入 `selfCheck.suspectedDuplicateProjects` 并在数据体检页列出，由人判断，而不是由程序自动合并。

### 9.4 积分合并口径

- 合并后 `Σcredit` = **账号消耗下限**，UI 文案只能是「已知积分（覆盖 X% 请求）」，禁止写「总积分」。
- 覆盖率按**请求数加权**：`Σ(有 credit 的请求) / Σ(全部请求)`，两源共同计入分母。
- CodeBuddy 侧 `ask` 模式 `credit` 恒为 0（实测 8/8），会把覆盖率虚高——需在体检页单列，不并入"缺失"。

### 9.5 空档合并口径

- `missingDays` 语义改为**「两源皆无记录的日子」**，重命名为**无记录日**。
- 按源分别算 coverage 后再取并集；**不画缺口告警区段**，只作中性留白。
- 本机无记录 = 当天没用这两个产品（多 agent 切换的正常结果），不是数据缺失的告警项。

### 9.6 合并后必须成立的自检

```
两源 token 相加后，逐日相加 == 合并后逐日            // 防止合并层重复计数
合并后 requests == Σ各源 requests                    // 同上
同一 (source, sessionId, messageId) 不重复            // 跨源不去重，源内必须去重
归一后同 key 不同原串的项目数 == selfCheck.suspectedDuplicateProjects
积分覆盖率 = 有 credit 请求数 / 全部请求数（两源合并分母）
```
