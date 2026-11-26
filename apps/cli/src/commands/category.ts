import type { Command } from 'commander'
import { jsonOption, output, withRuntime, type OutputOptions } from '../command-runtime.js'
import { confirmWrite } from '../ui.js'

/** 分类命令只负责交互，计数和关联更新由 Runtime 完成。 */
export function registerCategoryCommands(program: Command): void {
  const category = jsonOption(
    program.command('category').description('管理文档库分类')
  ).enablePositionalOptions()
  const list = async (opts: OutputOptions) => {
    const rows = await withRuntime((runtime) => runtime.listCategories())
    output(opts, rows, (items) =>
      items.map((item) => `${item.name}\t${item.libraryCount} 个库`).join('\n')
    )
  }
  category.action(list)
  jsonOption(category.command('list').description('列出分类及文档库数量')).action(list)
  jsonOption(category.command('add <name>').description('创建分类')).action(
    async (name: string, opts: OutputOptions) => {
      const result = await withRuntime((runtime) => runtime.createCategory(name))
      output(opts, result, (item) => `${item.name}\t${item.libraryCount} 个库`)
    }
  )
  jsonOption(category.command('delete <name>').description('删除分类并清除文档库关联'))
    .option('--yes', '跳过确认')
    .action(async (name: string, opts: OutputOptions & { yes?: boolean }) => {
      await confirmWrite(`删除分类「${name}」并将关联文档库设为未分类？`, opts.yes)
      const deleted = await withRuntime((runtime) => runtime.deleteCategory(name))
      output(opts, { deleted }, () => (deleted ? `已删除分类 ${name}` : `分类 ${name} 不存在`))
    })
}
