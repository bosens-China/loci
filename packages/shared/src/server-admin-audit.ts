export type ServerAdminAuditMethod = 'POST' | 'PUT' | 'DELETE'

/** Server 端持久化的管理员写操作摘要，不包含请求正文或认证信息。 */
export interface ServerAdminAuditLog {
  id: string
  actor: string
  method: ServerAdminAuditMethod
  path: string
  statusCode: number
  createdAt: string
}

export interface ServerAdminAuditLogPage {
  items: ServerAdminAuditLog[]
  total: number
  offset: number
  limit: number
}
