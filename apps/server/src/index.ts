import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { AdminAuth } from './auth.js'
import { createApp } from './app.js'
import { readBrowserConfig } from './browser-config.js'
import { ServerDatabase } from './database.js'
import { createPublicFetch } from './public-fetch.js'
import { SyncService } from './sync-service.js'

const dataDirectory = resolve(process.env.LOCI_DATA_DIR ?? './data')
const adminUsername = process.env.LOCI_ADMIN_USERNAME ?? 'admin'
const adminPassword = process.env.LOCI_ADMIN_PASSWORD
const port = Number(process.env.PORT ?? 7001)
const browserConfig = readBrowserConfig()

if (!adminPassword) throw new Error('请设置 LOCI_ADMIN_PASSWORD')
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT 无效')

mkdirSync(dataDirectory, { recursive: true })
const database = new ServerDatabase(join(dataDirectory, 'loci-server.sqlite'))
const sync = new SyncService(database, createPublicFetch(), browserConfig)
const app = createApp({ database, sync, auth: new AdminAuth(adminUsername, adminPassword) })
sync.restoreSchedules()

const server = serve({ fetch: app.fetch, port })
console.log(`Loci Server 已启动：http://0.0.0.0:${port}`)

let shuttingDown = false

async function shutdown(): Promise<void> {
  if (shuttingDown) return
  shuttingDown = true
  const syncClosed = sync.close()
  const closeError = await new Promise<Error | undefined>((resolveClose) => {
    server.close((error) => resolveClose(error))
  })
  await syncClosed
  database.close()
  if (closeError) console.error(closeError)
  process.exit(closeError ? 1 : 0)
}

process.on('SIGINT', () => void shutdown())
process.on('SIGTERM', () => void shutdown())
