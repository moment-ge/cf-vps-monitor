# Cloudflare 生产部署与运维清单

本文件对应当前的 **CF VPS Monitor** 生产环境。项目命令必须从项目根目录 `cf-vps-monitor/` 运行，不要从外层 `推广/` 或本文件所在的 `agent/` 目录运行。

## 当前生产状态

- `wrangler.jsonc` 中的 `DB` 已绑定到真实的 Cloudflare D1 数据库；不要在当前生产仓库重新创建或替换它。
- `0001_initial.sql` 至 `0004_traffic_quota.sql` 已应用到生产 D1。
- `ADMIN_PASSWORD` 和 `SESSION_SECRET` 已作为 Worker 的**生产 Secrets**配置在 Cloudflare Dashboard；它们不在 Git，也不保存在本机 `.production-secrets.json`。
- 正式入口为 `https://vps.huckge.com`。VPS 探针应使用这个 HTTPS 域名，而不是 `workers.dev` 地址。
- 部署由 Cloudflare Workers Builds 从 Git 仓库执行。日常发布不需要在本机运行 Wrangler 登录或手工部署。

> D1 的 `database_id` 不是认证密钥，但它属于当前 Cloudflare 账户。将本项目 fork 到其他账户时必须换成该账户自己的 D1 ID；不能复用当前生产绑定。

## 1. 日常发布：Cloudflare Workers Builds

推送已审核的变更到已连接的生产分支后，由 Cloudflare 自动构建和发布。Workers Builds 中应保持以下配置：

| 字段 | 当前值 |
| --- | --- |
| Build command | `npm run check && npm run build` |
| Deploy command | `npx wrangler deploy --config wrangler.jsonc` |
| Version command | `npx wrangler versions upload --config wrangler.jsonc` |

`npm run build` 会生成 `dist/`，供 `assets.directory` 上传。不要把 `npm run db:remote`、`wrangler d1 migrations apply` 或任何写入生产数据库的命令加入 Build、Deploy 或 Version command：数据库迁移必须由有权限的人审阅后单独执行。

生产 Secrets 在 Dashboard 的 Worker **Settings → Variables and Secrets** 中管理，不要写入仓库、构建日志或 Cloudflare Builds 环境变量。当前已有的 Secrets 不需要在每次发布时重新上传。

## 2. 当前生产环境的验收

以正式域名验证公开接口：

```sh
WORKER_URL="https://vps.huckge.com"
curl -fsS "$WORKER_URL/api/session"
curl -fsS "$WORKER_URL/api/site"
curl -fsS "$WORKER_URL/api/nodes"
```

`/api/session` 应返回 `configured: true`。在浏览器打开 `https://vps.huckge.com`，使用**此前保存在密码管理器中的**管理员密码登录，然后：

1. 新增一台测试节点。
2. 下载该节点生成的专属 `config.json`。
3. 在测试 VPS 上运行一次探针，确认节点显示在线并产生样本。
4. 在 Workers 和 D1 Metrics 中检查请求数、CPU、`rows_read` 与 `rows_written`。

Cloudflare 不会再次显示已保存的 Secret 明文。若管理员密码遗失，在 Dashboard 替换 `ADMIN_PASSWORD` 并更新密码管理器；除非有计划让所有会话失效，否则不要随意替换 `SESSION_SECRET`。

## 3. D1 迁移与后续升级

当前生产库已经完成 `0001`–`0004`，因此不需要为了日常发布重复迁移。源码新增迁移时，按下面顺序操作：

1. 阅读新增的 `migrations/*.sql` 并确认目标是当前生产 D1。
2. 先备份或确认 Cloudflare 的迁移备份策略。
3. 使用具备 D1 权限的受控环境单独运行：

   ```sh
   npm run db:remote
   ```

4. 确认迁移成功后，再推送代码，让 Workers Builds 发布 Worker。

本机锁定的 Wrangler `4.92.0` 使用浏览器的 `localhost:8976` OAuth 回调，且没有 `wrangler login --device` 选项。若该回调出现 CSRF 或浏览器授权错误，不要在 Builds 中绕过迁移；改在 Cloudflare Dashboard 的 D1 SQL 控制台执行已审阅的迁移，或在能够完成浏览器回调的受控机器上运行 CLI。

## 4. 环境变量与绑定

| 名称 | 类型 | 当前状态 / 作用 |
| --- | --- | --- |
| `DB` | D1 binding | 已由 `wrangler.jsonc` 绑定；不是 Secret。 |
| `ASSETS` | Workers assets binding | 已由 `wrangler.jsonc` 从 `dist/` 自动绑定。 |
| `ADMIN_PASSWORD` | Secret | 已在生产 Dashboard 设置；管理员登录密码，至少 10 个字符。 |
| `SESSION_SECRET` | Secret | 已在生产 Dashboard 设置；会话与匿名公开编号签名密钥，至少 32 个字符。 |
| `TELEGRAM_BOT_TOKEN` | Secret | 可选；仅在启用 Telegram 告警时设置。 |
| `TELEGRAM_CHAT_ID` | Secret | 可选；仅在启用 Telegram 告警时设置。 |

