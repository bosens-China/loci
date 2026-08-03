import type { Command } from 'commander'
import { runWithRuntime } from '../command-runtime.js'
import { resolveDocument, resolveSource } from '../resources.js'
import { askText, printTable } from '../ui.js'

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
    .action((reference: string | undefined) =>
      runWithRuntime('文档目录', async (runtime) => {
        const source = await resolveSource(runtime, reference)
        const documents = runtime.database
          .listDocuments()
          .filter((item) => item.sourceId === source.id)
          .sort((left, right) => left.url.localeCompare(right.url))
        process.stdout.write(`${source.name}\n`)
        for (const item of documents) {
          const path = new URL(item.url).pathname || '/'
          process.stdout.write(`  └─ ${path}  ${item.title}\n`)
        }
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
        return `已读取“${item.title}”`
      })
    )
}
