import { z } from 'zod'
import { normalizeServerUrl, type McpClient } from '@loci/shared'
import type { LociDatabase } from '@loci/runtime'

const mcpConfigureSchema = z.object({
  client: z.enum(['codex', 'cursor', 'vscode', 'claude-code', 'antigravity'])
})

export interface McpConfigurePreference {
  client: McpClient
}

const CLI_SCOPE = 'cli'

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
    client: 'codex'
  })
}

export function saveMcpConfigurePreference(
  database: LociDatabase,
  preference: McpConfigurePreference
): void {
  database.setInteractionPreference(CLI_SCOPE, 'mcp-configure', preference)
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
