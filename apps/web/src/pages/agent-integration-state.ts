import type { AgentIntegrationActionResult, AgentIntegrationComponentState } from '@loci/shared'

export type AgentIntegrationActionIntent = 'setup' | 'update' | 'remove'
export type AgentIntegrationFeedback =
  | 'attention'
  | 'setup-completed'
  | 'update-completed'
  | 'manual-completed'
  | 'manual-unchanged'
  | 'unchanged'
  | 'removed'
  | 'remove-unchanged'

export function canRemoveAgentIntegration(
  components: readonly AgentIntegrationComponentState[]
): boolean {
  return components.some((item) => item.status === 'current' || item.status === 'outdated')
}

/** 用按钮意图和实际写入结果区分首次接入、检查更新与幂等无变化。 */
export function resolveAgentIntegrationFeedback(
  result: AgentIntegrationActionResult,
  intent: AgentIntegrationActionIntent
): AgentIntegrationFeedback {
  if (result.status.overall === 'attention') return 'attention'
  if (result.action === 'remove') return result.changed ? 'removed' : 'remove-unchanged'

  const manual = result.status.components.some((item) => item.status === 'manual')
  if (manual) return result.changed ? 'manual-completed' : 'manual-unchanged'
  if (!result.changed) return 'unchanged'
  return intent === 'update' ? 'update-completed' : 'setup-completed'
}
