import { describe, expect, it } from 'vitest'
import type { AgentIntegrationComponentState } from '@loci/shared'
import { canRemoveAgentIntegration } from '@/pages/agent-integration-state'

describe('Agent 接入操作状态', () => {
  it('允许移除已就绪或待更新的 Loci 自动配置', () => {
    expect(canRemoveAgentIntegration([component('current')])).toBe(true)
    expect(canRemoveAgentIntegration([component('outdated')])).toBe(true)
  })

  it('不把缺失、冲突或手动配置视为可自动移除', () => {
    expect(
      canRemoveAgentIntegration([component('missing'), component('conflict'), component('manual')])
    ).toBe(false)
  })
})

function component(
  status: AgentIntegrationComponentState['status']
): AgentIntegrationComponentState {
  return {
    component: 'skill',
    status,
    path: '/tmp/use-loci',
    message: null
  }
}
