import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import which from 'which'
import {
  getMcpClientDefinition,
  isAgentClient,
  type AgentClient,
  type AgentImportResult,
  type McpAgentConnection,
  type McpImportStrategy
} from '@loci/shared'

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
  connection: McpAgentConnection
): Promise<AgentImportResult> {
  const selected = requireAgentClient(client)
  const command = createAgentImportCommand(selected, connection)
  const executable = await resolveExecutable(command)
  await runCommand(executable, command.args, command.label)
  const transport = connection.type === 'stdio' ? 'CLI stdio' : '桌面 HTTP'
  return {
    client: selected,
    message: `已将 ${transport} MCP 导入到 ${command.label} 的用户配置`
  }
}

export function createAgentImportCommand(
  client: unknown,
  connection: McpAgentConnection
): AgentImportCommand {
  const selected = requireAgentClient(client)
  validateConnection(connection)
  const definition = getMcpClientDefinition(selected)
  if (!definition.executable || !definition.quickImport) {
    throw new Error('这个 Agent 客户端不支持自动写入')
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
