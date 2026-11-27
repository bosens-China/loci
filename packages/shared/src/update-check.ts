export interface UpdateCheckStatus {
  currentVersion: string
  latestVersion: string
  updateAvailable: boolean
  checkedAt: string | null
  checking: boolean
  checkFailed: boolean
  upgradeCommand: string
}
