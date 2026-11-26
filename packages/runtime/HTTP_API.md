# 本机 Runtime HTTP 契约

`startLocalHttpServer(runtime, { port?, assetsDir?, devOrigin? })` 返回 `{ port, endpoint, close }`。默认使用系统分配的端口，监听 `127.0.0.1`。前台 UI 退出时依次等待 `server.close()` 和 `runtime.close()`。开发脚本在 `127.0.0.1:12333` 启动 Vite，在 `127.0.0.1:12334` 启动本机 API。

请求和响应使用 JSON，ZIP 导入导出除外。JSON 请求上限为 1 MiB。浏览器写请求的 `Origin` 和所有请求的 `Host` 必须匹配本机服务地址或显式配置的回环开发地址。CLI 可以省略 `Origin`。错误响应为 `{ error: string }`。校验失败返回 `400`，来源或 Host 校验失败返回 `403`，缺少资源或路由返回 `404`，资源锁冲突返回 `409`，未配置 Agent 接入时 Agent 路由返回 `503`。

## 文档库与内容

下表中的 `:id` 为完整文档库 ID，路径参数按 URL 编码。`LibrarySummary` 包含 `DocumentSource` 的全部字段，以及 `pageCount` 和排序去重的 `languages`。`updatedAt` 为 ISO 时间，旧版遗留的远端快照以 `readOnly: true` 标识，可读取、导出和删除。

| 方法与路径                            | 请求                                                                                   | 成功响应                                        |
| ------------------------------------- | -------------------------------------------------------------------------------------- | ----------------------------------------------- |
| `GET /health`                         | 无                                                                                     | `200 { service: 'loci-local-web', pid }`        |
| `GET /api/libraries`                  | 可选 `query` 按名字、ID 或 URL 匹配，`category`、`version` 可组合精确筛选              | `200 LibrarySummary[]`                          |
| `GET /api/libraries/:id`              | 无                                                                                     | `200 LibrarySummary`                            |
| `POST /api/libraries`                 | 文档库配置                                                                             | `201 DocumentSource`。相同本地身份复用已有库    |
| `PUT /api/libraries/:id`              | 完整文档库配置                                                                         | `200 DocumentSource`                            |
| `DELETE /api/libraries/:id`           | 无                                                                                     | `200 { deleted: true }`，可重复执行             |
| `GET /api/libraries/:id/tree`         | `parent?`、`depth?`、可重复的 `queries?`                                               | `200 UrlTreeNode[]`                             |
| `POST /api/search`                    | `DocumentSearchInput`                                                                  | `200 DocumentSearchResult`                      |
| `POST /api/read`                      | `DocumentReadInput`                                                                    | `200 DocumentReadResult[]`                      |
| `POST /api/libraries/:id/documents`   | `{ title, path? 或 url?, content, language? }`                                         | `201 DocumentRecord`                            |
| `GET /api/documents/:docId`           | 无                                                                                     | `200 DocumentDetail`，完整 Markdown             |
| `PUT /api/documents/:docId`           | `{ title?, content?, language?, expectedUpdatedAt? }`                                  | `200 DocumentRecord`                            |
| `GET /api/documents/:docId/sections`  | 无                                                                                     | `200 DocumentSectionDetail[]`                   |
| `POST /api/documents/:docId/sections` | `{ action, sectionId?, heading?, level?, content?, operationId?, expectedUpdatedAt? }` | `200 DocumentRecord`                            |
| `DELETE /api/libraries/:id/documents` | `{ targets: string \| string[] }`                                                      | `200 { deleted: number }`，计数为本次删除的篇数 |

`category` 和 `version` 响应均为非空字符串。配置写入时去除首尾空白，省略或清空时分别采用 `未分类` 和 `latest`。提交新分类名会在同一事务中创建分类。

| 方法与路径                     | 请求               | 成功响应                                                                  |
| ------------------------------ | ------------------ | ------------------------------------------------------------------------- |
| `GET /api/categories`          | 无                 | `200 CategorySummary[]`，按 `sort_order, name` 排列                       |
| `POST /api/categories`         | `{ name: string }` | `201 CategorySummary`，重复创建返回已有分类                               |
| `DELETE /api/categories/:name` | URL 编码的分类名   | `200 { deleted: boolean }`，关联库归入 `未分类`。删除 `未分类` 返回 `400` |

