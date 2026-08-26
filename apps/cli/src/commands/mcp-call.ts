import type { CallToolResult } from '@modelcontextprotocol/server'
import { Option, type Command } from 'commander'
import { callLociMcpTool, createLocalJobRunner, LociToolNotFoundError } from '@loci/runtime'
import * as z from 'zod/v4'
import { CliError } from '../errors.js'
import { createCliRuntime } from '../runtime.js'
import { createMcpServices } from './mcp-services.js'

export function registerMcpCallCommand(mcp: Command): void {
  mcp
    .command('call <tool>')
    .description('直接调用 Loci MCP 工具并输出结构化 JSON')
    .option('--input <json>', '工具输入 JSON', '{}')
    .addOption(
      new Option('--progress <format>', '逐页进度写入 stderr')
        .choices(['jsonl', 'text', 'none'])
        .default('jsonl')
    )
    .action(async (tool: string, options: { input: string; progress: ProgressFormat }) => {
      const input = parseInput(options.input)
      const runtime = createCliRuntime()
      const runner = createLocalJobRunner(runtime, { owner: `mcp-call-${process.pid}` })
      const controller = new AbortController()
      const cancel = (): void => controller.abort(new Error('CLI MCP 调用已取消'))
      process.once('SIGINT', cancel)
      process.once('SIGTERM', cancel)
      runner.start()
      try {
        const progressFormat = options.progress
        const response = await callLociMcpTool(
          createMcpServices(runtime, { durableJobs: true }),
          tool,
          input,
          {
            signal: controller.signal,
            ...(progressFormat === 'none'
              ? {}
              : {
                  progressToken: 'cli',
                  notifyProgress: (progress, total, message) => {
                    writeProgress(progressFormat, progress, total, message)
                    return Promise.resolve()
                  }
                })
          }
        )
        if (response.isError) throw new CliError(toolErrorMessage(response))
        if (response.structuredContent === undefined) {
          throw new CliError(`工具 ${tool} 没有返回结构化结果`)
        }
        process.stdout.write(`${JSON.stringify(response.structuredContent, null, 2)}\n`)
      } catch (error) {
        if (error instanceof z.ZodError) {
          throw new CliError(`工具输入不合法：\n${z.prettifyError(error)}`, 2)
        }
        if (error instanceof LociToolNotFoundError) throw new CliError(error.message, 2)
        throw error
      } finally {
        process.off('SIGINT', cancel)
        process.off('SIGTERM', cancel)
        await runner.stop()
        await runtime.close()
      }
    })
}

type ProgressFormat = 'jsonl' | 'text' | 'none'

function writeProgress(
  format: Exclude<ProgressFormat, 'none'>,
  progress: number,
  total: number,
  message: string
): void {
  const line =
    format === 'jsonl'
      ? JSON.stringify({ type: 'progress', progress, total, message })
      : `[${progress}/${total}] ${message}`
  process.stderr.write(`${line}\n`)
}

function parseInput(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    throw new CliError('--input 必须是有效 JSON', 2)
  }
}

function toolErrorMessage(response: CallToolResult): string {
  const messages = response.content.flatMap((item) => (item.type === 'text' ? [item.text] : []))
  return messages.join('\n') || 'Loci MCP 工具调用失败'
}
