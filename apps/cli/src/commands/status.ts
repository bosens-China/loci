import type { Command } from 'commander'
import { isLociMcpAvailable } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { printTable } from '../ui.js'

export function registerStatusCommand(program: Command): void {
  program
    .command('status')
    .description('显示本地知识库、任务、云端副本和 MCP 摘要')
    .action(() =>
      runWithRuntime('Loci 状态', async (runtime) => {
        const sources = runtime.database.listSources()
        const documents = runtime.database.listDocuments()
        const local = sources.filter((item) => item.cloud === null)
        const cloud = sources.filter((item) => item.cloud !== null)
        const runs = runtime.database.listCrawlHistory()
        const settings = runtime.database.getSettings()
        const mcpRunning = await canConnect(settings.mcpPort)
        printTable(
          ['项目', '状态'],
          [
            ['本地文档源', `${local.length} 个`],
            ['云端副本', `${cloud.length} 个`],
            ['本地文档', `${documents.length} 篇`],
            [
              '最近同步',
              runs[0]
                ? `${statusLabel(runs[0].status)}，${runs[0].startedAt ? new Date(runs[0].startedAt).toLocaleString('zh-CN') : '—'}`
                : '暂无记录'
            ],
            ['MCP', mcpRunning ? `运行中，端口 ${settings.mcpPort}` : '未运行'],
            ['Server', settings.serverUrl]
          ]
        )
        return '状态检查完成'
      })
    )
}

export const canConnect = isLociMcpAvailable

function statusLabel(status: string): string {
  return { queued: '等待', running: '进行中', completed: '成功', failed: '失败' }[status] ?? status
}
