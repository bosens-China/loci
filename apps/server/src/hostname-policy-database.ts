import {
  normalizeHostnamePolicyInput,
  normalizePolicyHostname,
  type HostnameCrawlPolicy,
  type SaveHostnameCrawlPolicyInput
} from '@loci/shared'
import { eq } from 'drizzle-orm'
import type { ServerDrizzleDatabase } from './drizzle-database.js'
import { hostnameCrawlPolicies } from './drizzle-schema.js'

export interface ServerHostnamePolicyDatabase {
  list: () => HostnameCrawlPolicy[]
  get: (hostname: string) => HostnameCrawlPolicy | undefined
  save: (input: SaveHostnameCrawlPolicyInput) => HostnameCrawlPolicy
  delete: (hostname: string) => boolean
}

export function createServerHostnamePolicyDatabase(
  database: ServerDrizzleDatabase
): ServerHostnamePolicyDatabase {
  const get = (hostname: string): HostnameCrawlPolicy | undefined =>
    database
      .select()
      .from(hostnameCrawlPolicies)
      .where(eq(hostnameCrawlPolicies.hostname, normalizePolicyHostname(hostname)))
      .get()

  return {
    list: () =>
      database.select().from(hostnameCrawlPolicies).orderBy(hostnameCrawlPolicies.hostname).all(),
    get,
    save: (input) => {
      const normalized = normalizeHostnamePolicyInput(input)
      const updatedAt = new Date().toISOString()
      database
        .insert(hostnameCrawlPolicies)
        .values({ ...normalized, updatedAt })
        .onConflictDoUpdate({
          target: hostnameCrawlPolicies.hostname,
          set: { ...normalized, updatedAt }
        })
        .run()
      const saved = get(normalized.hostname)
      if (!saved) throw new Error('域名抓取策略保存失败')
      return saved
    },
    delete: (hostname) =>
      database
        .delete(hostnameCrawlPolicies)
        .where(eq(hostnameCrawlPolicies.hostname, normalizePolicyHostname(hostname)))
        .run().changes > 0
  }
}
