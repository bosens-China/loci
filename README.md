# Loci

> 为 AI Agent 准备的本地优先文档知识库。

Loci 将公开技术文档收录为本地 Markdown，提供全文搜索，并通过桌面应用、CLI 和 MCP 供人与 Agent 使用。文档内容保留在本机，不会上传。

## 特性

- 收录网页、公开 GitHub 仓库中的 Markdown、`llms.txt` 和 OpenAPI 文档。
- 桌面应用与 CLI 共享同一份本地 SQLite 数据和全文索引。
- 通过 MCP 按需搜索和读取文档，适用于 Codex 等 Agent 客户端。
- 同一文档源的重复同步会复用已有任务；不同文档源可并行处理。

## 快速开始

### 桌面应用

从 [GitHub Releases](https://github.com/bosens-China/loci/releases) 下载适用于 macOS、Windows 或 Linux 的安装包。添加文档源并完成同步后，即可浏览和搜索本地文档。

### CLI

需要 Node.js 22.13 或更高版本：

```bash
npm install --global @boses/cli
loci source add https://rspress.rs/guide/introduction.html
loci source sync rspress
loci document search "Quick start"
loci mcp configure codex
```

需要抓取依赖客户端渲染的网站时，再安装浏览器运行时：

```bash
loci browser install
```

## 文档

- [使用文档](https://bosens-china.github.io/loci/)
- [CLI 快速开始](https://bosens-china.github.io/loci/cli/getting-started)
- [桌面应用快速开始](https://bosens-china.github.io/loci/desktop/getting-started)
- [MCP 集成](https://bosens-china.github.io/loci/agent/mcp)

## 参与贡献

欢迎通过 [Issue](https://github.com/bosens-China/loci/issues) 提交问题或建议，也欢迎提交 Pull Request。提交前请运行：

```bash
pnpm lint
pnpm typecheck
pnpm test
```

## 许可证

[MIT](./LICENSE)
