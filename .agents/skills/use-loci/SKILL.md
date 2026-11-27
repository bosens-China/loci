---
name: use-loci
description: 用本地 loci CLI 查阅与项目版本匹配的 API、配置、SDK 和迁移文档。
---

# 使用 Loci 查阅技术文档

具体 API、配置和迁移问题优先查本地文档。报错排查、Issue、博客等需求直接搜索。本地 CLI 不可用或证据不足时，查官方网页。

1. 从项目清单或锁文件确认依赖版本，用 `loci list --json` 选库并记录 `id`。
2. 用 `loci search <查询> --library <lib> --content --json` 读取去重后的完整命中小节。续页时沿用查询，将 `nextOffset` 和 `nextPageToken` 分别传给 `--offset` 和 `--page-token`。如果结果顺序已更新，从第一页重新查。旧版 CLI 或需要精确读取时，先用 `loci search ... --json` 定位，再用 `loci read <目标> --library <lib> --section <sectionId> --json` 读取。回答时引用结果中的 `url`。
3. 缺库时核实官方 URL 后运行 `loci fetch <url>`，已有库过时用 `loci update <lib>`。轮询 `loci status <lib> --json` 至终态，检查 `error` 和 `failures`，再回到查询。需前台等待时加 `--wait`。

管理操作按用户明确要求执行。删除、覆盖、缩小收录范围或安装软件前需获得授权。已获授权的非交互操作按命令要求使用 `--yes`。

参数和示例按需查阅 [文档库命令](https://bosens-china.github.io/loci/cli/commands/local-library.md) 或 [完整文档索引](https://bosens-china.github.io/loci/llms.txt)。离线时用 `loci <命令> --help`。
