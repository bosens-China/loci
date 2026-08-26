import type { DatabaseSync } from 'node:sqlite'
import { drizzle } from 'drizzle-orm/node-sqlite'

/** 在现有 node:sqlite 连接上创建类型安全查询层，不额外打开数据库连接。 */
export function createDrizzleDatabase(database: DatabaseSync) {
  return drizzle({ client: database })
}

export type LociDrizzleDatabase = ReturnType<typeof createDrizzleDatabase>
