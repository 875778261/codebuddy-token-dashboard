# 部署与网络实况

产物是单个 `dist/index.html`（`vite-plugin-singlefile`），可直接双击打开，也可交给任意静态托管。GitHub Pages、Cloudflare Workers、EdgeOne 由 push `main` 自动构建；Cloudflare Pages 走本地 `npm run deploy:pages`。

README 只放入口表，过程性记录（构建设置、踩坑、链路实测）都在这里。

## 入口

| 入口 | 地址 | 无代理可用 | 触发方式 |
|---|---|---|---|
| **GitHub Pages**（README 演示地址） | <https://875778261.github.io/codebuddy-token-dashboard/> | 慢，实测 21s 才 200 | push `main` 自动（`.github/workflows/pages.yml`） |
| Cloudflare Pages | <https://codebuddy-token-dashboard.pages.dev> | 是，实测 200 / 2~4s | `npm run deploy:pages` |
| Cloudflare Workers | <https://codebuddy-token-dashboard.875778261.workers.dev> | 否 | push `main` 自动，或 `npm run deploy:manual` |
| EdgeOne Pages | 只有带 `eo_token` 签名的预览链接能开，3 小时失效 | 401（换机直连实测） | 控制台关联 Git 仓库，push `main` 自动构建 |

本地只校验配置与产物，不上传、不切线上：`npm run deploy:dry`（build + `wrangler deploy --dry-run`）。

## EdgeOne Pages

腾讯云控制台 → EdgeOne → Pages → 创建项目 → 导入 Git 仓库 → 授权 GitHub → 选 `875778261/codebuddy-token-dashboard`：

| 构建设置 | 值 |
|---|---|
| 构建命令 | `npm run build` |
| 输出目录 | `dist` |
| Node 版本 | 22 |

产物是单个 `index.html`，不需要路由规则。

### 默认域名不能当公开入口

`*.edgeone.cool` 的「项目域名 / 部署域名」受加速区域合规策略约束（官方文档《域名管理》）：加速区域含中国大陆时，**必须用系统生成的预览链接访问**，链接带 `eo_token` 与 `eo_time` 两个签名参数、有效期 **3 小时**，超时或去掉参数直连一律返回 **401 UNAUTHORIZED**。

实测（2026-10-31）：

| 访问方式 | 结果 |
|---|---|
| `https://codebuddy-token-dashboard-3n3gdtzq.edgeone.cool?eo_token=…&eo_time=…` | 200，3 小时内有效 |
| `https://codebuddy-token-dashboard-3n3gdtzq.edgeone.cool/`（换机直连） | 401 |

这是平台区域合规策略，控制台没有「关闭校验」开关，也不是项目配置错。两种长期化路径：

1. **绑已备案的自定义域名**（唯一真正长期解）：加速区域含中国大陆时，域名必须完成 ICP 备案；备案按域名走，需要国内云资源与实名主体。
2. **重建项目并选「全球（不含中国大陆）」**：不要求备案，但加速区域**创建后不可自助修改**，只能删项目重建；且该区域默认域名境内访问同样受限。

在拿到备案域名之前，EdgeOne 只能当临时预览，不要写进 README 入口表、也不要贴给外部用户。

## Cloudflare

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

两条硬性约束：

- Dashboard 里的 Worker 名称必须与 `wrangler.jsonc` 的 `name` 完全一致（当前均为 `codebuddy-token-dashboard`）；
- `wrangler.jsonc` 必须在仓库里，否则 Cloudflare 的 autoconfig 会先开一个 PR 补配置。

Git 集成不可用时才手动部署，用完记得让 `main` 与线上重新对齐，否则下一次 push 会覆盖掉这次手动版本：

```bash
npx wrangler login      # 首次：OAuth 授权（或改用 CLOUDFLARE_API_TOKEN）
npm run deploy:manual   # build + wrangler deploy
```

### 不要放 `_redirects`

SPA 深层路径回落只由 `wrangler.jsonc` 的 `assets.not_found_handling: "single-page-application"` 负责。**不要往 `public/` 放 `_redirects`**：Vite 会把它原样复制进 `dist/`，而 Workers 在版本上传阶段会校验该文件，`/* /index.html 200` 会因为目标被规范化为 `/` 再次命中 `/*` 而报 `Infinite loop detected in this rule`（code 100324），表现为「构建成功、部署失败」。Pages 侧不需要该文件：应用没有客户端路由，任何路径都只打开同一个入口。

## 网络实况（2026-10-30 实测）

用**同一个 Cloudflare 边缘 IP `104.18.21.135`、只换 SNI** 做对照，结论是**阻断按 SNI 关键词，不按 IP**：

| SNI | 同一 IP 下的握手结果 |
|---|---|
| `*.workers.dev` | ClientHello 后被 RST（curl exit 35） |
| `*.pages.dev` | 成功（530 = Cloudflare「未知主机」页） |
| 任意普通域名 | 成功（530） |

- `*.workers.dev`：**DNS 投毒 + SNI 阻断**双重失效。投毒在链路层——`8.8.8.8:53` 与阿里 DoH `223.5.5.5` 都返回伪造地址（Facebook AS 段、`face:b00c` 的 IPv6、Teredo 前缀），**换 DNS 服务器无用**；改 hosts 也无用，因为指向真实边缘 IP 后 SNI 仍被 RST。
- `*.pages.dev`：**不受影响**，是无代理下的可用入口。旧文档「换 Pages 也不能解决」是误判，源于一次 `pages.dev` exit 35 的偶发失败、未做交叉验证。
- `*.github.io`：DNS 干净但慢（2026-10-31 复测 21s 才 200），当 README 演示地址够用，不适合当主链路；`github.com` 无代理下 IPv4 直接不通，`git push` 与 `gh` 需开代理。
- `dash.cloudflare.com` / `api.cloudflare.com` / `registry.npmjs.org` 直连正常：**部署与依赖安装不依赖代理**。
- 本机裸 `curl` 打不通 Workers 地址**不代表部署失败**。

有托管在 Cloudflare 的域名时，可在 `wrangler.jsonc` 加 `routes`（`{ "pattern": "dash.example.com", "custom_domain": true }`）直连；SNI 不含被拦关键词即可无代理访问。

## 为什么不提供 Gitee 入口

Gitee Pages 已下线，不是配置问题：

- Gitee 反馈区（`oschina/git-osc`）官方答复：「由于不可抗原因，Pages 服务已经下线，暂无具体计划再次上线」（2024-05）；
- 服务页提示语：「因服务维护调整，Gitee Pages 暂停提供服务」；
- `gitee.io` 首页：「Gitee Pages 服务已下线，恢复时间暂无计划」。

因此没有可自动部署的 `*.gitee.io` 托管目标，仓库里也不写相关 workflow。第三方 `gitee-pages-action` 一类工具同样无对象可刷新，且需要在 Secrets 存 Gitee 账号密码、走非公开接口，不采用。

源码镜像到 Gitee 也**暂不做**（只解决 `git clone` 慢，不解决页面访问）。决策见 [ADR 0005](adr/0005-domestic-entry.md)；若将来要恢复，再补一条镜像工作流。
