import { Command, CommanderError } from 'commander'
import { CliError } from './errors.js'
import { registerAdminCommand } from './commands/admin.js'
import { registerAgentCommands } from './commands/agent.js'
import { registerBrowserCommands } from './commands/browser.js'
import { registerCloudCommands } from './commands/cloud.js'
import { registerConfigCommands } from './commands/config.js'
import { registerDataCommands } from './commands/data.js'
import { registerDoctorCommand } from './commands/doctor.js'
import { registerDocumentCommands } from './commands/document.js'
import { registerMcpCommands } from './commands/mcp.js'
import { registerSourceCommands } from './commands/source.js'
import { registerScheduleCommands } from './commands/schedule.js'
import { registerServiceCommands, registerUiCommand } from './commands/service.js'
import { registerStatusCommand } from './commands/status.js'
import { registerTaskCommands } from './commands/task.js'
import { registerUpdateCommand } from './commands/update.js'
import {
  CLI_VERSION,
  formatUpdateMessage,
  readCachedUpdate,
  startDailyUpdateCheck
} from './update.js'
import { warning } from './ui.js'

export async function runCli(args: readonly string[]): Promise<void> {
  const cachedUpdate = readCachedUpdate()
  if (
    cachedUpdate &&
    args[0] !== 'update' &&
    !isVersionOrHelp(args) &&
    !requiresCleanStdout(args)
  ) {
    warning(formatUpdateMessage(cachedUpdate))
  }
  startDailyUpdateCheck(args)
  const program = createProgram()
  if (args.length === 0) {
    program.outputHelp()
    return
  }
  try {
    await program.parseAsync([...args], { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) {
      if (error.code === 'commander.helpDisplayed' || error.code === 'commander.version') return
      throw new CliError(translateCommanderError(error.message), error.exitCode || 2)
    }
    throw error
  }
}

export interface CreateProgramOptions {
  ensureUserService?: () => Promise<unknown>
}

export function createProgram(options: CreateProgramOptions = {}): Command {
  const program = new Command()
    .name('loci')
    .description('面向终端用户的本地文档知识库')
    .version(CLI_VERSION, '-V, --version', '显示 CLI 版本')
    .helpOption('-h, --help', '显示帮助')
    .addHelpCommand('help [command]', '显示指定命令的帮助')
    .showHelpAfterError()
    .showSuggestionAfterError()
    .exitOverride()
    .configureHelp({
      styleTitle: (title) =>
        ({
          'Usage:': '用法：',
          'Arguments:': '参数：',
          'Options:': '选项：',
          'Commands:': '命令：'
        })[title] ?? title
    })
    .configureOutput({ writeErr: () => undefined })

  registerStatusCommand(program)
  registerTaskCommands(program)
  registerUpdateCommand(program)
  registerSourceCommands(program)
  registerScheduleCommands(program, options.ensureUserService)
  registerServiceCommands(program)
  registerUiCommand(program)
  registerDocumentCommands(program)
  registerCloudCommands(program, options.ensureUserService)
  registerAdminCommand(program)
  registerAgentCommands(program)
  registerMcpCommands(program)
  registerBrowserCommands(program)
  registerConfigCommands(program)
  registerDataCommands(program, options.ensureUserService)
  registerDoctorCommand(program)
  return program
}

function isVersionOrHelp(args: readonly string[]): boolean {
  return ['-V', '--version', '-h', '--help', 'help'].includes(args[0] ?? '')
}

function requiresCleanStdout(args: readonly string[]): boolean {
  return (
    (args[0] === 'mcp' && (args[1] === 'stdio' || args[1] === 'call')) ||
    (args[0] === 'task' && args[1] === 'follow' && args.includes('jsonl')) ||
    (args[0] === 'agent' &&
      (args[1] === 'print-config' ||
        args[1] === 'connect' ||
        args[1] === 'rules' ||
        (args[1] === 'status' && args.includes('--json')) ||
        (args[1] === 'skills' && args.includes('--json'))))
  )
}

function translateCommanderError(message: string): string {
  return message
    .replace(/^error: /, '参数错误：')
    .replace(/unknown command '([^']+)'/, '未知命令“$1”')
    .replace(/unknown option '([^']+)'/, '未知选项“$1”')
    .replace(/missing required argument '([^']+)'/, '缺少必填参数“$1”')
    .replace(/option '([^']+)' argument missing/, '选项“$1”缺少参数')
}
