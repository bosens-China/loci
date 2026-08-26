# Agents

- 代码行数尽量不要超出400，拆除考虑拆分
- 测试用vitest，然后测试放到当前文件同层级，例如utils/fs.ts 对应 utils/test/fs.test.ts
- 测试只覆盖核心且稳定的行为：优先数据一致性、事务与并发幂等、安全边界、跨进程、外部 CLI/Web/MCP/API 契约、关键失败恢复；不测试普通文案、展示格式、简单布局、静态命令或配置清单、私有实现细节和 mock 调用次数。相同行为只在最接近的公共边界保留一组，跨层复用前先抽共享逻辑；断言可观察的结果、状态或结构，只有机器协议、持久化格式或执行性安全规则中的文本才可作为文本契约测试。
- React 请开启 react compiler
- 请使用ts，避免any，未知类型用unknown
- 样式优先用unocss，避免书写style和css
- 注释使用中文，重要模块请确保包含注释
- 请配置alias，例如@/xxx等形式，避免../../../这样路径出现
- 实现功能的时候，需要考虑到 CLI、Web UI、后台服务和远端 Server 的模块关系
- 实现的时候避免重复实现，而是尽可能复用，例如爬取功能，Web、CLI、后台服务和远端 Server 都复用共享实现
- SQLite 数据访问默认使用 Drizzle schema 与 query builder：普通 CRUD、条件查询、列表、关联、聚合和元数据查询必须优先使用 Drizzle，并复用现有 `node:sqlite` 的 `DatabaseSync` 连接；只有 FTS5、`PRAGMA`、DDL/`user_version` 迁移、备份恢复、批量 prepared statement，以及依赖 `BEGIN IMMEDIATE`、租约、CAS 或精确 `changes` 语义的并发状态机可以保留原生 SQL。同一模块允许混用两者，不以清零手写 SQL 为目标；保留的原生 SQL 必须参数化，并在代码结构或注释中体现不能使用 Drizzle 的原因。未经架构决策不得引入 Drizzle Kit 作为第二套迁移权威。
- 修改代码、配置、CLI、Web、后台服务、远端 Server、MCP 工具或用户工作流时，完成前必须检查 `.agents/skills/` 和 `apps/docs/` 是否受到影响；涉及用户行为、命令、配置、工具 Schema、工作流或安全边界时，应在同一变更中同步更新。没有影响时无需为了形式修改文档。
- 任何可由 UI 点击、CLI、MCP、后台任务或服务端请求重复触发的写操作，都必须将并发安全视为正确性要求：同一资源采用幂等和 single-flight，在事务、唯一约束或跨进程锁等持久化或进程边界落实约束，不能只依赖 UI 状态；重复调用复用已有任务和进度，不同资源仍可独立并行，并补充同时启动、重试、取消和跨进程执行测试。
