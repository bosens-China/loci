import type {
  AgentClient,
  AgentIntegrationActionResult,
  AgentIntegrationStatus
} from '@loci/shared'
import { request } from './client'

/** 获取所有支持的 Agent 集成状态列表。 */
export const getAgentIntegrations = async (): Promise<AgentIntegrationStatus[]> => {
  const { data } = await request.get<AgentIntegrationStatus[]>('/api/agents')
  return data
}

/** 获取单个 Agent 客户端的集成状态。 */
export const getAgentIntegration = async (client: AgentClient): Promise<AgentIntegrationStatus> => {
  const { data } = await request.get<AgentIntegrationStatus>(
    `/api/agents/${encodeURIComponent(client)}`
  )
  return data
}

/** 一键接入或更新指定 Agent（配置 use-loci skill 与全局 rules）。 */
export const setupAgentIntegration = async (
  client: AgentClient
): Promise<AgentIntegrationActionResult> => {
  const { data } = await request.post<AgentIntegrationActionResult>(
    `/api/agents/${encodeURIComponent(client)}/setup`
  )
  return data
}

/** 移除指定 Agent 的接入配置。 */
export const removeAgentIntegration = async (
  client: AgentClient
): Promise<AgentIntegrationActionResult> => {
  const { data } = await request.post<AgentIntegrationActionResult>(
    `/api/agents/${encodeURIComponent(client)}/remove`
  )
  return data
}
