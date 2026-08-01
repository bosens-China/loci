# Loci

Loci 是为 AI Agent 准备的本地知识库。它将用户指定的公开文档抓取为本地 Markdown，提供目录浏览、全文搜索和本机 MCP 服务，并通过配套的 [`use-loci`](./skills/use-loci/SKILL.md) Skill 指导 Agent 按需发现和组合阅读文档。

当前版本使用 Electron、React、TypeScript 和 SQLite，数据仅保存在本机。

## 下载与发布

安装包发布在 [GitHub Releases](https://github.com/bosens-China/loci/releases)。合并普通 PR 后，Release Please 会根据提交消息维护版本 PR；再合并版本 PR，即创建对应 tag、Release 和三平台安装包。

- `fix:` 发布补丁版本，例如 `1.0.0` → `1.0.1`
- `feat:` 发布次版本，例如 `1.0.0` → `1.1.0`
- `feat!:` 或提交正文中的 `BREAKING CHANGE:` 发布主版本
- 提交正文中的 `Release-As: 1.2.3` 可指定下一版本
