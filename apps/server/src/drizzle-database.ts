import type { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'

/** Server 使用独立表映射，但继续复用已经初始化的 node:sqlite 连接。 */
export function createServerDrizzleDatabase(database: DatabaseSync) {
  return drizzle({ client: database })
}

export type ServerDrizzleDatabase = ReturnType<typeof createServerDrizzleDatabase>
