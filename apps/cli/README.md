# Loci CLI

Loci 将网页、GitHub 仓库和 Markdown 文档保存在本机，可从命令行和 Web 界面使用同一份文档库。

```bash
loci fetch https://example.org/docs --scope /docs --wait
loci list --json
loci tree <library> --query hooks --all
loci search hooks --library <library> --json
loci read /guide /reference/hooks --library <library>
loci ui --no-open
```

`loci fetch` 和 `loci update` 默认异步启动，`--wait` 在前台显示进度并等待完成。用 `loci cancel <library>` 取消当前抓取。两条抓取命令均支持 `--http-concurrency <n>` 和 `--browser-concurrency <n>`（1–32）。复用已有库时可显式更新配置，省略的字段沿用已有值。

`fetch` 和 `update` 可用 `--category <name>` 与 `--version <ver>` 标注文档库，新的分类名自动创建。`loci list --category 前端 --version v19 --json` 可组合筛选，`loci category --json` 列出分类及库数。用 `loci category add <name>` 创建空分类，`loci category delete <name>` 删除分类并保留关联库。

`loci status [library]` 可轮询至终态并查询抓取进度、错误原因及最多 20 个失败页面的 URL 和消息，`--json` 通过 `failures` 返回这些明细。`loci setup` 引导安装 Agent 的 Skill 和全局 Rules。运行 `loci --help` 或 `loci <command> --help` 可查看完整选项。

## 本地开发

```bash
pnpm --filter @boses/cli typecheck
pnpm --filter @boses/cli test
pnpm --filter @boses/cli build
node apps/cli/dist/index.js ui --no-open
```

`LOCI_DATA_DIR` 和 `LOCI_CACHE_DIR` 可覆盖本地数据和缓存目录。构建脚本先构建 Web，再将静态资源和 `use-loci` Skill 复制到发布包。`ui` 默认监听 `127.0.0.1:4520`，按 Ctrl+C 关闭。