`CategorySummary` 含 `name`、`createdAt`、`libraryCount` 和 `isDefault`。旧 ZIP 缺失或空白的分类与版本回填为 `未分类` 和 `latest`。

文档库配置要求 `name` 和 `url`。可选字段为 `kind`、`mode`、`pageLimit`、`scopePath`、`excludePathPattern`、`httpConcurrency`、`browserConcurrency`、`githubArchiveLimitMb`、`githubMarkdownLimitMb`。新库省略字段采用 `DOCUMENT_SOURCE_DEFAULTS`，`kind` 根据 URL 推断。`POST` 命中相同身份（网站按域名和收录路径、GitHub 按仓库，再加版本）时保留已有入口 URL，按显式字段更新配置，省略分类时保留原分类。同一 URL 的多个版本可独立共存。`PUT` 会重新应用默认值。改变来源、收窄范围或增加排除规则可能在同一事务中移除旧正文和搜索索引。创建库后单独调用 `sync` 或 `pages` 抓取内容。

- `tree` 默认返回第一层。`parent` 可传目录节点的 `id` 或 `/guide/routing` 形式的逻辑路径，`depth` 为正整数。传入多个关键词时使用 `?queries=router&queries=navigation`。筛选树的目录给出该目录下全部文档的 `totalCount` 和命中的 `matchedCount`，叶节点同时给出元数据、`path` 和匹配段落。空分支返回空数组。
- `search` 的 `queries` 接受非空字符串或非空字符串数组，其他字段为 `libraryIds?`、`pathPrefix?`、`offset?`、`limit?` 和 `tree?`。每组词在限定范围内依次尝试全部词 FTS、任一词 FTS 和元数据子串匹配，首次有结果即停止。各组结果按输入顺序合并去重。响应包含 `hits`、`total`、`retrieval: [{ query, mode }]` 和可选 `nextOffset`，`mode` 为 `all`、`any` 或 `fuzzy`。默认 `offset=0`、`limit=20`。`tree=true` 另返回 `trees: [{ libraryId, nodes }]`，其中包含全部命中文档，分页只作用于 `hits`。
- `read` 接受 `{ libraryId?, targets, sectionId?, offset?, maxCharsPerFile? }`。`targets` 支持一个或多个完整 ID、唯一短 ID、带 `/` 前缀的文件或子树逻辑路径。无库限制时在全部库中解析，命中多个 ID 的短前缀返回 `400`。多目标按库 ID 和库内树顺序去重。`sectionId` 须来自返回的同一文档。默认从 `0` 读取，每篇最多 `20000` 个 UTF-16 码元，按段落边界切片。每条响应均含文件元数据、`path`、`content`、`totalChars`、`offset` 和 `truncated`。截断时返回该文件或小节的 `nextOffset`，续读应传同一文档 ID 与小节 ID。
- 新增文档须提供 `path` 或 `url` 其中一项。`path` 是库内逻辑路径，按来源站点根地址生成 URL。`url` 使用 HTTP(S)，会去除查询参数和片段。`language` 默认为 `und`。重复创建相同 URL 和内容返回已有记录，内容冲突返回 `400`。标题、正文或语言更新保留文档 ID，提交后立即可检索。只读快照拒绝文档编辑。
- 整篇编辑先读取 `GET /api/documents/:docId`，响应含 `id`、`sourceId`、`title`、`url`、`path`、`language`、完整 `content` 和 `updatedAt`。新建的手工文档在整库和指定页面抓取时保留正文和索引，并随备份恢复。
- 整篇 `PUT` 和小节 `POST` 均接受 `expectedUpdatedAt`，取自打开编辑器时的文档或小节响应。新操作的版本与当前文档不同时返回 `409 { error }`。收到冲突后请重新读取文档或小节、合并修改再提交。
- 每个小节含 `body` 和所属文档的 `updatedAt`。`body` 是标题行之后的完整原文，保留换行和空白，可直接作为编辑请求的 `content`。其他字段为 `id`、`title`、`level`、`startOffset`、`endOffset`、`charCount`。偏移是原始 Markdown 的 UTF-16 半开区间，标题和段末换行计入长度。首个标题前的正文是级别 `0` 的小节，围栏代码中的标题字符属于正文。小节 ID 与 `search` 和 `read` 相同，按位置编号，结构变更后须重新获取列表。
- `action: 'add'` 需要单行 `heading`，`level` 默认为 `2`，可选范围 `1` 至 `6`。省略 `sectionId` 时追加，指定时插在对应小节之后。`update` 与 `delete` 需要 `sectionId`。`update` 只替换传入的标题、级别或正文。网络重试可传相同的 `operationId`，服务器在正文和 FTS 的同一事务中记录操作并返回当前文档。重试时保留原请求中的 `expectedUpdatedAt`。已提交的同一请求直接返回当前文档，新操作才校验版本。同一显式 ID 搭配不同输入返回 `400`。
- 删除与读取共用目标解析。删除可重复执行，缺失目标计数为 `0`。短 ID 有歧义时整批失败。同库同时抓取或维护时文件锁保护写入。删除子树同时清理正文、FTS 结果和对应的指定页面目标。

