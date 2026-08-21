# Loci CLI 开发说明

面向用户的安装、使用和命令参考由 Rspress 站点维护，源文件位于 [`apps/docs/docs/cli`](../docs/docs/cli)。

## 本地开发

```bash
pnpm dev
pnpm dev:user
pnpm --filter @boses/cli build
pnpm --filter @boses/cli test
pnpm --filter @boses/cli typecheck
```

`pnpm dev` 默认使用仓库内的 `.loci-dev` 隔离数据与缓存，适合日常开发。需要直接复现正式 `loci ui` 中的数据问题时，显式运行 `pnpm dev:user`；它遵循 Runtime 的正式数据目录规则以及 `LOCI_DATA_DIR`、`LOCI_CACHE_DIR` 覆盖，并且 Web 中的写操作会直接修改对应数据。

CLI 构建会先构建 `@loci/web`，再把产物复制到 npm 包的 `dist/resources/ui`。本地验证前台 Web 会话：

```bash
node dist/index.js ui --no-open
```

命令会先打印访问地址并保持运行；验证完成后按 `Ctrl+C` 关闭本地服务。

构建后可直接运行：

```bash
node dist/index.js --help
```

正式版默认连接 `https://loci.xiaowo.live`。联调本地 Server 时显式覆盖地址：

```bash
LOCI_SERVER_URL=http://localhost:7001 node dist/index.js doctor
```

CLI 入口为 `src/index.ts`。发布前由根目录的 Release 工作流创建版本和发布 npm 包；`prepack` 会自动执行构建。
