import type { AgentIntegrationComponentState } from '@loci/shared'

export function canRemoveAgentIntegration(
  components: readonly AgentIntegrationComponentState[]
): boolean {
  return components.some((item) => item.status === 'current' || item.status === 'outdated')
}
