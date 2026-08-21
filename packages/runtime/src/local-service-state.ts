import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { writeFileAtomically } from './atomic-file.js'

export interface LocalServiceState {
  pid: number
  mode: 'persistent' | 'on-demand'
  startedAt: string
  heartbeatAt: string
}

export interface LocalWebServiceState {
  pid: number
  port: number
  startedAt: string
}

export function localServiceStatePath(dataDir: string): string {
  return join(dataDir, 'service.json')
}

export function writeLocalServiceState(dataDir: string, state: LocalServiceState): void {
  writeFileAtomically(localServiceStatePath(dataDir), `${JSON.stringify(state, null, 2)}\n`)
}

export function localWebServiceStatePath(dataDir: string): string {
  return join(dataDir, 'web.json')
}

export function writeLocalWebServiceState(dataDir: string, state: LocalWebServiceState): void {
  writeFileAtomically(localWebServiceStatePath(dataDir), `${JSON.stringify(state, null, 2)}\n`)
}

export function readLocalServiceState(dataDir: string): LocalServiceState | null {
  const path = localServiceStatePath(dataDir)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalServiceState>
    if (
      typeof value.pid !== 'number' ||
      !['persistent', 'on-demand'].includes(value.mode ?? '') ||
      typeof value.startedAt !== 'string' ||
      typeof value.heartbeatAt !== 'string'
    ) {
      return null
    }
    return {
      pid: value.pid,
      mode: value.mode as LocalServiceState['mode'],
      startedAt: value.startedAt,
      heartbeatAt: value.heartbeatAt
    }
  } catch {
    return null
  }
}

export function readLocalWebServiceState(dataDir: string): LocalWebServiceState | null {
  const path = localWebServiceStatePath(dataDir)
  if (!existsSync(path)) return null
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LocalWebServiceState>
    if (
      typeof value.pid !== 'number' ||
      typeof value.port !== 'number' ||
      typeof value.startedAt !== 'string'
    ) {
      return null
    }
    return {
      pid: value.pid,
      port: value.port,
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

export function removeLocalWebServiceState(dataDir: string, pid = process.pid): void {
  const state = readLocalWebServiceState(dataDir)
  if (!state || state.pid !== pid) return
  rmSync(localWebServiceStatePath(dataDir), { force: true })
}

export async function checkLocalService(
  state: LocalServiceState,
  staleAfterMs = 10_000
): Promise<boolean> {
  try {
    if (Date.now() - new Date(state.heartbeatAt).getTime() > staleAfterMs) return false
    process.kill(state.pid, 0)
    return true
  } catch {
    return false
  }
}

export async function checkLocalWebService(
  state: LocalWebServiceState,
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
      body.service === 'loci-local-web' &&
      'pid' in body &&
      body.pid === state.pid
    )
  } catch {
    return false
  }
}
