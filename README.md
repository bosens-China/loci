# Loci

## 项目是什么

Loci 是为 AI Agent 准备的本地知识库。它将公开文档抓取为本地 Markdown，提供目录浏览、全文搜索和 MCP 服务，让 Agent 能按需发现和阅读文档。

Loci 提供 Electron 桌面应用和独立 CLI，两者共享同一份本地 SQLite 数据；本地文档不会上传到服务器。

桌面应用、CLI 和本机 MCP 会协调同一文档源的同步与维护操作。重复触发会复用已有任务和持久进度，不会并发改写同一份内容；不同文档源仍可独立执行。取消任务会中止网络与解析流程，只有完整成功且未取消的结果才会事务性提交。

## 如何使用

### 桌面应用

前往 [GitHub Releases](https://github.com/bosens-China/loci/releases) 下载适用于 macOS、Windows 或 Linux 的安装包。安装后，添加公开文档源并同步，即可在应用中浏览和搜索文档。

桌面端会在启动时每天检查一次更新；可在“系统设置 → 关于 Loci”手动检查并前往 Releases 下载新版。macOS 未签名版本需要手动安装，并可能要求在系统“隐私与安全性”中确认打开。

### CLI

CLI 需要 Node.js 22.13 或更高版本：

```bash
npm install --global @boses/cli
loci --help
```

常用命令：

```bash
loci source add https://rspress.rs/guide/introduction.html
loci source add http://localhost:8000/docs # 自动发现 FastAPI / OpenAPI 接口文档
loci source add https://github.com/vuejs/docs # 下载默认分支 ZIP 并收录 Markdown
loci source sync
loci document search React
loci mcp configure codex
loci mcp config # 为 Kimi Code 等客户端输出可复制配置
loci mcp config antigravity # 输出 Google Antigravity HTTP 配置
```

输入 Swagger UI、Knife4j、ReDoc、FastAPI `/docs` 或常见 OpenAPI JSON 地址时，Loci 会在普通网页抓取前自动发现同站的结构化接口规范；命中后直接整理接口、参数、响应、认证和数据模型。未发现规范时继续按普通网页收录。

输入公开 GitHub 仓库 URL 时，Loci 会流式下载默认分支当前提交的 ZIP，只读取其中的 Markdown，并保留仓库相对目录。相对图片会改写为固定提交的 Raw URL，相对链接会改写为固定提交的 Blob URL；私有仓库、非默认分支和 Git LFS 不受支持。

需要抓取依赖客户端渲染的文档站时，CLI 会在 `auto` 检测或 `browser` 抓取前提示安装浏览器运行时；也可以提前手动安装：

```bash
loci browser install
```

更多命令请查看 [CLI 使用文档](./apps/docs/docs/cli/getting-started.mdx)。

## 开源协议

MIT License
