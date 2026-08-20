# Loci

> 为 AI Agent 准备的本地优先文档知识库。

Loci 将公开技术文档收录为本地 Markdown，提供全文搜索，并通过 Web UI、CLI 和 MCP 供人与 Agent 使用。文档内容保留在本机，不会上传。

## 特性

- 收录网页、公开 GitHub 仓库中的 Markdown、`llms.txt` 和 OpenAPI 文档。
- 用户级后台服务持续执行持久任务和定时计划，Web UI 与 CLI 共享同一份本地 SQLite 数据和全文索引。
- Agent 可通过 MCP 按需搜索和读取文档；只有 Skill 时，也可在授权安装 CLI 后直接调用同一批工具。
- 同一文档源的重复同步会复用已有任务；不同文档源可并行处理。

## 快速开始

### CLI 与 Web UI

需要 Node.js 22.13 或更高版本：

```bash
npm install --global @boses/cli
loci ui
loci source add https://rspress.rs/guide/introduction.html
loci source sync rspress
loci document search "Quick start"
loci agent
# 无 MCP 连接时也可直接调用同一工具
loci mcp call loci_list_libraries
```

`loci ui` 会启用当前用户的后台服务并打开本机 Web 控制台。关闭浏览器和终端不会停止已排队的同步或定时计划。仓库的 `pnpm dev` 用于联调本地服务与 Web UI，`pnpm build` 构建包含 Web UI 的 CLI 发布包。

需要抓取依赖客户端渲染的网站时，再安装浏览器运行时：

```bash
loci browser install
```

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
