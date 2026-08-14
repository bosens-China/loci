import { readFile, writeFile } from 'node:fs/promises'
import { existsSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import type { Command } from 'commander'
import { acquireMaintenanceRuntimeLock } from '@loci/runtime'
import { runWithRuntime } from '../command-runtime.js'
import { CliCanceledError, CliError } from '../errors.js'
import { readRecentResource, saveRecentResource } from '../preferences.js'
import { askConfirm, askPath } from '../ui.js'

export function registerDataCommands(program: Command): void {
  const data = program.command('data').description('备份、恢复和清理本地数据')

  data
    .command('export [file]')
    .description('导出 Loci 备份，省略路径时使用带时间的文件名')
    .action((file: string | undefined) =>
      runWithRuntime('导出 Loci 数据', async (runtime) => {
        const directory = readRecentResource(runtime.database, 'data-directory') ?? process.cwd()
        const target = resolve(file ?? join(directory, defaultBackupFilename()))
        await writeFile(
          target,
          JSON.stringify(runtime.database.exportBackup(), null, 2),
          file ? 'utf8' : { encoding: 'utf8', flag: 'wx' }
        )
        saveRecentResource(runtime.database, 'data-directory', dirname(target))
        return `数据已导出到 ${target}`
      })
    )

  data
    .command('import [file]')
    .description('使用备份覆盖当前本地数据')
    .option('--yes', '跳过确认')
    .action((file: string | undefined, options: { yes?: boolean }) =>
      runWithRuntime('导入 Loci 数据', async (runtime) => {
        requireYesInNonInteractive(options)
        const source = resolve(
          file ??
            (await askPath('选择 Loci 备份文件', {
              root: readRecentResource(runtime.database, 'data-directory') ?? process.cwd(),
              validate: validateBackupPath
            }))
        )
        let input: unknown
        try {
          input = JSON.parse(await readFile(source, 'utf8')) as unknown
        } catch (error) {
          if (error instanceof SyntaxError) {
            throw new CliError('备份文件不是有效 JSON，请确认文件来源', 2)
          }
          throw error
        }
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
          saveRecentResource(runtime.database, 'data-directory', dirname(source))
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
        requireYesInNonInteractive(options)
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

  data
    .command('clear-sources')
    .description('清空全部文档源及其文档、全文索引和抓取历史')
    .option('--yes', '跳过确认')
    .action((options: { yes?: boolean }) =>
      runWithRuntime('清空本地文档源', async (runtime) => {
        requireYesInNonInteractive(options)
        const count = runtime.database.listSources().length
        if (!options.yes && !(await askConfirm(`确定清空全部 ${count} 个文档源及其文档吗？`))) {
          throw new CliCanceledError()
        }
        const lock = acquireMaintenanceRuntimeLock(runtime.dataDir, 'CLI 文档源清理')
        try {
          const removed = runtime.database.clearSources()
          return `已清空 ${removed} 个文档源及其关联数据`
        } finally {
          lock.release()
        }
      })
    )
}

function requireYesInNonInteractive(options: { yes?: boolean }): void {
  if (!process.stdin.isTTY && !options.yes) {
    throw new CliError('非交互终端请传入 --yes 跳过确认', 2)
  }
}

function validateBackupPath(value: string | undefined): string | undefined {
  const target = resolve(value ?? '')
  if (!existsSync(target)) return '文件不存在，请重新选择'
  try {
    return statSync(target).isFile() ? undefined : '请选择一个备份文件，而不是目录'
  } catch {
    return '无法读取这个文件，请检查权限'
  }
}

export function defaultBackupFilename(now: Date = new Date()): string {
  return `loci-backup-${now.toISOString().replace(/[:.]/g, '-')}.json`
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
