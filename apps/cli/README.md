# Loci CLI 开发说明

面向用户的安装、使用和命令参考由 Rspress 站点维护，源文件位于 [`apps/docs/docs/cli`](../docs/docs/cli)。

## 本地开发

```bash
pnpm --filter @boses/cli build
pnpm --filter @boses/cli test
pnpm --filter @boses/cli typecheck
```

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
