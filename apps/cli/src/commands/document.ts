import type { Command } from 'commander'
import { buildUrlTree, getUrlTreeSlice } from '@loci/shared'
import { DOCUMENT_SOURCE_DEFAULTS, DOCUMENT_SOURCE_LIMITS } from '@loci/core'
import { runWithRuntime } from '../command-runtime.js'
import { saveRecentResource } from '../preferences.js'
import { resolveDocument, resolveSource } from '../resources.js'
import { CliError } from '../errors.js'
import { askText, confirmAction, printTable, printTree, requireYesInNonInteractive } from '../ui.js'

export function registerDocumentCommands(program: Command): void {
  const document = program.command('document').description('浏览和搜索本地知识库')

  document
    .command('list [source]')
    .description('列出文档')
    .action((reference: string | undefined) =>
      runWithRuntime('文档列表', async (runtime) => {
        const source = reference ? await resolveSource(runtime, reference) : undefined
        const documents = runtime.database
          .listDocuments()
          .filter((item) => !source || item.sourceId === source.id)
        printTable(
          ['标题', '文档源', '语言', '最近更新', '短 ID'],
          documents.map((item) => [
            item.title,
            item.sourceName,
            item.language,
            item.updatedAt,
            item.id.slice(0, 8)
          ])
        )
        return `共 ${documents.length} 篇文档`
      })
    )

  document
    .command('tree [source]')
    .description('按 URL 路径展示文档目录')
    .option('--parent <path>', '只读取指定目录的直接子级')
    .option('--depth <number>', '返回目录深度', '1')
    .action((reference: string | undefined, options: { parent?: string; depth: string }) =>
      runWithRuntime('文档目录', async (runtime) => {
        const source = await resolveSource(runtime, reference, { preferenceKey: 'document-tree' })
        const documents = runtime.database
          .listDocuments()
          .filter((item) => item.sourceId === source.id)
        const depth = Math.max(1, Math.min(10, Number.parseInt(options.depth, 10) || 1))
        const tree =
          getUrlTreeSlice(
            buildUrlTree(
              documents.map((item) => ({ id: item.id, url: item.url, title: item.title })),
              source.id
            ),
            options.parent,
            depth
          ) ?? []
        process.stdout.write(`${source.name}\n`)
        printTree(tree)
        saveRecentResource(runtime.database, 'document-tree', source.id)
        return `目录中有 ${documents.length} 篇文档`
      })
    )

  document
    .command('search [query]')
    .description('关键词搜索标题和 Markdown 正文')
    .action((query: string | undefined) =>
      runWithRuntime('搜索知识库', async (runtime) => {
        const keyword = query ?? (await askText('搜索关键词'))
        const documents = runtime.database.searchDocuments(keyword)
        printTable(
          ['标题', '文档源', 'URL', '短 ID'],
          documents.map((item) => [item.title, item.sourceName, item.url, item.id.slice(0, 8)])
        )
        return documents.length > 0 ? `找到 ${documents.length} 篇文档` : '没有找到匹配文档'
      })
    )

  document
    .command('read [document]')
    .description('完整读取一篇 Markdown 文档')
    .action((reference: string | undefined) =>
      runWithRuntime('读取文档', async (runtime) => {
        const item = await resolveDocument(runtime, reference)
        process.stdout.write(`\n# ${item.title}\n\n来源：${item.url}\n\n${item.content}\n`)
        saveRecentResource(runtime.database, 'document-read', item.id)
        return `已读取“${item.title}”`
      })
    )

  document
    .command('move <documents...>')
    .description('把多篇文档事务性移动到一个新文档库')
    .requiredOption('--name <name>', '新文档库名称')
    .requiredOption('--url <url>', '新文档库仓库或入口 URL')
    .option('--scope <path>', '收录范围', DOCUMENT_SOURCE_DEFAULTS.scopePath)
    .option('--page-limit <number>', '页面上限', String(DOCUMENT_SOURCE_DEFAULTS.pageLimit))
    .option('--operation-id <id>', '重试时复用同一操作 ID')
    .option('--keep-empty-sources', '原文档库为空时仍保留')
    .option('--yes', '跳过确认')
    .action(
      async (
        references: string[],
        options: {
          name: string
          url: string
          scope: string
          pageLimit: string
          operationId?: string
          keepEmptySources?: boolean
          yes?: boolean
        }
      ) =>
        runWithRuntime('移动文档', async (runtime) => {
          runtime.assertWritable()
          requireYesInNonInteractive(options.yes, '非交互终端请传入 --yes 跳过确认')
          const selected = await Promise.all(
            references.map((item) => resolveDocument(runtime, item))
          )
          if (
            !(await confirmAction(
              `确认移动 ${selected.length} 篇文档到新文档库“${options.name}”吗？`,
              options.yes,
              '非交互终端请传入 --yes 跳过确认'
            ))
          ) {
            return '已取消移动'
          }
          const pageLimit = Number(options.pageLimit)
          if (
            !Number.isInteger(pageLimit) ||
            pageLimit < DOCUMENT_SOURCE_LIMITS.pageLimit.min ||
            pageLimit > DOCUMENT_SOURCE_LIMITS.pageLimit.max
          ) {
            throw new CliError('页面上限超出允许范围', 2)
          }
          const moved = runtime.database.moveDocumentsToNewSource({
            operationId: options.operationId,
            documentIds: selected.map((item) => item.id),
            deleteEmptySources: !options.keepEmptySources,
            target: {
              name: options.name,
              url: options.url,
              mode: 'auto',
              pageLimit,
              scopePath: options.scope,
              schedule: null,
              httpConcurrency: null,
              browserConcurrency: null
            }
          })
          return `${moved.reused ? '已复用' : '已完成'}移动：${moved.moved} 篇，目标“${moved.target.name}”`
        })
    )
}
