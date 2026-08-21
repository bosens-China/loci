import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acquireRuntimeLock } from '@loci/runtime'
import {
  ensureUserServiceRunning,
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsServiceScript,
  type UserServiceManager
} from '../service-manager.js'

const command = {
  executable: '/usr/local/bin/node',
  args: ['/opt/loci/dist/index.js', 'service', 'run', '--managed'],
  environment: { LOCI_DATA_DIR: '/tmp/loci data' }
}

const temporaryDirectories: string[] = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe('service manager definitions', () => {
  it('生成不经过 shell 的 launchd 用户服务定义', () => {
    const plist = renderLaunchdPlist(command, '/Users/test/Library/Application Support/Loci')
    expect(plist).toContain('<string>com.loci.service</string>')
    expect(plist).toContain('<string>/usr/local/bin/node</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<string>Background</string>')
    expect(plist).toContain('<key>LOCI_DATA_DIR</key>')
  })

  it('生成登录后启用的 systemd user service', () => {
    const unit = renderSystemdUnit(command, '/home/test/.config/Loci')
    expect(unit).toContain('ExecStart="/usr/local/bin/node"')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).toContain('Environment="LOCI_DATA_DIR=/tmp/loci data"')
  })

  it('生成 Windows Task Scheduler 调用脚本', () => {
    const script = renderWindowsServiceScript({
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Users\\test\\loci\\index.js', 'service', 'run', '--managed']
    })
    expect(script).toContain('"C:\\Program Files\\nodejs\\node.exe"')
    expect(script).toContain('service')
    expect(script).toContain('--managed')
    expect(script).toContain(':loci_service_loop')
    expect(script).toContain('timeout /t 5')
  })

  it('首次启动时安装用户级服务，后续启动复用已有定义', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-service-start-'))
    temporaryDirectories.push(directory)
    const install = vi.fn(async () => undefined)
    const start = vi.fn(async () => undefined)
    const manager: UserServiceManager = {
      install,
      start,
      stop: vi.fn(async () => undefined),
      restart: vi.fn(async () => undefined),
      disable: vi.fn(async () => undefined),
      status: vi
        .fn()
        .mockResolvedValueOnce({
          installed: false,
          running: false,
          state: null,
          definitionPath: '/tmp/loci.service',
          logPaths: []
        })
        .mockResolvedValueOnce({
          installed: true,
          running: false,
          state: null,
          definitionPath: '/tmp/loci.service',
          logPaths: []
        }),
      definitionPath: '/tmp/loci.service',
      logPaths: []
    }
    const state = {
      pid: 42,
      port: 43123,
      controlToken: 'control-token',
      startedAt: '2026-08-20T00:00:00.000Z'
    }
    const waitForService = vi.fn(async () => state)

    await ensureUserServiceRunning(manager, directory, waitForService)
    await ensureUserServiceRunning(manager, directory, waitForService)

    expect(install).toHaveBeenCalledOnce()
    expect(start).toHaveBeenCalledOnce()
    expect(waitForService).toHaveBeenNthCalledWith(1, directory)
    expect(waitForService).toHaveBeenNthCalledWith(2, directory)
  })

  it('前台 UI 已承载当前数据目录时不启动第二个服务', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-service-start-'))
    temporaryDirectories.push(directory)
    const state = {
      pid: 42,
      port: 43123,
      controlToken: 'control-token',
      startedAt: '2026-08-20T00:00:00.000Z'
    }
    const manager = createManager()
    manager.status = vi.fn(async () => ({
      installed: false,
      running: true,
      state,
      definitionPath: '/tmp/loci.service',
      logPaths: []
    }))
    const waitForService = vi.fn(async () => state)

    await expect(ensureUserServiceRunning(manager, directory, waitForService)).resolves.toEqual(
      state
    )

    expect(manager.install).not.toHaveBeenCalled()
    expect(manager.start).not.toHaveBeenCalled()
    expect(waitForService).not.toHaveBeenCalled()
  })

  it('同进程并发调用复用同一次服务安装', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-service-start-'))
    temporaryDirectories.push(directory)
    const state = {
      pid: 42,
      port: 43123,
      controlToken: 'control-token',
      startedAt: '2026-08-20T00:00:00.000Z'
    }
    let releaseStatus = (): void => undefined
    const statusGate = new Promise<void>((resolvePromise) => {
      releaseStatus = resolvePromise
    })
    const manager = createManager()
    manager.status = vi.fn(async () => {
      await statusGate
      return {
        installed: false,
        running: false,
        state: null,
        definitionPath: '/tmp/loci.service',
        logPaths: []
      }
    })
    const waitForService = vi.fn(async () => state)

    const first = ensureUserServiceRunning(manager, directory, waitForService)
    const second = ensureUserServiceRunning(manager, directory, waitForService)
    expect(first).toBe(second)
    releaseStatus()

    await expect(Promise.all([first, second])).resolves.toEqual([state, state])
    expect(manager.install).toHaveBeenCalledOnce()
    expect(waitForService).toHaveBeenCalledOnce()
  })

  it('跨进程激活锁占用时等待现有启动结果', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-service-start-'))
    temporaryDirectories.push(directory)
    mkdirSync(join(directory, 'locks'), { recursive: true })
    const lock = acquireRuntimeLock(directory, 'service-start', '另一个激活流程')
    const manager = createManager()
    const state = {
      pid: 42,
      port: 43123,
      controlToken: 'control-token',
      startedAt: '2026-08-20T00:00:00.000Z'
    }
    const waitForService = vi.fn(async () => state)
    try {
      await expect(ensureUserServiceRunning(manager, directory, waitForService)).resolves.toEqual(
        state
      )
      expect(manager.status).not.toHaveBeenCalled()
      expect(manager.install).not.toHaveBeenCalled()
      expect(waitForService).toHaveBeenCalledWith(directory)
    } finally {
      lock.release()
    }
  })

  it('失败的激活任务会释放 single-flight 以便重试', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'loci-service-start-'))
    temporaryDirectories.push(directory)
    const manager = createManager()
    vi.mocked(manager.status)
      .mockRejectedValueOnce(new Error('temporary failure'))
      .mockResolvedValueOnce({
        installed: false,
        running: false,
        state: null,
        definitionPath: '/tmp/loci.service',
        logPaths: []
      })
    const state = {
      pid: 42,
      port: 43123,
      controlToken: 'control-token',
      startedAt: '2026-08-20T00:00:00.000Z'
    }
    const waitForService = vi.fn(async () => state)

    await expect(ensureUserServiceRunning(manager, directory, waitForService)).rejects.toThrow(
      'temporary failure'
    )
    await expect(ensureUserServiceRunning(manager, directory, waitForService)).resolves.toEqual(
      state
    )

    expect(manager.status).toHaveBeenCalledTimes(2)
    expect(manager.install).toHaveBeenCalledOnce()
  })
})

function createManager(): UserServiceManager {
  return {
    install: vi.fn(async () => undefined),
    start: vi.fn(async () => undefined),
    stop: vi.fn(async () => undefined),
    restart: vi.fn(async () => undefined),
    disable: vi.fn(async () => undefined),
    status: vi.fn(async () => ({
      installed: false,
      running: false,
      state: null,
      definitionPath: '/tmp/loci.service',
      logPaths: []
    })),
    definitionPath: '/tmp/loci.service',
    logPaths: []
  }
}
