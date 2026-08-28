import type { McpClient, AgentIntegrationActionResult, AgentIntegrationStatus } from '@loci/shared'
import { request } from './client'

export const getAgentIntegrations = async (): Promise<AgentIntegrationStatus[]> => {
  const { data } = await request.get<AgentIntegrationStatus[]>('/api/agents')
  return data
}

export const setupAgentIntegration = async (
  client: McpClient
): Promise<AgentIntegrationActionResult> => {
  const { data } = await request.post<AgentIntegrationActionResult>(
    `/api/agents/${encodeURIComponent(client)}/setup`
  )
  return data
}

export const removeAgentIntegration = async (
  client: McpClient
): Promise<AgentIntegrationActionResult> => {
  const { data } = await request.post<AgentIntegrationActionResult>(
    `/api/agents/${encodeURIComponent(client)}/remove`
  )
  return data
}
