import type { Command } from 'commander'
import { createCliBrowserManager } from '../browser.js'
import { askConfirm, createSpinner, finishUi, startUi } from '../ui.js'

export function registerBrowserCommands(program: Command): void {
  const browser = program.command('browser').description('管理 CLI 使用的 Playwright 无头浏览器')

  browser
    .command('status')
    .description('检查无头浏览器是否安装且可以启动')
    .action(async () => {
      startUi('无头浏览器状态')
      const status = await createCliBrowserManager().getStatus()
      process.stdout.write(`安装状态：${status.installed ? '已安装' : '未安装'}\n`)
      process.stdout.write(`启动状态：${status.launchable ? '正常' : '不可用'}\n`)
      process.stdout.write(`Playwright：${status.playwrightVersion}\n`)
      if (status.chromiumVersion) process.stdout.write(`Chromium：${status.chromiumVersion}\n`)
      process.stdout.write(`可执行文件：${status.executablePath}\n`)
      if (status.error) process.stdout.write(`错误：${status.error}\n`)
      finishUi(
        status.launchable ? '无头浏览器可以使用' : '请运行 loci browser install',
        status.launchable ? 'success' : 'warning'
      )
      if (!status.launchable) process.exitCode = 3
    })

  browser
    .command('install')
    .description('安装版本匹配的 Chromium headless shell')
    .action(async () => {
      startUi('安装无头浏览器')
      const spinner = createSpinner()
      const manager = createCliBrowserManager((operation) => {
        const suffix = operation.progress === null ? '' : ` ${operation.progress}%`
        spinner.message(`${operation.message}${suffix}`)
      })
      spinner.start('正在准备浏览器安装')
      try {
        await manager.run('install')
        spinner.stop('Chromium headless shell 安装成功')
      } catch (error) {
        spinner.error('浏览器安装失败')
        throw error
      }
      finishUi('Chromium headless shell 安装成功')
    })

  browser
    .command('uninstall')
    .description('删除 CLI 管理的无头浏览器')
    .option('--yes', '跳过确认')
    .action(async (options: { yes?: boolean }) => {
      startUi('卸载无头浏览器')
      if (!options.yes && !(await askConfirm('确定删除 CLI 管理的无头浏览器吗？'))) {
        finishUi('未卸载浏览器')
        return
      }
      await createCliBrowserManager().run('uninstall')
      finishUi('无头浏览器已卸载')
    })
}
