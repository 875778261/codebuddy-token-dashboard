# codebuddy-token-dashboard

本机 AI 用量的本地看板：从 CodeBuddy IDE、CodeBuddy CLI 与 WorkBuddy 的本地文件里读出用量，合并成一份统计，纯前端、零上传。

## Language

### 数据与来源

**数据源（Source）**：一个产品在本机落盘的用量数据根，当前有 `codebuddy`（IDE）、`codebuddy-cli`（CLI）与 `workbuddy` 三个。同一产品可以有多个源，各源的保留窗口与格式互不相干，源之间不互相覆盖。
_Avoid_: 渠道、厂商、provider

**端（End）**：把源按产品归组得到的比较单位，当前有 `codebuddy`（源 `codebuddy` + `codebuddy-cli`）与 `workbuddy` 两个。端对比与「账号消耗下限」只在端层成立；源切片视图仍在源层，是视图而非第二份数据。
_Avoid_: 产品线、平台、厂商

**切片（Slice）**：只来自单一数据源、尚未与其他源合并的数据集。切片不得自带跨源归一化。
_Avoid_: 分片、分表

**切片视图（Slice view）**：在合并后的 Dataset 上按 `source` 过滤得到的统计结果，与切片同数字、同口径。它是视图，不是第二份数据，也不允许有自己的聚合实现。
_Avoid_: 分源看板、双管线

**合并视图（Merged view）**：两源归一化后融合成的唯一统计结果，所有指标只有一份数字。
_Avoid_: 汇总视图、双源视图

**端对比（Source comparison）**：合并视图旁边的一组派生指标，只在两端都载入时出现，分三层：量差、效率差、节奏差。
_Avoid_: 端差异报表、产品对比

**同模型对照（Same-model comparison）**：只取两端都存在的模型，比较缓存命中率与每百万 token 积分。这是唯一可 apples-to-apples 的效率比较；跨模型的差异主要来自模型构成。
_Avoid_: 效率排名

**快照（Snapshot）**：可导出的整份数据集 JSON，用于归档、换机与离线对拍。
_Avoid_: 备份、缓存

**新鲜度（Freshness）**：某个源切片是否属于「最近一轮扫描」。一轮扫描内的各源共用一个时间戳；本会话没扫过的一律记为**缓存**，即便它的扫描时间就在几分钟前。
_Avoid_: 更新时间、数据时效、同步状态

**缓存切片（Cached slice）**：从 IndexedDB 恢复、本轮未重扫的切片。它显示的扫描时间是自己那次扫描的时间，不会被另一端的刷新带新——这正是合并层「扫描时间取各源最大值」不能当刷新时间用的原因。
_Avoid_: 旧数据、过期数据

**已读入（Loaded）**：某个源有切片且请求数 > 0。有目录句柄但 0 条**不算**已读入——那恰好说明路径选错了，应该继续提示。
_Avoid_: 已导入、已连接

**数据完整度（Completeness）**：逐源给出已读入/未读入，再在端层给出「能不能比」。两级分开说，因为端的聚合会掩盖源缺口（只读入 CLI 时 CodeBuddy 端"能比"，但端内缺 IDE）。
_Avoid_: 数据体检、健康度

**已声明没有（Declined）**：用户主动标记「我没有这个源」。只影响提示，不影响数据与统计，可随时恢复。
_Avoid_: 忽略、屏蔽

**归档（Archive）**：只对**不可重建**的源（当前只有 `codebuddy-cli`，其日志按天轮转）生效的本地累积：扫到过的请求按 `event_id` 存进 IndexedDB，日志消失后仍然保留。归档是该源切片的一部分，不是第二份数据；清空归档不可恢复。全量常驻磁盘的源（IDE、WorkBuddy）不归档，保持「重扫即真值」。
_Avoid_: 备份、缓存、快照

### 用量单位

**请求（Request）**：一次真实 API 调用。CodeBuddy 侧记在 `requests[]`（存在 usage 且 requests==1），WorkBuddy 侧一条带 `providerData.usage` 的记录即一次请求，CodeBuddy CLI 侧一条 `agent.model_call.completed` 日志行即一次请求——**一次用户 turn 可含多条请求**，turn 只是分组键，不是请求。
_Avoid_: 调用、turn、消息

**会话（Session）**：一次连续的对话。WorkBuddy 的 subagent 会话独立存在，与主会话 token 不重复；CodeBuddy CLI 的辅助 agent（如会话标题生成）同样独立成会话并计入，打同一个子会话标记。
_Avoid_: 对话、任务

**项目（Project）**：以归一化后的 cwd 标识的工作目录，跨数据源合并成同一条。
_Avoid_: 工作空间、仓库

**Subagent 会话**：由主会话派生的子智能体会话，自带独立 sessionId 且与主会话 messageId 无交集，计入总量但需单独打标。
_Avoid_: 子会话、子任务

### 积分与缺口

**积分（credit）**：厂商计费单位，本地无单价表，不换算人民币。
_Avoid_: 额度、费用、金额

**已知积分（Known credit）**：某个视图里由请求级 `credit` 字段加总的积分，必须同时给出覆盖率（按请求数加权）。源视图只能叫「该源已知积分」，端视图叫「该端已知积分」。
_Avoid_: 总积分、实际消耗

**账号消耗下限**：各端积分之和的语义。因 CodeBuddy 端与 WorkBuddy 端共用同一积分账户（无论 CodeBuddy 端由 IDE 与 CLI 几个源组成），且有其它设备与不落盘的消耗，本地只能给出小于真值的下限。只适用于合并视图。
_Avoid_: 总积分、账号余额

**字段覆盖缺口**：某请求没有 credit 字段导致的可补缺口，属于解析层问题。
_Avoid_: 积分不全

**无记录日**：两个数据源当天都没有任何请求的日子。属于多工具切换使用的正常结果，不是数据损坏。
_Avoid_: 缺失天、空档、缺口

### 校验

**自检（SelfCheck）**：解析期对恒等式（`total == in + out`、`cached <= input`）与去重计数的断言集合。任一失败即视为解析 bug，而非数据缺失。
_Avoid_: 校验、检查

**疑似同项目**：归一后 key 相同但原始字符串不同的项目对。只告警，不自动合并。
_Avoid_: 重复项目
