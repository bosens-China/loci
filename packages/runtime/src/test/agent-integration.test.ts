import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentIntegrationService } from '../agent-integration.js'
import {
  AGENT_INTEGRATION_LOCK_RETRY_INTERVAL_MS,
  AGENT_INTEGRATION_LOCK_WAIT_TIMEOUT_MS
} from '../agent-operation-timing.js'
import { createDatabase } from '../database.js'
import { acquireRuntimeLock } from '../runtime-lock.js'

const cleanups: string[] = []
const skillResourceDir = fileURLToPath(
  new URL('../../../../.agents/skills/use-loci/', import.meta.url)
)

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
  cleanups.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
})

function setup(): { root: string; service: AgentIntegrationService; close: () => void } {
  const root = mkdtempSync(join(tmpdir(), 'loci-agent-integration-'))
  cleanups.push(root)
  const dataDir = join(root, 'data')
  const homeDir = join(root, 'home')
  mkdirSync(dataDir, { recursive: true })
  const database = createDatabase(join(dataDir, 'loci.sqlite'))
  const service = new AgentIntegrationService({
    database,
    dataDir,
    homeDir,
    packageVersion: '1.13.0',
    skillResourceDir
  })
  return { root, service, close: () => database.close() }
}

describe('Agent 全局接入服务', () => {
  it('Pi 使用自定义目录和覆盖规则，重复接入与移除保留个人规则和通用 Skill', async () => {
    const { root, service, close } = setup()
    try {
      const piDir = join(root, 'home', 'pi-profile')
      const piSkill = join(piDir, 'skills', 'use-loci')
      const sharedSkill = join(root, 'home', '.agents', 'skills', 'use-loci')
      const override = join(piDir, 'AGENTS.override.md')
      const fallback = join(piDir, 'AGENTS.md')
      vi.stubEnv('PI_CODING_AGENT_DIR', '~/pi-profile')
      mkdirSync(piDir, { recursive: true })
      writeFileSync(override, '# Personal override\n')
      writeFileSync(fallback, '# Personal default\n')
      await service.setup('codex')
      const sharedBefore = readFileSync(join(sharedSkill, 'SKILL.md'))

      const [first, duplicate] = await Promise.all([service.setup('pi'), service.setup('pi')])
      expect(duplicate).toEqual(first)
      expect(first).toMatchObject({
        changed: true,
        status: {
          overall: 'ready',
          components: [
            { component: 'skill', status: 'current', path: piSkill },
            { component: 'rules', status: 'current', path: override }
          ]
        }
      })
      expect((await service.setup('pi')).changed).toBe(false)
      expect(readFileSync(override, 'utf8')).toContain('<!-- loci:start -->')
      expect((await service.remove('pi')).status.overall).toBe('missing')
      expect((await service.remove('pi')).changed).toBe(false)
      expect(existsSync(piSkill)).toBe(false)
      expect(readFileSync(override, 'utf8')).toBe('# Personal override\n')
      expect(readFileSync(fallback, 'utf8')).toBe('# Personal default\n')
      expect(readFileSync(join(sharedSkill, 'SKILL.md'))).toEqual(sharedBefore)

      vi.stubEnv('PI_CODING_AGENT_DIR', '~/.agents')
      expect((await service.remove('pi')).status.overall).toBe('attention')
      expect(readFileSync(join(sharedSkill, 'SKILL.md'))).toEqual(sharedBefore)
    } finally {
      close()
    }
  })

  it('完整接入、重复调用和安全移除 Antigravity', async () => {
    const { service, close } = setup()
    expect(service.inspect('antigravity').overall).toBe('missing')

    const first = await service.setup('antigravity')
    const second = await service.setup('antigravity')
    expect(first.changed).toBe(true)
    expect(first.status.overall).toBe('ready')
    expect(second.changed).toBe(false)

    const removed = await service.remove('antigravity')
    expect(removed.changed).toBe(true)
    expect(removed.status.overall).toBe('missing')
    expect((await service.remove('antigravity')).changed).toBe(false)
    close()
  })

  it('Cursor 自动完成 Skill 与本机 Rules', async () => {
    const { service, close } = setup()
    const result = await service.setup('cursor')

    expect(result.status.overall).toBe('ready')
    expect(result.status.components).toMatchObject([
      { component: 'skill', status: 'current' },
      {
        component: 'rules',
        status: 'current',
        path: expect.stringContaining(join('.cursor', 'rules', 'loci.mdc'))
      }
    ])
    expect((await service.remove('cursor')).status.overall).toBe('missing')
    close()
  })

  it('同操作复用任务，接入与移除竞争按调用顺序收敛', async () => {
    const { service, close } = setup()
    const first = service.setup('antigravity')
    const duplicate = service.setup('antigravity')
    expect(first).toBe(duplicate)
    await first

    const setupAgain = service.setup('antigravity')
    const remove = service.remove('antigravity')
    await Promise.all([setupAgain, remove])
    expect(service.inspect('antigravity').overall).toBe('missing')
    close()
  })

  it('跨入口操作超过旧等待上限后仍复查状态并继续接入', async () => {
    vi.useFakeTimers()
    const { root, service, close } = setup()
    const lock = acquireRuntimeLock(
      join(root, 'data'),
      'agent-integration-antigravity',
      '另一个 Loci 入口'
    )
    const pending = service.setup('antigravity')
    await vi.advanceTimersByTimeAsync(5_100)
    lock.release()
    await vi.advanceTimersByTimeAsync(AGENT_INTEGRATION_LOCK_RETRY_INTERVAL_MS)
    vi.useRealTimers()

    await expect(pending).resolves.toMatchObject({ status: { overall: 'ready' } })
    close()
  })

  it('跨入口等待真正超时后可在锁释放时重试', async () => {
    vi.useFakeTimers()
    const { root, service, close } = setup()
    const lock = acquireRuntimeLock(
      join(root, 'data'),
      'agent-integration-antigravity',
      '另一个 Loci 入口'
    )
    const pending = service.setup('antigravity')
    const rejected = expect(pending).rejects.toMatchObject({
      name: 'RuntimeLockedError',
      message: expect.stringContaining('请稍后重试')
    })
    await vi.advanceTimersByTimeAsync(
      AGENT_INTEGRATION_LOCK_WAIT_TIMEOUT_MS + AGENT_INTEGRATION_LOCK_RETRY_INTERVAL_MS
    )

    await rejected
    lock.release()
    vi.useRealTimers()

    await expect(service.setup('antigravity')).resolves.toMatchObject({
      status: { overall: 'ready' }
    })
    close()
  })
})
