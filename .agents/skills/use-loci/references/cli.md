# 本地 CLI 调用参考

下列尖括号代表要替换的值：`<lib>` 取自库列表的 `id`，`<doc>` 和 `<section>` 分别取自命中的 `id` 和 `sectionId`。

## 1. 查询文档

```bash
loci list --json
loci list --category 前端 --version v19 --json
loci category --json
loci tree <lib> --query router navigation --json
loci search "router navigation" --library <lib> --json
loci search router navigation --tree --json
loci read <doc> --library <lib> --section <section> --json
loci read /guide /reference/hooks --library <lib> --max-chars 4000 --json
```

- `search` 的 `--library` 可接受多个库；省略时跨库搜索。
- `read` 的位置参数都是读取目标。长正文返回 `nextOffset` 时，单独读取同一篇文档，传入 `--offset <n>` 并沿用原 `--section`。

## 2. 更新与抓取

```bash
loci update <lib> --json
loci update <lib> --pages <url...> --json
loci update <lib> --wait --json
loci fetch <url> --json
loci fetch <url> --inspect --json
loci fetch <url> --pages --json
loci fetch <url> --to <lib> --json
loci status <lib> --json
loci status --json
loci cancel <lib> --json
```

- `fetch` 与 `update` 支持 `--category <name>`、`--version <ver>`；新库默认 `未分类` 和 `latest`，已有库保留未显式指定的标签。同一来源按版本独立建库，新分类自动创建。
- `fetch` 缺库时核实官方文档 URL 后直接抓取：`--inspect` 只探测规模和路径分布，`--pages` 只取给定页面，`--to <lib>` 把给定页面补入已有库。
- `fetch` 与 `update` 默认异步启动，返回 `libraryId`、`runId` 和 `reused`。同库相同目标可复用进行中的任务；遇到其他抓取占用提示时，等待当前任务结束后重提。加 `--wait` 在前台等待进度与结果（按 `Ctrl+C` 取消）。
- 轮询 `loci status <lib> --json` 至终态，检查 `error` 与 `failures` 中的逐页原因；中止进行中的抓取用 `loci cancel <lib>`。

## 3. 管理操作（仅在用户明确要求时）

删除、刻意覆盖、导入恢复或改变可能裁剪旧内容的收录配置前，必须先确认目标与影响；已获授权的非交互调用使用 `--yes`。

### 分类管理

```bash
loci category add <name> --json
loci category delete <name> --yes --json
```

默认分类 `未分类` 不可删除；删除其他分类后，关联库自动归入 `未分类`。

### 编辑与删除文档

```bash
loci doc create <lib> --title "路由笔记" --path /notes/router --file ./router.md --json
loci doc sections <doc> --library <lib> --json
loci doc section <doc> --library <lib> --action update --section <section> --file ./section.md --yes --json
loci delete <lib> --doc <doc> --yes --json
loci delete <lib> --yes --json
```

按用户要求编辑时，用文档 ID 指定单篇，小节变更后重新列出小节。

### 备份、恢复与清空

```bash
loci data export <file> --json
loci data export <file> --category <name...> --library <lib...> --json
loci data import <file> --yes --json
loci data import <file> --replace-all --yes --json
loci data clear-documents --yes --json
loci data clear-sources --yes --json
```

- `export` 省略筛选条件时导出全部；覆盖同名文件需 `--yes`。
- `import` 默认按库 ID 或来源与版本匹配，先删旧库再恢复，保留其他库（旧版只读快照按原服务器地址与远端库 ID 匹配）；`--replace-all` 清空本地全部库后恢复，完整备份还会恢复设置和域名策略。
- `clear-documents` 清空正文与索引并保留库；`clear-sources` 删除全部库。两者均保留分类和设置，仅在用户明确授权对应范围后执行。
