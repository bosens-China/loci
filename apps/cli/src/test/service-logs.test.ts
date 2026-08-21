import { describe, expect, it, vi } from 'vitest'
import { CliError } from '../errors.js'
import {
  parseServiceLogLines,
  showServiceLogs,
  type ServiceLogDependencies
} from '../service-logs.js'

interface Snapshot {
  content: Buffer
  identity: string
}

describe('后台服务日志', () => {
  it('每个文件默认按指定行数输出，并去重日志路径', async () => {
    let output = ''
    const readSnapshot = vi.fn(async (path: string): Promise<Snapshot | null> =>
      path === '/logs/service.log'
        ? { content: Buffer.from('one\ntwo\nthree\n'), identity: 'main' }
        : null
    )

    await showServiceLogs(
      ['/logs/service.log', '/logs/missing.log', '/logs/service.log'],
      { lines: 2 },
      {
        readSnapshot,
        write: (content) => {
          output += content
        }
      }
    )

    expect(readSnapshot).toHaveBeenCalledTimes(2)
    expect(output).toContain('==> /logs/service.log <==\ntwo\nthree\n')
    expect(output).toContain('日志尚未创建：/logs/missing.log')
  })

  it('跟随尚未创建的文件，并读取追加、截断和轮转后的内容', async () => {
    let snapshot: Snapshot | null = null
    let output = ''
    let notify = (): void => undefined
    let terminate = (): void => undefined
    const stopped = vi.fn()
    const termination = new Promise<void>((resolvePromise) => {
      terminate = resolvePromise
    })
    const dependencies: Partial<ServiceLogDependencies> = {
      readSnapshot: async () => snapshot,
      watch: (_path, onChange) => {
        notify = onChange
        return stopped
      },
      waitForTermination: () => termination,
      write: (content) => {
        output += content
      },
      reportError: vi.fn()
    }

    const following = showServiceLogs(
      ['/logs/service.log'],
      { lines: 50, follow: true },
      dependencies
    )
    await vi.waitFor(() => expect(output).toContain('正在跟随'))

    snapshot = { content: Buffer.from('created\n'), identity: 'first' }
    notify()
    await vi.waitFor(() => expect(output).toContain('created'))
    snapshot = { content: Buffer.from('created\nnext\n'), identity: 'first' }
    notify()
    await vi.waitFor(() => expect(output).toContain('next'))
    snapshot = { content: Buffer.from('short\n'), identity: 'first' }
    notify()
    await vi.waitFor(() => expect(output).toContain('short'))
    snapshot = { content: Buffer.from('rotated\n'), identity: 'second' }
    notify()
    await vi.waitFor(() => expect(output).toContain('rotated'))

    terminate()
    await following
    expect(stopped).toHaveBeenCalledOnce()
    expect(output.match(/created/g)).toHaveLength(1)
  })

  it('拒绝无效的日志行数', () => {
    expect(() => parseServiceLogLines('0')).toThrow(CliError)
    expect(() => parseServiceLogLines('1.5')).toThrow('--lines 必须是大于 0 的整数')
    expect(parseServiceLogLines('25')).toBe(25)
  })
})
