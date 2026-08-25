import { createLocalRuntime, type LocalRuntime } from '@loci/runtime'
import { resolveCliSkillResourceDir } from './skill-resources.js'
import { CLI_VERSION } from './update.js'

export type CliRuntime = LocalRuntime

export function createCliRuntime(): CliRuntime {
  return createLocalRuntime({
    owner: 'CLI',
    agentIntegration: {
      packageVersion: CLI_VERSION,
      skillResourceDir: resolveCliSkillResourceDir()
    }
  })
}