如需新增 Telegram 凭据，在 Dashboard 的生产 Secrets 中添加；不要把令牌放入 Git、`wrangler.jsonc`、截图或聊天记录。

> `wrangler deploy` / `wrangler versions upload` 不会删除已有 Secrets，但默认可能覆盖 Dashboard 中的非 Secret 变量。若未来把普通变量直接配置在 Dashboard，修改自动发布命令前先评估是否需要 `--keep-vars`。

## 5. VPS 需要做什么

各 VPS **不需要彼此连接**，也不需要 Node.js、数据库或 Cloudflare 登录凭据。每台机器独立完成：

1. 从 `https://vps.huckge.com` 的管理后台创建对应节点，并下载它自己的探针配置；不要在多台机器复用 token 或 `config.json`。
2. 选择正确架构的 `cf-monitor-agent` 二进制，连同该节点的 `config.json` 放到 VPS。
3. 运行对应安装脚本（Linux 为 `agent/install-linux.sh`），或配置 systemd 开机自启。
4. 确保 VPS 能通过**出站 HTTPS / TCP 443**访问 `https://vps.huckge.com`。

无需开放 VPS 入站端口，也无需让 VPS 之间互通。探针只向 `/api/agent/report` 发起出站 HTTPS 请求，且 endpoint 必须是可直接访问的 HTTPS origin，不能依赖 HTTP 重定向。

在 `vps.huckge.com` 打开管理后台后再下载的配置，会自动以当前域名作为 endpoint。已经下载过 `workers.dev` 或旧域名配置的 VPS，应重新下载配置（或仅改 endpoint）后重启探针。

## 6. 新 fork / 新 Cloudflare 账户的首次部署

本节只适用于独立 fork、灾备环境或其他 Cloudflare 账户；**不要对当前生产仓库重复执行**。

1. 从项目根目录安装并验证：

   ```sh
   npm ci
   npm run check
   npm test
   npm run build
   ```

2. 在目标 Cloudflare 账户创建一个新的 D1 数据库并记录它的 `database_id`。可在 Dashboard 创建；若使用 CLI，必须在能正常完成 Wrangler 浏览器登录的受控机器上执行。
3. 在该 fork 中运行下面命令，写入**新账户自己的** D1 ID，并生成私密的初始 Secrets 文件：

   ```sh
   node scripts/prepare-deploy.mjs YOUR_REAL_D1_DATABASE_ID
   ```

   `.production-secrets.json` 只应临时保存在本机、权限设为仅当前用户可读写；将管理员密码保存到密码管理器，绝不提交、上传或发送此文件。

4. 在目标账户对新的 D1 单独执行迁移：

   ```sh
   npm run db:remote
   ```

   如果该机器无法完成 Wrangler 登录，在 Dashboard 的 D1 SQL 控制台按文件名顺序执行 `0001` 到 `0004` 的已审阅 SQL；不要跳过迁移，也不要将迁移加入自动构建。

5. 将 `.production-secrets.json` 中的 `ADMIN_PASSWORD` 和 `SESSION_SECRET` 添加为目标 Worker 的生产 Secrets。可使用 Dashboard，或在已认证的受控机器执行：

   ```sh
   npx wrangler secret bulk .production-secrets.json --config wrangler.jsonc
   ```

6. 提交新的 `wrangler.jsonc`（其中仅含该账户的 D1 ID，不含 Secrets）并推送到连接 Workers Builds 的分支；使用第 1 节的构建命令发布。
7. 为新环境绑定它自己的自定义域名，再从该域名的管理后台创建节点并下载 VPS 配置。

## 7. 常见问题

| 现象 | 处理 |
| --- | --- |
| Build 报 `assets.directory` 不存在 | Build command 必须先运行 `npm run build`，使 `dist/` 在 deploy 前生成。 |
| D1 绑定报 `database_id` 未找到 | 确认该 ID 属于当前 Cloudflare 账户；fork 必须使用自己的 D1。 |
| `/api/session` 返回 `configured: false` | 在 Worker 的生产 Variables and Secrets 中确认 `ADMIN_PASSWORD` 与 `SESSION_SECRET` 均已设置且名称正确。 |
| 本机 `wrangler login` 回调失败 | 当前 Wrangler 4.92.0 没有设备码登录；改用 Dashboard 或可正常完成 localhost OAuth 回调的受控机器。 |
| 管理员无法登录 | 使用密码管理器中保存的生产密码；遗失时替换 Dashboard 中的 `ADMIN_PASSWORD`，不要从 `.dev.vars` 或 Git 查找。 |
| 探针不上报 | 检查节点专属 token、endpoint 是否为 `https://vps.huckge.com`、VPS 出站 443、DNS 与 HTTPS 证书。 |

更完整的产品、容量和运维说明见 [部署与使用手册](../docs/部署与使用手册.md)。其中“尚未上线”或旧的首次部署叙述不适用于当前生产环境，以本文件为准。
