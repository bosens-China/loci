import { randomUUID } from 'node:crypto'
import type {
  BrowserOperationKind,
  BrowserOperationPhase,
  BrowserOperationStatus,
  LocalBrowserStatus
} from '@loci/shared'
import {
  browserInstallationStatus,
  browserStatus,
  runBrowserCommand,
  type BrowserCommandProgress
} from './browser-crawler.js'
import { acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js'

interface BrowserVerification {
  installed: boolean
  executable: string
  launchable: boolean
  chromiumVersion: string | null
  playwrightVersion: string
  error: string | null
}

interface BrowserManagerOptions {
  browsersPath: string
  lockRoot: string
  usageLockRoot?: string
  owner: string
  beforeUninstall?: () => Promise<void>
  assertCanUninstall?: () => void
  onChange?: (status: BrowserOperationStatus) => void
  runCommand?: typeof runBrowserCommand
  verify?: (browsersPath: string) => Promise<BrowserVerification>
}

interface ActiveOperation {
  id: string
  promise: Promise<void>
}

/** CLI 与本机 Web 共享的浏览器管理状态机；文件锁负责跨进程互斥。 */
export class BrowserManager {
  private operation: BrowserOperationStatus | null = null
  private active: ActiveOperation | null = null
  private verified: LocalBrowserStatus | null = null
  private readonly listeners = new Set<(operation: BrowserOperationStatus) => void>()
  private readonly runCommand: typeof runBrowserCommand
  private readonly verify: (browsersPath: string) => Promise<BrowserVerification>

  constructor(private readonly options: BrowserManagerOptions) {
    this.runCommand = options.runCommand ?? runBrowserCommand
    this.verify = options.verify ?? browserStatus
  }

  async getStatus(): Promise<LocalBrowserStatus> {
    if (this.active) return this.activeStatus()
    const checked = await this.verify(this.options.browsersPath)
    this.verified = {
      installed: checked.installed,
      launchable: checked.launchable,
      executablePath: checked.executable,
      chromiumVersion: checked.chromiumVersion,
      playwrightVersion: checked.playwrightVersion,
      checkedAt: new Date().toISOString(),
      error: checked.error,
      operation: cloneOperation(this.operation)
    }
    return { ...this.verified, operation: cloneOperation(this.operation) }
  }

  start(kind: BrowserOperationKind): BrowserOperationStatus {
    if (this.active) {
      if (this.operation?.kind === kind) return cloneOperation(this.operation)!
      throw new Error(
        `浏览器正在${this.operation?.kind === 'install' ? '安装' : '卸载'}，请等待完成后重试`
      )
    }
    const operationLock = acquireRuntimeLock(
      this.options.lockRoot,
      'browser-management',
      `${this.options.owner}${kind === 'install' ? '安装' : '卸载'}无头浏览器`
    )
    let usageLock: RuntimeLock | undefined
    try {
      if (kind === 'uninstall' && this.options.usageLockRoot) {
        usageLock = acquireRuntimeLock(
          this.options.usageLockRoot,
          'browser-uninstall',
          `${this.options.owner}卸载无头浏览器`
        )
      }
      if (kind === 'uninstall') this.options.assertCanUninstall?.()
    } catch (error) {
      usageLock?.release()
      operationLock.release()
      throw error
    }
    const lock = combineLocks(operationLock, usageLock)
    const operation: BrowserOperationStatus = {
      id: randomUUID(),
      kind,
      state: 'running',
      phase: kind === 'install' ? 'preparing' : 'removing',
      progress: kind === 'install' ? 0 : null,
      message: kind === 'install' ? '正在准备浏览器安装' : '正在准备卸载浏览器',
      startedAt: new Date().toISOString(),
      finishedAt: null,
      error: null
    }
    this.operation = operation
    this.notify()
    const promise = this.execute(operation, lock)
    this.active = { id: operation.id, promise }
    void promise.catch(() => undefined)
    return cloneOperation(operation)!
  }

  async run(kind: BrowserOperationKind): Promise<LocalBrowserStatus> {
    const operation = this.start(kind)
    const active = this.active
    if (active?.id === operation.id) await active.promise
    return this.getStatus()
  }

  async waitForCurrent(): Promise<void> {
    await this.active?.promise
  }

  /** Web transport 订阅当前 Runtime 的浏览器操作进度，不影响 CLI 回调。 */
  subscribe(listener: (operation: BrowserOperationStatus) => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private async execute(operation: BrowserOperationStatus, lock: RuntimeLock): Promise<void> {
    try {
      if (operation.kind === 'install') await this.install(operation)
      else await this.uninstall(operation)
      operation.state = 'succeeded'
      operation.progress = 100
      operation.message = operation.kind === 'install' ? '浏览器安装完成' : '浏览器卸载完成'
      operation.finishedAt = new Date().toISOString()
      this.notify()
    } catch (error) {
      const message = error instanceof Error ? error.message : '浏览器操作失败'
      operation.state = 'failed'
      operation.error = message
      operation.message = message
      operation.finishedAt = new Date().toISOString()
      this.notify()
      throw error
    } finally {
      lock.release()
      if (this.active?.id === operation.id) this.active = null
    }
  }

  private async install(operation: BrowserOperationStatus): Promise<void> {
    await this.runCommand(this.options.browsersPath, 'install', (progress) =>
      this.updateInstallProgress(operation, progress)
    )
    this.update(operation, 'validating', 100, '正在验证浏览器能否启动')
    const checked = await this.verify(this.options.browsersPath)
    if (!checked.launchable) throw new Error(checked.error ?? '浏览器安装后仍无法启动')
    this.verified = verifiedStatus(checked, operation)
  }

  private async uninstall(operation: BrowserOperationStatus): Promise<void> {
    this.update(operation, 'removing', null, '正在停止浏览器并清理安装文件')
    await this.options.beforeUninstall?.()
    await this.runCommand(this.options.browsersPath, 'uninstall')
    const checked = await this.verify(this.options.browsersPath)
    if (checked.installed) throw new Error('浏览器卸载完成，但安装文件仍然存在')
    this.verified = verifiedStatus(checked, operation)
  }

  private updateInstallProgress(
    operation: BrowserOperationStatus,
    progress: BrowserCommandProgress
  ): void {
    const phase: BrowserOperationPhase = progress.progress === 100 ? 'installing' : 'downloading'
    this.update(operation, phase, progress.progress, progress.message)
  }

  private update(
    operation: BrowserOperationStatus,
    phase: BrowserOperationPhase,
    progress: number | null,
    message: string
  ): void {
    operation.phase = phase
    if (progress !== null) operation.progress = progress
    if (message) operation.message = message
    this.notify()
  }

  private activeStatus(): LocalBrowserStatus {
    const installation = browserInstallationStatus(this.options.browsersPath)
    return {
      installed: installation.installed,
      launchable: this.verified?.launchable ?? null,
      executablePath: installation.executable,
      chromiumVersion: this.verified?.chromiumVersion ?? null,
      playwrightVersion: installation.playwrightVersion,
      checkedAt: this.verified?.checkedAt ?? null,
      error: this.verified?.error ?? null,
      operation: cloneOperation(this.operation)
    }
  }

  private notify(): void {
    if (!this.operation) return
    const operation = cloneOperation(this.operation)!
    this.options.onChange?.(operation)
    for (const listener of this.listeners) listener(operation)
  }
}

function combineLocks(primary: RuntimeLock, secondary: RuntimeLock | undefined): RuntimeLock {
  return {
    path: primary.path,
    release: () => {
      secondary?.release()
      primary.release()
    }
  }
}

function verifiedStatus(
  checked: BrowserVerification,
  operation: BrowserOperationStatus
): LocalBrowserStatus {
  return {
    installed: checked.installed,
    launchable: checked.launchable,
    executablePath: checked.executable,
    chromiumVersion: checked.chromiumVersion,
    playwrightVersion: checked.playwrightVersion,
    checkedAt: new Date().toISOString(),
    error: checked.error,
    operation: cloneOperation(operation)
  }
}

function cloneOperation(operation: BrowserOperationStatus | null): BrowserOperationStatus | null {
  return operation ? { ...operation } : null
}
