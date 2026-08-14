import type { CallToolResult } from '@modelcontextprotocol/server'
import type { Command } from 'commander'
import { callLociMcpTool, LociToolNotFoundError } from '@loci/runtime'
import * as z from 'zod/v4'
import { CliError } from '../errors.js'
import { createCliRuntime } from '../runtime.js'
import { createMcpServices } from './mcp-services.js'

export function registerMcpCallCommand(mcp: Command): void {
  mcp
    .command('call <tool>')
    .description('直接调用 Loci MCP 工具并输出结构化 JSON')
    .option('--input <json>', '工具输入 JSON', '{}')
    .action(async (tool: string, options: { input: string }) => {
      const input = parseInput(options.input)
      const runtime = createCliRuntime()
      try {
        const response = await callLociMcpTool(createMcpServices(runtime), tool, input)
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
        await runtime.close()
      }
    })
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
