import type { AppSettings } from '@loci/shared'
import { request } from '@/api/client'

export async function getSettings(): Promise<AppSettings> {
  return (await request.get<AppSettings>('/api/settings')).data
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  return (await request.put<AppSettings>('/api/settings', settings)).data
}
