import { Option, type Command } from 'commander'
import type { LibraryFilters, LibraryTreeOptions, UrlTreeNode } from '@loci/shared'
import {
  jsonOption,
  natural,
  output,
  positive,
  withRuntime,
  type OutputOptions
} from '../command-runtime.js'
import { documentSummary, library, libraryId } from '../resources.js'

type Page = { offset?: number; limit?: number }
function pagination(command: Command): Command {
  return command
    .option('--offset <n>', '跳过的条数', natural)
    .option('--limit <n>', '最多返回条数', positive)
}

interface TreeEntry {
  id: string
  title: string
  path?: string
  matchedCount?: number
  totalCount?: number
  children?: TreeEntry[]
  sectionId?: string
}

function compactTree(nodes: UrlTreeNode[]): TreeEntry[] {
  return nodes.map(({ id, title, path, matchedCount, totalCount, children, sectionId }) => ({
    id,
    title,
    path,
    matchedCount,
    totalCount,
    sectionId,
    children: children ? compactTree(children) : undefined
  }))
}

function treeText(nodes: TreeEntry[], indent = ''): string {
  return nodes
    .flatMap((node) => [
      `${indent}${node.title}${node.path ? `  ${node.id}` : '/'}${node.matchedCount === undefined ? '' : ` (${node.matchedCount}/${node.totalCount})`}`,
      ...(node.children?.length ? [treeText(node.children, indent + '  ')] : [])
    ])
    .join('\n')
}

/** 各入口的匹配、排序与子树展开均使用 runtime 的同一份快照。 */
export function registerQueryCommands(program: Command): void {
  pagination(jsonOption(program.command('list [library]').description('列出文档库或库中的文档')))
    .option('--category <name>', '按分类精确筛选')
    .option('--version <ver>', '按文档库版本精确筛选')
    .option('--query <kw>', '筛选文档库')
    .action(
      async (reference: string | undefined, options: OutputOptions & Page & LibraryFilters) => {
        await withRuntime((runtime) => {
          const offset = options.offset ?? 0
          const end = options.limit === undefined ? undefined : offset + options.limit
          if (reference !== undefined) {
            const rows = runtime.database
              .listDocumentSummaries(library(runtime, reference).id)
              .slice(offset, end)
              .map(documentSummary)
            output(options, rows, (items) =>
              items.map((d) => `${d.id}\t${d.path}\t${d.title}`).join('\n')
            )
          } else {
            const rows = runtime
              .listLibraries(options)
              .slice(offset, end)
              .map(({ id, name, category, version, url, pageCount, readOnly, languages }) => ({
                id,
                name,
                category,
                version,
                url,
                pageCount,
                readOnly,
                languages
              }))
            output(options, rows, (items) =>
              items
                .map(
                  (s) =>
                    `${s.id}\t${s.name}\t分类 ${s.category ?? '—'}\t版本 ${s.version ?? '—'}\t${s.pageCount} 页\t${s.url}`
                )
                .join('\n')
            )
          }
        })
      }
    )

  jsonOption(program.command('tree <library>').description('查看文档目录树，可按关键词裁剪'))
    .option('--parent <path|id>', '父目录路径或节点 ID')
    .option('--depth <n>', '显示层数', positive, 2)
    .option('--all', '显示完整深度')
    .option('--query <kw...>', '筛选关键词')
    .action(
      async (
        reference: string,
        opts: OutputOptions & LibraryTreeOptions & { all?: boolean; query?: string[] }
      ) => {
        const nodes = await withRuntime((r) =>
          r.getLibraryTree(library(r, reference).id, {
            parent: opts.parent,
            depth: opts.all ? Number.MAX_SAFE_INTEGER : opts.depth,
            queries: opts.query
          })
        )
        output(opts, compactTree(nodes), treeText)
      }
    )

  pagination(
    jsonOption(program.command('search <queries...>').description('全文搜索并定位命中小节'))
  )
    .addOption(
      new Option('--library <lib...>', '限制文档库，可重复或用逗号分隔').argParser(
        (value: string, previous: string[] = []) => [
          ...previous,
          ...value.split(',').map((v) => v.trim())
        ]
      )
    )
    .option('--path-prefix <path>', '限制路径前缀')
    .option('--tree', '显示命中目录树')
    .action(
      async (
        queries: string[],
        opts: OutputOptions & Page & { library?: string[]; pathPrefix?: string; tree?: boolean }
      ) => {
        const result = await withRuntime((r) =>
          r.searchDocuments({
            queries,
            libraryIds: opts.library?.map((ref) => library(r, ref).id),
            pathPrefix: opts.pathPrefix,
            tree: opts.tree,
            offset: opts.offset,
            limit: opts.limit
          })
        )
        if (opts.tree) {
          const trees =
            result.trees?.map((t) => ({ libraryId: t.libraryId, nodes: compactTree(t.nodes) })) ??
            []
          output(opts, { total: result.total, trees }, (v) =>
            v.trees.map((t) => `${t.libraryId}\n${treeText(t.nodes)}`).join('\n')
          )
        } else {
          const hits = result.hits.map(
            ({ id, title, path, sourceId, sectionId, sectionTitle, paragraph, truncated }) => ({
              id,
              libraryId: sourceId,
              path,
              title,
              sectionId,
              sectionTitle,
              paragraph,
              truncated
            })
          )
          output(opts, { total: result.total, nextOffset: result.nextOffset, hits }, (v) =>
            v.hits.map((h) => `${h.id}  ${h.path}  ${h.sectionTitle}\n${h.paragraph}`).join('\n\n')
          )
        }
      }
    )

  jsonOption(
    program.command('read <targets...>').description('按目录树顺序读取文档 ID 或多个子树路径')
  )
    .option('--library <lib>', '指定文档库')
    .option('--section <id>', '只读指定小节')
    .option('--offset <n>', '正文起始字符', natural)
    .option('--max-chars <n>', '每篇最多读取字符数', positive)
    .action(
      async (
        targets: string[],
        opts: OutputOptions & {
          library?: string
          section?: string
          offset?: number
          maxChars?: number
        }
      ) => {
        const docs = await withRuntime((r) =>
          r.readDocuments({
            targets,
            libraryId: libraryId(r, opts.library),
            sectionId: opts.section,
            offset: opts.offset,
            maxCharsPerFile: opts.maxChars
          })
        )
        output(
          opts,
          docs.map(
            ({ id, sourceId, title, path, url, content, offset, nextOffset, totalChars }) => ({
              id,
              libraryId: sourceId,
              title,
              path,
              url,
              content,
              offset,
              nextOffset,
              totalChars
            })
          ),
          (items) =>
            items.length > 1
              ? items
                  .map((d) => `${d.title}\nURL: ${d.url}\n路径: ${d.path}\n\n${d.content}`)
                  .join('\n\n---\n\n')
              : (items[0]?.content ?? '')
        )
      }
    )
}
