---
name: use-loci
description: 通过本地 loci CLI 查询和更新与项目版本匹配的技术文档（API、配置、SDK、迁移）；报错排查、Issue、博客等非文档需求直接使用搜索工具。
---

# 使用 Loci 查阅与更新技术文档

## 使用场景

- **优先用 Loci（技术文档）**：查阅库、框架、SDK 的 API、配置项、行为细节、版本差异与迁移指南。默认直接查询本地文档库，文档过时时直接更新。
- **直接用搜索工具（非文档）**：报错排查、GitHub Issue/PR、社区讨论、技术博客、方案选型对比、发布亮点或最新动态、普通网页检索等，直接用搜索工具查询，不必先走 Loci 或抓进本地库。
- **回退**：本地 CLI 不可用、缺库且不适合抓取、或已有本地资料不足时，直接查阅官方网页或使用搜索工具。

## CLI 使用指南

1. **确认版本并选库**
   先从项目清单或锁文件确认依赖版本，再运行 `loci list --json` 按名称、URL、分类和版本定位目标库，记下 `id`。需要筛选时可用 `loci category --json` 与 `loci list --category <name> --version <ver> --json`。

2. **定位文档**
   用 `loci tree <lib> --json` 浏览目录，或用 `loci tree <lib> --query <kw...> --json` 裁剪目录；用 `loci search <queries...> --json` 全文检索（`--library <lib>` 限定库，`--tree` 查看命中树）。API 名称、配置键和错误消息保留原样。

3. **阅读正文并引用**
   运行 `loci read <targets...> --library <lib> --json`，目标可为文档 ID 或 `/` 开头的路径；命中具体小节时加 `--section <id>`。回答时引用返回的 `url`。

4. **更新与补齐文档**
   - **已有库过时**：直接运行 `loci update <lib>`；仅需刷新个别页面时用 `loci update <lib> --pages <urls...>`。
   - **缺库需抓取**：核实官方文档 URL 后直接运行 `loci fetch <url>`；仅需已知页面时加 `--pages`。
   - 两条命令均支持 `--category <name>` 与 `--version <ver>`（新库默认 `未分类` 与 `latest`，已有库保留未显式指定的标签，新分类自动创建；同来源不同版本独立建库）。

5. **检查抓取状态**
   `fetch` 与 `update` 默认异步返回 `libraryId`，需要前台等待时加 `--wait`。异步启动后轮询 `loci status <lib> --json`，直到变为 `completed`、`completed_with_errors`、`failed` 或 `cancelled`。部分成功或失败时检查 `error` 与 `failures`，需要中止时运行 `loci cancel <lib>`。完成后回到第 2、3 步核实正文。

## 管理操作（仅按明确要求执行）

默认只执行上述查询与更新流程。仅在用户明确要求时，才执行文档/小节编辑、删除文档或整库、分类管理、备份导入导出或清空数据。删除、刻意覆盖、缩小收录范围或安装软件前需获用户授权；已获授权的非交互调用使用 `--yes`。完整参数与示例见 [CLI 调用参考](references/cli.md)。
