# ADR 0007：只给不可重建的源做归档

- 状态：已采纳
- 日期：2026-11-20
- 相关：`docs/adr/0002-pure-frontend-collection.md`、`docs/adr/0003-merge-workbuddy-into-one-dataset.md`、`docs/codebuddy-cli-data-sources.md`

## 背景

CodeBuddy CLI 是第一个「**盘上会消失**」的数据源：用量只在 `~/.codebuddy/logs/<日期>/*.log`，按天轮转。相比之下：

- CodeBuddy IDE 的 `history/**/index.json` 全量留在盘上；
- WorkBuddy 的 `projects/**/*.jsonl` 同样全量留在盘上。

看板的价值是历史曲线，而 CLI 曲线会随轮转断头。三条路：

- **A. 不救**：页面明示「CLI 视图覆盖期 = 日志保留期」。实现最干净，但两周后 CLI 曲线断头。
- **B. 扫到即归档**：IndexedDB 里按 `event_id` 去重累积，重扫只增不减。
- **C. 人工快照归档**：靠「导出快照 → 下次导入合并」。零新机制，但依赖人记得导，离线版还走不通。

## 决策

**采用 B，且只对「不可重建」的源生效。**

1. 归档的判定不是策略而是事实：一个源的原始文件是否全量常驻磁盘。当前只有 `codebuddy-cli` 不满足。
2. 归档就是**该源切片本身**（`归档 ∪ 本轮扫描`），不引入第二份数据结构，也不新建 IndexedDB store：沿用现有的 `slices` 键。
3. 合并规则：按会话 `rawId` 归并，请求按 `key`（=`event_id`）去重，新扫到的覆盖旧的，其余字段（cwd / isSubAgent / 已配好的 credit）从归档继承。
4. 数据体检新增 `archiveRequests`：归档补入的请求数。`requestsWithUsage` 表示归档合并后的总数，`requestsTotal` 仍表示「本轮日志里实际看到的行数」——两者语义不同，界面上分开写。
5. 快照必须携带归档：否则「换机、归档、离线对拍」都会丢掉 CLI 历史（ADR 0003 的真值承诺）。因此 `schemaVersion` 升到 **3**，旧页面读到 v3 必须明确拒绝，而不是静默少算一个新源。
6. 提供「清空归档」入口，只清 CLI 切片、保留目录句柄；下一轮重扫按当前日志重建。
7. IDE 与 WorkBuddy 保持「重扫即真值、覆盖式替换」。**不**为它们引入归档，否则会出现「盘上删了、看板还显示」的残留，而系统无法区分残留与数据未删。

## 后果

- 不破 ADR 0002 的「纯前端、零上传」：归档在 IndexedDB，仍是本机。
- 「新鲜度 / 缓存切片」多一档含义：CLI 切片的覆盖期可能早于它的扫描时间。为此 `archiveRequests` 与 `requestsTotal` 必须在体检里同时可见。
- 浏览器清站点数据 = 丢掉 CLI 历史。这是可接受的代价，但它必须写在界面上（数据体检的「已知缺口」里有一条）。
- 快照体积随归档增长（每条请求只有几个数字，实测 284 条 ≈ 100 KB 量级），可以接受。
