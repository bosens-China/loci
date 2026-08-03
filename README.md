# Loci

## 项目是什么

Loci 是为 AI Agent 准备的本地知识库。它将公开文档抓取为本地 Markdown，提供目录浏览、全文搜索和 MCP 服务，让 Agent 能按需发现和阅读文档。

Loci 提供 Electron 桌面应用和独立 CLI，两者共享同一份本地 SQLite 数据；本地文档不会上传到服务器。

## 如何使用

### 桌面应用

前往 [GitHub Releases](https://github.com/bosens-China/loci/releases) 下载适用于 macOS、Windows 或 Linux 的安装包。安装后，添加公开文档源并同步，即可在应用中浏览和搜索文档。

### CLI

CLI 需要 Node.js 22.13 或更高版本：

```bash
npm install --global @boses/cli
loci --help
```

常用命令：

```bash
loci source add
loci source sync
loci document search React
loci mcp configure codex
```

需要抓取依赖客户端渲染的文档站时，安装浏览器运行时：

```bash
loci browser install
```

更多命令请查看 [CLI 文档](./apps/cli/README.md)。

## 开源协议

MIT License
