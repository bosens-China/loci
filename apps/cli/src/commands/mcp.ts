import type { Command } from 'commander'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import {
  acquireRuntimeLock,
  checkLocalService,
  createLocalJobRunner,
  createLociMcpServer,
  readLocalServiceState,
  readRuntimeLock,
  startMcpHttpServer
} from '@loci/runtime'
import { createCliRuntime } from '../runtime.js'
import { waitForTermination } from '../process-lifecycle.js'
import { runWithRuntime } from '../command-runtime.js'
import { finishUi, info, startUi, success } from '../ui.js'
import { canConnect } from './status.js'
import { registerMcpCallCommand } from './mcp-call.js'
import { createMcpServices } from './mcp-services.js'

export function registerMcpCommands(program: Command): void {
  const mcp = program.command('mcp').description('运行和调试 Loci MCP 服务')

  registerMcpCallCommand(mcp)

  mcp
    .command('stdio')
    .description('通过 Loci MCP stdio 为 Agent 提供本地能力')
    .action(async () => {
      const runtime = createCliRuntime()
      const runner = createLocalJobRunner(runtime)
      runner.start()
      const handle = serveStdio(
        () => createLociMcpServer(createMcpServices(runtime, { durableJobs: true })),
        {
          onerror: (error) => console.error(`Loci MCP stdio 错误：${error.message}`)
        }
      )
      try {
        await waitForStdioTermination()
      } finally {
        await handle.close()
        await runner.stop()
        await runtime.close()
      }
    })

  mcp
    .command('serve')
    .description('以前台方式启动 Loci MCP')
    .action(async () => {
      startUi('Loci MCP')
      const runtime = createCliRuntime()
      const settings = runtime.database.getSettings()
      let lock: ReturnType<typeof acquireRuntimeLock> | undefined
      let runner: ReturnType<typeof createLocalJobRunner> | undefined
      try {
        if (await canConnect(settings.mcpPort)) {
          info(`现有实例：http://127.0.0.1:${settings.mcpPort}/mcp`)
          finishUi('已有 Loci MCP 正在运行，本次未重复启动')
          return
        }
        lock = acquireRuntimeLock(runtime.dataDir, 'mcp', 'CLI')
        runner = createLocalJobRunner(runtime)
        runner.start()
        const server = await startMcpHttpServer(
          settings.mcpPort,
          createMcpServices(runtime, { durableJobs: true })
        )
        success(`MCP 已启动：${server.endpoint}`)
        info('按 Ctrl+C 停止服务')
        await waitForTermination()
        await server.close()
        finishUi('MCP 已停止')
      } finally {
        lock?.release()
        await runner?.stop()
        await runtime.close()
      }
    })

  mcp
    .command('status')
    .description('检查 MCP 地址、端口和当前宿主')
    .action(() =>
      runWithRuntime('MCP 状态', async (runtime) => {
        const settings = runtime.database.getSettings()
        const running = await canConnect(settings.mcpPort)
        const lock = readRuntimeLock(runtime.dataDir, 'mcp')
        const localService = readLocalServiceState(runtime.dataDir)
        const serviceOwnsMcp = Boolean(
          running &&
          localService?.mcpPort === settings.mcpPort &&
          (await checkLocalService(localService))
        )
        process.stdout.write('默认 Agent 入口： CLI stdio（loci mcp stdio）\n')
        process.stdout.write(`地址： http://127.0.0.1:${settings.mcpPort}/mcp\n`)
        process.stdout.write(`HTTP 状态： ${running ? '运行中' : '未运行'}\n`)
        process.stdout.write(
          `宿主： ${serviceOwnsMcp ? 'Loci 后台服务' : (lock?.owner ?? (running ? '其他 Loci 进程' : '—'))}\n`
        )
        return running ? 'MCP 服务可访问' : 'MCP 当前未运行'
      })
    )
}

function waitForStdioTermination(): Promise<void> {
  return new Promise((resolve) => {
    const stop = (): void => {
      process.stdin.off('end', stop)
      process.stdin.off('close', stop)
      process.off('SIGINT', stop)
      process.off('SIGTERM', stop)
      resolve()
    }
    process.stdin.once('end', stop)
    process.stdin.once('close', stop)
    process.once('SIGINT', stop)
    process.once('SIGTERM', stop)
  })
}
