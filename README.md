# CF VPS Monitor 云端观测站

面向多台低配置 VPS 的轻量监控面板。前端、管理 API 和历史数据库部署在 Cloudflare Workers + D1，每台被监控机器只运行一个 Go 探针。针对 1 核 512 MB / 1 GB 的机器采用低频采样、休眠等待、失败退避和自动配额保护。

完整中文文档：[部署与使用手册](docs/部署与使用手册.md)。

## 已实现

- 公开匿名状态页面、管理员登录、浅色和深色主题。访客卡片跳转到独立状态页，完整仪表盘和地图仅管理员可见。
- 仪表盘式概览：顶部六格汇总（内存、剩余价值、硬盘、累计流量、实时上下行，含迷你趋势线）与可旋转球体并排，下方是状态和地区两组筛选，再下方是节点卡片网格；默认显示在线节点，保留列表视图，整卡点击打开详情。
- 节点卡片按参考站结构排布：状态圆点 + 名称 + 状态徽标、地区行、CPU / 内存 / 硬盘 / 流量四格指标条、实时与累计流量、到期剩余，以及最近 16 次采样的延迟和丢包色条。
- 节点状态分为在线、警告、离线、待接入。任一资源占用达到 80%，或到期日进入配置的提醒窗口，即标记为警告。
- PC 使用鼠标拖动和滚轮缩放；触屏默认可从地图区域滑动页面，点击“操作地图”后启用手势，点击“完成操作”恢复页面滑动。地图缩放和复位按钮始终可用。
- 地图随实际容器宽度调整布局：大屏扩展画布，小屏将控件与节点信息分行；3D 取景适配宽高比，保留旋转和缩放状态，平铺节点保持固定屏幕点击尺寸。
- 可切换的全球节点地图：平铺世界地图与 3D 地球共用真实海岸线和节点坐标，支持自动旋转、拖拽、缩放、复位和区域定位；地区标记显示在线数/总数。
- 视觉采用纯 CSS 深色网格背景和分层监控台表面，不加载照片、壁纸或其他背景图片；浅色主题沿用同一布局和状态色语义。
- 节点位置字段：按管理员经纬度定位，未填写时使用地区级参考点并明确标注；位置在节点详情和后台管理中展示。
- 节点新增、编辑、分组、排序、公开/隐藏、归档与恢复。
- 独立探针密钥、密钥重置、探针配置下载。
- 创建后等待真实首报，显示接入结果和最近上报时间；过期指标不在概览冒充实时数据。
- CPU、内存、指定磁盘、网络吞吐、累计网络计数、TCP 延迟与丢包率和系统运行时间。
- 可选的每节点流量套餐；填写后卡片显示已用占比，留空表示不限。
- 管理员页脚回显当前访问者自己的 IP、地区和运营商，数据来自 Cloudflare 的请求元信息，不记录也不入库。
- 历史图表按需加载，每页 20 台节点，搜索和筛选。
- 费用、到期日期、分币种月均费用。
- 节点位置字段（地区、纬度、经度），详情中显示定位精度和坐标。
- 离线、资源阈值和到期事件，Telegram 可选通知。
- 定时清理历史和事件；配置摘要导出。
- Linux / Windows / macOS 探针与安装脚本。

本项目是独立的 Cloudflare 适配实现，**不是原版 Komari 的完整移植**，不兼容原版 Komari Agent 协议。没有网页终端、命令执行、文件管理、3x-ui 用户流量查询或服务器重启功能。

## 节点信息保护

访客接口 `/api/nodes` 仅返回匿名编号、匿名名称和正常 / 异常 / 离线 / 待接入状态。编号由服务端使用 `SESSION_SECRET` 做 HMAC 派生，不暴露数据库节点 ID；更换该密钥会更换公开链接。需配置至少 32 字符的密钥，缺失时公开接口拒绝提供数据。

真实名称、地区、坐标、分组、系统和硬件、费用、备注、流量、探针配置及历史指标只对已登录管理员返回。管理员概览使用 `/api/admin/overview`，原有历史接口也必须登录后访问；公开状态接口即使带管理员会话也只返回匿名数据。隐藏或归档节点不出现在访客列表中。站点名称、描述和 Logo 仍属于公开品牌内容。

API 响应禁止缓存，管理员 Cookie 使用 HttpOnly 和 SameSite，并在 HTTPS 下启用 Secure。远程 HTTP API 读取请求跳转 HTTPS，写入请求拒绝执行；仅本机开发地址允许 HTTP。响应包含 HSTS。这里使用的是传输加密、访问控制与匿名化，数据库仍按现有 D1 方案存储。

## 本地运行

要求 Node.js 22.13+。

```sh
npm ci
npm run setup:local
npm run build
npm run db:local
npm run seed:demo
npm run dev
```

访问 `http://127.0.0.1:5175`。管理员开发密钥见 `.local-admin`。演示命令只操作本地数据库，远程部署不包含演示数据。演示节点没有持续探针，几分钟后显示离线是正常行为。

## 验证和编译

```sh
npm run check
npm test
npm run build
cd agent
go test ./...
cd ..
npm run build:agent
```

运行 `npm run build:agent` 可生成 Linux amd64/arm64/386/armv7、Windows amd64/arm64、macOS amd64/arm64 的探针二进制与 SHA256 校验文件，输出位于 `release/agent/`。该目录是可再生发布产物，不纳入源码 Git 提交。

## Cloudflare 部署

```sh
npx wrangler login
npx wrangler d1 create cf-vps-monitor --config wrangler.jsonc
node scripts/prepare-deploy.mjs YOUR_DATABASE_ID
npm run db:remote
npm run deploy
npx wrangler secret bulk .production-secrets.json --config wrangler.jsonc
```

升级已有部署时，`npm run db:remote` 会执行 `0004_traffic_quota.sql`，为 `nodes` 增加 `traffic_limit` 列（默认 0，表示不限）。

`.production-secrets.json` 是本地私密文件，包含生产管理员密钥和会话签名密钥。首次发布与设置 Secrets 之间，管理员接口会保持不可登录状态。保存生产密钥后可删除本地文件，务必保留独立安全备份。

免费套餐不是无限量服务。默认 120 秒上报、900 秒历史采样、7 天历史；节点增加时后端自动扩大间隔。20 / 50 / 100 台的额度估算和限制见手册。当前尚未连接 Cloudflare 账户完成线上发布。

## 源码来源

已拉取以下上游源码到本地 `upstream/`，仅作参考与保留来源。该目录不参与构建，也不随部署包上传。

| 项目 | 提交 |
| --- | --- |
| [Komari](https://github.com/komari-monitor/komari) | `b11ffd3aa7cca03502a75eb64ecbe827d6831d3a` |
| [Komari Glassmorphism](https://github.com/sanrokamlan-prog/komari-theme-Glassmorphism) | `bf8376587c720de915ac48789a8a180357c762d6` |

地区图标复用主题的本地资源，相应 MIT 许可位于 `licenses/`。后端协议、页面和探针在本项目中独立实现。系统指标采集使用 [gopsutil](https://github.com/shirou/gopsutil)，图表使用 uPlot，图标使用 Lucide。
