import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import which from 'which'
import {
  getMcpClientDefinition,
  isAgentClient,
  supportsMcpTransport,
  type AgentClient,
  type AgentImportResult,
  type McpAgentConnection,
  type McpImportStrategy
} from '@loci/shared'
import {
  resolveAgentMcpConfigPath,
  writeAgentMcpConfigFile,
  type AgentMcpConfigPathOptions
} from './agent-mcp-config.js'
import { resolveLociDataDir } from './data-path.js'
import { acquireRuntimeLock } from './runtime-lock.js'

export type { McpAgentConnection } from '@loci/shared'

interface AgentImportCommand {
  command: string
  args: string[]
  label: string
}

interface CommandResult {
  code: number | null
  output: string
}

export interface ImportAgentClientOptions extends AgentMcpConfigPathOptions {
  dataDir?: string
  owner?: string
}

const activeImports = new Map<string, Promise<AgentImportResult>>()

export const LOCI_CLI_STDIO_CONNECTION: McpAgentConnection = {
  type: 'stdio',
  command: 'loci',
  args: ['mcp', 'stdio']
}

export function createHttpMcpConnection(endpoint: string): McpAgentConnection {
  return { type: 'http', endpoint }
}

export async function importAgentClient(
  client: unknown,
  connection: McpAgentConnection,
  options: ImportAgentClientOptions = {}
): Promise<AgentImportResult> {
  const selected = requireAgentClient(client)
  validateClientConnection(selected, connection)
  const path = resolveAgentMcpConfigPath(selected, options)
  const active = activeImports.get(path)
  if (active) return active

  const task = performAgentImport(selected, connection, path, options)
  activeImports.set(path, task)
  try {
    return await task
  } finally {
    if (activeImports.get(path) === task) activeImports.delete(path)
  }
}

async function performAgentImport(
  client: AgentClient,
  connection: McpAgentConnection,
  path: string,
  options: ImportAgentClientOptions
): Promise<AgentImportResult> {
  const definition = getMcpClientDefinition(client)
  const lock = acquireRuntimeLock(
    options.dataDir ?? resolveLociDataDir(),
    `agent-mcp-config-${client}`,
    options.owner ?? 'Agent MCP 配置写入'
  )
  try {
    let commandError: Error | undefined
    if (definition.quickImport) {
      const command = createAgentImportCommand(client, connection)
      try {
        const executable = await resolveExecutable(command)
        await runCommand(executable, command.args, command.label)
        return {
          client,
          message: `已通过 ${command.label} 命令写入 ${transportLabel(connection)} MCP`
        }
      } catch (error) {
        commandError = toError(error)
      }
    }

    const result = writeAgentMcpConfigFile(client, connection, options)
    const status = result.changed
      ? result.created
        ? `已创建用户配置：${path}`
        : `已合并用户配置：${path}`
      : `用户配置已是最新版本：${path}`
    return {
      client,
      message: commandError
        ? `${definition.label} 配置命令失败（${commandError.message}），${status}`
        : `${definition.label} 不支持配置命令，${status}`
    }
  } finally {
    lock.release()
  }
}

export function createAgentImportCommand(
  client: unknown,
  connection: McpAgentConnection
): AgentImportCommand {
  const selected = requireAgentClient(client)
  validateClientConnection(selected, connection)
  const definition = getMcpClientDefinition(selected)
  if (!definition.executable || !definition.quickImport) {
    throw new Error('这个 Agent 客户端不支持命令导入')
  }
  return {
    command: definition.executable,
    args: createImportArgs(definition.importStrategy, connection),
    label: definition.label
  }
}

function requireAgentClient(client: unknown): AgentClient {
  if (!isAgentClient(client)) throw new Error('不支持这个 Agent 客户端')
  return client
}

