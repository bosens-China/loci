import type { Command } from 'commander'
import { checkForUpdate, formatUpdateMessage } from '../update.js'
import { info, success } from '../ui.js'

/** 手动检查 CLI 的 npm 最新版本。 */
export function registerUpdateCommand(program: Command): void {
  program
    .command('update')
    .description('检查 Loci CLI 是否有新版本')
    .action(async () => {
      const update = await checkForUpdate()
      if (update) info(formatUpdateMessage(update))
      else success('Loci CLI 已是最新版本')
    })
}
