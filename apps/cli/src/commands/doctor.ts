import { accessSync, constants } from 'node:fs'
import { join } from 'node:path'
import type { Command } from 'commander'
import { hasActiveCrawlLocks, readRuntimeLock } from '@loci/runtime'
import { browserStatus } from '../browser.js'
import { runWithRuntime } from '../command-runtime.js'
import { canConnect } from './status.js'
import { printTable } from '../ui.js'

export function registerDoctorCommand(program: Command): void {
  program
    .command('doctor')
    .description('检查数据库、浏览器、Server 和 MCP 并给出修复建议')
    .action(() =>
      runWithRuntime('Loci 诊断', async (runtime) => {
        const settings = runtime.database.getSettings()
        const browser = await browserStatus(join(runtime.cacheDir, 'playwright'))
        const server = await checkServer(settings.serverUrl)
        const mcp = await canConnect(settings.mcpPort)
        const maintenance = readRuntimeLock(runtime.dataDir, 'maintenance')
        const scheduleHost = readRuntimeLock(runtime.dataDir, 'schedule')
        const crawling = hasActiveCrawlLocks(runtime.dataDir)
        let writable = true
        try {
          accessSync(runtime.dataDir, constants.R_OK | constants.W_OK)
        } catch {
          writable = false
        }
        const rows = [
          ['数据目录', writable ? '正常' : '不可写', runtime.dataDir],
          [
            '数据库',
            '正常',
            `${join(runtime.dataDir, 'loci.sqlite')}（Schema ${runtime.database.schemaVersion}）`
          ],
          [
            '跨进程锁',
            maintenance ? '维护中' : crawling ? '同步中' : '正常',
            maintenance
              ? `${maintenance.owner}（PID ${maintenance.pid}）`
              : crawling
                ? '存在活跃文档同步任务'
                : '无活跃锁，陈旧锁已自动清理'
          ],
          [
            '无头浏览器',
            browser.launchable ? '正常' : '需要处理',
            browser.launchable ? browser.executable : '运行 loci browser install'
          ],
          ['Loci Server', server.ok ? '正常' : '不可访问', server.message],
          [
            'MCP',
            mcp ? '运行中' : '未运行',
            mcp ? `端口 ${settings.mcpPort}` : '桌面端会自动启动，或运行 loci mcp serve'
          ],
          [
            '计划运行器',
            scheduleHost ? '运行中' : '未运行',
            scheduleHost?.owner ?? '运行 loci schedule run'
          ]
        ]
        printTable(['检查项', '结果', '说明'], rows)
        const issues = rows.filter((row) =>
          ['不可写', '需要处理', '不可访问'].includes(row[1]!)
        ).length
        return issues === 0
          ? '所有关键检查均正常'
          : { message: `诊断完成，发现 ${issues} 项需要处理`, tone: 'warning' }
      })
    )
}

async function checkServer(serverUrl: string): Promise<{ ok: boolean; message: string }> {
  try {
    const response = await fetch(`${serverUrl}/health`, { signal: AbortSignal.timeout(3000) })
    return { ok: response.ok, message: response.ok ? serverUrl : `HTTP ${response.status}` }
  } catch {
    return { ok: false, message: `${serverUrl}，请检查地址或网络` }
  }
}
