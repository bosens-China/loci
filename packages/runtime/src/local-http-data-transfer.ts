import type { IncomingMessage, ServerResponse } from 'node:http'
import { inspectPersistentBackgroundRequirements } from './background-requirements.js'
import type { LocalApiOptions } from './local-http-api.js'
import type { LocalRuntime } from './local-runtime.js'
import { json, mutationJson, readBuffer, safeClientError } from './local-http-response.js'
import { acquireMaintenanceRuntimeLock } from './runtime-lock.js'

const BACKUP_LIMIT_BYTES = 512 * 1024 * 1024

export async function handleDataTransfer(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL,
  options: LocalApiOptions
): Promise<boolean> {
  if (request.method === 'GET' && url.pathname === '/api/data/export') {
    try {
      const archive = await runMaintenance(runtime, options, () =>
        runtime.database.exportBackupArchive()
      )
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
      const archive = await readBuffer(request, BACKUP_LIMIT_BYTES)
      const summary = await runMaintenance(runtime, options, async () => {
        const imported = await runtime.database.importBackupArchive(archive)
        runtime.resetCrawlStates()
        runtime.database.refreshSourceSchedules()
        return imported
      })
      let backgroundError: string | null = null
      if (inspectPersistentBackgroundRequirements(runtime.database.listSources()).required) {
        try {
          await options.ensurePersistentBackground?.()
        } catch (error) {
          backgroundError = safeClientError(error)
        }
      }
      return { ...summary, backgroundError }
    })
    return true
  }
  return false
}

async function runMaintenance<T>(
  runtime: LocalRuntime,
  options: LocalApiOptions,
  action: () => T | Promise<T>
): Promise<T> {
  const run = async (): Promise<T> => {
    const lock = acquireMaintenanceRuntimeLock(runtime.dataDir, 'Web 数据维护')
    try {
      return await action()
    } finally {
      lock.release()
    }
  }
  return options.runMaintenance ? options.runMaintenance(run) : run()
}
