# Loci

Loci 是为 AI Agent 准备的本地知识库。它将用户指定的公开文档抓取为本地 Markdown，提供目录浏览、全文搜索和本机 MCP 服务，并通过配套的 [`use-loci`](./skills/use-loci/SKILL.md) Skill 指导 Agent 按需发现和组合阅读文档。

当前版本使用 Electron、React、TypeScript 和 SQLite，数据仅保存在本机。
