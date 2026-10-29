# CodeBuddy IDE 本地数据源勘察报告

> 勘察日期：2026-10-29　机器：`HUAWEI`（win32）　CodeBuddy CN 5.9.x（VS Code 系）
> 方法：**全部结论来自本机真实文件的解析结果**，不引用二手整理。
> 复核脚本（已随本报告落盘，可直接重跑）：`docs/exploration/cb_verify.py`、`docs/exploration/cb_log_vs_hist.py`，参考输出 `docs/exploration/cb_verify_out.json`。

---

## 0. 裁定结论

**`handoff-codebuddy-token-dashboard.md` 的核心判断正确，可以据此开工；但有 7 处需要修正，其中 2 处会直接导致采集器漏数据。**

- ✅ 主数据源定位准确：`history\<projectHash>\<conversationId>\index.json` 的 `requests[].usage` 是**唯一权威的请求级用量**来源，8 个字段实测 **662/662 条 = 100% 齐全**。
- ✅ 日志格式、双层字符串化 JSON、长路径、编码这些"坑"全部实测复现，描述准确。
- ⚠️ 遗漏了 **`codebuddy-sessions.vscdb`**——本地唯一能拿到会话标题 / 项目路径 / 完成状态的来源，对看板价值极高。
- ⚠️ 遗漏了 **`state.vscdb` 内嵌的模型目录**（24 个模型 + 上下文长度 + 积分倍率）。
- ❌ 路径模板写得比实际更窄：`<uid>` 槽位还可能是 base64 编码的项目路径，产品线还可能是 `WXIDE`。
- ❌ §2 表格 C 行的路径拼写错误：`tencent-cloud.coding-pilot` 实际为 `tencent-cloud.coding-copilot`。
- ❌ "日志不能当权威"这句话会误导：实测**日志的 step 级数据按 requestId 汇总后与 history 请求级数据 0.0% 误差、积分完全相等**（11/12 命中）。日志不是"不能信"，而是"覆盖不全"。
- ❌ "必须锚定行首"不足以防误匹配：`[TerminalExecutor]` 的命令回显行**同样以时间戳开头**，命令文本里含 `notifyStepEnd` 时仍会命中。
- 📉 所有数字已过期（正常）：655 请求 → **663**；874,818,785 token → **879,462,435**；1582.99 积分 → **1592.42**。

---

## 1. 本机数据全景（实测）