## 前台抓取

| 方法与路径                             | 请求                                       | 成功响应                                                           |
| -------------------------------------- | ------------------------------------------ | ------------------------------------------------------------------ |
| `POST /api/inspect`                    | `{ url, scopePath?, excludePathPattern? }` | `200 SourceInspection`，包含发现方式、估计页数、估计类型和路径分组 |
| `POST /api/libraries/:id/sync`         | 无                                         | `202 ForegroundCrawlState`，抓取或更新网站或 GitHub 仓库           |
| `POST /api/libraries/:id/pages`        | `{ urls: string[] }`，至少一个 HTTP(S) URL | `202 ForegroundCrawlState`，精确抓取一个或多个页面                 |
| `GET /api/libraries/:id/crawl`         | 无                                         | `200 ForegroundCrawlState \| null`                                 |
| `GET /api/libraries/crawl-status`      | 无                                         | `200 LibraryCrawlStatus[]`，每个有记录的库一项                     |
| `GET /api/libraries/:id/crawl-status`  | 无                                         | `200 LibraryCrawlStatus \| null`，已有库尚未抓取为 `null`          |
| `POST /api/libraries/:id/crawl/cancel` | 无                                         | `200 ForegroundCrawlState \| null`，随后轮询至终态                 |

`LibraryCrawlStatus` 包含 `libraryId`、`runId`、`kind`、`status`、`progress: { discovered, processed, succeeded, failed, currentUrl }`、`startedAt`、`finishedAt` 和 `error`。后三个字段及 `currentUrl` 可为 `null`，时间使用 ISO 8601。CLI 和 Web 共用本机 SQLite 中各库的最近一次抓取记录。部分页面失败且有成功页时为 `completed_with_errors`，全部页面失败为 `failed`。整库全部页面失败时 `error` 包含首个具体原因。可选 `failures: Array<{ url: string, message: string }>` 按本次运行的失败记录顺序最多返回 20 条。取消为 `cancelled`。持有者异常退出后查询会收口遗留的 `running` 为 `failed`，并保留中断原因与最后进度。`crawl-status` 可跨进程、跨服务重启读取。

`ForegroundCrawlState` 包含 `libraryId`、`kind: 'sync' \| 'pages'`、`status: 'running' \| 'completed' \| 'completed_with_errors' \| 'failed' \| 'cancelled'`、`progress: CrawlProgress \| null`、`error: string \| null`。同一前台服务内，同库同抓取类型、同目标的在途请求复用任务和进度，其他在途请求返回 `409`。旧版审查库的普通更新只刷新已收录的 URL 和已登记的指定页面。终态后再次 POST 可以重试或更新。轮询返回此 HTTP 服务最近启动或跟随的任务，服务重启后为 `null`。跨进程跟随已有抓取时取消只结束本入口的等待。`pages` 完成时额外返回 `items: [{ url, status, message? }]`，逐项状态为 `inserted`、`updated`、`unchanged`、`missing` 或 `failed`。手工文档在远端抓取成功时返回 `unchanged`，远端缺失时返回 `missing`，两种情况均保留本地文档。调用方可结合 `progress.failed` 显示部分成功结果。CLI 直接等待 `runLocalSourceSync` 或 `runtime.fetchPages` 时可传进度回调及 `AbortSignal`。

## Agent、浏览器、设置和备份

