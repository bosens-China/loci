import type { IncomingMessage, ServerResponse } from 'node:http'
import type { OperationLog } from '@loci/shared'
import type { LocalRuntime } from './local-runtime.js'
import { json } from './local-http-response.js'

export function handleOperationLogs(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): boolean {
  if (request.method !== 'GET' || url.pathname !== '/api/logs') return false
  const category = enumParam(url, 'category', operationCategories)
  const level = enumParam(url, 'level', operationLevels)
  const offset = numberParam(url, 'offset', 0)
  const limit = numberParam(url, 'limit', 50)
  json(
    response,
    200,
    runtime.database.listOperationLogs({
      ...(category ? { category } : {}),
      ...(level ? { level } : {}),
      ...(url.searchParams.get('date') ? { date: url.searchParams.get('date')! } : {}),
      ...(url.searchParams.get('hostname') ? { hostname: url.searchParams.get('hostname')! } : {}),
      offset,
      limit
    })
  )
  return true
}

function enumParam<T extends string>(url: URL, key: string, values: readonly T[]): T | undefined {
  const value = url.searchParams.get(key)
  return value && values.includes(value as T) ? (value as T) : undefined
}

function numberParam(url: URL, key: string, fallback: number): number {
  const value = Number(url.searchParams.get(key) ?? fallback)
  return Number.isFinite(value) ? value : fallback
}

const operationCategories: readonly OperationLog['category'][] = [
  'task',
  'library',
  'settings',
  'cloud',
  'maintenance',
  'system'
]
const operationLevels: readonly OperationLog['level'][] = ['info', 'warning', 'error']
