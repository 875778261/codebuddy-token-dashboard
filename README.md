# Buddy 用量看板

本机 AI 用量的本地看板：**纯前端、零上传**。支持只载入 CodeBuddy、只载入 WorkBuddy、或两端都载入（合并成一份总账 + 端对比）。

- CodeBuddy：扫描 `history/**/index.json`，可选 `codebuddy-sessions.vscdb` 补标题与项目路径；
- WorkBuddy：扫描 `~/.workbuddy/projects/**/*.jsonl`（必须含 `subagents/`），逐请求 usage 与积分都来自 jsonl；
- 两端都载入时：token 直接相加（实测零重叠），并给出量差 / 同模型效率差 / 切换节奏三层端对比。

页面结构参考 [token.daeai.cn](https://token.daeai.cn/)（WorkBuddy 看板）的"选目录 → 浏览器内扫描"交互，但数据源、指标口径和可视化都是按两端的真实文件结构重建的。

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
| **A. 拖拽**（推荐） | CodeBuddy：把 `%LOCALAPPDATA%\CodeBuddyExtension\Data` 拖进窗口；要标题与项目路径，再把 `%APPDATA%\CodeBuddy CN\codebuddy-sessions.vscdb` 一起拖进来。WorkBuddy：把 `%USERPROFILE%\.workbuddy`（或其 `projects`）拖进来 | 两端可以分两次拖，后拖的只更新自己那一端；浏览器若给出可持久化句柄，「重扫 / 自动刷新」也能用 |
| **B. 快照** | 跑 `npm run collect`，把生成的 `*-usage-*.json` 导入或拖进页面 | 归档、换机、CI，或拖拽也不可用时 |

页面按**文件形状**识别数据源，不需要提前声明用的是哪个产品：`history/**/index.json` 归 CodeBuddy，`projects/**/*.jsonl` 归 WorkBuddy，一次拖入两种都能识别。

```bash
npm run collect      # 读本机两份数据 → 一份快照 JSON（页面里导入或拖入）
```

> 拖完是否还能「重扫」，取决于浏览器有没有给可持久化目录句柄：Edge / Chrome 实测会给（`DataTransferItem.getAsFileSystemHandle` 拿到 directory handle 并写进 IndexedDB），因此拖完点「重扫」能读到新增用量；只有快照导入、`<input webkitdirectory>` 文件框、示例数据这三条路径没有句柄，顶栏「重扫」会明确提示改用拖拽或「目录」。
> **拖拽必须通过 `http(s)` 打开页面**（`npm run dev` 或任意静态托管）：`file://` 下浏览器不会为拖入的目录创建文件系统条目，表现是"拖了没反应"。`file://` 场景请用快照导入。

### 踩过的坑（供后来者参考）

- **目录联接（junction）不能拖**：`npm run bridge` 生成的 `cb-bridge` 看似捷径，但 Chrome 对联接目录不返回 `FileSystemEntry`，拖进去等于没拖，扫描结果为 0 条。脚本还留在 `scripts/bridge.mjs`，仅供想手动验证「选择目录能否选联接」的人使用，不作为推荐路径。
- **不要试图用 `file://` + 目录选择**：`showDirectoryPicker` 在部分 `file://` 场景抛 `SecurityError`，界面会回落到文件框，但文件框同样拦 AppData。

选完的数据会缓存在 IndexedDB，下次打开直接出图。

## 部署

产物是单个 `dist/index.html`，托管在 **Cloudflare Workers 静态资源**（`wrangler.jsonc` 里 `assets.directory = ./dist`，`not_found_handling = single-page-application`）。

### 主路径：push 即部署

线上以 **Workers Builds（Git 集成）** 为唯一部署入口：Cloudflare 拉 `main` 构建并发布，本地不再手动 deploy，避免两个入口互相覆盖版本历史。

```
Dashboard → Workers & Pages → codebuddy-token-dashboard
         → Settings → Builds → Connect → 选 875778261/codebuddy-token-dashboard
```

| 构建设置 | 值 |
|---|---|
| Production branch | `main` |
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |

免费计划为 3000 构建分钟/月、并发 1、单次超时 20 分钟。非 `main` 分支自动触发 Preview 构建，只出预览 URL，不切线上。

硬性约束（踩过就构建失败）：

- Dashboard 里的 Worker 名称必须与 `wrangler.jsonc` 的 `name` 完全一致（当前均为 `codebuddy-token-dashboard`）；
- `wrangler.jsonc` 必须在仓库里，否则 Cloudflare 的 autoconfig 会先开一个 PR 补配置。

### 本地只需校验

```bash
npm run deploy:dry      # build + 干跑，校验配置和产物，不上传、不切线上
```

### 应急手动部署

Git 集成不可用时才用，用完记得让 `main` 与线上重新对齐，否则下一次 push 会覆盖掉这次手动版本：

```bash
npx wrangler login      # 首次：OAuth 授权（或改用 CLOUDFLARE_API_TOKEN）
npm run deploy:manual   # build + wrangler deploy
```

线上地址：<https://codebuddy-token-dashboard.875778261.workers.dev>

### 国内镜像：GitHub Pages

<https://875778261.github.io/codebuddy-token-dashboard/>

同一份 `dist` 产物镜像到 GitHub Pages，由 `.github/workflows/pages.yml` 在 push `main` 时自动构建部署，与 Workers 的提交同源。两个地址内容一致（已用 normalized md5 比对过，差异仅 Windows `core.autocrlf` 造成的 22 个 CR 字节）。

存在的理由：`*.workers.dev` 会被 DNS 投毒（解析到 `128.121.243.75` / `face:b00c`）**且** TLS SNI 被阻断，改 hosts 无效；`*.pages.dev` 同样只在 TLS 层被拦，换 Pages 也不能解决；`*.github.io` 相对可直连。本机 `curl` 不通 Workers 地址**不代表部署失败**。

代价是两套部署面：`main` 上一次 push 会同时触发 Workers Builds 和 Pages，两者互不依赖。纯本地使用仍可双击 `dist/index.html`。

> 若将来有了托管在 Cloudflare 的域名，可以改为在 `wrangler.jsonc` 加 `routes`（`{ "pattern": "dash.example.com", "custom_domain": true }`）直连，那时 Pages 镜像可以撤掉。


## 指标口径

| 指标 | 口径 | 数据来源 |
|---|---|---|
| 总 Token / 输入 / 输出 | `usage` 逐条求和（两源直接相加，跨源不去重） | CB history / WB jsonl |
| 缓存命中率 | `Σcache / Σinput`，**合并视图按合并后的分子分母重算** | 同上 |
| 已知积分 | `Σcredit` + 覆盖率（有 credit 字段的请求数 / 全部请求数）；本地无单价表，不换算人民币 | 同上 |
| 请求数 | 以 `usage` 存在为唯一准入条件 | 同上 |
| 会话数 | 主会话与 subagent 分列（WorkBuddy 的 subagent 会话独立存在） | 同上 |
| 模型归属 | **请求级 `model` 优先**（WB），回落会话级 `selectedModelId`（CB）；都缺才归入「未记录模型」 | WB jsonl / CB 项目索引 |
| 会话标题 | WorkBuddy 取 `ai-title`（约 6 成），CodeBuddy 取会话库 | jsonl / vscdb |
| 项目 | 归一化 cwd（`\`→`/`、去尾斜杠，**大小写保留**）；归一后同 key 不同原串只告警，不自动合并 | 同上 |
| 活跃天数 / 无记录日 | 按本地日期聚合；两源都没有请求的日子只作中性留白，不做插值 | 同上 |

两条恒等式在解析期逐条校验并展示在「数据体检」里：

```
inputTokens == cacheTokens + cachedMissTokens (+ cachedWriteTokens)
totalTokens == inputTokens + outputTokens
```

合并后还要额外成立（都展示在「数据体检」）：

```
合并 requests == Σ各源 requests == 实际会话求和     // 防合并层重复计数
归一后同 key 不同原串的项目数 == suspectedDuplicateProjects
```

**端对比**只在两端都载入时出现，分三层：量差、同模型效率差（只比两端同名的模型）、切换节奏（逐日「只用 CB / 只用 WB / 都用 / 都没用」）。所有比率字段各自重算，绝不求和；单源视图里的积分只能叫「该端已知积分」。

## 数据体检与已知缺口

看板会明示这些口径限制，而不是把它们藏在脚注里：

- 代码补全（Inline Completion）在扩展日志里只有耗时，没有 token / 积分，永久不可得。
- Inline Chat / 选中代码提问不写 `requests[]`，会少算。
- 云端会话正文不落本地；跨机器需要靠导出的快照合并。
- 扩展日志会轮转，早于首次启动目录的 step 级明细（含 `thinkingTokens`）已丢失。
- 两端共用同一积分账户：合并后的积分只是**账号消耗下限**，与官方账单的差额永远存在，不做比例外推。
- WorkBuddy 首版不读 `workbuddy.db`：会话标题来自 `ai-title`（约 6 成），缺失留空。
- 两源都没有请求的日子是**无记录日**（多工具切换的正常结果），只作中性留白，不当缺口告警。

## 验证

```bash
npm test          # 38 个单元测试：解析、聚合、按源切片、合并、WorkBuddy 解析、快照往返、SQLite 解析器
npm run verify    # 真实数据对拍：TS 管线 vs Python 独立实现
```

`npm run verify` 会跑 `scripts/ground-truth.py`（独立的 Python 实现）与 `scripts/verify-pipeline.ts`（浏览器里跑的那份 TS 代码），逐字段比对
请求数、Token、积分、两条恒等式、逐日、逐会话、以及快照往返。任何差异都判定为解析 bug。

最近一次本机对拍结果：`128 会话 / 674 请求 / 886,086,182 token / 1611.69 积分`，逐日逐会话完全一致。

## 目录结构

```
GLOSSARY.md        领域术语表（数据源 / 请求 / 积分 / 无记录日）
src/
  core/            纯函数，可被 Node 与浏览器共用
    sqlite.ts      极简只读 SQLite 解析（表 b-tree + overflow 页）
    parse.ts       CodeBuddy history index.json → Dataset（含自检与覆盖率）
    workbuddyParse.ts  WorkBuddy projects/**/*.jsonl → Dataset（去重 / 全零回落 / subagents）
    merge.ts       切片归一化与合并（路径归一、源前缀、疑似同项目）
    ids.ts         带源前缀的会话 id
    sessions.ts    sessions.vscdb → 会话维表
    aggregate.ts   时间窗口 / 模型 / 项目 / 时段 / 分布聚合（含按源过滤）
    snapshot.ts    快照序列化与反序列化（v2，兼容 v1）
    demo.ts        合成示例数据（双端，不含任何真实路径）
  platform/        浏览器侧 I/O（目录扫描、拖拽扫描、IndexedDB）
    browserScan.ts 目录选择器 / 文件夹文件框
    dropScan.ts    拖拽读取（绕开系统目录选择器）
  ui/              卡片与图表组件
docs/
  codebuddy-ide-data-sources.md  本机数据源勘察报告（口径依据）
  workbuddy-data-sources.md      WorkBuddy 数据源勘察报告（含 token.daeai.cn 口径对拍）
  exploration/     复核脚本（cb_verify.py / wb_verify.py）与参考输出
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
- [ADR 0003](docs/adr/0003-merge-workbuddy-into-one-dataset.md)：WorkBuddy 作为第二个数据源并入同一份 Dataset；合并必须先做三处归一化；积分因共用账户只能作为「账号消耗下限」。
- [ADR 0004](docs/adr/0004-source-slices-and-compare.md)：支持只载入一端 / 两端合并；端对比限定为量差、同模型效率差、节奏差；允许按源过滤，但只有一套聚合。
