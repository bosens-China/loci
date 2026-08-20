import { request } from '@/api/client'

export function readLaunchToken(hash = window.location.hash): string | null {
  return new URLSearchParams(hash.replace(/^#/u, '')).get('token')
}

export async function exchangeLaunchToken(token: string): Promise<void> {
  await request.post('/api/session', undefined, { headers: { authorization: `Bearer ${token}` } })
}

export async function verifySession(): Promise<void> {
  await request.get('/api/sources')
}
