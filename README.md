# Loci

Loci 是为 AI Agent 准备的本地知识库。它将用户指定的公开文档抓取为本地 Markdown，提供目录浏览、全文搜索和本机 MCP 服务，并通过配套的 [`use-loci`](./.agents/skills/use-loci/SKILL.md) Skill 指导 Agent 按需发现和组合阅读文档。

当前版本使用 Electron、React、TypeScript 和 SQLite。本地文档保存在本机；仓库同时提供可选的 [Loci Server](./apps/server/README.md)，用于抓取和发布公开文档库的只读快照，本地内容不会上传到服务器。

Loci 只抓取无需登录即可访问的公开 HTTP/HTTPS 页面，不处理登录态、验证码、Cloudflare 等反爬挑战或访问限制。URL 会移除 Query 和 Fragment，因此不支持使用 `#` 区分页面的 Hash Router 文档站。

## 仓库结构

- `apps/desktop`：Electron 桌面应用，包括主进程、Preload 和 React Renderer。
- `apps/server`：可选的 Hono 文档抓取与快照服务。
- `packages/core`：桌面端与服务端复用的抓取和调度能力。
- `docs`：产品决策与功能工作区文档。

根目录只负责 pnpm workspace 编排、统一质量检查和发布，不再承载应用源码。

## 文档

- [产品 PRD](./docs/PRD.md)
- [Loci Server 部署与 API](./apps/server/README.md)
- [Agent 使用 Skill](./.agents/skills/use-loci/SKILL.md)

## 下载与发布

安装包发布在 [GitHub Releases](https://github.com/bosens-China/loci/releases)。合并普通 PR 后，Release Please 会根据提交消息维护版本 PR；再合并版本 PR，即创建对应 tag、Release 和三平台安装包。

仓库采用单一产品版本：根 `package.json` 是 Release Please 的版本源，版本 PR 会同步更新桌面端、服务端和 core 包版本，并统一写入根 `CHANGELOG.md`。服务端目前仍通过仓库内 Compose 从源码构建，不单独发布容器镜像。

- `fix:` 发布补丁版本，例如 `1.0.0` → `1.0.1`
- `feat:` 发布次版本，例如 `1.0.0` → `1.1.0`
- `feat!:` 或提交正文中的 `BREAKING CHANGE:` 发布主版本
- 提交正文中的 `Release-As: 1.2.3` 可指定下一版本
