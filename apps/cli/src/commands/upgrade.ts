import type { Command } from 'commander'
import { jsonOption, output, type OutputOptions } from '../command-runtime.js'
import { checkForUpdate, CLI_VERSION, formatUpdateMessage } from '../update.js'

export function registerUpgradeCommand(program: Command): void {
  jsonOption(program.command('upgrade').description('检查 CLI 的 npm 新版本并显示升级命令')).action(
    async (opts: OutputOptions) => {
      const update = await checkForUpdate()
      output(
        opts,
        {
          currentVersion: CLI_VERSION,
          latestVersion: update?.latestVersion ?? CLI_VERSION,
          updateAvailable: Boolean(update)
        },
        () => (update ? formatUpdateMessage(update) : 'Loci CLI 已是最新版本')
      )
    }
  )
}
