import {
  normalizeHostnamePolicyInput,
  normalizePolicyHostname,
  type HostnameCrawlPolicy,
  type SaveHostnameCrawlPolicyInput
} from '@loci/shared'
import { eq } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { hostnameCrawlPolicies } from './drizzle-schema.js'

export interface HostnameCrawlPolicyDatabase {
  listHostnameCrawlPolicies: () => HostnameCrawlPolicy[]
  getHostnameCrawlPolicy: (hostname: string) => HostnameCrawlPolicy | undefined
  saveHostnameCrawlPolicy: (input: SaveHostnameCrawlPolicyInput) => HostnameCrawlPolicy
  deleteHostnameCrawlPolicy: (hostname: string) => boolean
}

export function createHostnameCrawlPolicyDatabase(
  database: LociDrizzleDatabase
): HostnameCrawlPolicyDatabase {
  const get = (hostname: string): HostnameCrawlPolicy | undefined =>
    database
      .select()
      .from(hostnameCrawlPolicies)
      .where(eq(hostnameCrawlPolicies.hostname, normalizePolicyHostname(hostname)))
      .get()

  return {
    listHostnameCrawlPolicies: () =>
      database.select().from(hostnameCrawlPolicies).orderBy(hostnameCrawlPolicies.hostname).all(),
    getHostnameCrawlPolicy: get,
    saveHostnameCrawlPolicy: (input) => {
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
    deleteHostnameCrawlPolicy: (hostname) =>
      database
        .delete(hostnameCrawlPolicies)
        .where(eq(hostnameCrawlPolicies.hostname, normalizePolicyHostname(hostname)))
        .run().changes > 0
  }
}
