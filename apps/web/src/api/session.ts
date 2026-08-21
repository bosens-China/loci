import { request } from '@/api/client'

let activeAuthentication: Promise<void> | null = null

export function readLaunchToken(hash = window.location.hash): string | null {
  return new URLSearchParams(hash.replace(/^#/u, '')).get('token')
}

export async function exchangeLaunchToken(token: string): Promise<void> {
  await request.post('/api/session', undefined, { headers: { authorization: `Bearer ${token}` } })
}

export async function verifySession(): Promise<void> {
  await request.get('/api/sources')
}

/** 复用并发的会话初始化，避免开发模式重复消费一次性启动令牌。 */
export function authenticateSession(): Promise<void> {
  if (activeAuthentication) return activeAuthentication

  const authentication = runAuthentication()
  const clear = (): void => {
    if (activeAuthentication === authentication) activeAuthentication = null
  }
  activeAuthentication = authentication
  void authentication.then(clear, clear)
  return authentication
}

async function runAuthentication(): Promise<void> {
  const token = readLaunchToken()
  if (token) {
    await exchangeLaunchToken(token)
    window.history.replaceState({}, '', `${window.location.pathname}${window.location.search}`)
    return
  }
  await verifySession()
}
