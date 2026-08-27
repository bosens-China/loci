export interface DocumentSearch {
  source?: string
  doc?: string
  q?: string
  document?: string
}

export interface CanonicalDocumentSearch {
  source?: string
  doc?: string
  q?: string
}

/** Router 会 JSON 解析查询值；这里恢复原有 URLSearchParams 的字符串语义。 */
export function parseDocumentSearch(search: Record<string, unknown>): DocumentSearch {
  return {
    source: optionalString(search.source),
    doc: optionalString(search.doc),
    q: optionalString(search.q),
    document: optionalString(search.document)
  }
}

/** 旧 document 参数只在入口兼容，所有后续导航都写回规范 doc 参数。 */
export function canonicalDocumentSearch(search: DocumentSearch): CanonicalDocumentSearch {
  return compactSearch({
    source: search.source,
    doc: search.doc ?? search.document,
    q: search.q
  })
}

function optionalString(value: unknown): string | undefined {
  if (typeof value === 'string') return value || undefined
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  return undefined
}

function compactSearch(search: CanonicalDocumentSearch): CanonicalDocumentSearch {
  return Object.fromEntries(
    Object.entries(search).filter(([, value]) => value !== undefined && value !== '')
  ) as CanonicalDocumentSearch
}
