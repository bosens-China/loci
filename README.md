# Loci

> 为 AI Agent 准备的本地优先文档知识库。

Loci 将公开技术文档收录为本地 Markdown，提供全文搜索，并通过 Web UI、CLI 和 MCP 供人与 Agent 使用。文档内容保留在本机，不会上传。

## 特性

- 收录网页、公开 GitHub 仓库中的 Markdown、`llms.txt` 和 OpenAPI 文档。
- Web UI 的本机 HTTP 只在当前终端会话期间运行；抓取由独立的无 HTTP worker 执行。默认数据目录中的定时抓取或云端每日同步会自动准备用户级常驻 worker，普通后台任务使用空闲后退出的按需 worker。各入口共享同一份本地 SQLite 数据和全文索引。
- Agent 可通过 MCP 按需搜索和读取文档；长时间抓取使用 SDK 原生逐页进度和取消，Host 不支持时由 Skill 降级到 CLI。
- 已知页面不在自动抓取路径时，可通过 MCP 只插入或刷新指定 URL，而不扩大站点发现范围。
- 同一文档源的重复同步会复用已有任务；不同文档源可并行处理。

## 快速开始

### CLI 与 Web UI

需要 Node.js 22.16 或更高版本：

```bash
npm install --global @boses/cli
loci ui
loci source add https://rspress.rs/guide/introduction.html
loci source sync rspress
loci task list
loci document search "Quick start"
loci agent setup codex
# 无 MCP 连接时也可直接调用同一工具
loci mcp call loci_list_libraries
```

`loci agent setup <client>` 会一次配置用户级 MCP、`use-loci` Skill 和全局 Rules；`loci agent status` 检查状态，`loci agent remove <client>` 安全移除 Loci 管理的内容。`loci ui` 的“Agent”入口提供相同能力。

`loci ui` 会先输出本机 Web 地址，再尝试打开浏览器，并在当前终端运行仅服务本次会话的回环 HTTP；按 `Ctrl+C` 会关闭 HTTP，但已经提交的后台任务继续由独立 worker 执行。浏览器无法自动打开时，复制终端中的地址手动访问即可。Web 的“管理”入口可以登录目标 Server，维护公开文档库和同步任务；远程 Admin Token 只保存在当前 Runtime 内存。在默认数据目录中开启定时抓取或云端每日同步后，Loci 会立即确保无 HTTP 的登录自启动 worker 可用；设置 `LOCI_DATA_DIR` 时只启动当前登录会话的 detached worker，长期运行需要由外部进程管理器托管 `loci service run`。`loci service start` 保留为默认用户级服务的手动恢复和治理入口。仓库的 `pnpm dev` 使用 `.loci-dev` 隔离数据、缓存和模拟用户目录来联调本机 Web 会话与 worker；需要复现正式数据问题时显式运行 `pnpm dev:user`，其 Web 写操作会直接修改正式 Loci 数据和真实 Agent 文件。`pnpm build` 构建包含 Web UI 的 CLI 发布包。

需要抓取依赖客户端渲染的网站时，再安装浏览器运行时：

```bash
loci browser install
```

## Server 部署安全

Loci Server 会在应用层拒绝非公网目标，但 DNS 校验只属于纵深防御。生产部署必须通过主机防火墙、云网络策略或受控出口代理，在每个实际发起目标连接的执行环境阻断 RFC 1918、loopback、link-local、IPv6 本地地址和云元数据服务。默认本地 Chromium 需覆盖 Loci Server 容器；使用远程 Browserless 时还必须覆盖 Browserless 执行环境。不要只依赖应用层 URL 或 DNS 检查作为 SSRF 边界。

## 文档

- [使用文档](https://bosens-china.github.io/loci/)
- [CLI 快速开始](https://bosens-china.github.io/loci/cli/getting-started)
- [接入 Agent](https://bosens-china.github.io/loci/agent/overview)
- [通过 MCP 接入](https://bosens-china.github.io/loci/agent/mcp)

## 参与贡献

欢迎通过 [Issue](https://github.com/bosens-China/loci/issues) 提交问题或建议，也欢迎提交 Pull Request。提交前请运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 许可证

[MIT](./LICENSE)
