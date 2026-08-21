import type { DocumentSource } from '@loci/shared'

export interface PersistentBackgroundRequirements {
  required: boolean
  scheduledSources: number
  autoSyncCloudSources: number
}

/** 统一判断哪些已保存能力必须由脱离终端的宿主持续执行。 */
export function inspectPersistentBackgroundRequirements(
  sources: readonly DocumentSource[]
): PersistentBackgroundRequirements {
  const scheduledSources = sources.filter(
    (source) => source.cloud === null && source.schedule
  ).length
  const autoSyncCloudSources = sources.filter((source) => source.cloud?.autoSync).length
  return {
    required: scheduledSources + autoSyncCloudSources > 0,
    scheduledSources,
    autoSyncCloudSources
  }
}