| # | 位置（绝对路径模板） | 实际内容 | 用量价值 | handoff |
|---|---|---|---|---|
| **A** | `%LOCALAPPDATA%\CodeBuddyExtension\Data\<uid>\CodeBuddyIDE\<uid>\history\` | 85 个项目 / 206 会话 / 663 请求 / 14,534 条消息 / 254 MB | ★★★★★ 权威 | 已覆盖 |
| **B** | `%APPDATA%\CodeBuddy CN\logs\<启动时间戳>\window<N>\exthost\Tencent-Cloud.coding-copilot\腾讯云代码助手.log` | 逐 step 的 `notifyStepEnd` usage，含 `thinkingTokens` | ★★★★ 精确但轮转 | 已覆盖 |
| **F** | `%APPDATA%\CodeBuddy CN\codebuddy-sessions.vscdb` | SQLite `ItemTable`，128 条 `session:<convId>`，含 title/cwd/status/时间 | ★★★★★ 元数据 | **未覆盖** |
| **G** | `%APPDATA%\CodeBuddy CN\User\globalStorage\state.vscdb` → 键 `Tencent-Cloud.coding-copilot` | 内嵌 gzip+base64 产品配置：**24 个模型目录、maxInputTokens、credits 倍率、tokenUsageThresholds** | ★★★★ 模型维度 | **未覆盖** |
| **C** | `%APPDATA%\CodeBuddy CN\User\globalStorage\tencent-cloud.coding-copilot\` | `genie-history`(545K) / `edit-sessions` / `file-changes`(23M,全空) / `todos`(260K) / `media-index` / `message-queue` / `brain` | ★☆ 仅 `edit-sessions` 有 fileDiffs | 部分覆盖且路径拼错 |
| **D** | 同上 `state.vscdb` 的其它键 | 草稿、主题、`chatModelThinkingGlobalMap` 等 | ☆ 无用量 | 已覆盖 |
| **E** | `%APPDATA%\CodeBuddy CN\User\workspaceStorage\<hash>\workspace.json` | `{"folder":"file:///d%3A/..."}`，**仅 12 个可映射**，而项目 hash 有 85 个 | ★ 覆盖率 14% | 已覆盖但高估 |
| **H** | `%LOCALAPPDATA%\CodeBuddyExtension\Logs\CodeBuddyIDE\<YYYY-MM-DD>\<workspace>__<hash>.log` | 按工作区按天，含 `userId=`、内存/插件日志；**无 token** | ☆ | 未覆盖（发现但无价值） |
| **I** | `~\.codebuddy\` | `skills`、`plugins`、`memery`、`models.json`(338B)、`logs\memwatch\*`（CLI 内存日志） | ☆ | 未覆盖（无用量） |
| **J** | `%LOCALAPPDATA%\CodeBuddyExtension\Data\<uid>\WXIDE\<uid>\history\` | 微信 IDE 产品线，3 项目 / **0 请求** | ☆ | 未覆盖 |
| **K** | `%LOCALAPPDATA%\CodeBuddyExtension\Data\default\CodeBuddyIDE\<base64 项目路径>\history\` | 2 项目，会话创建于 07-31 / 09-14，**0 请求** | ☆ | 未覆盖 |

> **重要**：A 的三/四个候选根中，**100% 的用量都来自 `fdb42935-f98d-45a6-9cda-8be6bff04c36`**（663/663）。其它根贡献 0，所以"选 index.json 最多的目录"这一启发式在当前机器上不会漏量；但**不该把它写成唯一正确形态**，因为它只是"未清理的历史遗留"。

---

## 2. 主数据源实证

### 2.1 A：请求级用量（权威）

复核口径（本次全量扫描）：

| 指标 | 实测值 |
|---|---|
| 请求总数 | **663** |
| 带 `usage` 的请求 | **662**（缺 1 条，原因见下） |
| 累计 `totalTokens` | **879,462,435** |
| `inputTokens` / `outputTokens` | 871,625,468 / 7,836,967 |
| `cacheTokens` | 857,559,749（缓存命中率 ≈98.4%） |
| 累计 `credit` | **1592.42** |
| 日期范围 | **2026-08-10 ~ 2026-10-29**，有数据 **39 天**，区间内缺失 **42 天** |
| 类型分布 | `craft` 655 / `ask` 8 |
| 项目 / 会话 | 85 / 206（其中 127 个会话含请求） |

**两条恒等式在全量 662 条上 100% 成立**，可直接作为采集器的数据完整性断言：

```
inputTokens == cacheTokens + cachedMissTokens      // 662/662 成立，0 反例
totalTokens == inputTokens + outputTokens          // 662/662 成立，0 反例
```

**缺 `usage` 的那条请求同时缺 `startedAt`**，字段集只有 `{id, messages, state, type}`——它是**正在生成中的在途请求**，不是脏数据。当前这次对话的第 5 个请求就是这个形态。⇒ 采集器必须以 **`usage` 存在**为纳入条件，同时以 `startedAt` 存在为时间归集条件，两者都缺失时跳过且不告警。

### 2.2 F：`codebuddy-sessions.vscdb`（新增，强烈建议纳入）

```
%APPDATA%\CodeBuddy CN\codebuddy-sessions.vscdb   (64 KB, 128 行)
  ItemTable(key='session:<conversationId>', value=JSON)
```

实测值样例：

```json
{"conversationId":"7f007c0561d349439349ff8e412d4f8c",
 "cwd":"d:/WORK_SPACE/YLTS/ylts-web",
 "userId":"fdb42935-f98d-45a6-9cda-8be6bff04c36",
 "title":"WorkBuddy 技能迁移至 CodeBuddy 方案",
 "status":"Completed",
 "createdAt":1786345561222, "updatedAt":1786346967412,
 "isPlayground":false}
