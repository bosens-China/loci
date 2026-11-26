# Loci

Loci 把公开技术文档收录为本地 Markdown。人可以在终端或 Web UI 查阅和编辑，Agent 可以用本机 CLI 搜索目录、读取命中小节并引用来源。三个入口共用本机文档库与 SQLite 全文索引。

## 快速开始

需要 Node.js 22.16 或更高版本。以下示例只收录 Rspress 的一个页面。

```bash
npm install --global @boses/cli
loci list --json
loci fetch https://rspress.rs/guide/introduction.html --pages --name rspress --wait
loci tree rspress --json
loci search Rspress --library rspress --json
loci read /guide/introduction.html --library rspress --json
```

`read` 接受一个或多个文档 ID 或路径。遇到重定向时，可从 `tree` 的结果复制实际 ID。整库抓取会识别公开 GitHub 仓库、`llms.txt`、OpenAPI、Sitemap 或页面链接。`loci fetch` 和 `loci update` 默认异步返回。示例加 `--wait`，以便下一条命令立即读取已收录的内容。后台抓取可用 `loci status rspress --json` 轮询至终态，`error` 和 `failures` 提供具体失败原因。`loci cancel rspress` 取消该库正在进行的抓取。

```bash
loci ui
```

Web UI 默认在 `127.0.0.1:4520` 打开。可在知识管理页查看目录、阅读正文和编辑小节，在设置页导出或恢复 ZIP。终端会保持前台运行，按 `Ctrl+C` 关闭。需要自动选择端口且只打印地址时，运行 `loci ui --port 0 --no-open`。

## 分类与版本

`fetch` 和 `update` 支持 `--category <name>` 与 `--version <ver>`。新库默认使用 `未分类` 和 `latest`。刷新已有库时保留未显式指定的分类和版本。同一来源按版本分别建库，重复抓取相同版本会复用该库。首次使用新分类时自动创建。用 `loci list --category 前端 --version v19 --json` 精确筛选。`loci category` 显示每个分类的库数量，`loci category add <name>` 创建空分类，`loci category delete <name>` 删除分类并将关联库设为不可删除的 `未分类`。

## 备份与导入

`loci data export backup.zip` 导出全部库、分类、设置与域名策略。添加 `--category 前端 后端` 或 `--library <库ID>` 可导出选定范围。`loci data import backup.zip` 默认合并，先删除 ID 相同或来源与版本均相同的旧库，再写入备份中的正文、索引、指定页面和抓取记录，其他库保留。旧版只读快照按原服务器地址和远端库 ID 匹配，可与同源可写库并存。使用 `--replace-all` 会清空全部本地库，导入完整备份时同时恢复设置与域名策略。

设置页可以清空正文或删除全部文档库。CLI 使用 `loci data clear-documents` 或 `loci data clear-sources`。两者都要求确认，已获授权的脚本可以加 `--yes`。

## Agent 接入

```bash
loci setup codex
loci setup status codex --json
```

`setup` 同步该客户端的全局 `use-loci` Skill 和 Rules。Agent 先列库、定位并阅读正文。缺库时确认官方 URL 与范围后抓取，过时时刷新，通过 `status` 查看进度与失败原因。单独为项目安装 Skill 用 `loci skills add use-loci --project ./`。

- [使用文档](https://bosens-china.github.io/loci/)
- [CLI 快速开始](https://bosens-china.github.io/loci/cli/getting-started)
- [接入 Agent](https://bosens-china.github.io/loci/agent/overview)

## 本地开发与贡献

`pnpm dev` 使用 `.loci-dev` 隔离文档、浏览器缓存和 Agent 用户文件。`pnpm dev:user` 使用真实用户目录，Web 写操作会修改正式数据和 Agent 文件。`pnpm cli:build` 生成包含 Web UI 与 Skill 的 CLI 发布包。

```bash
pnpm install
pnpm dev
```

提交变更前可运行以下验证。欢迎提交 [Issue](https://github.com/bosens-China/loci/issues) 或 Pull Request。

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm cli:build
pnpm docs:build
```

## 许可证

[MIT](./LICENSE)
