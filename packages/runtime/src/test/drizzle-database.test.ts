import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { LOCI_DATABASE_SCHEMA } from '../database-schema.js'
import { createDrizzleDatabase } from '../drizzle-database.js'
import { createInteractionPreferencesDatabase } from '../interaction-preferences.js'
import { createSettingsDatabase, initializeSettings } from '../settings-database.js'
import { createSkillInstallationDatabase } from '../skill-database.js'

describe('Drizzle 数据库访问层', () => {
  it('与原生 SQL 复用同一个 node:sqlite 连接并互相观察写入', () => {
    const sqlite = new DatabaseSync(':memory:', { enableForeignKeyConstraints: true })
    try {
      sqlite.exec(LOCI_DATABASE_SCHEMA)
      initializeSettings(sqlite)

      const drizzleDatabase = createDrizzleDatabase(sqlite)
      const settings = createSettingsDatabase(drizzleDatabase)
      const preferences = createInteractionPreferencesDatabase(drizzleDatabase)
      const skills = createSkillInstallationDatabase(drizzleDatabase)

      settings.saveSettings({ ...settings.getSettings(), theme: 'dark' })
      const nativeSettings = sqlite
        .prepare('SELECT theme FROM app_settings WHERE id = 1')
        .get() as unknown as { theme: string }
      expect(nativeSettings.theme).toBe('dark')

      preferences.setInteractionPreference('cli', 'recent-source', { sourceId: 'source-1' })
      const nativePreference = sqlite
        .prepare(
          'SELECT value_json FROM interaction_preferences WHERE scope = ? AND preference_key = ?'
        )
        .get('cli', 'recent-source') as unknown as { value_json: string }
      expect(JSON.parse(nativePreference.value_json)).toEqual({ sourceId: 'source-1' })

      skills.saveSkillInstallationRecord({
        id: 'installation-1',
        skillName: 'use-loci',
        requestedAgent: 'codex',
        resolvedTarget: '/tmp/use-loci',
        scope: 'global',
        projectRoot: null,
        packageVersion: '1.0.0',
        contentDigest: 'digest-1',
        createdAt: '2026-08-26T00:00:00.000Z',
        updatedAt: '2026-08-26T00:00:00.000Z'
      })
      sqlite
        .prepare('UPDATE skill_installations SET package_version = ? WHERE resolved_target = ?')
        .run('1.1.0', '/tmp/use-loci')
      expect(skills.getSkillInstallationRecord('/tmp/use-loci')?.packageVersion).toBe('1.1.0')
    } finally {
      sqlite.close()
    }
  })
})
