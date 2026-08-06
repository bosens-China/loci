import type { DatabaseSync } from 'node:sqlite'

export interface InteractionPreferencesDatabase {
  getInteractionPreference: (scope: string, key: string) => unknown | null
  setInteractionPreference: (scope: string, key: string, value: unknown) => void
}

/** 交互偏好与业务设置分开存储；解析失败时按未记忆处理，不阻断正常命令。 */
export function createInteractionPreferencesDatabase(
  database: DatabaseSync
): InteractionPreferencesDatabase {
  return {
    getInteractionPreference: (scope, key) => {
      const row = database
        .prepare(
          'SELECT value_json FROM interaction_preferences WHERE scope = ? AND preference_key = ?'
        )
        .get(scope, key) as unknown as { value_json: string } | undefined
      if (!row) return null
      try {
        return JSON.parse(row.value_json) as unknown
      } catch {
        return null
      }
    },
    setInteractionPreference: (scope, key, value) => {
      const serialized = JSON.stringify(value)
      if (serialized === undefined) throw new Error('交互偏好无法序列化')
      database
        .prepare(
          `INSERT INTO interaction_preferences (scope, preference_key, value_json, updated_at)
           VALUES (?, ?, ?, ?)
           ON CONFLICT(scope, preference_key) DO UPDATE SET
             value_json = excluded.value_json,
             updated_at = excluded.updated_at`
        )
        .run(scope, key, serialized, new Date().toISOString())
    }
  }
}
