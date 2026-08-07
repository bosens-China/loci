# Loci Server

Loci Server 是单机 Hono 服务，负责抓取公开文档、定时更新并向桌面端发布只读快照。本地文档不会上传到这里。

服务端只支持无需登录即可访问的公开 HTTP/HTTPS 文档，不保存登录态，也不处理验证码、Cloudflare 挑战、代理或其他反爬绕过能力。URL 会移除 Query 和 Fragment，因此不支持使用 `#` 区分页面的 Hash Router 文档站。

公开 GitHub 仓库 URL 会进入默认分支 ZIP 流程，收录 `.md` 并保留仓库相对路径。同一 `github.com` 下的不同仓库按仓库根路径区分；私有仓库、非默认分支和 Git LFS 不受支持。

## 本地 Docker 环境

仓库提供独立的本地 Compose 环境，默认监听端口 `7001`：

```bash
docker compose -f compose.local.yaml up --build -d
```

- 服务地址：`http://127.0.0.1:7001`
- 管理员账号：`admin`
- 本地默认密码：`loci-local-admin-password`

桌面开发版的全新数据默认连接该地址。复用已有数据或使用 CLI 联调时，可设置
`LOCI_SERVER_URL=http://localhost:7001`；该覆盖只用于开发启动，正式版默认地址仍为
`https://loci.xiaowo.live`。

可以通过 `LOCI_LOCAL_SERVER_PORT` 和 `LOCI_LOCAL_ADMIN_PASSWORD` 覆盖本地默认值。
默认凭据只用于本机开发，不得用于部署。

```bash
docker compose -f compose.local.yaml down
```

## 生产运行

生产环境复制并修改根目录的环境变量示例，然后通过 Compose 启动：

```bash
cp .env.example .env
docker compose pull
docker compose up -d
```

Compose 默认拉取 GHCR 发布的 Loci Server 镜像，并只向宿主机发布 Hono 的 `3000`
端口。可通过 `LOCI_SERVER_IMAGE` 固定后端版本。镜像只安装与 `playwright-core` 同版本的
Chromium headless shell，不包含完整 Chrome 或 Browserless 服务；浏览器执行 JavaScript、
生成 DOM 后把 HTML 交回现有 Markdown 转换链路。SQLite 位于命名卷 `loci-data`，重建
容器不会删除数据。

本地只调试 HTTP 抓取时，也可以不启动远程浏览器：

```powershell
$env:LOCI_ADMIN_PASSWORD = 'replace-me'
pnpm server:build
pnpm server:start
```

| 环境变量                | 默认值   | 说明                                   |
| ----------------------- | -------- | -------------------------------------- |
| `LOCI_ADMIN_PASSWORD`   | 无       | 必填的管理员密码                       |
| `LOCI_ADMIN_USERNAME`   | `admin`  | 管理员用户名                           |
| `LOCI_BROWSER_PROVIDER` | 自动推断 | `local` 或 `browserless`               |
| `LOCI_BROWSER_URL`      | 无       | 远程 Browserless Playwright 地址       |
| `LOCI_BROWSER_TOKEN`    | 无       | 仅 Browserless 需要                    |
| `LOCI_DATA_DIR`         | `./data` | SQLite 数据目录                        |
| `PORT`                  | `7001`   | HTTP 端口（Compose 内显式使用 `3000`） |

生产环境必须通过 HTTPS 反向代理暴露服务，并持久化 `LOCI_DATA_DIR`。当前只运行一个服务实例。

## 公开 API

- `GET /health`：健康检查。
- `GET /api/v1/libraries`：列出已经发布的文档库，包括页面数和下载后将保存的 Markdown UTF-8 原始字节数 `contentSize`。
- `GET /api/v1/libraries/:id/snapshot`：下载完整 JSON 快照。

快照响应提供 `ETag`。客户端再次请求时传入 `If-None-Match`，内容未变化会返回 `304 Not Modified`。
只有至少包含一个页面的快照才会发布和出现在公开目录中；同步结果为 0 页时保留旧快照，首次同步为 0 页时不产生可下载快照。

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
    relativePath?: string
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
- `POST /api/v1/admin/libraries/sync`：使用 `{ libraryIds: string[] }` 批量提交同步任务。
- `GET /api/v1/admin/jobs`：列出活动和最近的同步任务。
- `GET /api/v1/admin/jobs/:id`：查询同步状态和失败页面。
- `POST /api/v1/admin/jobs/:id/cancel`：取消排队或运行中的同步任务。

创建和更新文档库的请求正文：

```json
{
  "name": "Hono",
  "url": "https://hono.dev/docs",
  "scopePath": "/docs",
  "pageLimit": 1000,
  "schedule": "0 2 * * *"
}
```

`scopePath` 默认是 `/`，只收录该路径及其子路径；同一域名可以按不同范围建立多个文档库，
但同一域名与范围组合不能重复。缩小范围会立即删除范围外的旧文档。

`schedule` 使用五段 Linux Cron，传 `null` 表示关闭定时同步。批量同步任务由 Server
统一排队，最多同时抓取 3 个文档库。任务、进度、所有者和租约保存在 SQLite；共享同一
数据库的多个 Server 进程同时提交同一文档库时会返回同一个活动任务，不同文档库仍可
并行。取消会传递到 HTTP、浏览器、GitHub 下载和 ZIP 解析，取消后不会提交工作文档、
成功 revision 或公开快照。进程异常退出后的过期租约会失败收口，后续请求可以重试。配置浏览器
后，服务端会比较入口页的 HTTP 与浏览器渲染结果，再为整个文档库选择一种抓取方式；
后续页面不会重复双通道抓取。

Node HTTP 和浏览器请求都会拒绝回环、局域网及链路本地地址。浏览器还会禁止跨
hostname 导航、弹窗、下载和权限申请。生产机应同时通过主机防火墙或云网络策略
阻断容器访问内网及云元数据地址，避免仅依赖应用层 DNS 检查。

Compose 默认直接启动镜像内的 Chromium headless shell。Docker 构建分步安装 Chromium
系统依赖和 `playwright install --only-shell chromium`，不会下载带界面的完整 Chromium。
服务端仍兼容 Browserless：设置提供方、Playwright WebSocket 地址和令牌即可复用原连接
方式。

Chromium headless shell 参考 [Playwright 浏览器文档](https://playwright.dev/docs/browsers#chromium-headless-shell)，
Hono Node.js 运行方式参考 [Hono 官方文档](https://hono.dev/docs/getting-started/nodejs)。
