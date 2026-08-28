import type { LocalBrowserStatus } from '@loci/shared'
import { request } from '@/api/client'

export async function getLocalBrowserStatus(): Promise<LocalBrowserStatus> {
  return (await request.get<LocalBrowserStatus>('/api/browser')).data
}

export async function installLocalBrowser(): Promise<LocalBrowserStatus> {
  return (await request.post<LocalBrowserStatus>('/api/browser/install')).data
}

export async function uninstallLocalBrowser(): Promise<LocalBrowserStatus> {
  return (await request.delete<LocalBrowserStatus>('/api/browser')).data
}
