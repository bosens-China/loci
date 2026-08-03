# Loci CLI 开发说明

面向用户的安装、使用和命令参考由 Rspress 站点维护，源文件位于 [`apps/docs/docs/cli`](../docs/docs/cli)。

## 本地开发

```bash
pnpm --filter @boses/cli build
pnpm --filter @boses/cli test
pnpm --filter @boses/cli typecheck
```

构建后可直接运行：

```bash
node dist/index.js --help
```

CLI 入口为 `src/index.ts`。发布前由根目录的 Release 工作流创建版本和发布 npm 包；`prepack` 会自动执行构建。
