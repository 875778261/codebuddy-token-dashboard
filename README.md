# codebuddy-token-dashboard

CodeBuddy IDE 的本地用量看板：**纯前端、零上传**，在浏览器里直接扫描 `history/**/index.json` 和 `codebuddy-sessions.vscdb`，给出 Token、积分、缓存命中、项目与会话维度的可视化。

页面结构参考 [token.daeai.cn](https://token.daeai.cn/)（WorkBuddy 看板）的"选目录 → 浏览器内扫描"交互，但数据源、指标口径和可视化都是按 CodeBuddy 的真实文件结构重建的。

## 快速开始

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # 产出单个 dist/index.html（约 750 KB，可离线双击打开）
```

### 为什么不能直接"选择" AppData

Chrome / Edge 把 `AppData` 判定为**系统目录**，`showDirectoryPicker()` 与 `<input webkitdirectory>` 的目录选择器会直接拒绝，提示
「无法打开此文件夹：由于此文件夹包含系统文件」。这是浏览器的硬限制，与读权限无关（同一路径交给页面读取是完全可行的，实测 250 ms 扫完）。`codebuddy-sessions.vscdb` 的文件选择器同样会被拦。

两条绕过路径，都已用本机真实数据跑通：

| 方式 | 操作 | 说明 |
|---|---|---|
| **A. 拖拽**（推荐） | 把 `%LOCALAPPDATA%\CodeBuddyExtension\Data` 文件夹拖进窗口任意位置；要标题与项目路径，再把 `%APPDATA%\CodeBuddy CN\codebuddy-sessions.vscdb` 一起拖进来 | 纯前端、无需命令；浏览器若给出可持久化句柄，「重扫 / 自动刷新」也能用 |
| **B. 快照** | 跑 `npm run collect`，把生成的 `codebuddy-usage-*.json` 导入或拖进页面 | 归档、换机、CI，或拖拽也不可用时 |

```bash
npm run collect      # 读本机两份数据 → 一份快照 JSON（页面里导入或拖入）
```

> 拖完是否还能「重扫」，取决于浏览器有没有给可持久化目录句柄：Edge / Chrome 实测会给（`DataTransferItem.getAsFileSystemHandle` 拿到 directory handle 并写进 IndexedDB），因此拖完点「重扫」能读到新增用量；只有快照导入、`<input webkitdirectory>` 文件框、示例数据这三条路径没有句柄，顶栏「重扫」会明确提示改用拖拽或「目录」。
> **拖拽必须通过 `http(s)` 打开页面**（`npm run dev` 或任意静态托管）：`file://` 下浏览器不会为拖入的目录创建文件系统条目，表现是"拖了没反应"。`file://` 场景请用快照导入。

### 踩过的坑（供后来者参考）

- **目录联接（junction）不能拖**：`npm run bridge` 生成的 `cb-bridge` 看似捷径，但 Chrome 对联接目录不返回 `FileSystemEntry`，拖进去等于没拖，扫描结果为 0 条。脚本还留在 `scripts/bridge.mjs`，仅供想手动验证「选择目录能否选联接」的人使用，不作为推荐路径。
- **不要试图用 `file://` + 目录选择**：`showDirectoryPicker` 在部分 `file://` 场景抛 `SecurityError`，界面会回落到文件框，但文件框同样拦 AppData。

选完的数据会缓存在 IndexedDB，下次打开直接出图。

## 指标口径

| 指标 | 口径 | 数据来源 |
|---|---|---|
| 总 Token / 输入 / 输出 | `requests[].usage` 逐条求和 | history 会话索引 |
| 缓存命中率 | `ΣcacheTokens / ΣinputTokens` | 同上 |
| 积分 | `Σusage.credit`（本地无单价表，不换算人民币） | 同上 |
| 请求数 / 会话数 | 以 `usage` 存在为唯一准入条件 | 同上 |
| 模型归属 | 会话级 `selectedModelId`（缺字段归入「未记录模型」，不猜测） | 项目索引 |
| 会话标题 / 项目路径 / 完成状态 | `session:<conversationId>` 的 JSON | `codebuddy-sessions.vscdb` |
| 活跃天数 / 缺失天 | 按 `startedAt` 的本地日期聚合，空档不做插值 | history 会话索引 |

两条恒等式在解析期逐条校验并展示在「数据体检」里：

```
inputTokens == cacheTokens + cachedMissTokens (+ cachedWriteTokens)
totalTokens == inputTokens + outputTokens
```

## 数据体检与已知缺口

看板会明示这些口径限制，而不是把它们藏在脚注里：

- 代码补全（Inline Completion）在扩展日志里只有耗时，没有 token / 积分，永久不可得。
- Inline Chat / 选中代码提问不写 `requests[]`，会少算。
- 云端会话正文不落本地；跨机器需要靠导出的快照合并。
- 扩展日志会轮转，早于首次启动目录的 step 级明细（含 `thinkingTokens`）已丢失。
- history 被清理的历史空档会被画成灰色区段，不做平滑或补零伪装。

## 验证

```bash
npm test          # 19 个单元测试：解析、聚合、元数据合并、快照往返、SQLite 解析器
npm run verify    # 真实数据对拍：TS 管线 vs Python 独立实现
```

`npm run verify` 会跑 `scripts/ground-truth.py`（独立的 Python 实现）与 `scripts/verify-pipeline.ts`（浏览器里跑的那份 TS 代码），逐字段比对
请求数、Token、积分、两条恒等式、逐日、逐会话、以及快照往返。任何差异都判定为解析 bug。

最近一次本机对拍结果：`128 会话 / 674 请求 / 886,086,182 token / 1611.69 积分`，逐日逐会话完全一致。

## 目录结构

```
src/
  core/            纯函数，可被 Node 与浏览器共用
    sqlite.ts      极简只读 SQLite 解析（表 b-tree + overflow 页）
    parse.ts       history index.json → Dataset（含自检与覆盖率）
    sessions.ts    sessions.vscdb → 会话维表
    aggregate.ts   时间窗口 / 模型 / 项目 / 时段 / 分布聚合
    snapshot.ts    快照序列化与反序列化
    demo.ts        合成示例数据（不含任何真实路径）
  platform/        浏览器侧 I/O（目录扫描、拖拽扫描、IndexedDB）
    browserScan.ts 目录选择器 / 文件夹文件框
    dropScan.ts    拖拽读取（绕开系统目录选择器）
  ui/              卡片与图表组件
docs/
  codebuddy-ide-data-sources.md  本机数据源勘察报告（口径依据）
  adr/             架构决策记录
scripts/
  bridge.mjs       生成 cb-bridge 目录联接
  collect.ts       本地采集 → 快照 JSON
  local-files.ts   Node 侧读取本机数据（collect 与 verify 共用）
  verify-pipeline.ts / ground-truth.py  真值对拍
```

## 架构决策

- [ADR 0001](docs/adr/0001-playwright-install-scope.md)：浏览器自动化用全局 `playwright-cli`，不在仓库内装 Playwright。
- [ADR 0002](docs/adr/0002-pure-frontend-collection.md)：为什么采集放在浏览器里、为什么自己写 SQLite 解析器、为什么用快照 JSON 作为可携带真值。
