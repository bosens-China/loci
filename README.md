# Loci

Loci 是一个本地技术文档库工具，将公开技术文档收录为本地 Markdown 与 SQLite 全文索引，供终端 CLI、本机 Web UI 和 AI Agent 共同查阅与维护。

- **多来源抓取**：自动识别公开 GitHub 仓库、`llms.txt`、OpenAPI、Sitemap 与文档站点。
- **本地全文检索**：基于 SQLite FTS5，支持目录树浏览、跨库搜索与按小节读取。
- **多入口共用**：CLI 与本机 Web UI 共享同一份本地数据，支持分类、版本与 ZIP 备份恢复。
- **Agent 接入**：内置 `use-loci` Skill 与全局规则，一键接入主流编码 Agent。

## 文档

完整安装、快速上手、命令参考与 Agent 接入指南请访问：

https://bosens-china.github.io/loci/

## 许可证

[MIT](./LICENSE)
