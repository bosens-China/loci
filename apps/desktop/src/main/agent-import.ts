import { execFile, spawn } from 'node:child_process'
import { promisify, stripVTControlCharacters } from 'node:util'
import type { AgentClient, AgentImportResult } from '../shared/api'

interface AgentImportCommand {
  command: string
  args: string[]
  label: string
}

const execFileAsync = promisify(execFile)

const clients: Record<
  AgentClient,
  { command: string; label: string; args: (endpoint: string) => string[] }
> = {
  codex: {
    command: 'codex',
    label: 'Codex',
    args: (endpoint) => ['mcp', 'add', 'loci', '--url', endpoint]
  },
  cursor: {
    command: 'cursor',
    label: 'Cursor',
    args: (endpoint) => ['--add-mcp', JSON.stringify({ name: 'loci', type: 'http', url: endpoint })]
  },
  vscode: {
    command: 'code',
    label: 'VS Code',
    args: (endpoint) => ['--add-mcp', JSON.stringify({ name: 'loci', type: 'http', url: endpoint })]
  },
  'claude-code': {
    command: 'claude',
    label: 'Claude Code',
    args: (endpoint) => ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'loci', endpoint]
  },
  'gemini-cli': {
    command: 'gemini',
    label: 'Gemini CLI',
    args: (endpoint) => ['mcp', 'add', '--transport', 'http', '--scope', 'user', 'loci', endpoint]
  }
}

export async function importAgentClient(
  client: unknown,
  endpoint: string
): Promise<AgentImportResult> {
  const command = createAgentImportCommand(client, endpoint)
  const executable = await resolveExecutable(command)
  await runCommand(executable, command.args, command.label)
  return { client: client as AgentClient, message: `已导入到 ${command.label} 的用户配置` }
}

export function createAgentImportCommand(client: unknown, endpoint: string): AgentImportCommand {
  if (typeof client !== 'string' || !Object.hasOwn(clients, client)) {
    throw new Error('不支持这个 Agent 客户端')
  }
  validateEndpoint(endpoint)
  const definition = clients[client as AgentClient]
  return { command: definition.command, args: definition.args(endpoint), label: definition.label }
}

function validateEndpoint(endpoint: string): void {
  const url = new URL(endpoint)
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
  if (process.platform !== 'win32') return command.command
  try {
    const { stdout } = await execFileAsync('where.exe', [command.command], {
      encoding: 'utf8',
      timeout: 3_000,
      windowsHide: true
    })
    const matches = stdout.split(/\r?\n/).filter(Boolean)
    const executable =
      matches.find((match) => match.toLowerCase().endsWith('.exe')) ??
      matches.find((match) => /\.(cmd|bat)$/i.test(match))
    if (executable) return executable
  } catch {
    // 统一使用面向用户的未安装提示。
  }
  throw new Error(`未检测到 ${command.label}，请先安装并确保命令已加入 PATH`)
}

function runCommand(executable: string, args: string[], label: string): Promise<void> {
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
      fail(new Error(`${label} 导入超时，请稍后重试`))
    }, 15_000)

    child.stdout.on('data', append)
    child.stderr.on('data', append)
    child.once('error', (error: NodeJS.ErrnoException) => {
      fail(
        new Error(
          error.code === 'ENOENT'
            ? `未检测到 ${label}，请先安装并确保命令已加入 PATH`
            : `${label} 导入失败`
        )
      )
    })
    child.once('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code === 0) resolve()
      else reject(new Error(`${label} 导入失败${lastOutputLine(output)}`))
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
