import type { Command } from 'commander'
import {
  checkLocalService,
  inspectPersistentBackgroundRequirements,
  readLocalServiceState
} from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { printTable } from '../ui.js'
import { formatCrawlRunStatus } from './source-history.js'

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('显示本地知识库、任务和云端副本摘要')
    .action(() =>
      runWithRuntime('Loci 状态', async (runtime) => {
        const sources = runtime.database.listSources()
        const documents = runtime.database.listDocuments()
        const local = sources.filter((item) => item.cloud === null)
        const cloud = sources.filter((item) => item.cloud !== null)
        const runs = runtime.database.listCrawlHistory()
        const settings = runtime.database.getSettings()
        const serviceState = readLocalServiceState(runtime.dataDir)
        const serviceRunning = Boolean(serviceState && (await checkLocalService(serviceState)))
        const persistentRunning = serviceRunning && serviceState?.mode === 'persistent'
        const background = inspectPersistentBackgroundRequirements(sources)
        printTable(
          ['项目', '状态'],
          [
            ['本地文档源', `${local.length} 个`],
            ['云端副本', `${cloud.length} 个`],
            ['本地文档', `${documents.length} 篇`],
            [
              '最近同步',
              runs[0]
                ? `${formatCrawlRunStatus(runs[0].status)}，${runs[0].sourceName}，${runs[0].startedAt ? new Date(runs[0].startedAt).toLocaleString('zh-CN') : '—'}`
                : '暂无记录'
            ],
            [
              '后台服务',
              persistentRunning
                ? `无 HTTP worker 运行中，PID ${serviceState!.pid}`
                : background.required
                  ? '需要启动：loci service start'
                  : serviceRunning
                    ? `按需抓取 worker 运行中，PID ${serviceState!.pid}`
                    : '无需运行'
            ],
            ['Server', settings.serverUrl]
          ]
        )
        return '状态检查完成'
      })
    )
}
