import { clean, gt } from 'semver'

/** 使用标准 SemVer 规则比较版本，非法版本统一视为不可升级。 */
export function isNewerVersion(latest: string, current: string): boolean {
  const normalizedLatest = clean(latest)
  const normalizedCurrent = clean(current)
  return Boolean(normalizedLatest && normalizedCurrent && gt(normalizedLatest, normalizedCurrent))
}
