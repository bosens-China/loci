import type {
  CallToolResult,
  McpServer,
  ServerContext,
  StandardSchemaWithJSON,
  ToolAnnotations,
  ToolCallback
} from '@modelcontextprotocol/server'
import * as z from 'zod/v4'
import { registerCloudTools } from './cloud-tools.js'
import { registerHostnamePolicyTools } from './hostname-policy-tools.js'
import { registerDocumentMoveTools } from './document-move-tools.js'
import { registerLibraryContentTools, registerListLibrariesTool } from './core-tools.js'
import { registerLogTools } from './log-tools.js'
import { registerDeleteLibraryTool } from './delete-tool.js'
import { registerSearchTool } from './search-tool.js'
import { registerPageTools } from './page-tools.js'
import { registerSourcePlanningTools } from './source-planning-tools.js'
import type { LociMcpServices } from './services.js'
import { registerSyncTools } from './sync-tools.js'
import { registerTaskTools } from './task-tools.js'
import { registerServerTaskTools } from './server-task-tools.js'
import { registerServerLibraryTools } from './server-library-tools.js'
import { registerUrlReviewTools } from './url-review-tools.js'

export interface LociToolContext {
  progressToken?: string | number
  notifyProgress?: (progress: number, total: number, message: string) => Promise<void>
  trackBackgroundTask?: (task: Promise<void>) => void
  signal?: AbortSignal
}

interface LociToolConfig<InputSchema extends LociToolSchema, OutputSchema extends LociToolSchema> {
  title: string
  description: string
  inputSchema: InputSchema
  outputSchema: OutputSchema
  annotations: ToolAnnotations
}

export type LociToolRegistrar = <
  InputSchema extends LociToolSchema,
  OutputSchema extends LociToolSchema
>(
  name: string,
  config: LociToolConfig<InputSchema, OutputSchema>,
  execute: (
    input: z.output<InputSchema>,
    context: LociToolContext
  ) => CallToolResult | Promise<CallToolResult>
) => void

type LociToolSchema = z.ZodType & StandardSchemaWithJSON

interface ExecutableTool {
  invoke: (input: unknown) => Promise<CallToolResult>
}

export class LociToolNotFoundError extends Error {
  constructor(name: string, available: readonly string[]) {
    super(`未知 Loci MCP 工具：${name}。可用工具：${available.join(', ')}`)
    this.name = 'LociToolNotFoundError'
  }
}

export function createMcpToolRegistrar(server: McpServer): LociToolRegistrar {
  return (name, config, execute) => {
    const callback = ((input: unknown, context: ServerContext) =>
      execute(
        input as z.output<typeof config.inputSchema>,
        fromMcpContext(context)
      )) as unknown as ToolCallback<typeof config.inputSchema>
    server.registerTool<typeof config.outputSchema, typeof config.inputSchema>(
      name,
      config,
      callback
    )
  }
}

export async function callLociMcpTool(
  services: LociMcpServices,
  name: string,
  input: unknown,
  context: LociToolContext = {}
): Promise<CallToolResult> {
  const tools = new Map<string, ExecutableTool>()
  const register: LociToolRegistrar = (toolName, config, execute) => {
    tools.set(toolName, {
      invoke: async (rawInput) => {
        const backgroundTasks: Promise<void>[] = []
        const response = await execute(await config.inputSchema.parseAsync(rawInput), {
          ...context,
          trackBackgroundTask: (task) => backgroundTasks.push(task)
        })
        await Promise.all(backgroundTasks)
        if (!response.isError && response.structuredContent !== undefined) {
          return {
            ...response,
            structuredContent: await config.outputSchema.parseAsync(response.structuredContent)
          }
        }
        return response
      }
    })
  }
  registerLociTools(register, services)
  const tool = tools.get(name)
  if (!tool) throw new LociToolNotFoundError(name, [...tools.keys()])
  return tool.invoke(input)
}

export function registerLociTools(register: LociToolRegistrar, services: LociMcpServices): void {
  registerSyncTools(register, services)
  registerTaskTools(register, services)
  registerServerTaskTools(register, services)
  registerServerLibraryTools(register, services)
  registerLogTools(register, services)
  registerUrlReviewTools(register, services)
  registerPageTools(register, services)
  registerSourcePlanningTools(register, services)
  registerListLibrariesTool(register, services)
  registerCloudTools(register, services)
  registerHostnamePolicyTools(register, services)
  registerDocumentMoveTools(register, services)
  registerLibraryContentTools(register, services)
  registerSearchTool(register, services)
  registerDeleteLibraryTool(register, services)
}

function fromMcpContext(context: ServerContext): LociToolContext {
  return {
    progressToken: context.mcpReq._meta?.progressToken,
    signal: context.mcpReq.signal,
    notifyProgress: (progress, total, message) =>
      context.mcpReq.notify({
        method: 'notifications/progress',
        params: {
          progressToken: context.mcpReq._meta?.progressToken ?? '',
          progress,
          total,
          message
        }
      })
  }
}
