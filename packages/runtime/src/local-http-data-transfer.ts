import type { IncomingMessage, ServerResponse } from 'node:http'
import { z } from 'zod'
import type { LocalRuntime } from './local-runtime.js'
import { json, mutationJson, readBuffer, readJson, safeClientError } from './local-http-response.js'

const BACKUP_LIMIT_BYTES = 512 * 1024 * 1024
const clearInput = z.strictObject({ scope: z.enum(['documents', 'sources']) })

export async function handleDataTransfer(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  reset: () => void
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/data/counts') {
    json(response, 200, runtime.getClearDataCounts())
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/data/clear') {
    await mutationJson(response, 200, async () => {
      const { scope } = clearInput.parse(await readJson(request))
      const summary = await runtime.clearData(scope)
      reset()
      return summary
    })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/data/export') {
    try {
      const archive = await runtime.exportBackupArchive({
        categories: url.searchParams.has('category')
          ? url.searchParams.getAll('category')
          : undefined,
        libraryIds: url.searchParams.has('library') ? url.searchParams.getAll('library') : undefined
      })
      response
        .writeHead(200, {
          'content-type': 'application/zip',
          'content-length': String(archive.length),
          'content-disposition': `attachment; filename="loci-backup-${new Date().toISOString().slice(0, 10)}.zip"`
        })
        .end(archive)
    } catch (error) {
      json(response, 409, { error: safeClientError(error) })
    }
    return true
  }
  if (request.method === 'POST' && url.pathname === '/api/data/import') {
    await mutationJson(response, 200, async () => {
      const mode = url.searchParams.get('mode') ?? 'merge'
      if (mode !== 'merge' && mode !== 'replace') throw new Error('导入模式必须为 merge 或 replace')
      const archive = await readBuffer(request, BACKUP_LIMIT_BYTES)
      const summary = await runtime.importBackupArchive(archive, { replaceAll: mode === 'replace' })
      reset()
      return summary
    })
    return true
  }
  return false
}
