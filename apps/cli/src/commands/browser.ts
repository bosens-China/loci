import type { Command } from 'commander'
import { jsonOption, output, withRuntime, type OutputOptions } from '../command-runtime.js'
import { confirmWrite } from '../ui.js'

export function registerBrowserCommands(program: Command): void {
  const browser = program.command('browser').description('管理用于抓取的 Chromium')
  for (const action of ['status', 'install', 'uninstall'] as const) {
    const command = browser
      .command(action)
      .description(
        { status: '检查安装和启动状态', install: '安装匹配版本', uninstall: '删除受管浏览器' }[
          action
        ]
      )
    if (action === 'uninstall') command.option('--yes', '跳过确认')
    else jsonOption(command)
    command.action(async (opts: OutputOptions & { yes?: boolean }) => {
      if (action === 'uninstall') await confirmWrite('删除受管 Chromium？', opts.yes)
      const status = await withRuntime(async (r) => {
        if (action === 'status') return r.browserManager.getStatus()
        const off = r.browserManager.subscribe((op) => process.stderr.write(`${op.message}\n`))
        try {
          return await r.browserManager.run(action)
        } finally {
          off()
        }
      })
      const { installed, launchable, executablePath, chromiumVersion, playwrightVersion, error } =
        status
      if (action === 'status' && !launchable) process.exitCode = 3
      output(opts, {
        installed,
        launchable,
        executablePath,
        chromiumVersion,
        playwrightVersion,
        error
      })
    })
  }
}
