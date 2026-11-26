# 本地 CLI 调用参考

下列尖括号代表要替换的值。`<lib>` 取自库列表的 `id`；`<doc>` 和 `<section>` 分别取自命中的 `id` 和 `sectionId`。

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

`--library` 在 `search` 中可接受多个库；省略时跨库搜索。`read` 的位置参数都是读取目标。长正文返回 `nextOffset` 时，单独读取同一篇文档，传入 `--offset <n>`，并沿用原小节。

`fetch` 和 `update` 接受 `--category <name>`、`--version <ver>`，新库默认使用 `未分类` 和 `latest`，已有库保留未显式指定的分类和版本。同一来源按版本建库，新分类名会自动创建。单独管理分类使用 `loci category add <name> --json` 与 `loci category delete <name> --yes --json`，默认分类 `未分类` 不可删除。删除其他分类后，关联库自动归入 `未分类`。

`loci data export <file> --category <name...>` 按分类导出，`--library <lib...>` 按库导出，省略筛选项导出全部。`loci data import <file>` 默认按库 ID 或来源与版本匹配，先删后覆，保留其他库。旧版只读快照按原服务器地址与远端库 ID 匹配。`--replace-all` 清空本地库后恢复，完整备份还会恢复设置和域名策略。导入或覆盖同名备份时，已获授权的非交互调用传 `--yes`。

`loci data clear-documents --yes --json` 清空正文和索引，保留已有库供后续抓取。`loci data clear-sources --yes --json` 清空所有库。两条命令保留分类和设置，只在用户明确授权对应范围后调用。

删除小节、覆盖正文或改变可能裁剪旧内容的收录设置时，已授权的非交互脚本使用 `--yes`。

缺库时先确认官方 URL 和所需范围。`--inspect` 只探测，`--pages` 只取给定页，`--to` 把给定页补入已有库。`fetch` 与 `update` 默认异步启动，每个库返回 `libraryId`、`runId` 与 `reused`。同库相同抓取目标可复用运行。收到其他抓取占用提示时，等当前运行结束后重新提交。轮询 `loci status <lib> --json` 至终态，检查 `error` 和 `failures` 中的逐页原因；需要中止时运行 `loci cancel <lib>`。需要前台进度与最终结果时加 `--wait`，按 `Ctrl+C` 取消。

```bash
loci fetch <url> --inspect --json
loci fetch <url> --pages --json
loci fetch <url> --to <lib> --json
loci update <lib> --json
loci status <lib> --json
loci status --json
loci cancel <lib> --json
loci update <lib> --wait --json
```

按用户要求编辑时，用文档 ID 指定单篇，小节变更后重新列出小节。删除或刻意覆盖前先确认目标。

```bash
loci doc create <lib> --title "路由笔记" --path /notes/router --file ./router.md --json
loci doc sections <doc> --library <lib> --json
loci doc section <doc> --library <lib> --action update --section <section> --file ./section.md --yes --json
loci delete <lib> --doc <doc>
```
