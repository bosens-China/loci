# Loci Server

Loci Server 是单机 Hono 服务，负责抓取公开文档、定时更新并向桌面端发布只读快照。本地文档不会上传到这里。

## 运行

生产环境复制并修改根目录的环境变量示例，然后通过 Compose 启动：

```bash
cp .env.example .env
docker compose up --build -d
```

Compose 只向宿主机发布 Hono 的 `3000` 端口。Browserless Chromium 仅在 Compose
内部网络提供 Playwright WebSocket，并使用独立令牌、两个并发会话和 `2 GB`
共享内存。SQLite 位于命名卷 `loci-data`，重建容器不会删除数据。

本地只调试 HTTP 抓取时，也可以不启动 Browserless：

```powershell
$env:LOCI_ADMIN_PASSWORD = 'replace-me'
pnpm server:build
pnpm server:start
```

| 环境变量              | 默认值   | 说明                                      |
| --------------------- | -------- | ----------------------------------------- |
| `LOCI_ADMIN_PASSWORD` | 无       | 必填的管理员密码                          |
| `LOCI_ADMIN_USERNAME` | `admin`  | 管理员用户名                              |
| `LOCI_BROWSER_URL`    | 无       | Browserless Playwright WebSocket 地址     |
| `LOCI_BROWSER_TOKEN`  | 无       | Browserless 访问令牌，必须与 URL 同时设置 |
| `LOCI_DATA_DIR`       | `./data` | SQLite 数据目录                           |
| `PORT`                | `3000`   | HTTP 端口                                 |

生产环境必须通过 HTTPS 反向代理暴露服务，并持久化 `LOCI_DATA_DIR`。当前只运行一个服务实例。

## 公开 API

- `GET /health`：健康检查。
- `GET /api/v1/libraries`：列出已经发布的文档库。
- `GET /api/v1/libraries/:id/snapshot`：下载完整 JSON 快照。

快照响应提供 `ETag`。客户端再次请求时传入 `If-None-Match`，内容未变化会返回 `304 Not Modified`。

```ts
interface LibrarySnapshot {
  schemaVersion: 1
  library: {
    id: string
    name: string
    url: string
    revision: string
    publishedAt: string
  }
  documents: Array<{
    id: string
    title: string
    url: string
    language: string
    markdown: string
  }>
}
```

## 管理员 API

- `POST /api/v1/admin/login`：使用 `{ username, password }` 登录，返回 24 小时 Bearer Token。
- `POST /api/v1/admin/logout`：注销当前 Token。
- `GET /api/v1/admin/libraries`：列出全部服务器文档库。
- `POST /api/v1/admin/libraries`：创建文档库。
- `PUT /api/v1/admin/libraries/:id`：更新文档库和抓取计划。
- `DELETE /api/v1/admin/libraries/:id`：删除文档库及已发布快照。
- `POST /api/v1/admin/libraries/:id/sync`：启动后台同步，返回 `202` 和任务 ID。
- `GET /api/v1/admin/jobs/:id`：查询同步状态和失败页面。

创建和更新文档库的请求正文：

```json
{
  "name": "Hono",
  "url": "https://hono.dev/docs",
  "pageLimit": 1000,
  "schedule": "0 2 * * *"
}
```

`schedule` 使用五段 Linux Cron，传 `null` 表示关闭定时同步。配置 Browserless
后，服务端会比较入口页的 HTTP 与浏览器渲染结果，再为整个文档库选择一种抓取方式；
后续页面不会重复双通道抓取。

Node HTTP 和浏览器请求都会拒绝回环、局域网及链路本地地址。浏览器还会禁止跨
hostname 导航、弹窗、下载和权限申请。生产机应同时通过主机防火墙或云网络策略
阻断容器访问内网及云元数据地址，避免仅依赖应用层 DNS 检查。

Compose 固定使用 `ghcr.io/browserless/chromium:2.55.2`，服务端固定使用
`playwright-core@1.62.0`。Playwright 原生连接要求两端版本兼容，升级时必须同时
检查 [Browserless 版本说明](https://github.com/browserless/browserless/blob/main/CHANGELOG.md)。

Browserless 容器参数参考 [官方自托管文档](https://docs.browserless.io/enterprise/open-source)，
Hono Node.js 运行方式参考 [Hono 官方文档](https://hono.dev/docs/getting-started/nodejs)。
