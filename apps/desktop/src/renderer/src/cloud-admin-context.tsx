import { createContext, useContext } from 'react'
import type { CloudAdminLoginInput, CloudAdminSession } from '@loci/shared'

export interface CloudAdminContextValue {
  session: CloudAdminSession | null
  loading: boolean
  login: (input: CloudAdminLoginInput) => Promise<CloudAdminSession>
  logout: () => Promise<void>
}

export const CloudAdminContext = createContext<CloudAdminContextValue | null>(null)

export function useCloudAdmin(): CloudAdminContextValue {
  const context = useContext(CloudAdminContext)
  if (!context) throw new Error('云端管理员上下文尚未初始化')
  return context
}
