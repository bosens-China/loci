import { z } from 'zod'
import {
  getSourceScopeOptions,
  normalizeServerUrl,
  type AgentClient,
  type FetchMode
} from '@loci/shared'
import type { LociDatabase } from '@loci/runtime'

const sourceCreateSchema = z.object({
  mode: z.enum(['auto', 'http', 'browser']),
  pageLimit: z.number().int().min(1).max(10_000),
  scopeDepth: z.number().int().nonnegative(),
  syncAfterCreate: z.boolean()
})

const adminCreateSchema = z.object({
  pageLimit: z.number().int().min(1).max(10_000),
  scopeDepth: z.number().int().nonnegative(),
  schedule: z.string().nullable()
})

const mcpConfigureSchema = z.object({
  client: z.enum(['codex', 'cursor', 'vscode', 'claude-code']),
  transport: z.enum(['stdio', 'http'])
})

export interface SourceCreatePreference {
  mode: FetchMode
  pageLimit: number
  scopeDepth: number
  syncAfterCreate: boolean
}

export interface AdminCreatePreference {
  pageLimit: number
  scopeDepth: number
  schedule: string | null
}

export interface McpConfigurePreference {
  client: AgentClient
  transport: 'stdio' | 'http'
}

const CLI_SCOPE = 'cli'

export function readSourceCreatePreference(database: LociDatabase): SourceCreatePreference {
  return readPreference(database, CLI_SCOPE, 'source-create', sourceCreateSchema, {
    mode: 'auto',
    pageLimit: 1000,
    scopeDepth: 0,
    syncAfterCreate: true
  })
}

export function saveSourceCreatePreference(
  database: LociDatabase,
  preference: SourceCreatePreference
): void {
  database.setInteractionPreference(CLI_SCOPE, 'source-create', preference)
}

export function readAdminCreatePreference(
  database: LociDatabase,
  serverUrl: string
): AdminCreatePreference {
  return readPreference(database, adminScope(serverUrl), 'create', adminCreateSchema, {
    pageLimit: 1000,
    scopeDepth: 0,
    schedule: null
  })
}

export function saveAdminCreatePreference(
  database: LociDatabase,
  serverUrl: string,
  preference: AdminCreatePreference
): void {
  database.setInteractionPreference(adminScope(serverUrl), 'create', preference)
}

export function readAdminUsername(database: LociDatabase, serverUrl: string): string | undefined {
  const value = database.getInteractionPreference(adminScope(serverUrl), 'username')
  return typeof value === 'string' && value.trim() ? value : undefined
}

export function saveAdminUsername(
  database: LociDatabase,
  serverUrl: string,
  username: string
): void {
  database.setInteractionPreference(adminScope(serverUrl), 'username', username.trim())
}

export function readAdminSyncSelection(database: LociDatabase, serverUrl: string): string[] {
  const value = database.getInteractionPreference(adminScope(serverUrl), 'sync-selection')
  const parsed = z.array(z.string().min(1)).safeParse(value)
  return parsed.success ? parsed.data : []
}

export function saveAdminSyncSelection(
  database: LociDatabase,
  serverUrl: string,
  libraryIds: readonly string[]
): void {
  database.setInteractionPreference(adminScope(serverUrl), 'sync-selection', [...libraryIds])
}

export function readRecentResource(database: LociDatabase, key: string): string | undefined {
  const value = database.getInteractionPreference(CLI_SCOPE, `recent:${key}`)
  return typeof value === 'string' && value ? value : undefined
}

export function saveRecentResource(database: LociDatabase, key: string, id: string): void {
  database.setInteractionPreference(CLI_SCOPE, `recent:${key}`, id)
}

export function readMcpConfigurePreference(database: LociDatabase): McpConfigurePreference {
  return readPreference(database, CLI_SCOPE, 'mcp-configure', mcpConfigureSchema, {
    client: 'codex',
    transport: 'stdio'
  })
}

export function saveMcpConfigurePreference(
  database: LociDatabase,
  preference: McpConfigurePreference
): void {
  database.setInteractionPreference(CLI_SCOPE, 'mcp-configure', preference)
}

export function scopeAtDepth(url: string, depth: number): string {
  const options = getSourceScopeOptions(url)
  return options[Math.min(depth, Math.max(0, options.length - 1))]?.value ?? '/'
}

export function scopeDepth(url: string, scopePath: string): number {
  const index = getSourceScopeOptions(url).findIndex((option) => option.value === scopePath)
  return Math.max(0, index)
}

function adminScope(serverUrl: string): string {
  return `cli:admin:${normalizeServerUrl(serverUrl)}`
}

function readPreference<T>(
  database: LociDatabase,
  scope: string,
  key: string,
  schema: z.ZodType<T>,
  fallback: T
): T {
  const parsed = schema.safeParse(database.getInteractionPreference(scope, key))
  return parsed.success ? parsed.data : fallback
}
