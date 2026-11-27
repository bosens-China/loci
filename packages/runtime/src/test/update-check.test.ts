import { execFile } from 'node:child_process'
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { promisify } from 'node:util'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { createLocalRuntime } from '../local-runtime.js'
import { startLocalHttpServer } from '../local-http-server.js'
import {
  UPDATE_CACHE_FILE,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_RETRY_INTERVAL_MS,
  checkForCliUpdate,
  isUpdateCheckDue,
  isUpdateCheckRunning,
  isUpdateCheckDisabled,
  readCachedUpdateStatus,
  readUpdateCache,
  shouldCheckForUpdate,
  triggerBackgroundUpdateCheck,
  writeUpdateCache
} from '../update-check.js'

const tempDirs: string[] = []

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'loci-update-check-'))
  tempDirs.push(dir)
  return dir
}

afterEach(() => {
  vi.unstubAllEnvs()
  while (tempDirs.length) {
    const dir = tempDirs.pop()
    if (dir) rmSync(dir, { recursive: true, force: true })
  }
})

describe('update-check', () => {
  it('损坏的缓存文件静默回退为空状态，不抛出异常', () => {
    const cacheDir = makeTempDir()
    writeFileSync(join(cacheDir, UPDATE_CACHE_FILE), '{broken-json')

    expect(readUpdateCache(cacheDir)).toEqual({})
    expect(readCachedUpdateStatus('3.0.0', { cacheDir })).toMatchObject({
      currentVersion: '3.0.0',
      latestVersion: '3.0.0',
      updateAvailable: false,
      checkedAt: null
    })
  })

  it('成功检查 24h 内节流，失败尝试 1h 内节流且保留已有最新版本缓存', async () => {
    const cacheDir = makeTempDir()
    const baseTime = Date.UTC(2026, 10, 27, 8, 0, 0)

    const okFetcher = async () =>
      new Response(JSON.stringify({ version: '3.2.0' }), { status: 200 })

    const first = await checkForCliUpdate('3.0.0', {
      cacheDir,
      fetcher: okFetcher,
      now: baseTime
    })
    expect(first.updateAvailable).toBe(true)
    expect(first.latestVersion).toBe('3.2.0')
    expect(shouldCheckForUpdate(readUpdateCache(cacheDir), baseTime + 60_000)).toBe(false)
    expect(
      shouldCheckForUpdate(readUpdateCache(cacheDir), baseTime + UPDATE_CHECK_INTERVAL_MS)
    ).toBe(true)

    const failTime = baseTime + UPDATE_CHECK_INTERVAL_MS + 1_000
    const failFetcher = async () => new Response('down', { status: 503 })
    await expect(
      checkForCliUpdate('3.0.0', { cacheDir, fetcher: failFetcher, now: failTime })
    ).rejects.toThrow('503')

    const afterFail = readUpdateCache(cacheDir)
    expect(afterFail.latestVersion).toBe('3.2.0')
    expect(shouldCheckForUpdate(afterFail, failTime + 10_000)).toBe(false)
    expect(shouldCheckForUpdate(afterFail, failTime + UPDATE_RETRY_INTERVAL_MS)).toBe(true)
  })

  it('并发调用 checkForCliUpdate 复用 single-flight，只发起一次请求', async () => {
    const cacheDir = makeTempDir()
    let calls = 0
    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })

    const fetcher = async () => {
      calls += 1
      await gate
      return new Response(JSON.stringify({ version: '3.5.0' }), { status: 200 })
    }

    const p1 = checkForCliUpdate('3.0.0', { cacheDir, fetcher })
    const p2 = checkForCliUpdate('4.0.0', { cacheDir, fetcher })
    release()

    const [r1, r2] = await Promise.all([p1, p2])
    expect(calls).toBe(1)
    expect(r1.latestVersion).toBe('3.5.0')
    expect(r2).toMatchObject({ currentVersion: '4.0.0', updateAvailable: false })
  })

  it('后台检查完成后节流，并兼容旧版 checkedOn 字段', async () => {
    const cacheDir = makeTempDir()
    const now = Date.UTC(2026, 10, 27, 9, 0, 0)

    expect(isUpdateCheckDue({ cacheDir, now })).toBe(true)
    await triggerBackgroundUpdateCheck('3.0.0', {
      cacheDir,
      now,
      env: {},
      fetcher: async () => Response.json({ version: '3.4.0' })
    })
    expect(isUpdateCheckDue({ cacheDir, now: now + 1000 })).toBe(false)

    const legacyDir = makeTempDir()
    const todayDate = new Date(now)
    const today = `${todayDate.getFullYear()}-${String(todayDate.getMonth() + 1).padStart(2, '0')}-${String(todayDate.getDate()).padStart(2, '0')}`
    writeUpdateCache({ checkedOn: today, latestVersion: '3.1.0' }, legacyDir)
    expect(isUpdateCheckDue({ cacheDir: legacyDir, now })).toBe(false)
  })

  it('识别禁用自动检查的环境变量', () => {
    expect(isUpdateCheckDisabled({})).toBe(false)
    expect(isUpdateCheckDisabled({ LOCI_NO_UPDATE_CHECK: '1' })).toBe(true)
    expect(isUpdateCheckDisabled({ NO_UPDATE_NOTIFIER: 'true' })).toBe(true)
    expect(isUpdateCheckDisabled({ CI: 'true' })).toBe(true)
  })

  it('跨进程共享检查结果，失败保留上一次成功版本并可重试', async () => {
    const cacheDir = makeTempDir()
    const moduleUrl = pathToFileURL(resolve('src/update-check.ts')).href
    const gate = join(cacheDir, 'resume')
    const script = `
      import { existsSync } from 'node:fs'
      import { setTimeout as delay } from 'node:timers/promises'
      import { checkForCliUpdate } from ${JSON.stringify(moduleUrl)}
      const [cacheDir, gate, outcome] = process.argv.slice(1)
      try {
        const status = await checkForCliUpdate('3.0.0', {
          cacheDir,
          fetcher: async () => {
            while (!existsSync(gate)) await delay(25)
            return outcome === 'success'
              ? Response.json({ version: '3.5.0' })
              : new Response('down', { status: 503 })
          }
        })
        console.log(JSON.stringify(status))
      } catch { console.log('failed') }
    `
    const runChild = (gateFile: string, outcome: string) =>
      promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '-e', script, cacheDir, gateFile, outcome],
        { timeout: 8_000 }
      )
    const joinCheck = () =>
      checkForCliUpdate('3.1.0', {
        cacheDir,
        fetcher: async () => Response.json({ version: '9.9.9' })
      })
    const leader = runChild(gate, 'success')
    await expect.poll(() => isUpdateCheckRunning(cacheDir), { timeout: 3000 }).toBe(true)
    const follower = joinCheck()
    writeFileSync(gate, '')
    expect(await follower).toMatchObject({ currentVersion: '3.1.0', latestVersion: '3.5.0' })
    expect(JSON.parse((await leader).stdout)).toMatchObject({ latestVersion: '3.5.0' })

    const failureGate = join(cacheDir, 'resume-failure')
    const failing = runChild(failureGate, 'failure')
    await expect.poll(() => isUpdateCheckRunning(cacheDir), { timeout: 3000 }).toBe(true)
    const sharedFailure = expect(joinCheck()).rejects.toThrow('在线检查更新失败')
    writeFileSync(failureGate, '')
    await sharedFailure
    expect((await failing).stdout.trim()).toBe('failed')
    expect(readUpdateCache(cacheDir)).toMatchObject({ latestVersion: '3.5.0', failed: true })
    expect(await joinCheck()).toMatchObject({ latestVersion: '9.9.9', checkFailed: false })
  }, 15_000)

  it('Web 可追踪后台检查，并默认将结果写入 Runtime 的隔离缓存', async () => {
    const dir = makeTempDir()
    const cacheDir = join(dir, 'cache')
    const defaultCache = join(dir, 'default-cache')
    vi.stubEnv('LOCI_CACHE_DIR', defaultCache)
    vi.stubEnv('CI', '')
    vi.stubEnv('LOCI_NO_UPDATE_CHECK', '')
    vi.stubEnv('NO_UPDATE_NOTIFIER', '')
    const runtime = createLocalRuntime({ dataDir: dir, cacheDir })

    let release!: () => void
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const server = await startLocalHttpServer(runtime, {
      port: 0,
      currentVersion: '3.0.0',
      updateFetcher: async () => {
        await gate
        return Response.json({ version: '3.4.0' })
      }
    })

    const readStatus = async () => (await fetch(server.endpoint + '/api/update')).json()
    try {
      expect(await readStatus()).toMatchObject({
        currentVersion: '3.0.0',
        checking: true,
        checkedAt: null
      })
      const explicit = fetch(server.endpoint + '/api/update/check', { method: 'POST' })
      release()
      expect(await (await explicit).json()).toMatchObject({
        latestVersion: '3.4.0',
        updateAvailable: true
      })
      await expect.poll(readStatus).toMatchObject({
        latestVersion: '3.4.0',
        updateAvailable: true,
        checking: false,
        checkedAt: expect.any(String)
      })
      expect(readUpdateCache(cacheDir).latestVersion).toBe('3.4.0')
      expect(existsSync(join(defaultCache, UPDATE_CACHE_FILE))).toBe(false)
    } finally {
      release()
      await server.close()
      await runtime.close()
    }
  })
})