function createImportArgs(strategy: McpImportStrategy, connection: McpAgentConnection): string[] {
  switch (strategy) {
    case 'codex-cli':
      return connection.type === 'http'
        ? ['mcp', 'add', 'loci', '--url', connection.endpoint]
        : ['mcp', 'add', 'loci', '--', connection.command, ...connection.args]
    case 'cursor-cli':
    case 'vscode-cli':
      return ['--add-mcp', createEditorConfig(connection)]
    case 'claude-cli':
      return connection.type === 'http'
        ? ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'loci', connection.endpoint]
        : [
            'mcp',
            'add',
            '--transport',
            'stdio',
            '--scope',
            'user',
            'loci',
            '--',
            connection.command,
            ...connection.args
          ]
    case 'manual':
      throw new Error('这个 Agent 客户端不支持自动写入')
  }
}

function createEditorConfig(connection: McpAgentConnection): string {
  return JSON.stringify(
    connection.type === 'http'
      ? { name: 'loci', type: 'http', url: connection.endpoint }
      : {
          name: 'loci',
          type: 'stdio',
          command: connection.command,
          args: [...connection.args]
        }
  )
}

function validateConnection(connection: McpAgentConnection): void {
  if (connection.type === 'stdio') {
    if (!connection.command.trim()) throw new Error('MCP stdio 命令不能为空')
    return
  }
  const url = new URL(connection.endpoint)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.pathname !== '/mcp' ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  ) {
    throw new Error('MCP 地址不是有效的本机地址')
  }
}

function validateClientConnection(client: AgentClient, connection: McpAgentConnection): void {
  validateConnection(connection)
  if (!supportsMcpTransport(client, connection.type)) {
    const definition = getMcpClientDefinition(client)
    throw new Error(`${definition.label} 不支持 ${connection.type} 传输`)
  }
}

async function resolveExecutable(command: AgentImportCommand): Promise<string> {
  const executable = await which(command.command, { nothrow: true })
  if (executable) return executable
  throw new Error(`未检测到 ${command.label}，请先安装并确保命令已加入 PATH`)
}

async function runCommand(executable: string, args: string[], label: string): Promise<void> {
  let result: CommandResult
  try {
    result = await executeCommand(executable, args, 15_000)
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ETIMEDOUT') throw new Error(`${label} 导入超时，请稍后重试`)
    if (code === 'ENOENT') {
      throw new Error(`未检测到 ${label}，请先安装并确保命令已加入 PATH`)
    }
    throw new Error(`${label} 导入失败`)
  }
  if (result.code !== 0) {
    throw new Error(`${label} 导入失败${lastOutputLine(result.output)}`)
  }
}

function executeCommand(
  executable: string,
  args: string[],
  timeout: number
): Promise<CommandResult> {
  return new Promise((resolve, reject) => {
    const isWindowsScript = process.platform === 'win32' && /\.(cmd|bat)$/i.test(executable)
    // 参数均由白名单生成，Windows 仅为执行 CLI 的 cmd 包装脚本而使用命令解释器。
    const child = isWindowsScript
      ? spawn(
          process.env.ComSpec ?? 'cmd.exe',
          ['/d', '/s', '/c', `"${[executable, ...args].map(quoteWindowsArgument).join(' ')}"`],
          { windowsHide: true, windowsVerbatimArguments: true }
        )
      : spawn(executable, args, { windowsHide: true })
    let output = ''
    let settled = false
    const append = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-4_000)
    }
    const fail = (error: Error): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(error)
    }
    const timer = setTimeout(() => {
      child.kill()
      const error = new Error('命令执行超时') as NodeJS.ErrnoException
      error.code = 'ETIMEDOUT'
      fail(error)
    }, timeout)

    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', fail)
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve({ code, output })
    })
  })
}

function quoteWindowsArgument(value: string): string {
  return `"${value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, '$1$1')}"`
}

function lastOutputLine(output: string): string {
  const line = stripVTControlCharacters(output)
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean)
    .at(-1)
  return line ? `：${line.slice(0, 240)}` : ''
}

function transportLabel(connection: McpAgentConnection): string {
  return connection.type === 'stdio' ? 'CLI stdio' : '本地 HTTP'
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error('未知错误')
}
