# Loci

Loci 是为 AI Agent 准备的本地知识库。它将公开文档抓取为本地 Markdown，并提供浏览与全文搜索；未来可作为 Agent 工具调用的知识节点。

当前版本使用 Electron、React、TypeScript 和 SQLite，数据仅保存在本机。

## 开发

### Install

```bash
$ pnpm install
```

### Development

```bash
$ pnpm dev
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```
