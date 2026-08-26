import { readFile } from 'node:fs/promises'

export type JsonObject = Record<string, unknown>

export function asJsonObject(value: unknown, source: string): JsonObject {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${source} 必须是 JSON 对象`)
  }
  return value as JsonObject
}

export async function readJsonObject(path: string): Promise<JsonObject> {
  return asJsonObject(JSON.parse(await readFile(path, 'utf8')) as unknown, path)
}
