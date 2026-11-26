import type { DatabaseSync } from 'node:sqlite'
import { DEFAULT_LIBRARY_CATEGORY, type CategorySummary } from '@loci/shared'
import { count, eq } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { categories, documentSources } from './drizzle-schema.js'
import { withImmediateTransaction } from './sqlite.js'

const defaults = [
  DEFAULT_LIBRARY_CATEGORY,
  '前端',
  '后端',
  'AI',
  '数据库',
  '运维与云原生',
  '移动端',
  '工具与其他'
]

/** 在调用方的写事务中插入，重复创建保留原创建时间。 */
export function ensureCategory(db: LociDrizzleDatabase, name: string): void {
  const order = defaults.indexOf(name)
  db.insert(categories)
    .values({ name, sortOrder: order < 0 ? 100 : order - 1, createdAt: new Date().toISOString() })
    .onConflictDoNothing()
    .run()
}

export function seedCategories(db: LociDrizzleDatabase): void {
  for (const name of defaults) ensureCategory(db, name)
}

function categoryName(input: string): string {
  const name = input.trim()
  if (!name) throw new Error('分类名称不能为空')
  return name
}

export function createCategoryDatabase(database: DatabaseSync, db: LociDrizzleDatabase) {
  const summaries = (name?: string): CategorySummary[] =>
    db
      .select({
        name: categories.name,
        createdAt: categories.createdAt,
        libraryCount: count(documentSources.id)
      })
      .from(categories)
      .leftJoin(documentSources, eq(categories.name, documentSources.category))
      .where(name === undefined ? undefined : eq(categories.name, name))
      .groupBy(categories.name)
      .orderBy(categories.sortOrder, categories.name)
      .all()
      .map((row) => ({ ...row, isDefault: defaults.includes(row.name) }))
  return {
    listCategories: () => summaries(),
    createCategory: (input: string) =>
      withImmediateTransaction(database, () => {
        const name = categoryName(input)
        ensureCategory(db, name)
        return summaries(name)[0]!
      }),
    deleteCategory: (input: string) =>
      withImmediateTransaction(database, () => {
        const name = categoryName(input)
        if (name === DEFAULT_LIBRARY_CATEGORY) throw new Error(`不能删除默认分类「${name}」`)
        db.update(documentSources)
          .set({ category: DEFAULT_LIBRARY_CATEGORY })
          .where(eq(documentSources.category, name))
          .run()
        return db.delete(categories).where(eq(categories.name, name)).run().changes > 0
      })
  }
}

export type CategoryDatabase = ReturnType<typeof createCategoryDatabase>
