import type { DocumentSummary, DocumentSource } from '@loci/shared'
import { documentPath } from '@loci/shared'
import { CliError } from './errors.js'
import type { CliRuntime } from './runtime.js'

/** 短 ID 或同名结果必须唯一，防止有歧义的选择进入写操作。 */
export function library(runtime: CliRuntime, reference: string): DocumentSource {
  if (!reference.trim()) throw new CliError('文档库名称或 ID 不能为空', 2)
  const sources = runtime.listLibraries()
  const exact = sources.find((source) => source.id === reference)
  if (exact) return exact
  let matches = sources.filter(
    (source) => source.name === reference || source.id.startsWith(reference)
  )
  if (matches.length === 0) {
    // 使用每个候选的完整版本后缀，以兼容库名和版本中都出现 @。
    matches = sources.filter((source) => {
      const suffix = `@${source.version}`
      if (!reference.endsWith(suffix) || reference.length === suffix.length) return false
      const base = reference.slice(0, -suffix.length)
      return source.name === base || source.id.startsWith(base)
    })
  }
  if (!matches.length) throw new CliError(`未找到文档库：${reference}`, 2)
  if (matches.length > 1) {
    const candidates = matches.map((source) => `${source.name}@${source.version}（${source.id}）`)
    throw new CliError(`文档库名称或短 ID 不唯一：${reference}。候选：${candidates.join('、')}`, 2)
  }
  return matches[0]!
}

export function libraryId(runtime: CliRuntime, reference?: string): string | undefined {
  return reference === undefined ? undefined : library(runtime, reference).id
}

export function documentId(runtime: CliRuntime, reference: string, source?: string): string {
  if (reference.startsWith('/')) throw new CliError('请指定单篇文档的 ID 或短 ID', 2)
  return runtime.readDocuments({
    libraryId: libraryId(runtime, source),
    targets: reference,
    maxCharsPerFile: 1
  })[0]!.id
}

export function documentSummary(doc: DocumentSummary) {
  return { id: doc.id, title: doc.title, path: documentPath(doc), language: doc.language }
}
