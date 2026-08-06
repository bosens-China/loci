import type { DocumentRecord, DocumentSource } from '@loci/shared'
import type { CliRuntime } from './runtime.js'
import { CliError } from './errors.js'
import { readRecentResource } from './preferences.js'
import { askSearch, askSelect } from './ui.js'

export async function resolveSource(
  runtime: CliRuntime,
  reference: string | undefined,
  options: { localOnly?: boolean; message?: string; preferenceKey?: string } = {}
): Promise<DocumentSource> {
  const sources = runtime.database
    .listSources()
    .filter((source) => !options.localOnly || source.cloud === null)
  if (sources.length === 0)
    throw new CliError(options.localOnly ? '还没有本地文档源' : '还没有文档源')
  if (reference) {
    const matches = sources.filter(
      (source) =>
        source.id === reference || source.id.startsWith(reference) || source.name === reference
    )
    if (matches.length === 1) return matches[0]!
    if (matches.length === 0) throw new CliError(`找不到文档源：${reference}`, 2)
  }
  if (sources.length === 1) return sources[0]!
  const remembered = options.preferenceKey
    ? readRecentResource(runtime.database, options.preferenceKey)
    : undefined
  const initialValue = sources.some((source) => source.id === remembered) ? remembered : undefined
  const id = await askSelect(
    options.message ?? '请选择文档源',
    sources.map((source) => ({
      value: source.id,
      label: `${source.name}（${source.pages} 页）`,
      hint: source.cloud ? '云端副本' : source.url
    })),
    initialValue
  )
  return sources.find((source) => source.id === id)!
}

export async function resolveDocument(
  runtime: CliRuntime,
  reference: string | undefined
): Promise<DocumentRecord> {
  const documents = runtime.database.listDocuments()
  if (documents.length === 0) throw new CliError('知识库中还没有文档')
  if (reference) {
    const matches = documents.filter(
      (document) =>
        document.id === reference ||
        document.id.startsWith(reference) ||
        document.url === reference ||
        document.title === reference
    )
    if (matches.length === 1) return matches[0]!
    if (matches.length === 0) throw new CliError(`找不到文档：${reference}`, 2)
  }
  if (documents.length === 1) return documents[0]!
  const remembered = readRecentResource(runtime.database, 'document-read')
  const initialValue = documents.some((document) => document.id === remembered)
    ? remembered
    : undefined
  const id = await askSearch(
    '搜索并选择文档',
    documents.map((document) => ({
      value: document.id,
      label: document.title,
      hint: `${document.sourceName} · ${new URL(document.url).pathname}`
    })),
    '输入标题、文档源或路径',
    initialValue
  )
  return documents.find((document) => document.id === id)!
}
