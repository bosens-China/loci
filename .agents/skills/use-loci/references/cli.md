# Loci CLI 调用参考

在当前会话没有可调用的 `loci_*` MCP 工具，或当前 Agent/Host 无法同时使用 MCP 原生 Progress 与 Cancellation 来执行长时间抓取时，读取和使用本参考。这里的 CLI 主要是工具调用和持久任务载体，不需要为降级重新配置 MCP。

## 准备 CLI

1. 使用 `command -v loci` 检查全局命令是否存在；这一步只读，不需要用户确认。
2. 命令存在时，可用 `loci --version` 验证它能运行，然后直接进入工具调用。
3. 命令不存在时，向用户说明需要全局安装 npm 包 `@boses/cli`，并取得明确同意。
4. 用户同意后执行 `npm install --global @boses/cli`。安装失败时报告实际错误，不要假装 Loci 可用。
5. 用户拒绝安装、环境没有 npm/Node.js 或安装持续失败时，把 Loci 视为不可用，并按主文档的其他来源兜底条件继续。

安装授权只允许安装 CLI，不等于允许拉取云端库、抓取官网、主动同步或删除文档库。这些写操作仍需分别遵守主文档的确认规则。不要自行改用 `npx` 绕过用户对安装的决定。

## 调用工具

统一格式：

```bash
loci mcp call <tool> --input '<json>'
```

例如：

```bash
loci mcp call loci_list_libraries --input '{"query":"vue"}'
loci mcp call loci_get_library_tree --input '{"library_id":"lib-id","depth":2}'
loci mcp call loci_search_files --input '{"queries":["router"],"library_ids":["lib-id"]}'
loci mcp call loci_read_files --input '{"file_ids":["file-id"]}'
```

长时间抓取设置等待完成，并让逐页进度以 JSONL 写入 stderr：

```bash
loci mcp call loci_sync_libraries \
  --input '{"library_ids":["lib-id"],"wait_for_completion":true}' \
  --progress jsonl
```

stdout 始终只包含最终 `structuredContent` JSON。`--progress text` 提供人类可读逐页输出，`--progress none` 关闭进度流。对该命令发送 `SIGINT`（终端中按 `Ctrl+C`）会取消本次调用：若任务由本次调用创建，底层抓取一并取消；若调用复用了已有 single-flight 任务，只停止当前跟随。

无参数工具可以省略 `--input`，默认输入为 `{}`。成功时 stdout 是该工具的结构化 JSON；把它当成直接 MCP 调用的 `structuredContent` 继续处理。诊断写入 stderr，非零退出码表示调用没有成功；此时读取错误、修正参数或按主流程兜底，不要把错误文本当作文档证据。

CLI 是短进程。调用普通模式的 `loci_add_library`、`loci_fetch_pages` 或 `loci_sync_libraries` 时优先传 `"wait_for_completion":true`，以便在同一次调用中取得最终状态；未传时 CLI 仍会在安全收口已启动任务后退出，再用 `loci_get_sync_status` 读取结果。Agent URL 审查使用持久批次，不设置等待参数；按主文档依次调用 `loci_start_url_review`、`loci_get_url_review`、`loci_submit_url_review` 或 `loci_cancel_url_review`。发现任何活动 URL 审查时，不论外层同步状态是 `syncing` 还是 `awaiting_review`，都先使用返回的 `run_id` 调用 `loci_get_url_review`：内层状态为 `discovering` 时用同一 `library_id` 重调 `loci_start_url_review`，为 `awaiting_review` 时提交当前批次。每个短进程都复用同一运行。

需要在另一个终端或工具调用中管理持久抓取时，使用任务命令：

```bash
loci task list
loci task status <task-id>
loci task follow <task-id> --format jsonl
loci task cancel <task-id>
```

`task follow` 按持久 sequence 逐页读取，不会因轮询较慢丢页；其中 `Ctrl+C` 只停止跟随并保留任务，真正停止抓取必须运行 `task cancel`。这些命令只用于进度和取消，不替代 Loci MCP 工具的文档检索流程。

工具名与 MCP 完全一致：

- 发现与读取：`loci_list_libraries`、`loci_get_library_tree`、`loci_search_files`、`loci_read_files`
- 云端获取：`loci_list_cloud_libraries`、`loci_pull_cloud_library`
- 抓取规划：`loci_inspect_library_source`（只读）、`loci_update_library`（修改配置，不自动同步）
- 官网抓取与同步：`loci_add_library`、`loci_fetch_pages`、`loci_sync_libraries`、`loci_get_sync_status`、`loci_list_sync_failures`
- Agent URL 审查：`loci_start_url_review`、`loci_get_url_review`、`loci_submit_url_review`、`loci_cancel_url_review`
- 删除：`loci_delete_library`

JSON 应作为单个 shell 参数传递，避免变量插值或命令替换。不要把 Token、密码、Cookie 或其他凭据写入参数、命令历史或错误输出。

## 禁止的替代路径

- 不运行 `loci agent connect` 或 `loci mcp stdio`；CLI 分支不需要创建 MCP 连接。
- 不要求用户重启 Agent 或开启新会话。
- 不使用普通 `loci source`、`loci cloud`、`loci document` 等命令拼装第二套文档检索工作流；`loci task` 仅用于允许的长任务进度和取消降级。
- 当前会话后来出现 Loci MCP 工具时，不对已经完成的 CLI 操作重复执行；下一项操作可切回 MCP 通道。
