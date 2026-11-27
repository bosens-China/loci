import type { UpdateCheckStatus } from '@loci/shared'
import { request } from './client'

/** 获取当前版本与缓存的更新状态，并在服务端非阻塞触发后台更新检查。 */
export const getUpdateStatus = async (signal?: AbortSignal): Promise<UpdateCheckStatus> => {
  const { data } = await request.get<UpdateCheckStatus>('/api/update', { signal })
  return data
}

/** 立即向 npm 检查最新版本并刷新服务端缓存。 */
export const checkUpdateNow = async (): Promise<UpdateCheckStatus> => {
  const { data } = await request.post<UpdateCheckStatus>('/api/update/check')
  return data
}
