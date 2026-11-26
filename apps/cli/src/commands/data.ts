import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { copyFile, link, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import type { Command } from 'commander'
import {
  jsonOption,
  output,
  withCancellation,
  withRuntime,
  type OutputOptions
} from '../command-runtime.js'
import { library } from '../resources.js'
import { confirmWrite } from '../ui.js'

async function publishNewBackup(temp: string, path: string): Promise<void> {
  try {
    await link(temp, path)
  } catch (error) {
    if (!(
      error instanceof Error &&
      'code' in error &&
      ['ENOTSUP', 'EOPNOTSUPP', 'EPERM', 'ENOSYS'].includes(String(error.code))
    ))
      throw error
    // 不支持硬链接的目标盘也要排他创建，避免覆盖后来出现的文件。
    await copyFile(temp, path, constants.COPYFILE_EXCL)
  }
}

export function registerDataCommands(program: Command): void {
  const data = program.command('data').description('备份、恢复与清空本地文档库')
  jsonOption(
    data
      .command('export [file]')
      .description('导出 ZIP 备份')
      .option('--category <name...>', '按分类导出')
      .option('--library <lib...>', '按库名或 ID 导出')
      .option('--yes', '跳过覆盖同名备份的确认')
  ).action(
    async (
      file: string | undefined,
      opts: OutputOptions & { category?: string[]; library?: string[]; yes?: boolean }
    ) => {
      const path = resolve(
        file ?? `loci-backup-${new Date().toISOString().replace(/[:.]/gu, '-')}.zip`
      )
      const bytes = await withRuntime((r) =>
        r.exportBackupArchive({
          categories: opts.category,
          libraryIds: opts.library?.map((ref) => library(r, ref).id)
        })
      )
      // 先完整写入临时文件，失败时保留原有备份。
      const temp = `${path}.${randomUUID()}.tmp`
      try {
        await writeFile(temp, bytes, { flag: 'wx', mode: 0o600 })
        try {
          await publishNewBackup(temp, path)
        } catch (error) {
          if (!(error instanceof Error && 'code' in error && error.code === 'EEXIST')) throw error
          await confirmWrite(`覆盖已有备份 ${path}？`, opts.yes)
          await rename(temp, path)
        }
      } finally {
        await rm(temp, { force: true })
      }
      output(opts, { path, bytes: bytes.length })
    }
  )
  jsonOption(data.command('import <file>').description('从 ZIP 合并导入文档库'))
    .option('--replace-all', '清空全部本地库并恢复备份')
    .option('--yes', '跳过确认')
    .action(async (file: string, opts: OutputOptions & { yes?: boolean; replaceAll?: boolean }) => {
      await confirmWrite(
        opts.replaceAll
          ? `清空全部本地文档库并从 ${file} 恢复？`
          : `从 ${file} 合并导入，替换匹配库的全部内容，保留其他库？`,
        opts.yes
      )
      const bytes = await readFile(file)
      output(
        opts,
        await withRuntime((r) => r.importBackupArchive(bytes, { replaceAll: opts.replaceAll })),
        (result) =>
          `已新增 ${result.importedLibraries - result.replacedLibraries} 个库，覆盖 ${result.replacedLibraries} 个库，导入 ${result.importedDocuments} 篇文档。`
      )
    })
  for (const scope of ['documents', 'sources'] as const) {
    const documentsOnly = scope === 'documents'
    jsonOption(
      data
        .command(`clear-${scope}`)
        .description(
          documentsOnly ? '清空全部文档和索引，保留文档库' : '清空全部文档库及文档、索引和抓取记录'
        )
    )
      .option('--yes', '跳过确认')
      .action(async (opts: OutputOptions & { yes?: boolean }) => {
        await confirmWrite(async () => {
          const { libraries, documents } = await withRuntime((r) => r.getClearDataCounts())
          return documentsOnly
            ? `清空 ${libraries} 个库中的 ${documents} 篇文档及索引，并保留库设置？手工文档和只读快照正文也会删除。`
            : `删除全部 ${libraries} 个库、${documents} 篇文档及索引和抓取记录？`
        }, opts.yes)
        const summary = await withCancellation((signal) =>
          withRuntime((r) => r.clearData(scope, signal))
        )
        output(opts, summary, (r) =>
          documentsOnly
            ? `已清空 ${r.documents} 篇文档。`
            : `已删除 ${r.libraries} 个库及 ${r.documents} 篇文档。`
        )
      })
  }
}
