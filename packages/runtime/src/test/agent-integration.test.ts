import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { AgentIntegrationService, type AgentIntegrationOptions } from '../agent-integration.js'
import { LOCI_CLI_STDIO_CONNECTION } from '../agent-import.js'
import { writeAgentMcpConfigFile } from '../agent-mcp-config.js'
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
  cleanups.splice(0).forEach((path) => rmSync(path, { recursive: true, force: true }))
})

function setup(
  setupMcp: NonNullable<AgentIntegrationOptions['setupMcp']> = async (client, options) => {
    writeAgentMcpConfigFile(client, LOCI_CLI_STDIO_CONNECTION, options)
  }
): { root: string; service: AgentIntegrationService; close: () => void } {
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
    skillResourceDir,
    setupMcp
  })
  return { root, service, close: () => database.close() }
}

describe('Agent 全局接入服务', () => {
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

  it('Cursor 自动完成 MCP 与 Skill，并保留 Rules 手动状态', async () => {
    const { service, close } = setup()
    const result = await service.setup('cursor')

    expect(result.status.overall).toBe('partial')
    expect(result.status.components).toMatchObject([
      { component: 'mcp', status: 'current' },
      { component: 'skill', status: 'current' },
      { component: 'rules', status: 'manual' }
    ])
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
    await vi.advanceTimersByTimeAsync(
      AGENT_INTEGRATION_LOCK_WAIT_TIMEOUT_MS + AGENT_INTEGRATION_LOCK_RETRY_INTERVAL_MS
    )

    await expect(pending).rejects.toMatchObject({
      name: 'RuntimeLockedError',
      message: expect.stringContaining('请稍后重试')
    })
    lock.release()
    vi.useRealTimers()

    await expect(service.setup('antigravity')).resolves.toMatchObject({
      status: { overall: 'ready' }
    })
    close()
  })

  it('组件执行异常会标记为需处理，避免报告假成功', async () => {
    const { service, close } = setup(async () => {
      throw new Error('模拟 MCP 写入失败')
    })

    const result = await service.setup('antigravity')
    expect(result.status.overall).toBe('attention')
    expect(result.status.components.find((item) => item.component === 'mcp')).toMatchObject({
      status: 'conflict',
      message: expect.any(String)
    })
    close()
  })

  it('MCP 被修改时拒绝删除该项并继续安全移除其他组件', async () => {
    const { root, service, close } = setup()
    await service.setup('antigravity')
    const path = join(root, 'home/.gemini/config/mcp_config.json')
    writeFileSync(
      path,
      readFileSync(path, 'utf8').replace('"command": "loci"', '"command": "custom"'),
      'utf8'
    )

    const result = await service.remove('antigravity')
    expect(result.status.overall).toBe('attention')
    expect(result.status.components.find((item) => item.component === 'mcp')).toMatchObject({
      status: 'conflict'
    })
    expect(result.status.components.find((item) => item.component === 'skill')).toMatchObject({
      status: 'missing'
    })
    close()
  })
})
