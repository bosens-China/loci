import { and, eq } from 'drizzle-orm'
import type { LociDrizzleDatabase } from './drizzle-database.js'
import { interactionPreferences } from './drizzle-schema.js'

export interface InteractionPreferencesDatabase {
  getInteractionPreference: (scope: string, key: string) => unknown | null
  setInteractionPreference: (scope: string, key: string, value: unknown) => void
}

/** 交互偏好与业务设置分开存储；解析失败时按未记忆处理，不阻断正常命令。 */
export function createInteractionPreferencesDatabase(
  database: LociDrizzleDatabase
): InteractionPreferencesDatabase {
  return {
    getInteractionPreference: (scope, key) => {
      const row = database
        .select({ valueJson: interactionPreferences.valueJson })
        .from(interactionPreferences)
        .where(
          and(
            eq(interactionPreferences.scope, scope),
            eq(interactionPreferences.preferenceKey, key)
          )
        )
        .get()
      if (!row) return null
      try {
        return JSON.parse(row.valueJson) as unknown
      } catch {
        return null
      }
    },
    setInteractionPreference: (scope, key, value) => {
      const serialized = JSON.stringify(value)
      if (serialized === undefined) throw new Error('交互偏好无法序列化')
      const updatedAt = new Date().toISOString()
      database
        .insert(interactionPreferences)
        .values({ scope, preferenceKey: key, valueJson: serialized, updatedAt })
        .onConflictDoUpdate({
          target: [interactionPreferences.scope, interactionPreferences.preferenceKey],
          set: { valueJson: serialized, updatedAt }
        })
        .run()
    }
  }
}
