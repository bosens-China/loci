import { Command, CommanderError } from 'commander'
import { CliError } from './errors.js'
import { registerBrowserCommands } from './commands/browser.js'
import { registerCategoryCommands } from './commands/category.js'
import { registerConfigCommands } from './commands/config.js'
import { registerCrawlCommands } from './commands/crawl.js'
import { registerDataCommands } from './commands/data.js'
import { registerEditCommands } from './commands/doc.js'
import { registerQueryCommands } from './commands/query.js'
import { registerSetupCommand } from './commands/setup.js'
import { registerSkillsCommands } from './commands/skills.js'
import { registerUpgradeCommand } from './commands/upgrade.js'
import { registerWebCommand } from './web.js'
import {
  CLI_VERSION,
  printCachedUpdateNotice,
  shouldNotifyUpdate,
  startDailyUpdateCheck
} from './update.js'

export function createProgram(json = false): Command {
  const program = new Command()
    .name('loci')
    .description('本地文档知识库')
    .version(CLI_VERSION)
    .enablePositionalOptions()
    .exitOverride()
    .configureOutput({
      writeErr: () => undefined,
      writeOut: (message) =>
        process.stdout.write(json ? `${JSON.stringify({ message: message.trimEnd() })}\n` : message)
    })
  registerSetupCommand(program)
  registerCrawlCommands(program)
  registerCategoryCommands(program)
  registerQueryCommands(program)
  registerEditCommands(program)
  registerWebCommand(program)
  registerSkillsCommands(program)
  registerBrowserCommands(program)
  registerConfigCommands(program)
  registerDataCommands(program)
  registerUpgradeCommand(program)
  return program
}

export async function runCli(args: readonly string[]): Promise<void> {
  const notifyUpdate = shouldNotifyUpdate(args)
  if (notifyUpdate) startDailyUpdateCheck(args)
  const program = createProgram(args.includes('--json'))
  if (!args.length) {
    program.outputHelp()
    if (notifyUpdate) printCachedUpdateNotice()
    return
  }
  try {
    await program.parseAsync([...args], { from: 'user' })
  } catch (error) {
    if (error instanceof CommanderError) {
      if (!error.exitCode) {
        if (notifyUpdate) printCachedUpdateNotice()
        return
      }
      throw new CliError(error.message, 2)
    }
    throw error
  }
  if (notifyUpdate) printCachedUpdateNotice()
}
