import { spawn } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { createLocalRuntime, type LocalRuntime } from '@loci/runtime'
import type { EmbeddingModelId } from '@loci/shared'
import { resolveCliSkillResourceDir } from './skill-resources.js'
import { CLI_VERSION } from './update.js'

export type CliRuntime = LocalRuntime

export function createCliRuntime(detachedCrawl = false): CliRuntime {
  return createLocalRuntime({
    detachedCrawl,
    owner: 'CLI',
    launchEmbeddingRefresh,
    agentIntegration: {
      packageVersion: CLI_VERSION,
      skillResourceDir: resolveCliSkillResourceDir()
    }
  })
}

/** CLI 搜索返回后由独立进程续建索引，模型锁负责跨入口复用。 */
function launchEmbeddingRefresh(id: EmbeddingModelId): void {
  const source = fileURLToPath(import.meta.url).endsWith('.ts')
  const entry = fileURLToPath(new URL(source ? './index.ts' : './index.js', import.meta.url))
  const args = source ? ['--import', createRequire(import.meta.url).resolve('tsx')] : []
  const child = spawn(process.execPath, [...args, entry, '__model-index', id], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true
  })
  child.on('error', () => undefined)
  child.unref()
}