```

**这是本地唯一同时给出「会话标题 + 项目绝对路径 + 完成状态」的地方**，且是 SQLite 单文件、读取成本 O(1)。它与 A 的会话数（127 有请求 + 1 在途 = 128）**完全对齐**，可直接做 `conversationId` 维表。

### 2.3 B：日志 = A 的精确逐步骤切分（修正 handoff 的定性）

用今日日志（25 个文件）与 history 交叉比对：

| requestId | 日志 step 数 | 日志 Σ totalTokens | history totalTokens | 差异 | 日志 Σ credit | history credit |
|---|---|---|---|---|---|---|
| `cb74881a…ee81bd` | 13 | 284,347 | 284,347 | **0.0%** | 1.43 | 1.43 |
| `04126280…66c9` | 10 | 382,384 | 382,384 | **0.0%** | 1.37 | 1.37 |
| `5293f1fb…2e759` | 33 | 3,072,692 | 3,072,692 | **0.0%** | 5.49 | 5.49 |
| `0df0a40b…28e5` | 9 | 1,078,077 | 1,078,077 | **0.0%** | 2.19 | 2.19 |

11/12 命中，**token 与积分逐条完全相等**。结论修正为：

> 日志不是"低可信度的近似值"，而是 history 请求记录的**逐步骤展开**。它的缺陷只是**时间覆盖短**（本机仅 `20261024` 起 10 个启动目录，18 MB；此前已被轮转）。

**并且日志是唯一能按请求拿到 `thinkingTokens` 的来源**（history 的 `usage` 无此字段；`extra.statsSnapshot` 只在 189/4000 采样消息中出现）。

### 2.4 G：模型目录（新增）

`state.vscdb` → 键 `Tencent-Cloud.coding-copilot` → 字段 `CodeBuddy-Product-Cache`（base64 后的 gzip）解压后含：

- `models[]`：24 个模型，字段含 `id / name / maxInputTokens / maxOutputTokens / contextWindow / credits / supportsReasoning / vendor`
- `credits` 是**倍率字符串**，如 `deepseek-v4.1-flash → "x0.11"`、`glm-5.3-flash → "x0.08"`、`auto → null`
- `tokenUsageThresholds`、`modelTiers`（订阅优先分层）、`config.limitHintCN`（"credit 额度已用完"）

⇒ 可用于看板的「模型选择器 / 倍率标注 / 上下文上限」，**但不能用来反推人民币价格**（本地无单价表，handoff 的这条判断成立）。

### 2.5 模型归属：两级口径

| 口径 | 来源 | 覆盖率 | 成本 |
|---|---|---|---|
| 会话级 `selectedModelId` | `history\<projectHash>\index.json` → `conversations[]` | **131/206（63.6%）**，其余 75 条为旧格式无此字段 | 85 个文件 |
| 请求级 `modelId` | `history\…\<convId>\messages\<msgId>.json` → `extra.modelId` | 高（采样 4000 条中 4000 条有） | 14,534 个文件 |

实测模型分布（消息级采样）：`deepseek-v4.1-flash` 11938、`glm-5.3-flash` 785、`space-bunny` 713、`hy3` 476、`hy4-preview` 462、`auto` 70、`step-5-preview` 62。

⇒ MVP 用会话级（便宜），"按模型"卡片上线后再降级到消息级。

---

## 3. handoff 逐条裁定

| # | handoff 断言 | 裁定 | 实测证据 |
|---|---|---|---|
| 1 | 主数据源是 `history\…\<convId>\index.json` 的 `requests[].usage` | ✅ 正确 | 663 请求 / 662 带 usage |
| 2 | 8 个 usage 字段 100% 齐全 | ✅ 正确 | 662/662，字段名与顺序一致 |
| 3 | `inputTokens` 是跨 step 累计，不能与日志相加 | ✅ 正确且可加强 | 日志 Σstep 与请求级**完全相等**（0.0%），不是"约等于" |
| 4 | 日志的 `notifyStepEnd` 需锚定行首 | ⚠️ 不充分 | `[TerminalExecutor]` 回显行也以 `2026-` 开头，需再加 `[BaseAgent:(craft\|ask)]` 与 `notifyStepEnd, step: \d+` |
| 5 | `genie-history` 无用 | ✅ 正确 | 79 目录仅 `current.json`，`conversations\` 空 |
| 6 | C 目录路径 `tencent-cloud.coding-pilot` | ❌ 路径错 | 实际 `tencent-cloud.coding-copilot` |
| 7 | `state.vscdb` 无用量 | ✅ 正确（就"用量"而言） | 但含**模型目录**，不应整体判死 |
| 8 | workspaceStorage 可做 hash↔路径映射 | ⚠️ 严重高估 | 12 个 workspace.json vs 85 个项目 hash，覆盖率 14% |
| 9 | 整个 `Data\<uid>` 252 MB / 14,791 json | ✅ 基本准确 | 现 254 MB / 14,534 messages（+85 项目 index） |
| 10 | 日志会被轮转，必须归档 | ✅ 正确 | handoff 记录的 `20261023T085727` 已消失；现存最早 `20261024T095335` |
| 11 | ask 模式 credit 恒为 0 | ✅ 正确 | 8/8 |
| 12 | `edit-sessions` 未被提及 | ➕ 遗漏 | 含 `fileDiffs{uri:{oldContent,content,hunkStates}}`，可做"改动文件数" |
| 13 | `codebuddy-sessions.vscdb` 未提及 | ➕ 遗漏 | 128 条会话元数据 |
| 14 | 缺失日期 10-24/26/27 | ⚠️ 不全 | 另缺 **10-22、10-25** |
| 15 | 覆盖 08-10~10-28 / 38 天 / 655 请求 | 📉 已过期 | 08-10~10-29 / 39 天 / 663 请求 |

---

## 4. 必须修正的 7 条（按严重度）

1. **采集器准入条件**：以 `request.usage` 存在为准入，`startedAt` 缺失时跳到下一请求；否则在途请求会被记成"缺失 1 条"并污染覆盖率统计。
2. **日志正则**：`^<ts> .*\[BaseAgent:(craft|ask)\] \[[0-9a-f]{32}\] notifyStepEnd, step: \d+.*usage: (\{.*?\}), isMaxTokenLimit`。只锚行首会误吞终端回显。
3. **补 `codebuddy-sessions.vscdb`** 作为会话维表；否则看板做不出「会话标题列表」「按项目聚合」。
4. **修正 C 目录拼写**，并补 `edit-sessions\`、`todos\`、`brain\` 的用途说明（`file-changes` 186 个目录实测全空，别去解析）。
5. **纠正「日志不能当权威」**：改为「日志与 history 逐请求完全一致，但覆盖窗口只有最近约 10 次启动，必须常驻归档」。
6. **`<uid>` 不是唯一形态**：真实布局是 `Data\<uid|default>\<CodeBuddyIDE|WXIDE>\<uid|base64(项目路径)>\history`。实现时应 glob 四段并逐一探测，而非只拼一种模板。
7. **workspaceStorage 映射率只有 14%**，不要把它当主关联键；项目维度应从 `sessions.vscdb.cwd` 取。

---

## 5. 最基础的数据源定档（MVP）

### Tier 1 — 必选，缺一不可

| 源 | 提供什么 | 读取方式 |
|---|---|---|
| **A. `history\**\<convId>\index.json`** | 请求级 `inputTokens / outputTokens / totalTokens / cacheTokens / cachedWriteTokens / cachedMissTokens / lastTokens / credit`、`startedAt`、`type(craft\|ask)`、`state` | 遍历 85 个项目目录下 206 个 index.json |
| **F. `codebuddy-sessions.vscdb`** | `conversationId / title / cwd / status / createdAt / updatedAt / isPlayground` | `sqlite3` 只读，`ItemTable` 前缀 `session:` |

最小可行指标（这两个源即可全部支撑）：

```
概览卡     : ΣtotalTokens / Σcredit / 请求数 / 活跃天数
每日趋势   : 按 startedAt 聚合（cache / miss / output 三段堆叠 + credit 折线）
会话榜     : 按 conversationId 聚合 → 用 F 补 title 与 cwd
项目榜     : 按 cwd 聚合（来自 F，覆盖 100%，优于 workspaceStorage 的 14%）
类型占比   : craft vs ask
缓存命中率 : Σcache / Σinput
数据缺口   : 区间内 missingDays（置灰）
```

### Tier 2 — 增强，第二阶段接

| 源 | 提供什么 | 代价 |
|---|---|---|
| **B. APPDATA 扩展日志** | step 级明细、`thinkingTokens`、`elapsedMs` 近似、日志↔history 交叉校验 | 需常驻归档，否则窗口只有 ~10 次启动 |
| **`messages\*.json` 的 `extra`** | 请求级 `modelId`、`toolStatus`、`statsSnapshot{thinkingTokens, elapsedMs}`、`inputPhrase` | 14,534 文件，需长路径支持 |
| **G. state.vscdb 模型目录** | 模型显示名、上下文上限、`credits` 倍率 | 一次解压即可，几乎零成本 |
| **`edit-sessions\*.json`** | `fileDiffs` → 本次会话改动文件数 | 只覆盖活跃会话 |

### Tier 3 — 明确不做

- `file-changes\`（186 目录实测全空）、`genie-history\`（仅指针）、`media-index`、`message-queue`
- `LocalAppData\...\Logs\CodeBuddyIDE\`（无 token）
- `~\.codebuddy\logs\memwatch\`（仅内存曲线）
- `WXIDE` / `default` 两条产品线根（0 请求，但**探测逻辑要能跳过它们**）

---

## 6. 已知覆盖缺口（必须在看板 UI 上明示）

| 缺口 | 说明 | 影响 |
|---|---|---|
| **代码补全 Inline Completion** | 日志只有 `[Inline Completion] COMPLETION START` 与耗时，**无 token / 积分** | 补全用量永久不可得 |
| **Inline Chat / 选中代码问** | history 不产生 `requests[]` | 少算 |
| **云端会话** | 正文不落本地 | 跨机器无法汇总 |
| **日志轮转** | 本机只剩 10 次启动（10-24 起），18 MB | 早于 10-24 的 step 明细永久丢失 |
| **history 被清理** | 08-11~08-20 等 42 天空档部分源于此 | 历史非绝对完整 |
| **多 uid / 多产品线** | 4 个 history 根，仅 1 个有数据 | 换机/换账号后需重新探测 |
| **积分口径** | 只有 `credit`，无单价表 | 不能换算人民币 |

---

## 7. 建议的规范化采集契约

```jsonc
// usage.json  —— Tier1 单文件可产出
{
  "generatedAt": "ISO8601",
  "source": { "historyRoot": "...", "sessionsDb": "...", "logRoot": "..." },
  "coverage": { "first": "2026-08-10", "last": "2026-10-29",
                "daysWithData": 39, "daysInRange": 81, "missingDays": [...] },
  "totals":   { "requests": 663, "ask": 8, "craft": 655,
                "inputTokens": 871625468, "outputTokens": 7836967,
                "totalTokens": 879462435, "cacheTokens": 857559749,
                "credit": 1592.42, "days": 39, "cacheHitRate": 98.4 },
  "daily":  [ { "date": "2026-10-29", "requests": 2, "totalTokens": 204532,
                "inputTokens": 0, "outputTokens": 0, "cacheTokens": 0, "credit": 0.67 } ],
  "sessions": [ { "conversationId": "...", "title": "...", "cwd": "d:/lhl_code/...",
                  "status": "Completed", "type": "craft", "modelId": "deepseek-v4.1-flash",
                  "startedAt": 1787..., "totalTokens": 0, "credit": 0.0 } ],
  "selfCheck": { "inputEqCachePlusMiss": true, "totalEqInPlusOut": true,
                 "inFlightSkipped": 1 }
}
```

**采集顺序**：① 扫 history 的 project index（拿会话列表 + `selectedModelId`）→ ② 扫 conv index（拿请求与 usage）→ ③ 读 sessions.vscdb 补 title/cwd → ④（可选）解日志做校验与 `thinkingTokens` 补录。

**必须内置的自检**：两条恒等式 + `usage` 缺失计数 + `inFlightSkipped` 计数。任一不成立即视为解析 bug，而不是"数据缺失"。

---

## 8. 置信度

| 结论 | 置信度 | 反证方式 |
|---|---|---|
| `requests[].usage` 是权威用量 | **高** | 换一台机器看字段是否仍 8/8 |
| 日志 step 汇总 == history 请求级 | **高**（11/12 精确相等） | 扩大样本到全部 12 个 requestId |
| `sessions.vscdb` 覆盖全部会话 | 中高（128 vs 127+1） | 有会话被删而 A 保留时会失配 |
| 模型归属应走消息级 | 中（会话级仅 63.6%） | 同一会话内切模型的情况未量化 |
| 积分不可换算人民币 | 高 | 若 `credits` 倍率 × 某基础单价可推导，则本结论需修正 |
