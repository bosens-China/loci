---
name: use-loci
description: 通过本地 loci CLI 查阅与项目版本匹配的库、框架、SDK、API、配置和迁移文档，在缺少资料时确认来源与抓取范围。
---

# 使用 Loci 查阅技术文档

先从项目清单或锁文件确认版本。发布亮点可直接查官方发布说明，具体 API、配置与迁移行为优先核对本地文档正文。

1. **选库。** 运行 `loci list --json`，用名称、URL、分类和版本选择匹配的库，记下 `id`。`loci category --json` 列出分类和库数量，`loci list --category <name> --version <ver> --json` 可组合精确筛选。
2. **定位。** 用 `loci tree <lib> --json` 浏览目录，或用 `loci tree <lib> --query <kw...> --json` 筛选。`loci search <queries...> --json` 跨库搜索，加 `--library <lib>` 限定库，加 `--tree` 查看命中树。API 名、配置键和错误消息保留原样。
3. **读正文。** 运行 `loci read <targets...> --library <lib> --json`，目标可为文档 ID 或以 `/` 开头的路径。用 `--section <id>` 读命中小节。回答时引用返回的 `url`。
4. **补齐资料。** 缺库时核实官方 URL，与用户确认来源和范围后运行 `loci fetch <url>`；已获同一授权即可执行。仅需已知页面时加 `--pages`。已有库过时时运行 `loci update <lib>`。两条命令都可用 `--category <name>` 和 `--version <ver>` 标注库。新库默认使用 `未分类` 和 `latest`，已有库保留未显式指定的分类与版本，新分类自动创建。同来源同版本复用，其他版本独立建库。两条命令默认异步返回每个库的 `libraryId`，需要前台等待时加 `--wait`。
5. **检查结果。** 轮询 `loci status <lib> --json`，直到状态变为 `completed`、`completed_with_errors`、`failed` 或 `cancelled`。部分成功或失败时读 `error` 与 `failures` 中的页面 URL 和原因。`loci status --json` 查看各库记录。用 `loci cancel <lib>` 取消该库正在执行的抓取。完成后回到第 2、3 步核实内容。
6. **维护。** 用户要求编辑时，先用 `loci doc sections <doc> --library <lib> --json` 确认小节，再按需创建或修改。删除指定文档用 `loci delete <lib> --doc <targets...>`；删除整库用 `loci delete <lib>`。删除、刻意覆盖或更改已有库的收录范围前确认目标与影响；已获授权的非交互调用用 `--yes`。
7. **备份。** `loci data export <file>` 导出全部，`--category <name...>` 或 `--library <lib...>` 限定范围。`loci data import <file>` 按 ID 或来源与版本匹配，先删旧库再恢复备份内容，保留其他库。`--replace-all` 清空全部库后恢复。用户明确要求清空时，用 `loci data clear-documents --yes` 保留库并清空正文，或用 `loci data clear-sources --yes` 删除全部库。

CLI 不可用或已有资料不足时，可使用官方网页等适当来源。安装软件需用户授权。分页、编辑和指定页面抓取示例见 [CLI 调用参考](references/cli.md)。
