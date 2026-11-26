import type { DatabaseSync } from 'node:sqlite'
import { parseGithubRepositoryUrl } from '@loci/core'
import { DEFAULT_LIBRARY_CATEGORY, DEFAULT_LIBRARY_VERSION } from '@loci/shared'
import { ensureCategory, seedCategories } from './category-database.js'
import type { LociBackup } from './database-backup-schema.js'
import { createWebSourceIdentity } from './database-local-source.js'
import { createDrizzleDatabase } from './drizzle-database.js'
import { categories, documentSources } from './drizzle-schema.js'

function normalizeSource(source: LociBackup['data']['sources'][number]) {
  const repository = parseGithubRepositoryUrl(source.first_url)
  return {
    ...source,
    document_kind: source.document_kind ?? (repository ? 'github' : 'web'),
    source_identity:
      source.source_type === 'cloud'
        ? (source.source_identity ?? null)
        : source.source_identity?.trim() ||
          repository?.identity ||
          createWebSourceIdentity(source.hostname, source.scope_path ?? '/'),
    category: source.category?.trim() || DEFAULT_LIBRARY_CATEGORY,
    version: source.version?.trim() || DEFAULT_LIBRARY_VERSION
  }
}

/** 匹配键与两类来源各自的唯一约束一致。 */
function sourceKey(
  type: 'local' | 'cloud',
  local: [string | null, string],
  snapshot: [string | null | undefined, string | null | undefined]
): string {
  return JSON.stringify([type, ...(type === 'local' ? local : snapshot)])
}

/** 先用完整快照计算所有匹配项，避免新恢复的库在同一批次中被再次删除。调用方持有写事务。 */
export function prepareBackupImport(
  database: DatabaseSync,
  backup: LociBackup,
  replaceAll: boolean
) {
  const db = createDrizzleDatabase(database)
  const categoryNames = () =>
    db
      .select({ name: categories.name })
      .from(categories)
      .all()
      .map((row) => row.name)
  const beforeCategories = new Set(categoryNames())
  const sources = backup.data.sources.map(normalizeSource)
  const incomingIds = new Set(sources.map((source) => source.id))
  const incomingKeys = new Map<string, string[]>()
  for (const source of sources) {
    const key = sourceKey(
      source.source_type ?? 'local',
      [source.source_identity, source.version],
      [source.cloud_server_url, source.cloud_library_id]
    )
    const ids = incomingKeys.get(key) ?? []
    ids.push(source.id)
    incomingKeys.set(key, ids)
  }
  const local = db
    .select({
      id: documentSources.id,
      type: documentSources.sourceType,
      identity: documentSources.sourceIdentity,
      version: documentSources.version,
      server: documentSources.cloudServerUrl,
      library: documentSources.cloudLibraryId
    })
    .from(documentSources)
    .all()
  const matchedIds: string[] = []
  const replaced = new Set<string>()
  for (const row of local) {
    const matching =
      incomingKeys.get(
        sourceKey(row.type, [row.identity, row.version], [row.server, row.library])
      ) ?? []
    const sameId = incomingIds.has(row.id)
    if (sameId || matching.length) matchedIds.push(row.id)
    if (sameId) replaced.add(row.id)
    for (const id of matching) replaced.add(id)
  }
  // FTS5 和历史移动回执没有外键，其余正文、显式页与运行记录由 SQLite 级联清理。
  if (replaceAll) {
    database.exec(
      'DELETE FROM documents_fts; DELETE FROM document_sources; DELETE FROM categories; DELETE FROM document_move_operations'
    )
    if (backup.data.settings) database.exec('DELETE FROM hostname_crawl_policies')
  } else {
    const deleteIndex = database.prepare('DELETE FROM documents_fts WHERE source_id = ?')
    const deleteSource = database.prepare('DELETE FROM document_sources WHERE id = ?')
    const deleteMoves = database.prepare(
      'DELETE FROM document_move_operations WHERE target_source_id = ?'
    )
    for (const id of matchedIds) {
      deleteIndex.run(id)
      deleteMoves.run(id)
      deleteSource.run(id)
    }
  }
  const insert = database.prepare(
    'INSERT INTO categories(name, sort_order, created_at) VALUES (?, ?, ?) ON CONFLICT(name) DO NOTHING'
  )
  for (const row of backup.data.categories ?? [])
    insert.run(row.name, row.sort_order, row.created_at)
  if (replaceAll && !backup.data.categories) seedCategories(db)
  ensureCategory(db, DEFAULT_LIBRARY_CATEGORY)
  for (const category of new Set(sources.map((source) => source.category)))
    ensureCategory(db, category)
  return {
    sources,
    replacedLibraries: replaced.size,
    categoriesCreated: categoryNames().filter((name) => !beforeCategories.has(name)).length
  }
}
