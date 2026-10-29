# codebuddy-token-dashboard

## Agent skills

### 问题跟踪

issue 与规格文档以 GitHub issue 形式存放于 `875778261/codebuddy-token-dashboard`，统一通过 `gh` CLI 读写。详见 `docs/agents/issue-tracker.md`。

### 分诊标签

沿用五个标准分诊角色，标签字符串与角色名完全一致。详见 `docs/agents/triage-labels.md`。

### 领域文档

单上下文布局：仓库根目录的 `GLOSSARY.md` 加 `docs/adr/`。详见 `docs/agents/domain.md`。

### 浏览器自动化

全局 `playwright-cli`，默认有头 Edge，配置文件在 `~/.playwright/cli.config.json`。产物会落进 cwd 的 `.playwright-cli/`，用完必须 `close-all`。详见 `docs/agents/playwright-cli.md`。
