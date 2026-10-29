# codebuddy-token-dashboard

本机 AI 用量的本地看板：从 CodeBuddy IDE 与 WorkBuddy 的本地文件里读出用量，合并成一份统计，纯前端、零上传。

## Language

### 数据与来源

**数据源（Source）**：一个产品在本机落盘的用量数据根，当前有 `codebuddy` 与 `workbuddy` 两个。
_Avoid_: 渠道、厂商、provider

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

### 用量单位

**请求（Request）**：一次真实 API 调用，以存在 usage 且 requests==1 为判据。CodeBuddy 侧记在 `requests[]`，WorkBuddy 侧一条带 `providerData.usage` 的记录即一次请求。
_Avoid_: 调用、turn、消息

**会话（Session）**：一次连续的对话。WorkBuddy 的 subagent 会话独立存在，与主会话 token 不重复。
_Avoid_: 对话、任务

**项目（Project）**：以归一化后的 cwd 标识的工作目录，跨数据源合并成同一条。
_Avoid_: 工作空间、仓库

**Subagent 会话**：由主会话派生的子智能体会话，自带独立 sessionId 且与主会话 messageId 无交集，计入总量但需单独打标。
_Avoid_: 子会话、子任务

### 积分与缺口

**积分（credit）**：厂商计费单位，本地无单价表，不换算人民币。
_Avoid_: 额度、费用、金额

**已知积分（Known credit）**：某个视图里由请求级 `credit` 字段加总的积分，必须同时给出覆盖率（按请求数加权）。单源视图只能叫「该端已知积分」。
_Avoid_: 总积分、实际消耗

**账号消耗下限**：两源积分之和的语义。因 CodeBuddy 与 WorkBuddy 共用同一积分账户，且有其它设备与不落盘的消耗，本地只能给出小于真值的下限。只适用于合并视图。
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
