# Loci CLI 调用参考

仅在当前会话没有可调用的 `loci_*` MCP 工具时读取和使用本参考。这里的 CLI 是工具调用载体，不是让 Agent 改用普通的人类交互命令。

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

无参数工具可以省略 `--input`，默认输入为 `{}`。成功时 stdout 是该工具的结构化 JSON；把它当成直接 MCP 调用的 `structuredContent` 继续处理。诊断写入 stderr，非零退出码表示调用没有成功；此时读取错误、修正参数或按主流程兜底，不要把错误文本当作文档证据。

CLI 是短进程。调用 `loci_add_library` 或 `loci_sync_libraries` 时优先传 `"wait_for_completion":true`，以便在同一次调用中取得最终状态；未传时 CLI 仍会在安全收口已启动任务后退出，再用 `loci_get_sync_status` 读取结果。

工具名与 MCP 完全一致：

- 发现与读取：`loci_list_libraries`、`loci_get_library_tree`、`loci_search_files`、`loci_read_files`
- 云端获取：`loci_list_cloud_libraries`、`loci_pull_cloud_library`
- 官网抓取与同步：`loci_add_library`、`loci_sync_libraries`、`loci_get_sync_status`、`loci_list_sync_failures`
- 删除：`loci_delete_library`

JSON 应作为单个 shell 参数传递，避免变量插值或命令替换。不要把 Token、密码、Cookie 或其他凭据写入参数、命令历史或错误输出。

## 禁止的替代路径

- 不运行 `loci mcp configure`、`loci mcp stdio` 或 `loci mcp serve`；CLI 分支不需要创建 MCP 连接。
- 不要求用户重启 Agent 或开启新会话。
- 不使用普通 `loci source`、`loci cloud`、`loci document` 等命令拼装第二套工作流。
- 当前会话后来出现 Loci MCP 工具时，不对已经完成的 CLI 操作重复执行；下一项操作可切回 MCP 通道。