| 方法与路径                                | 请求                                                                                                               | 成功响应                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------- |
| `GET /api/agents`                         | 无                                                                                                                 | `200 AgentIntegrationStatus[]`                                              |
| `GET /api/agents/:client`                 | 无                                                                                                                 | `200 AgentIntegrationStatus`                                                |
| `POST /api/agents/:client/setup`          | 无                                                                                                                 | `200 AgentIntegrationActionResult`                                          |
| `POST /api/agents/:client/remove`         | 无                                                                                                                 | `200 AgentIntegrationActionResult`                                          |
| `GET /api/browser`                        | 无                                                                                                                 | `200 LocalBrowserStatus`，含浏览器操作进度                                  |
| `POST /api/browser/install`               | 无                                                                                                                 | `202 LocalBrowserStatus`，轮询 `GET /api/browser`                           |
| `DELETE /api/browser`                     | 无                                                                                                                 | `202 LocalBrowserStatus`，启动卸载                                          |
| `GET /api/settings`                       | 无                                                                                                                 | `200 AppSettings`                                                           |
| `PUT /api/settings`                       | 完整 `AppSettings`                                                                                                 | `200 AppSettings`                                                           |
| `GET /api/hostname-policies`              | 无                                                                                                                 | `200 HostnameCrawlPolicy[]`                                                 |
| `PUT /api/hostname-policies/:hostname`    | `httpConcurrency`、`browserConcurrency`、`batchIntervalMinSeconds`、`batchIntervalMaxSeconds`，每项为整数或 `null` | `200 HostnameCrawlPolicy`                                                   |
| `DELETE /api/hostname-policies/:hostname` | 无                                                                                                                 | `200 { deleted: boolean }`                                                  |
| `GET /api/data/export`                    | 可重复的 `category`、`library`（库 ID），按并集筛选                                                                | `200 application/zip`，含文件名，维护冲突返回 `409`                         |
| `POST /api/data/import`                   | 原始 ZIP，最多 512 MiB，可选 `mode=merge`（默认）或 `mode=replace`                                                 | `200 BackupImportSummary`                                                   |
| `GET /api/data/counts`                    | 无                                                                                                                 | `200 { libraries, documents }`，用于显示确认前的当前数量                    |
| `POST /api/data/clear`                    | `{ scope: 'documents' \| 'sources' }`                                                                              | `200 { scope, libraries, documents }`，返回实际删除数量，维护冲突返回 `409` |

完整 ZIP 的 `scope` 为 `all`，包含所有分类、库及关联数据、设置和域名策略。范围 ZIP 的 `scope` 为 `filtered`，包含命中库、文档、抓取记录、显式页和相关分类。合并导入按库 ID 或 `(source_identity, version)` 匹配，在维护锁和单个写事务中先删旧库再恢复文档与 FTS，保留其他库和全局设置。`replace` 清空全部本地库，完整备份还会恢复全局设置与域名策略。并发导入相同 ZIP 和模式时，CLI 与 Web 共用持锁者的事务结果。不同操作争用维护锁时返回 `409`。摘要包含 `mode`、`importedLibraries`（总数）、`replacedLibraries`（其中覆盖数）、`importedDocuments`、`categoriesCreated`，兼容字段 `sources` 和 `documents`。

`documents` 清空文档正文与索引，保留库、分类、设置和抓取记录，并重置指定页面状态及 GitHub 快照版本。旧审查库保留已批准的 URL。`sources` 清空库及其关联数据，保留分类和设置。两种操作都包含旧只读快照的正文。同一范围的在途清空共用结果，数据库提交具有原子性。Web 在发出清空请求前单独向用户确认。

`client` 取 `codex`、`cursor`、`vscode`、`claude-code` 或 `antigravity`。组件取 `skill` 或 `rules`，接入操作结束后读取结果中每个组件的 `status`。`AppSettings` 包含 `theme`、`httpConcurrency`、`browserConcurrency`、`maxRetries`、`batchIntervalSeconds`、`batchIntervalMaxSeconds`、`githubArchiveLimitMb` 和 `githubMarkdownLimitMb`。

完整的 TypeScript 传输类型及来源探测结果 `SourceInspection` 由 `@loci/shared` 导出。`@loci/runtime` 也导出 `SourceInspection`，并提供精确抓取结果 `ExplicitPageFetchResult` 与 ZIP 导入结果 `BackupImportSummary`。
