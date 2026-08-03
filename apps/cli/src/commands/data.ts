import { readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import { acquireMaintenanceRuntimeLock } from '../../../desktop/src/main/runtime-lock.js'
import { runWithRuntime } from '../command-runtime.js'
import { CliCanceledError, CliError } from '../errors.js'
import { askConfirm, askText } from '../ui.js'

export function registerDataCommands(program: Command): void {
  const data = program.command('data').description('备份、恢复和清理本地数据')

  data
    .command('export [file]')
    .description('导出与桌面端兼容的 Loci 备份')
    .action((file: string | undefined) =>
      runWithRuntime('导出 Loci 数据', async (runtime) => {
        const target = resolve(file ?? `loci-backup-${new Date().toISOString().slice(0, 10)}.json`)
        await writeFile(target, JSON.stringify(runtime.database.exportBackup(), null, 2), 'utf8')
        return `数据已导出到 ${target}`
      })
    )

  data
    .command('import [file]')
    .description('使用备份覆盖当前本地数据')
    .option('--yes', '跳过确认')
    .action((file: string | undefined, options: { yes?: boolean }) =>
      runWithRuntime('导入 Loci 数据', async (runtime) => {
        const source = resolve(file ?? (await askText('备份文件路径')))
        const input = JSON.parse(await readFile(source, 'utf8')) as unknown
        const preview = backupCounts(input)
        if (
          !options.yes &&
          !(await askConfirm(
            `备份包含 ${preview.sources} 个文档源和 ${preview.documents} 篇文档，将覆盖当前数据，是否继续？`
          ))
        ) {
          throw new CliCanceledError()
        }
        const lock = acquireMaintenanceRuntimeLock(runtime.dataDir, 'CLI 数据导入')
        try {
          const summary = runtime.database.importBackup(input)
          return `已导入 ${summary.sources} 个文档源和 ${summary.documents} 篇文档`
        } finally {
          lock.release()
        }
      })
    )

  data
    .command('clear-documents')
    .description('清空全部文档和全文索引，保留文档源')
    .option('--yes', '跳过确认')
    .action((options: { yes?: boolean }) =>
      runWithRuntime('清空本地文档', async (runtime) => {
        const count = runtime.database.listDocuments().length
        if (!options.yes && !(await askConfirm(`确定清空全部 ${count} 篇文档吗？`))) {
          throw new CliCanceledError()
        }
        const lock = acquireMaintenanceRuntimeLock(runtime.dataDir, 'CLI 数据清理')
        try {
          const removed = runtime.database.clearDocuments()
          return `已清空 ${removed} 篇文档，文档源保留不变`
        } finally {
          lock.release()
        }
      })
    )
}

function backupCounts(input: unknown): { sources: number; documents: number } {
  if (!input || typeof input !== 'object' || !('data' in input)) {
    throw new CliError('备份文件格式无效', 2)
  }
  const data = input.data
  if (!data || typeof data !== 'object') throw new CliError('备份文件缺少数据', 2)
  const sources = 'sources' in data && Array.isArray(data.sources) ? data.sources.length : -1
  const documents =
    'documents' in data && Array.isArray(data.documents) ? data.documents.length : -1
  if (sources < 0 || documents < 0) throw new CliError('备份文件内容无效', 2)
  return { sources, documents }
}
