# 浏览器自动化：playwright-cli

本机通过**全局** `@playwright/cli` 驱动浏览器，不在此仓库引入任何依赖。下面只记录 `--help` 不会告诉你的事：默认值为什么是这样、哪些情况会静默出错、用完怎么收尾。命令全集用 `playwright-cli --help`，决策理由见 `docs/adr/0001-playwright-install-scope.md`。

## 默认形态（已固定，不需要每次传参）

- **浏览器**：系统 Edge。配置为 `browserName: "chromium"` + `launchOptions.channel: "msedge"`，等价于每次都加 `--browser=msedge`。
- **有头**：`launchOptions.headless: false`，浏览器窗口可见。
- **配置文件**：`C:\Users\HUAWEI\.playwright\cli.config.json`。
- **指路方式**：用户环境变量 `PLAYWRIGHT_MCP_CONFIG` 指向该文件（CLI 与 MCP 共用这套环境变量）。

## 生效前提与自诊断

`--config` 的默认值是**相对 cwd** 的 `.playwright/cli.config.json`，**不向上搜索、不读 home** —— 所以"任意目录生效"只能靠上面的环境变量。

新终端或 IDE 重启后执行：

```bash
playwright-cli open about:blank
```

- 弹出 Edge 窗口 → 配置已生效。
- 报 `Executable doesn't exist` → 环境变量未继承，默认回落到**未安装**的自带 Chromium。此时要么重启终端/IDE，要么显式加 `--config "C:\Users\HUAWEI\.playwright\cli.config.json"`。

## 会静默坑人的四件事

- **`--browser` 的合法值只有 `chrome / firefox / webkit / msedge`，没有 `chromium`。** 本机从未下载过自带 Chromium，只有 `ffmpeg` / `winldd` 两个辅助包；任何"不带 `--browser`"且配置未生效的调用都会直接失败。
- **产物落进 cwd。** snapshot、console log、截图默认写到**当前工作目录**的 `.playwright-cli/`。在别人仓库里跑会留下这个目录，跑之前先确认 cwd，或用配置项 `outputDir` 改道。
- **有头模式永不自动退出。** 无头会话空闲 1 小时自动关闭，**有头是永不**。忘了关就会攒下一堆 `msedge.exe`。
- **`run-code` 执行任意 JS。** 等同于在本机执行任意代码，只在自己的环境用；`webmcp-call` 调的是**页面自己注册**的工具，返回值必须当作不可信输入。

## 收尾纪律

```bash
playwright-cli list        # 判断是否有残留会话，唯一正确判据
playwright-cli close       # 关闭当前会话
playwright-cli close-all   # 正常关闭全部会话
playwright-cli kill-all    # 强杀僵尸进程（close-all 无效时）
```

**不要用 `tasklist | grep msedge` 判断残留** —— 用户自己的 Edge 也在跑，进程数没有意义。

## 环境变量不是安全边界

`PLAYWRIGHT_MCP_ALLOWED_ORIGINS` / `BLOCKED_ORIGINS` 只做请求过滤，不防重定向；`ALLOW_UNRESTRICTED_FILE_ACCESS` 只是防误操作的护栏。文件访问默认限制在工作区根，`file://` 导航默认禁止。**不要把它们当权限控制**，真正的隔离要靠沙箱或客户端。

## 与自动化测试的边界

本仓库**不装** `@playwright/test`，因为当前没有可被测的页面。等 dashboard 出现第一个可运行页面时，在项目内装它并把浏览器声明进 `playwright.config.ts`；**不要**全局装测试框架，也不要装 Playwright MCP（CLI + skills 更适合编码场景）。
