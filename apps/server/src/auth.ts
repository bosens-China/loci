import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

const SESSION_TTL_MS = 24 * 60 * 60 * 1000

/** 单管理员会话只保存在内存中，服务重启后自动失效。 */
export class AdminAuth {
  readonly #usernameHash: Buffer
  readonly #passwordHash: Buffer
  readonly #sessions = new Map<string, number>()

  constructor(username: string, password: string) {
    if (!username || !password) throw new Error('管理员用户名和密码不能为空')
    this.#usernameHash = hash(username)
    this.#passwordHash = hash(password)
  }

  login(username: string, password: string): string | null {
    if (
      !timingSafeEqual(hash(username), this.#usernameHash) ||
      !timingSafeEqual(hash(password), this.#passwordHash)
    ) {
      return null
    }
    const token = randomBytes(32).toString('base64url')
    this.#sessions.set(token, Date.now() + SESSION_TTL_MS)
    return token
  }

  verify(token: string): boolean {
    const expiresAt = this.#sessions.get(token)
    if (!expiresAt || expiresAt <= Date.now()) {
      this.#sessions.delete(token)
      return false
    }
    return true
  }

  logout(token: string): void {
    this.#sessions.delete(token)
  }
}

export function readBearerToken(header: string | undefined): string | null {
  return header?.startsWith('Bearer ') ? header.slice(7) : null
}

function hash(value: string): Buffer {
  return createHash('sha256').update(value).digest()
}
