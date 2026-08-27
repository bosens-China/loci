import type { HostnameCrawlPolicyDatabase } from './hostname-crawl-policy-database.js'
import type { OperationLogDatabase } from './operation-log-database.js'
import type { SettingsDatabase } from './settings-database.js'

export function createLoggedSettingsDatabase(
  settings: SettingsDatabase,
  logs: OperationLogDatabase
): SettingsDatabase {
  return {
    getSettings: settings.getSettings,
    saveSettings: (input) => {
      const saved = settings.saveSettings(input)
      logs.recordOperationLog({
        category: 'settings',
        action: 'settings.save',
        level: 'info',
        message: '应用设置已更新'
      })
      return saved
    }
  }
}

export function createLoggedHostnamePolicyDatabase(
  policies: HostnameCrawlPolicyDatabase,
  logs: OperationLogDatabase
): HostnameCrawlPolicyDatabase {
  return {
    listHostnameCrawlPolicies: policies.listHostnameCrawlPolicies,
    getHostnameCrawlPolicy: policies.getHostnameCrawlPolicy,
    saveHostnameCrawlPolicy: (input) => {
      const saved = policies.saveHostnameCrawlPolicy(input)
      logs.recordOperationLog({
        category: 'settings',
        action: 'hostname_policy.save',
        level: 'info',
        resourceType: 'hostname',
        resourceId: saved.hostname,
        hostname: saved.hostname,
        message: `已更新 ${saved.hostname} 的抓取限制`
      })
      return saved
    },
    deleteHostnameCrawlPolicy: (hostname) => {
      const deleted = policies.deleteHostnameCrawlPolicy(hostname)
      if (deleted) {
        logs.recordOperationLog({
          category: 'settings',
          action: 'hostname_policy.delete',
          level: 'warning',
          resourceType: 'hostname',
          resourceId: hostname.toLowerCase(),
          hostname: hostname.toLowerCase(),
          message: `已删除 ${hostname.toLowerCase()} 的抓取限制`
        })
      }
      return deleted
    }
  }
}
