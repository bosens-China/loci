# Loci CLI

Loci CLI 是面向终端用户的本地文档知识库。它可以管理和同步公开文档、搜索本地 Markdown、使用云端公开文档库、管理远程 Loci Server，并在没有桌面环境时启动同一个 Loci MCP。

CLI 的消息、提醒和交互目前只提供中文。输出用于人在终端中阅读，不承诺 JSON 等机器可读格式；AI Agent 应使用 Loci MCP。

## 安装

需要 Node.js 22.13 或更高版本：

```bash
npm install --global @boses/cli
loci --help
```

HTTP 文档无需浏览器即可同步。SPA 等依赖客户端渲染的文档需要显式安装 Playwright Chromium headless shell：

```bash
loci browser install
loci browser status
```

安装 CLI 本身不会自动下载浏览器，也不会静默提权安装 Linux 系统依赖。

## 常用命令

```bash
loci status
loci update
loci source add
loci source sync
loci document search React
loci document read <短 ID>
loci cloud list
loci doctor
```

缺少参数时，交互式终端会提示输入；在 CI 或管道中应通过选项提供全部必填值。删除、覆盖导入、清空文档和清空文档源默认要求确认，可显式传入 `--yes`。

完整命令分组：

```text
loci source list|add|update|delete|sync|runs
loci document list|tree|search|read
loci cloud list|pull|update|remove
loci admin
loci mcp stdio|serve|status|configure
loci browser status|install|uninstall
loci config list|set
loci data export|import|clear-documents|clear-sources
```

`loci source list` 和 `loci cloud list` 都会展示页面数和 Markdown 内容大小，按 `B`、`KB`、`MB`、`GB` 等单位自动转换。同一云端 revision 在下载前后的内容大小一致；JSON 传输包装和 SQLite、FTS 存储开销不计入。

`loci data clear-documents` 只清空文档和全文索引并保留文档源；`loci data clear-sources` 会清空全部本地文档源及其文档、索引和抓取历史，包括已下载的云端副本，但不会删除应用设置或远程 Server 内容。

## 与桌面端共享数据

CLI 与桌面端默认解析同一个 Loci 数据目录和 `loci.sqlite`。CLI 完成同步后，切换回已经运行的桌面窗口即可刷新看到新内容。SQLite 使用 WAL 和忙等待处理正常并发，同一文档源同步及覆盖导入等维护操作还有跨进程文件锁保护。

可用 `LOCI_DATA_DIR` 临时覆盖数据目录，适合测试或隔离环境。除非明确需要独立知识库，不建议在日常使用中设置它。

## 管理员会话

```bash
loci config set server-url https://loci.example.com
loci admin
```

CLI 会交互式读取账号和隐藏的密码。密码与登录 Token 只保存在当前进程内存中，退出会话后清除；下次运行必须重新登录。

## MCP

桌面端和 CLI 提供的是同一个逻辑 Loci MCP，Agent 配置中始终只保留一个名为 `loci` 的入口。CLI 默认使用 stdio，适合由 Agent 按需拉起，不需要常驻进程：

```bash
loci mcp configure codex
loci mcp stdio
```

桌面端继续提供自动管理的本机 HTTP MCP。只安装桌面端时可使用它；桌面端导入 Agent 配置时如果检测到本地 CLI，会优先写入 CLI stdio，否则写入桌面 HTTP。需要显式以前台 HTTP 服务兼容现有配置时可以运行：

```bash
loci mcp serve
loci mcp configure codex --transport http
loci mcp status
```

两种 transport 暴露相同的十个工具，包括本地文档库的获取、同步、目录、搜索和阅读，以及云端公开目录查询与快照拉取。Agent 的推荐获取顺序和确认边界由 [`use-loci`](../../.agents/skills/use-loci/SKILL.md) Skill 约束。

普通 CLI 命令不会隐式启动后台进程，也不会运行本地定时同步或云端自动同步。

CLI 每天首次在交互终端运行时会在后台检查一次 npm 最新版本，网络检查最多持续 5 秒，不会阻塞当前命令。发现更新后会在后续命令中提示；也可随时运行 `loci update` 立即检查。

## 退出码

- `0`：成功或用户主动取消。
- `1`：认证、网络、运行时或内部错误。
- `2`：参数或用户输入错误。
- `3`：操作完成但存在页面失败、诊断异常等需要注意的结果。

遇到问题时先运行 `loci doctor`。浏览器不可用时运行 `loci browser install`；MCP 端口被占用时运行 `loci mcp status` 查看现有实例。
