# Cloudflare 正式部署清单

本文件用于将 **CF VPS Monitor** 部署到 Cloudflare Workers + D1。请从项目根目录 `cf-vps-monitor/` 执行命令，而不是外层 `推广/` 目录，也不是本文件所在的 `agent/` 子目录。

## 当前状态

- Worker、静态资源绑定、D1 绑定和每 5 分钟 Cron 已写入 `wrangler.jsonc`。
- 当前 `database_id` 是全零占位符；必须替换为你账户中新建 D1 的真实 ID。
- `.dev.vars` 仅供本地开发使用。生产环境的 Secrets 尚未创建或上传。
- 生产部署需要 Cloudflare 账户所有者在浏览器完成登录；不要把 API Token、密码或 Secret 发到聊天中。

## 0. 准备条件

- Node.js 22.13 或更高版本（项目 CI 使用 Node 24）。
- 一个有 Workers 和 D1 权限的 Cloudflare 账户。
- 可选：已由该 Cloudflare 账户管理的自定义域名；没有域名也能先使用 `*.workers.dev`。

```sh
cd /Users/ge/Documents/ChatGPT/推广/cf-vps-monitor
npm ci
npm run check
npm test
npm run build
```

## 1. 登录 Cloudflare 并创建 D1

```sh
npx wrangler login
npx wrangler whoami --config wrangler.jsonc
npx wrangler d1 create cf-vps-monitor --config wrangler.jsonc
```

最后一条命令会显示一个 `database_id`。复制该值，然后运行（替换为真实 ID）：

```sh
node scripts/prepare-deploy.mjs YOUR_REAL_D1_DATABASE_ID
```

该脚本会做两件事：

1. 将 `wrangler.jsonc` 的 `DB` 绑定更新为真实 D1 ID。
2. 在本机生成 `.production-secrets.json`，其中包含随机的 `ADMIN_PASSWORD` 和 `SESSION_SECRET`。

这个文件已被 `.gitignore` 忽略。把 `ADMIN_PASSWORD` 保存到密码管理器；不要提交、截图、发送或复用 `.dev.vars` 中的本地值。

## 2. 执行远程数据库迁移

```sh
npm run db:remote
```

应看到 `0001_initial.sql` 至 `0004_traffic_quota.sql` 都已应用（重复运行会安全地跳过已完成的迁移）。若此步失败，停止部署，先确认登录账号、真实 D1 ID 和账户权限。

## 3. 发布 Worker、前端和生产 Secrets

以下命令将 Secrets 和 Worker 一并发布，避免先上线一个没有管理员凭据的短暂窗口：

```sh
npm run check
npm test
npm run build
npx wrangler deploy --config wrangler.jsonc --secrets-file .production-secrets.json
```

记录命令输出的 `https://<worker>.<subdomain>.workers.dev` 地址。

如果改用项目内置的 `npm run deploy`，它不会上传 Secrets，必须紧接着执行：

```sh
npx wrangler secret bulk .production-secrets.json --config wrangler.jsonc
```

## 4. 环境变量 / 绑定清单

| 名称 | 类型 | 是否必需 | 来源 / 作用 |
| --- | --- | --- | --- |
| `DB` | D1 binding | 是 | 由 `wrangler.jsonc` 绑定；不是 Secret。 |
| `ASSETS` | Workers assets binding | 是 | 由 `wrangler.jsonc` 自动绑定 `dist/`。 |
| `ADMIN_PASSWORD` | Secret | 是 | 管理员登录密码，至少 10 个字符；准备脚本自动生成。 |
| `SESSION_SECRET` | Secret | 是 | 会话和匿名公开编号签名密钥，至少 32 个字符；准备脚本自动生成。 |
| `TELEGRAM_BOT_TOKEN` | Secret | 否 | 只有需要 Telegram 告警时设置。 |
| `TELEGRAM_CHAT_ID` | Secret | 否 | 只有需要 Telegram 告警时设置。 |

若启用 Telegram，使用交互式命令输入值，避免令牌进入终端历史：

```sh
npx wrangler secret put TELEGRAM_BOT_TOKEN --config wrangler.jsonc
npx wrangler secret put TELEGRAM_CHAT_ID --config wrangler.jsonc
```

`triggers.crons` 已配置为 `*/5 * * * *`，用于告警检查和历史清理；发布后在 Workers 控制台确认 Cron 已启用。

## 5. 发布后验收

将部署输出的 HTTPS 地址保存为变量：

```sh
WORKER_URL="https://YOUR-WORKER.YOUR-SUBDOMAIN.workers.dev"
curl -fsS "$WORKER_URL/api/session"
curl -fsS "$WORKER_URL/api/site"
curl -fsS "$WORKER_URL/api/nodes"
```

`/api/session` 应返回 `configured: true`。随后在浏览器打开站点，用 `.production-secrets.json` 中的 `ADMIN_PASSWORD` 登录：

1. 新增一台测试节点。
2. 下载该节点生成的专属 `config.json`。
3. 在测试 VPS 上运行一次探针，确认节点显示在线并产生样本。
4. 在 Workers 和 D1 的 Metrics 中检查请求数、CPU、`rows_read` 与 `rows_written`。

## 6. 其他 VPS 需要做什么

各 VPS **不需要相互连接**，也不需要安装 Node.js、数据库或 Cloudflare 凭据。每台被监控的机器独立完成以下操作：

1. 在管理后台创建对应节点，并下载它自己的探针配置；不要在多台机器复用同一份配置或令牌。
2. 选择正确架构的 `cf-monitor-agent` 二进制，连同该节点的 `config.json` 放到 VPS。
3. 运行对应安装脚本（Linux 为 `agent/install-linux.sh`），或用 systemd 将探针设为开机自启。
4. 确保 VPS 能通过 **出站 HTTPS / TCP 443** 访问最终的 Worker 域名。

无需开放 VPS 的入站端口，也无需让 VPS 之间互通。探针只会向 Cloudflare 的 `/api/agent/report` 发起出站 HTTPS 请求；最终域名必须可直接 HTTPS 访问，不能依赖 HTTP 重定向。

## 7. 自定义域名（可选）

在 Cloudflare Dashboard 打开该 Worker，进入 **Settings → Domains & Routes → Add → Custom Domain**，绑定域名后再更新各节点探针的 endpoint 并重启探针。确认新域名 HTTPS 正常后再切换，避免探针上报中断。

## 8. 常见阻塞

| 现象 | 处理 |
| --- | --- |
| `You are not authenticated` | 在本机执行 `npx wrangler login`，完成浏览器授权后重新运行 `whoami`。 |
| D1 相关 API 报错 | 检查真实 `database_id` 是否已写入 `wrangler.jsonc`，并重新运行远程迁移。 |
| `/api/session` 返回 `configured: false` | 生产 Secrets 未上传或名称错误；重新执行带 `--secrets-file` 的部署或 `wrangler secret bulk`。 |
| 管理员登录失败 | 从安全保存的 `.production-secrets.json` 读取 `ADMIN_PASSWORD`，不要使用 `.dev.vars`。 |
| 探针不上报 | 检查每台 VPS 的 endpoint、专属 token、出站 443、DNS 和 HTTPS 证书。 |

更完整的产品、容量和运维说明见 [部署与使用手册](../docs/部署与使用手册.md)。
