import { describe, expect, it } from 'vitest'
import type { AgentIntegrationActionResult, AgentIntegrationComponentState } from '@loci/shared'
import {
  canRemoveAgentIntegration,
  resolveAgentIntegrationFeedback
} from '@/pages/agent-integration-state'

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

  it('区分首次接入、检查更新和幂等无变化', () => {
    expect(resolveAgentIntegrationFeedback(result(true), 'setup')).toBe('setup-completed')
    expect(resolveAgentIntegrationFeedback(result(true), 'update')).toBe('update-completed')
    expect(resolveAgentIntegrationFeedback(result(false), 'update')).toBe('unchanged')
  })
})

function result(changed: boolean): AgentIntegrationActionResult {
  return {
    action: 'setup',
    changed,
    status: {
      client: 'codex',
      label: 'Codex',
      overall: 'ready',
      components: [component('current')]
    }
  }
}

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
