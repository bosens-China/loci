import type { AppSettings, HostnameCrawlPolicy, SaveHostnameCrawlPolicyInput } from '@loci/shared'
import { request } from './client'

/** 获取应用全局设置。 */
export const getSettings = async (): Promise<AppSettings> => {
  const { data } = await request.get<AppSettings>('/api/settings')
  return data
}

/** 保存应用全局设置。 */
export const saveSettings = async (settings: AppSettings): Promise<AppSettings> => {
  const { data } = await request.put<AppSettings>('/api/settings', settings)
  return data
}

/** 获取所有域名抓取策略列表。 */
export const listHostnamePolicies = async (): Promise<HostnameCrawlPolicy[]> => {
  const { data } = await request.get<HostnameCrawlPolicy[]>('/api/hostname-policies')
  return data
}

/** 新建或保存特定域名的抓取策略。 */
export const saveHostnamePolicy = async (
  policy: SaveHostnameCrawlPolicyInput
): Promise<HostnameCrawlPolicy> => {
  const { hostname, ...body } = policy
  const { data } = await request.put<HostnameCrawlPolicy>(
    `/api/hostname-policies/${encodeURIComponent(hostname)}`,
    body
  )
  return data
}

/** 删除特定域名的抓取策略。 */
export const deleteHostnamePolicy = async (hostname: string): Promise<{ deleted: boolean }> => {
  const { data } = await request.delete<{ deleted: boolean }>(
    `/api/hostname-policies/${encodeURIComponent(hostname)}`
  )
  return data
}
