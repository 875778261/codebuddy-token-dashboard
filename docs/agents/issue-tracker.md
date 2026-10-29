# 问题跟踪：GitHub

本仓库的 issue 与规格文档都以 GitHub issue 的形式存放。所有操作统一使用 `gh` CLI。

## 约定

- **创建 issue**：`gh issue create --title "..." --body "..."`。多行正文使用 heredoc。
- **读取 issue**：`gh issue view <number> --json number,title,body,labels,comments`。
- **列出 issue**：`gh issue list --state open --json number,title,body,labels,comments --jq '[.[] | {number, title, body, labels: [.labels[].name], comments: [.comments[].body]}]'`，配合合适的 `--label` 与 `--state` 过滤条件。
- **把 issue 设为某个父 issue 的子 issue**：`gh issue create --parent <parent> ...`，或事后执行 `gh issue edit <parent> --add-sub-issue <child>`（需 `gh` 2.94+）。旧版本 `gh` 可用 `gh api --method POST repos/<owner>/<repo>/issues/<parent>/sub_issues -F sub_issue_id=<child-db-id>`（此处为子 issue 的数据库 id，见下文**阻塞关系**一节）。若不支持子 issue，则在子 issue 正文顶部写 `Part of #<parent>`。
- **评论 issue**：`gh issue comment <number> --body "..."`
- **添加 / 移除标签**：`gh issue edit <number> --add-label "..."` / `--remove-label "..."`
- **关闭 issue**：`gh issue close <number> --comment "..."`

仓库由 `git remote -v` 推断；在克隆目录内运行时 `gh` 会自动识别。

## PR 作为分诊入口

**PR 作为请求入口：否。** _（若本仓库把外部 PR 视为功能请求，请改为 `yes`；`/triage` 会读取该开关。）_

设为 `yes` 时，PR 与 issue 走同一套标签与状态流转，使用对应的 `gh pr` 命令：

- **读取 PR**：`gh pr view <number> --comments`，diff 用 `gh pr diff <number>`。
- **列出待分诊的外部 PR**：`gh api --paginate 'repos/{owner}/{repo}/pulls?state=open' --jq '.[] | select(.author_association | IN("OWNER","MEMBER","COLLABORATOR") | not) | {number, title, author: .user.login, author_association, labels: [.labels[].name]}'`。
- **评论 / 打标签 / 关闭**：`gh pr comment`、`gh pr edit --add-label`/`--remove-label`、`gh pr close`。

GitHub 的 issue 与 PR 共用同一套编号，因此裸写的 `#42` 可能是任一种：先 `gh pr view 42` 解析，失败再退回 `gh issue view 42`。

## 当技能要求「发布到问题跟踪器」

创建一条 GitHub issue。

## 当技能要求「获取相关工单」

按上文**读取 issue**的方式读取。

## 寻路操作

供 `/wayfinder` 使用。**地图**是一条 issue，其下的**子 issue** 即各张工单。

- **地图**：单条带 `wayfinder:map` 标签的 issue，正文承载「Notes / 已定决策 / 迷雾」三段。`gh issue create --label wayfinder:map`。
- **子工单**：作为地图的 GitHub 子 issue 关联（见**把 issue 设为某个父 issue 的子 issue**）。若子 issue 功能不可用，则把该子工单加入地图正文的任务列表，并在子 issue 正文顶部写 `Part of #<map>`。标签：`wayfinder:<type>`（`research`/`prototype`/`grilling`/`task`）。被认领后，工单指派给推进它的开发者。
- **阻塞关系**：使用 GitHub **原生 issue 依赖**，这是唯一规范且界面上可见的表示方式。用 `gh api --method POST repos/<owner>/<repo>/issues/<child>/dependencies/blocked_by -F issue_id=<blocker-db-id>` 建立依赖边，其中 `<blocker-db-id>` 是阻塞方 issue 的**数据库 id**（`gh api repos/<owner>/<repo>/issues/<n> --jq .id`，_不是_ `#number`，也不是 `node_id`）。GitHub 通过 `issue_dependencies_summary.blocked_by` 报告仍处于打开状态的阻塞方数量，这是实时的准入闸门。若依赖功能不可用，退化为在子 issue 正文顶部写 `Blocked by: #<n>, #<n>`。当所有阻塞方均关闭时，该工单即解除阻塞。
- **前沿查询**：列出地图下所有处于打开状态的子 issue（`gh issue list --state open`，限定在地图的子 issue / 任务列表范围内），剔除存在未关闭阻塞方的（`issue_dependencies_summary.blocked_by > 0`，或 `Blocked by` 行中仍有未关闭 issue）以及已被指派的，按地图顺序取第一个。
- **认领**：`gh issue edit <n> --add-assignee @me`，这是本次会话的第一次写操作。
- **解决**：`gh issue comment <n> --body "<答复>"`，随后 `gh issue close <n>`，再把上下文指针（摘要 + 链接）追加到地图的「已定决策」段落。
