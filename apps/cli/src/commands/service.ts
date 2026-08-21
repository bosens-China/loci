import { spawn } from 'node:child_process'
import { Option, type Command } from 'commander'
import {
  createLocalWebSession,
  startLocalService,
  startLocalWorker,
  RuntimeLockedError,
  type LocalWebServiceState
} from '@loci/runtime'
import { ensurePersistentBackgroundService } from '../background-host.js'
import { waitForTermination } from '../process-lifecycle.js'
import { parseServiceLogLines, showServiceLogs } from '../service-logs.js'
import {
  createUserServiceManager,
  ensureLocalJobWorkerRunning,
  ensureUserServiceRunning,
  resolveWebAssetsDir,
  waitForUserService
} from '../service-manager.js'
import { finishUi, info, printTable, startUi, warning } from '../ui.js'

interface UiService {
  state: LocalWebServiceState
  close: () => Promise<void>
}

export interface UiSessionDependencies {
  startService: () => Promise<UiService>
  createWebSession: (state: LocalWebServiceState) => Promise<string>
  printAddress: (url: string) => void
  openBrowser: (url: string) => Promise<boolean>
  reportBrowserOpenFailure: () => void
  reportReady: () => void
  waitForTermination: () => Promise<void>
}

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
          [
            '模式',
            status.state?.mode === 'persistent'
              ? '常驻 worker'
              : status.state?.mode === 'on-demand'
                ? '按需 worker'
                : '-'
          ],
          ['进程', status.state ? `PID ${status.state.pid}` : '-'],
          ['定义', status.definitionPath]
        ]
      )
    })

  service
    .command('start')
    .description('手动安装或启动用户级后台服务')
    .action(async () => {
      startUi('启动 Loci 后台服务')
      await ensureUserServiceRunning()
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
      finishUi('后台服务已停用，定时计划和云端每日检查将暂停')
    })

  service
    .command('logs')
    .description('显示或持续跟随后台服务日志')
    .option('--lines <number>', '每个日志文件显示的最近行数', parseServiceLogLines, 50)
    .option('--follow', '持续输出新增日志')
    .action(async (options: { lines: number; follow?: boolean }) => {
      const manager = createUserServiceManager()
      await showServiceLogs(manager.logPaths, options)
    })

  service
    .command('run')
    .description('以前台方式运行无 HTTP 后台 worker')
    .addOption(new Option('--managed', '由系统用户级服务管理').hideHelp())
    .action(async (options: { managed?: boolean }) => {
      const local = await startPersistentWorker(Boolean(options.managed))
      const stop = async (): Promise<void> => {
        await local.close()
      }
      process.once('uncaughtExceptionMonitor', () => void stop())
      local.start()
      if (process.stdout.isTTY) info(`Loci 后台 worker 已启动，PID ${local.state.pid}`)
      await waitForTermination()
      await stop()
    })

  service
    .command('worker', { hidden: true })
    .description('执行本地持久任务并在队列空闲后退出')
    .action(async () => {
      const local = startLocalWorker({ mode: 'on-demand' })
      try {
        await local.runUntilIdle()
      } finally {
        await local.close()
      }
    })
}

async function startPersistentWorker(
  waitForActiveWorker: boolean
): Promise<ReturnType<typeof startLocalWorker>> {
  while (true) {
    try {
      return startLocalWorker({ mode: 'persistent' })
    } catch (error) {
      if (!waitForActiveWorker || !(error instanceof RuntimeLockedError)) throw error
      await new Promise((resolvePromise) => setTimeout(resolvePromise, 500))
    }
  }
}

export function registerUiCommand(program: Command): void {
  program
    .command('ui')
    .description('启动当前会话的本机 HTTP 并打开 Web 界面')
    .option('--no-open', '只输出地址，不打开浏览器')
    .action(async (options: { open: boolean }) => {
      startUi('打开 Loci Web 界面')
      await runUiSession(options)
      finishUi('Loci Web 会话已结束')
    })
}

/** Web HTTP 与当前命令共用生命周期，后台任务由独立 worker 执行。 */
export async function runUiSession(
  options: { open: boolean },
  overrides: Partial<UiSessionDependencies> = {}
): Promise<void> {
  const dependencies: UiSessionDependencies = {
    startService: async () => {
      const local = await startLocalService({
        assetsDir: resolveWebAssetsDir(),
        startJobWorker: async () => void (await ensureLocalJobWorkerRunning()),
        ensurePersistentBackground: ensurePersistentBackgroundService
      })
      return {
        state: local.state,
        close: local.close
      }
    },
    createWebSession: createLocalWebSession,
    printAddress: (url) => process.stdout.write(`Web 地址：${url}\n`),
    openBrowser,
    reportBrowserOpenFailure: () => warning('无法自动打开浏览器，请复制上方 Web 地址手动打开'),
    reportReady: () => info('服务正在前台运行，按 Ctrl+C 结束 Web 会话'),
    waitForTermination,
    ...overrides
  }
  const local = await dependencies.startService()
  try {
    const token = await dependencies.createWebSession(local.state)
    const url = `http://127.0.0.1:${local.state.port}/#token=${encodeURIComponent(token)}`
    const termination = dependencies.waitForTermination()
    dependencies.printAddress(url)
    if (options.open) {
      let opened = false
      try {
        opened = await dependencies.openBrowser(url)
      } catch {
        // 浏览器启动失败不影响用户复制已输出的地址。
      }
      if (!opened) dependencies.reportBrowserOpenFailure()
    }
    dependencies.reportReady()
    await termination
  } finally {
    await local.close()
  }
}

export function openBrowser(url: string): Promise<boolean> {
  const command =
    process.platform === 'darwin'
      ? { executable: 'open', args: [url] }
      : process.platform === 'win32'
        ? { executable: 'cmd.exe', args: ['/d', '/s', '/c', 'start', '', url] }
        : { executable: 'xdg-open', args: [url] }
  return new Promise((resolvePromise) => {
    try {
      const child = spawn(command.executable, command.args, {
        stdio: 'ignore',
        windowsHide: true
      })
      child.once('error', () => resolvePromise(false))
      child.once('exit', (code) => resolvePromise(code === 0))
    } catch {
      resolvePromise(false)
    }
  })
}
