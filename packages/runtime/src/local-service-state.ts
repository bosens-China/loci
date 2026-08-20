import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from './atomic-file.js'

export interface LocalServiceState {
  pid: number
  port: number
  mcpPort?: number
  controlToken: string
  startedAt: string
}

export function localServiceStatePath(dataDir: string): string {
  return join(dataDir, 'service.json')
}

export function writeLocalServiceState(dataDir: string, state: LocalServiceState): void {
  writeFileAtomically(localServiceStatePath(dataDir), `${JSON.stringify(state, null, 2)}\n`)
}

export function readLocalServiceState(dataDir: string): LocalServiceState | null {
  const path = localServiceStatePath(dataDir)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalServiceState>
    if (
      typeof value.pid !== 'number' ||
      typeof value.port !== 'number' ||
      (value.mcpPort !== undefined && typeof value.mcpPort !== 'number') ||
      typeof value.controlToken !== 'string' ||
      typeof value.startedAt !== 'string'
    ) {
      return null
    }
    return {
      pid: value.pid,
      port: value.port,
      ...(value.mcpPort === undefined ? {} : { mcpPort: value.mcpPort }),
      controlToken: value.controlToken,
      startedAt: value.startedAt
    }
  } catch {
    return null
  }
}

export function removeLocalServiceState(dataDir: string, pid = process.pid): void {
  const state = readLocalServiceState(dataDir)
  if (!state || state.pid !== pid) return
  rmSync(localServiceStatePath(dataDir), { force: true })
}

export async function checkLocalService(
  state: LocalServiceState,
  timeoutMs = 800
): Promise<boolean> {
  try {
    const response = await fetch(`http://127.0.0.1:${state.port}/health`, {
      signal: AbortSignal.timeout(timeoutMs)
    })
    if (!response.ok) return false
    const body = (await response.json()) as unknown
    return Boolean(
      body &&
      typeof body === 'object' &&
      'service' in body &&
      body.service === 'loci-local-service' &&
      'pid' in body &&
      body.pid === state.pid
    )
  } catch {
    return false
  }
}

export async function createLocalWebSession(state: LocalServiceState): Promise<string> {
  const response = await fetch(`http://127.0.0.1:${state.port}/control/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${state.controlToken}` },
    signal: AbortSignal.timeout(1_500)
  })
  if (!response.ok) throw new Error('无法创建 Loci Web 会话')
  const body = (await response.json()) as unknown
  if (!body || typeof body !== 'object' || !('token' in body) || typeof body.token !== 'string') {
    throw new Error('Loci 后台服务返回了无效会话')
  }
  return body.token
}
