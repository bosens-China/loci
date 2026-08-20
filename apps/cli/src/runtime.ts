import { createLocalRuntime, type LocalRuntime } from '@loci/runtime'

export type CliRuntime = LocalRuntime

export function createCliRuntime(): CliRuntime {
  return createLocalRuntime({ owner: 'CLI' })
}
