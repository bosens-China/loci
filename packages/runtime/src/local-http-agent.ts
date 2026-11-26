import type { IncomingMessage, ServerResponse } from 'node:http'
import { isAgentClient } from '@loci/shared'
import type { LocalRuntime } from './local-runtime.js'
import { json, mutationJson } from './local-http-response.js'

/** 仅供回环 Web 使用的 Agent 全局接入接口。 */
export async function handleAgentIntegrations(
  runtime: LocalRuntime,
  request: IncomingMessage,
  response: ServerResponse,
  url: URL
): Promise<boolean> {
  if (!url.pathname.startsWith('/api/agents')) return false
  const service = runtime.agentIntegration
  if (!service) {
    json(response, 503, { error: '当前 Loci 运行时未启用 Agent 接入管理' })
    return true
  }
  if (request.method === 'GET' && url.pathname === '/api/agents') {
    json(response, 200, service.list())
    return true
  }
  const match = /^\/api\/agents\/([^/]+)(?:\/(setup|remove))?$/u.exec(url.pathname)
  if (!match) return false
  const client = decodeURIComponent(match[1]!)
  if (!isAgentClient(client)) {
    json(response, 404, { error: `不支持的 Agent 客户端：${client}` })
    return true
  }
  if (request.method === 'GET' && !match[2]) {
    json(response, 200, service.inspect(client))
    return true
  }
  if (request.method === 'POST' && match[2] === 'setup') {
    await mutationJson(response, 200, () => service.setup(client))
    return true
  }
  if (request.method === 'POST' && match[2] === 'remove') {
    await mutationJson(response, 200, () => service.remove(client))
    return true
  }
  return false
}
