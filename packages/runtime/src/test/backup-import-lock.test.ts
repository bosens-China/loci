import { execFile, spawn } from 'node:child_process'
import { once } from 'node:events'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { expect, it, vi } from 'vitest'
import { createLocalRuntime } from '../local-runtime.js'
import { acquireCrawlRuntimeLock } from '../runtime-lock.js'

it('维护锁拒绝跨进程抓取期间的导入，锁释放后重复提交同一归档共享恢复结果', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'loci-archive-lock-'))
  const runtime = createLocalRuntime({ dataDir: dir, cacheDir: dir })
  try {
    const source = runtime.createSource({ url: 'https://lock.test' })
    const file = join(dir, 'backup.zip')
    const bytes = await runtime.exportBackupArchive()
    writeFileSync(file, bytes)
    const other = runtime.createSource({ url: 'https://other.test' })
    const lock = acquireCrawlRuntimeLock(dir, other.id, '抓取')
    try {
      const script = `
        import { createLocalRuntime } from './src/local-runtime.ts'
        import { readFileSync } from 'node:fs'
        const runtime = createLocalRuntime({ dataDir: process.argv[1], cacheDir: process.argv[1] })
        try { await runtime.importBackupArchive(readFileSync(process.argv[2]), { replaceAll: true }) }
        catch (error) { console.log(error.name) }
        finally { await runtime.close() }
      `
      const { stdout } = await promisify(execFile)(
        process.execPath,
        ['--import', 'tsx', '--input-type=module', '--eval', script, dir, file],
        { cwd: new URL('../../', import.meta.url) }
      )
      expect(stdout.trim()).toBe('RuntimeLockedError')
      expect(runtime.database.hasSource(other.id)).toBe(true)
    } finally {
      lock.release()
    }
    runtime.deleteLibrary(source.id)
    // 在持有维护锁后暂缓读取，保证独立进程实际加入同一在途导入。
    let release = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const restore = runtime.database.importBackupArchive
    vi.spyOn(runtime.database, 'importBackupArchive').mockImplementationOnce(async (...args) => {
      await gate
      return restore(...args)
    })
    const leader = runtime.importBackupArchive(bytes)
    const followerScript = `
      import { createLocalRuntime } from './src/local-runtime.ts'
      import { readFileSync } from 'node:fs'
      const runtime = createLocalRuntime({ dataDir: process.argv[1], cacheDir: process.argv[1] })
      try {
        const imported = runtime.importBackupArchive(readFileSync(process.argv[2]))
        process.send('started')
        process.send(await imported)
      } finally { await runtime.close(); process.disconnect() }
    `
    const child = spawn(
      process.execPath,
      ['--import', 'tsx', '--input-type=module', '--eval', followerScript, dir, file],
      { cwd: new URL('../../', import.meta.url), stdio: ['ignore', 'ignore', 'inherit', 'ipc'] }
    )
    const closed = once(child, 'close')
    try {
      expect((await Promise.race([once(child, 'message'), closed]))[0]).toBe('started')
      const result = once(child, 'message')
      release()
      const summary = await leader
      expect((await Promise.race([result, closed]))[0]).toEqual(summary)
      expect(summary.replacedLibraries).toBe(0)
    } finally {
      release()
      child.kill()
      await closed
      await leader
    }
    expect(runtime.database.listSources()).toHaveLength(2)
  } finally {
    await runtime.close()
    rmSync(dir, { recursive: true, force: true })
  }
})
