# ADR 0001 — Playwright 安装范围与默认运行形态

- 状态：Accepted
- 日期：2026-10-29
- 决策者：仓库所有者
- 相关：本仓库尚无应用代码，E2E 能力属于提前铺设

## 背景

需要让编码 Agent 具备浏览器自动化能力（打开页面、观察渲染、点击、截图），用于本地探索与将来的页面验证。安装前核查发现三件事：

1. `@playwright/cli@0.1.21` 早已全局安装，且 10-26 曾成功运行 9 次会话。
2. 但那 9 次会话全部走 `channel: "chrome"`（系统 Chrome），`%LOCALAPPDATA%\ms-playwright` 中**从未存在任何 `chromium-*` 构建**，只有 `ffmpeg-1011` 与 `winldd-1007` 两个辅助包。
3. 本机同时具备系统 Chrome 与系统 Edge。

## 决策

### 1. 只装 `@playwright/cli`，全局安装

```bash
npm install -g @playwright/cli@latest   # 0.1.21 → 0.1.22
```

理由：CLI 面向编码 Agent，token 开销低于 MCP；全局安装免去每个仓库重复引入依赖。代价是版本随 `@latest` 漂移，装机后不再随意升级。

### 2. 不下载 Playwright 自带浏览器，使用系统 Edge

配置固定为 `channel: "msedge"`。理由：系统 Edge 已验证可用，节省约 200MB；`--browser` 的合法值只有 `chrome / firefox / webkit / msedge`（**没有 `chromium`**），自带 Chromium 是"不带 `--browser`"时的默认行为 —— 因此必须显式指定 channel，否则默认路径会失败。

### 3. 默认有头模式

目标是"能看见浏览器在做什么"。有头模式下 idle timeout 为**永不**（无头为 1 小时），所以会话会一直挂着，需要 `playwright-cli close-all` 收尾。

### 4. 全局默认配置走 home 目录 + 环境变量

`--config` 的默认值是**相对 cwd** 的 `.playwright/cli.config.json`，不向上搜索、不读 home，因此"任意目录生效"只能靠环境变量指路：

- 配置文件：`~/.playwright/cli.config.json`
- 用户环境变量：`PLAYWRIGHT_MCP_CONFIG=C:\Users\HUAWEI\.playwright\cli.config.json`

已实测 CLI 会读取该变量（用不存在的路径探测，报 `ENOENT: ... probe.json`）。

```json
{
  "browser": {
    "browserName": "chromium",
    "launchOptions": { "channel": "msedge", "headless": false }
  }
}
```

### 5. 不装 `@playwright/test`

E2E 用例需要有被测页面，本仓库当前零源码。等 dashboard 出现第一个可运行页面时，再在项目内装 `@playwright/test` 并按 `playwright.config.ts` 的 projects 补浏览器。**不要**全局装测试框架。

### 6. 不装 Playwright MCP

官方 README 指出：编码 Agent + 大代码库 + 上下文紧张的场景应选 CLI + SKILLS；MCP 适合需要持久浏览器状态与多轮迭代推理的探索式长流程。本仓库以写代码和读数据源为主，故选 CLI。仓库内不落任何 MCP 配置；需要时临时 `npx @playwright/mcp@latest`。

## 后果

- 本机在**任何目录**运行 `playwright-cli open <url>` 都会拉起有头 Edge —— 前提是环境变量已生效（新终端 / IDE 重启后）。
- 浏览器进程不会自动退出，容易堆积；收尾用 `playwright-cli close-all`。
- 系统 Edge 自动升级可能导致行为漂移，无版本锁定能力；若将来需要可复现，改用项目内 `@playwright/test` + `npx playwright install`。
- `PLAYWRIGHT_MCP_*` 系列环境变量对 CLI 同样生效，但它们不构成安全边界，不要用它做权限控制。

## 验证记录（2026-10-29 实测）

| 项目 | 结果 |
|---|---|
| 全局版本 | `0.1.22` |
| skills 安装 | `~/.agents/skills/playwright-cli`（`--skills=agents -g`，CodeBuddy 从此目录加载技能） |
| 启动形态 | `browser@c80aca28…json` 记录 `channel: "msedge"`、`headless: false` |
| 进程 | `msedge.exe` 主进程确实存在 |
| 交互链路 | `open demo.playwright.dev/todomvc` → `type` → `press Enter` → 截图确认新增条目 "Buy groceries (playwright smoke)" |
| 收尾 | `close` 后 `playwright-cli list` 返回 `(no browsers)` |
