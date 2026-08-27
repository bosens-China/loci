import type { AppSettings, HostnameCrawlPolicy, SaveHostnameCrawlPolicyInput } from '@loci/shared'
import { request } from '@/api/client'

export async function getSettings(): Promise<AppSettings> {
  return (await request.get<AppSettings>('/api/settings')).data
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return (await request.put<AppSettings>('/api/settings', settings)).data
}

export async function listHostnameCrawlPolicies(): Promise<HostnameCrawlPolicy[]> {
  return (await request.get<HostnameCrawlPolicy[]>('/api/settings/hostname-policies')).data
}

export async function saveHostnameCrawlPolicy(
  input: SaveHostnameCrawlPolicyInput
): Promise<HostnameCrawlPolicy> {
  return (
    await request.put<HostnameCrawlPolicy>(
      `/api/settings/hostname-policies/${encodeURIComponent(input.hostname)}`,
      input
    )
  ).data
}

export async function deleteHostnameCrawlPolicy(hostname: string): Promise<{ deleted: boolean }> {
  return (
    await request.delete<{ deleted: boolean }>(
      `/api/settings/hostname-policies/${encodeURIComponent(hostname)}`
    )
  ).data
}
