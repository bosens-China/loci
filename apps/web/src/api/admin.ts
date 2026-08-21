import type {
  CloudAdminLoginInput,
  CloudAdminSession,
  CloudLibrary,
  CloudLibraryInput,
  CloudSyncJob
} from '@loci/shared'
import { request } from '@/api/client'

export async function getAdminSession(): Promise<CloudAdminSession | null> {
  return (await request.get<CloudAdminSession | null>('/api/admin/session')).data
}

export async function loginAdmin(input: CloudAdminLoginInput): Promise<CloudAdminSession> {
  return (await request.post<CloudAdminSession>('/api/admin/login', input)).data
}

export async function logoutAdmin(): Promise<void> {
  await request.post('/api/admin/logout')
}

export async function listAdminLibraries(): Promise<CloudLibrary[]> {
  return (await request.get<CloudLibrary[]>('/api/admin/libraries')).data
}

export async function createAdminLibrary(input: CloudLibraryInput): Promise<CloudLibrary> {
  return (await request.post<CloudLibrary>('/api/admin/libraries', input)).data
}

export async function updateAdminLibrary(
  id: string,
  input: CloudLibraryInput
): Promise<CloudLibrary> {
  return (await request.put<CloudLibrary>(`/api/admin/libraries/${encodeURIComponent(id)}`, input))
    .data
}

export async function deleteAdminLibrary(id: string): Promise<void> {
  await request.delete(`/api/admin/libraries/${encodeURIComponent(id)}`)
}

export async function syncAdminLibraries(ids: readonly string[]): Promise<CloudSyncJob[]> {
  return (await request.post<CloudSyncJob[]>('/api/admin/libraries/sync', { libraryIds: ids })).data
}

export async function listAdminJobs(): Promise<CloudSyncJob[]> {
  return (await request.get<CloudSyncJob[]>('/api/admin/jobs')).data
}

export async function cancelAdminJob(id: string): Promise<CloudSyncJob> {
  return (await request.post<CloudSyncJob>(`/api/admin/jobs/${encodeURIComponent(id)}/cancel`)).data
}
