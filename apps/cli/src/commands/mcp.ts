import type { Command } from 'commander'
import { serveStdio } from '@modelcontextprotocol/server/stdio'
import { createLocalJobRunner, createLociMcpServer } from '@loci/runtime'
import { createCliRuntime } from '../runtime.js'
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
