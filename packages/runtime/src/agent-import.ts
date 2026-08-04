import { spawn } from 'node:child_process'
import { stripVTControlCharacters } from 'node:util'
import which from 'which'
import type { AgentClient, AgentImportResult, McpAgentConnection } from '@loci/shared'

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

type ConnectionArgs = (connection: McpAgentConnection) => string[]

export const LOCI_CLI_STDIO_CONNECTION: McpAgentConnection = {
  type: 'stdio',
  command: 'loci',
  args: ['mcp', 'stdio']
}

const clients: Record<AgentClient, { command: string; label: string; args: ConnectionArgs }> = {
  codex: {
    command: 'codex',
    label: 'Codex',
    args: (connection) =>
      connection.type === 'http'
        ? ['mcp', 'add', 'loci', '--url', connection.endpoint]
        : ['mcp', 'add', 'loci', '--', connection.command, ...connection.args]
  },
  cursor: {
    command: 'cursor',
    label: 'Cursor',
    args: (connection) => ['--add-mcp', createEditorConfig(connection)]
  },
  vscode: {
    command: 'code',
    label: 'VS Code',
    args: (connection) => ['--add-mcp', createEditorConfig(connection)]
  },
  'claude-code': {
    command: 'claude',
    label: 'Claude Code',
    args: (connection) =>
      connection.type === 'http'
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
  },
  'gemini-cli': {
    command: 'gemini',
    label: 'Gemini CLI',
    args: (connection) =>
      connection.type === 'http'
        ? ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'loci', connection.endpoint]
        : [
            'mcp',
            'add',
            '--transport',
            'stdio',
            '--scope',
            'user',
            'loci',
            connection.command,
            ...connection.args
          ]
  }
}

export function createHttpMcpConnection(endpoint: string): McpAgentConnection {
  return { type: 'http', endpoint }
}

export async function resolvePreferredMcpConnection(
  endpoint: string,
  findCli: () => Promise<string | null> = findLociCliExecutable
): Promise<McpAgentConnection> {
  const executable = await findCli()
  return executable
    ? { type: 'stdio', command: executable, args: ['mcp', 'stdio'] }
    : createHttpMcpConnection(endpoint)
}

export async function findLociCliExecutable(): Promise<string | null> {
  const executable = await which('loci', { nothrow: true })
  if (!executable) return null
  try {
    const result = await executeCommand(executable, ['mcp', 'stdio', '--help'], 3_000)
    return result.code === 0 && result.output.includes('Loci MCP stdio') ? executable : null
  } catch {
    return null
  }
}

export async function importAgentClient(
  client: unknown,
  connection: McpAgentConnection
): Promise<AgentImportResult> {
  const command = createAgentImportCommand(client, connection)
  const executable = await resolveExecutable(command)
  await runCommand(executable, command.args, command.label)
  const transport = connection.type === 'stdio' ? 'CLI stdio' : '桌面 HTTP'
  return {
    client: client as AgentClient,
    message: `已将 ${transport} MCP 导入到 ${command.label} 的用户配置`
  }
}

export function createAgentImportCommand(
  client: unknown,
  connection: McpAgentConnection
): AgentImportCommand {
  if (typeof client !== 'string' || !Object.hasOwn(clients, client)) {
    throw new Error('不支持这个 Agent 客户端')
  }
  validateConnection(connection)
  const definition = clients[client as AgentClient]
  return { command: definition.command, args: definition.args(connection), label: definition.label }
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
