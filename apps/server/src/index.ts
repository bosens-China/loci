import { mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { AdminAuth } from './auth.js'
import { createApp } from './app.js'
import { ServerDatabase } from './database.js'
import { createPublicFetch } from './public-fetch.js'
import { SyncService } from './sync-service.js'

const dataDirectory = resolve(process.env.LOCI_DATA_DIR ?? './data')
const adminUsername = process.env.LOCI_ADMIN_USERNAME ?? 'admin'
const adminPassword = process.env.LOCI_ADMIN_PASSWORD
const port = Number(process.env.PORT ?? 7001)
const browserEndpoint = readBrowserEndpoint()

if (!adminPassword) throw new Error('请设置 LOCI_ADMIN_PASSWORD')
if (!Number.isInteger(port) || port < 1 || port > 65_535) throw new Error('PORT 无效')

mkdirSync(dataDirectory, { recursive: true })
const database = new ServerDatabase(join(dataDirectory, 'loci-server.sqlite'))
const sync = new SyncService(database, createPublicFetch(), browserEndpoint)
const app = createApp({ database, sync, auth: new AdminAuth(adminUsername, adminPassword) })
sync.restoreSchedules()

const server = serve({ fetch: app.fetch, port })
console.log(`Loci Server 已启动：http://0.0.0.0:${port}`)

function shutdown(): void {
  sync.close()
  server.close((error) => {
    database.close()
    if (error) {
      console.error(error)
      process.exit(1)
    }
    process.exit(0)
  })
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

function readBrowserEndpoint(): string | undefined {
  const baseUrl = process.env.LOCI_BROWSER_URL
  const token = process.env.LOCI_BROWSER_TOKEN
  if (!baseUrl && !token) return undefined
  if (!baseUrl || !token) throw new Error('LOCI_BROWSER_URL 和 LOCI_BROWSER_TOKEN 必须同时设置')
  const endpoint = new URL(baseUrl)
  if (!['ws:', 'wss:'].includes(endpoint.protocol)) {
    throw new Error('LOCI_BROWSER_URL 必须使用 ws 或 wss')
  }
  endpoint.searchParams.set('token', token)
  return endpoint.toString()
}
