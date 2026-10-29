# ADR 0002：采集放在浏览器里，快照 JSON 作为可携带真值

- 状态：已采纳
- 日期：2026-10-29
- 相关：`docs/data-sources.md`

## 背景

CodeBuddy 的用量只存在于本机文件里：`history/<projectHash>/<convId>/index.json` 的 `requests[].usage`（请求级权威数据），以及 `codebuddy-sessions.vscdb` 的会话元数据（标题 / cwd / 状态）。目标是一个"打开就能看"的看板，同时不能把用户的项目路径、会话标题上传到任何服务器。

可选的三种形态：

1. Node 采集器产出 `usage.json`，看板只做静态展示；
2. 后端 API 读本地文件；
3. 浏览器内直接读文件（File System Access API），全部聚合在前端完成。

## 决策

选 **3**，并用 **快照 JSON** 作为唯一的持久化/交换格式：

- 目录扫描走 `showDirectoryPicker()`；目录 handle 存 IndexedDB，权限还在时可一键重扫、可每 5 分钟静默刷新。
- 不支持目录 API 的环境（`file://`、Firefox/Safari）回退到 `<input webkitdirectory>`，解析路径完全复用。
- `codebuddy-sessions.vscdb` 在浏览器里用**手写的只读 SQLite 解析器**读取（表 b-tree + 记录解码 + overflow 页，约 200 行），不引入 sql.js / WASM。
- 解析结果同时写入 IndexedDB（下次秒开）与可导出的 `codebuddy-usage-YYYYMMDD-HHmm.json`（归档、换机、离线比对）。
- 构建产物是**单个 `dist/index.html`**，不依赖任何运行时服务。

## 为什么不用 sql.js

`codebuddy-sessions.vscdb` 只有一张 `ItemTable(key TEXT, value)`，为它引入 1.5 MB WASM 会让单文件离线产物变脆，且在 `file://` 下的加载策略更容易出问题。手写解析器的风险用**外部基准**兜住：`src/core/__tests__/sqlite.test.ts` 直接对本机真实库对拍，`npm run verify` 再与 Python `sqlite3` 的读取结果逐会话比对。

## 后果

- 正向：零部署、零网络、隐私边界清晰；同一份 `core/` 代码既能跑在浏览器，也能被 Node 脚本用来做真值对拍。
- 代价：目录 API 只在 Chromium 系可用；用户需要手动选一次目录；首次扫描 200+ 个索引文件约 250 ms（实测）。
- 约束：不做多机自动汇总，跨机合并要靠快照；`credit` 不换算人民币。
