import { spawn } from 'node:child_process'
import type { Command } from 'commander'
import { createLocalWebSession, startLocalService } from '@loci/runtime'
import { waitForTermination } from '../process-lifecycle.js'
import {
  createUserServiceManager,
  ensureLocalServiceRunning,
  resolveWebAssetsDir,
  waitForUserService
} from '../service-manager.js'
import { finishUi, info, printTable, startUi } from '../ui.js'

export function registerServiceCommands(program: Command): void {
  const service = program.command('service').description('管理 Loci 用户级后台服务')

  service
    .command('status')
    .description('查看后台服务状态')
    .action(async () => {
      const status = await createUserServiceManager().status()
      printTable(
        ['项目', '状态'],
        [
          ['安装', status.installed ? '已安装' : '未安装'],
          ['运行', status.running ? '运行中' : '已停止'],
          ['Web 端口', status.state?.port ? String(status.state.port) : '-'],
          ['MCP 端口', status.state?.mcpPort ? String(status.state.mcpPort) : '-'],
          ['定义', status.definitionPath]
        ]
      )
    })

  service
    .command('start')
    .description('启动后台服务')
    .action(async () => {
      startUi('启动 Loci 后台服务')
      await createUserServiceManager().start()
      await waitForUserService()
      finishUi('后台服务已启动')
    })

  service
    .command('stop')
    .description('停止后台服务但保留登录自启动')
    .action(async () => {
      startUi('停止 Loci 后台服务')
      await createUserServiceManager().stop()
      finishUi('后台服务已停止；下次登录时仍会启动')
    })

  service
    .command('restart')
    .description('重启后台服务')
    .action(async () => {
      startUi('重启 Loci 后台服务')
      await createUserServiceManager().restart()
      await waitForUserService()
      finishUi('后台服务已重启')
    })

  service
    .command('disable')
    .description('停止并移除登录自启动')
    .action(async () => {
      startUi('停用 Loci 后台服务')
      await createUserServiceManager().disable()
      finishUi('后台服务已停用，定时计划将暂停')
    })

  service
    .command('logs')
    .description('显示后台服务日志路径')
    .action(async () => {
      const manager = createUserServiceManager()
      for (const path of manager.logPaths) process.stdout.write(`${path}\n`)
    })

  service
    .command('run')
    .description('以前台方式运行后台服务')
    .option('--managed', '由系统用户级服务管理')
    .action(async () => {
      const local = await startLocalService({ assetsDir: resolveWebAssetsDir() })
      const stop = async (): Promise<void> => {
        await local.close()
      }
      process.once('uncaughtExceptionMonitor', () => void stop())
      if (process.stdout.isTTY) info(`Loci 后台服务运行于 ${local.http.endpoint}`)
      await waitForTermination()
      await stop()
    })
}

export function registerUiCommand(program: Command): void {
  program
    .command('ui')
    .description('启动或复用后台服务并打开 Web 界面')
    .option('--no-open', '只输出地址，不打开浏览器')
    .action(async (options: { open: boolean }) => {
      startUi('打开 Loci Web 界面')
      const state = await ensureLocalServiceRunning()
      const token = await createLocalWebSession(state)
      const url = `http://127.0.0.1:${state.port}/#token=${encodeURIComponent(token)}`
      if (options.open) openBrowser(url)
      finishUi(options.open ? 'Loci Web 界面已打开' : 'Loci Web 界面已就绪')
      process.stdout.write(`${url}\n`)
    })
}

function openBrowser(url: string): void {
  const command =
    process.platform === 'darwin'
      ? { executable: 'open', args: [url] }
      : process.platform === 'win32'
        ? { executable: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
        : { executable: 'xdg-open', args: [url] }
  const child = spawn(command.executable, command.args, {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.once('error', () => undefined)
  child.unref()
}
