import { open, type FileHandle } from 'node:fs/promises'
import { watchFile, unwatchFile } from 'node:fs'
import { CliError, errorMessage } from './errors.js'
import { waitForTermination } from './process-lifecycle.js'

interface LogSnapshot {
  content: Buffer
  identity: string
}

interface LogPosition {
  identity: string
  size: number
}

export interface ServiceLogDependencies {
  readSnapshot: (path: string) => Promise<LogSnapshot | null>
  watch: (path: string, onChange: () => void) => () => void
  waitForTermination: () => Promise<void>
  write: (content: string) => void
  reportError: (path: string, error: unknown) => void
}

export interface ServiceLogOptions {
  lines: number
  follow?: boolean
}

/** 输出最近日志；跟随模式按文件身份和偏移量读取，兼容创建、截断和轮转。 */
export async function showServiceLogs(
  paths: readonly string[],
  options: ServiceLogOptions,
  overrides: Partial<ServiceLogDependencies> = {}
): Promise<void> {
  const dependencies: ServiceLogDependencies = {
    readSnapshot,
    watch: watchLogFile,
    waitForTermination,
    write: (content) => process.stdout.write(content),
    reportError: (path, error) =>
      process.stderr.write(`读取后台服务日志失败：${path}：${errorMessage(error)}\n`),
    ...overrides
  }
  const uniquePaths = [...new Set(paths)]
  const positions = new Map<string, LogPosition>()

  for (const path of uniquePaths) {
    const snapshot = await dependencies.readSnapshot(path)
    if (!snapshot) {
      dependencies.write(`日志尚未创建：${path}\n`)
      positions.set(path, { identity: '', size: 0 })
      continue
    }
    dependencies.write(renderInitialLog(path, snapshot.content, options.lines))
    positions.set(path, { identity: snapshot.identity, size: snapshot.content.length })
  }
  if (!options.follow) return

  dependencies.write('正在跟随后台服务日志，按 Ctrl+C 结束。\n')
  const pending = new Map<string, Promise<void>>()
  const enqueue = (path: string): void => {
    const task = (pending.get(path) ?? Promise.resolve())
      .then(() => appendLog(path, positions, dependencies))
      .catch((error: unknown) => dependencies.reportError(path, error))
    pending.set(path, task)
  }
  const stopWatching = uniquePaths.map((path) => dependencies.watch(path, () => enqueue(path)))
  try {
    await dependencies.waitForTermination()
  } finally {
    for (const stop of stopWatching) stop()
    await Promise.all(pending.values())
  }
}

export function parseServiceLogLines(value: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError('--lines 必须是大于 0 的整数', 2)
  }
  return parsed
}

async function appendLog(
  path: string,
  positions: Map<string, LogPosition>,
  dependencies: ServiceLogDependencies
): Promise<void> {
  const snapshot = await dependencies.readSnapshot(path)
  if (!snapshot) {
    positions.set(path, { identity: '', size: 0 })
    return
  }
  const previous = positions.get(path)
  const offset =
    previous?.identity === snapshot.identity && snapshot.content.length >= previous.size
      ? previous.size
      : 0
  const appended = snapshot.content.subarray(offset)
  positions.set(path, { identity: snapshot.identity, size: snapshot.content.length })
  if (appended.length > 0) dependencies.write(renderLogBlock(path, appended.toString('utf8')))
}

async function readSnapshot(path: string): Promise<LogSnapshot | null> {
  let file: FileHandle | undefined
  try {
    file = await open(path, 'r')
    const stats = await file.stat()
    return { content: await file.readFile(), identity: `${stats.dev}:${stats.ino}` }
  } catch (error) {
    if (isMissingFile(error)) return null
    throw error
  } finally {
    await file?.close()
  }
}

function watchLogFile(path: string, onChange: () => void): () => void {
  watchFile(path, { interval: 250 }, onChange)
  return () => unwatchFile(path, onChange)
}

function renderInitialLog(path: string, content: Buffer, lines: number): string {
  const text = content.toString('utf8')
  if (!text) return `==> ${path} <==\n（日志为空）\n`
  const normalized = text.replace(/\r?\n$/, '')
  const tail = normalized.split(/\r?\n/).slice(-lines).join('\n')
  return renderLogBlock(path, tail)
}

function renderLogBlock(path: string, content: string): string {
  return `==> ${path} <==\n${content}${content.endsWith('\n') ? '' : '\n'}`
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ENOENT'
}
