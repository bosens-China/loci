import { readFile } from 'node:fs/promises'
import { Option, type Command } from 'commander'
import type { EditDocumentSectionInput } from '@loci/shared'
import {
  jsonOption,
  output,
  positive,
  withRuntime,
  type OutputOptions
} from '../command-runtime.js'
import { documentId, documentSummary, library } from '../resources.js'
import { confirmWrite } from '../ui.js'

interface DocOptions extends OutputOptions {
  library?: string
  title?: string
  file?: string
  content?: string
  language?: string
  yes?: boolean
}
function contentOptions(command: Command): Command {
  return jsonOption(command)
    .addOption(new Option('--content <md>', 'Markdown 正文').conflicts('file'))
    .option('--file <file>', '从 UTF-8 文件读取正文')
}
async function content(opts: DocOptions): Promise<string | undefined> {
  return opts.file === undefined ? opts.content : readFile(opts.file, 'utf8')
}

/** 文档内容与小节写入交由运行时完成索引同步、操作去重和锁管理。 */
export function registerEditCommands(program: Command): void {
  const doc = program.command('doc').description('创建、修改文档或编辑 Markdown 小节')
  contentOptions(doc.command('create <library>').description('创建文档'))
    .requiredOption('--title <title>', '标题')
    .requiredOption('--path <path>', '文档逻辑路径')
    .option('--language <lang>', '语言')
    .action(async (ref: string, opts: DocOptions & { title: string; path: string }) => {
      const markdown = (await content(opts)) ?? ''
      const record = await withRuntime((r) =>
        r.createDocument(library(r, ref).id, {
          title: opts.title,
          path: opts.path,
          language: opts.language,
          content: markdown
        })
      )
      output(opts, documentSummary(record))
    })
  contentOptions(doc.command('update <doc>').description('修改文档'))
    .option('--library <lib>', '限定文档库')
    .option('--title <title>', '标题')
    .option('--language <lang>', '语言')
    .option('--yes', '跳过覆盖正文确认')
    .action(async (ref: string, opts: DocOptions) => {
      const markdown = await content(opts)
      if (markdown !== undefined) await confirmWrite(`覆盖文档「${ref}」的全文？`, opts.yes)
      const record = await withRuntime((r) =>
        r.updateDocument(documentId(r, ref, opts.library), {
          title: opts.title,
          language: opts.language,
          content: markdown
        })
      )
      output(opts, documentSummary(record))
    })
  jsonOption(doc.command('sections <doc>').description('列出文档小节'))
    .option('--library <lib>', '限定文档库')
    .action(async (ref: string, opts: DocOptions) => {
      const sections = await withRuntime((r) =>
        r.listDocumentSections(documentId(r, ref, opts.library))
      )
      output(
        opts,
        sections.map(({ id, title, level, charCount }) => ({ id, title, level, charCount }))
      )
    })
  contentOptions(doc.command('section <doc>').description('增删改文档小节'))
    .addOption(
      new Option('--action <action>', '小节操作')
        .choices(['add', 'update', 'delete'])
        .makeOptionMandatory()
    )
    .option('--library <lib>', '限定文档库')
    .option('--section <id>', '目标小节 ID')
    .option('--heading <h>', '小节标题')
    .option('--level <n>', '标题层级', positive)
    .option('--operation-id <id>', '重试同一操作时复用该 ID')
    .option('--yes', '跳过删除或覆盖正文确认')
    .action(
      async (ref: string, opts: DocOptions & EditDocumentSectionInput & { section?: string }) => {
        const markdown = await content(opts)
        if (opts.action === 'delete' || (opts.action === 'update' && markdown !== undefined)) {
          const action = opts.action === 'delete' ? '删除' : '覆盖'
          await confirmWrite(`${action}文档「${ref}」的小节「${opts.section ?? ''}」？`, opts.yes)
        }
        const record = await withRuntime((r) =>
          r.editDocumentSection(documentId(r, ref, opts.library), {
            action: opts.action,
            sectionId: opts.section,
            heading: opts.heading,
            level: opts.level,
            content: markdown,
            operationId: opts.operationId
          })
        )
        output(opts, documentSummary(record))
      }
    )

  jsonOption(program.command('delete <library>').description('删除文档库，或只删除指定文档及子树'))
    .option('--doc <targets...>', '文档 ID 或子树路径')
    .option('--yes', '跳过确认')
    .action(async (ref: string, opts: OutputOptions & { doc?: string[]; yes?: boolean }) => {
      const result = await withRuntime(async (r) => {
        const source = library(r, ref)
        await confirmWrite(
          opts.doc
            ? `从 ${source.name} 删除 ${opts.doc.join('、')}？`
            : `删除整个文档库 ${source.name}？`,
          opts.yes
        )
        if (opts.doc) return { libraryId: source.id, ...r.deleteDocuments(source.id, opts.doc) }
        r.deleteLibrary(source.id)
        return { libraryId: source.id, deleted: true }
      })
      output(opts, result)
    })
}
