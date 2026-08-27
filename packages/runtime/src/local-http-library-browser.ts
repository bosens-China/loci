import type { IncomingMessage, ServerResponse } from 'node:http'
import { buildUrlTree, getUrlTreeSlice } from '@loci/shared'
import type { LocalRuntime } from './local-runtime.js'
import { json } from './local-http-response.js'

export function handleLibraryBrowser(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): boolean {
  const tree = /^\/api\/libraries\/([^/]+)\/tree$/u.exec(url.pathname)
  if (request.method === 'GET' && tree) {
    const libraryId = decodeURIComponent(tree[1]!)
    const source = runtime.database.listSources().find((item) => item.id === libraryId)
    if (!source) json(response, 404, { error: '文档库不存在' })
    else {
      const files = runtime.database.listDocumentSummaries(libraryId)
      const parentId = url.searchParams.get('parent_id') ?? undefined
      const depth = integerParam(url, 'depth', 1, 1, 5)
      const nodes = getUrlTreeSlice(buildUrlTree(files, libraryId), parentId, depth)
      if (!nodes) json(response, 404, { error: '目录节点不存在' })
      else json(response, 200, { libraryId, title: source.name, parentId: parentId ?? null, nodes })
    }
    return true
  }
  const files = /^\/api\/libraries\/([^/]+)\/files$/u.exec(url.pathname)
  if (request.method === 'GET' && files) {
    const libraryId = decodeURIComponent(files[1]!)
    const offset = integerParam(url, 'offset', 0, 0, 1_000_000)
    const limit = integerParam(url, 'limit', 100, 1, 500)
    const items = runtime.database.listDocumentSummaries(libraryId)
    json(response, 200, { total: items.length, items: items.slice(offset, offset + limit) })
    return true
  }
  const file = /^\/api\/libraries\/([^/]+)\/files\/([^/]+)$/u.exec(url.pathname)
  if (request.method === 'GET' && file) {
    const libraryId = decodeURIComponent(file[1]!)
    const document = runtime.database.getDocument(decodeURIComponent(file[2]!))
    if (!document || document.sourceId !== libraryId)
      json(response, 404, { error: '文档文件不存在' })
    else {
      const offset = integerParam(url, 'offset', 0, 0, document.content.length)
      const maxChars = integerParam(url, 'max_chars', 20_000, 1_000, 50_000)
      const end = Math.min(document.content.length, offset + maxChars)
      json(response, 200, {
        file: {
          id: document.id,
          libraryId,
          title: document.title,
          url: document.url,
          path: document.folder,
          language: document.language,
          updatedAt: document.updatedAt,
          content: document.content.slice(offset, end),
          offset,
          ...(end < document.content.length ? { nextOffset: end } : {}),
          totalChars: document.content.length,
          truncated: end < document.content.length
        }
      })
    }
    return true
  }
  return false
}

function integerParam(url: URL, key: string, fallback: number, min: number, max: number): number {
  const raw = url.searchParams.get(key)
  if (raw === null) return fallback
  const value = Number(raw)
  return Number.isInteger(value) && value >= min && value <= max ? value : fallback
}
