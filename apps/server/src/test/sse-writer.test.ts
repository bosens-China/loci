import { describe, expect, it } from 'vitest'
import { createSerializedSseWriter } from '../sse-writer.js'

describe('串行 SSE 写入器', () => {
  it('在前一帧完成前不写入下一帧', async () => {
    let resolveFirst: () => void = () => undefined
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirst = resolve
    })
    const events: string[] = []
    const writer = createSerializedSseWriter(
      {
        aborted: false,
        writeSSE: async ({ event }) => {
          if (event) events.push(event)
          if (event === 'first') await firstWrite
        }
      },
      () => undefined
    )

    writer.enqueue({ event: 'first', data: '{}' })
    writer.enqueue({ event: 'second', data: '{}' })
    await Promise.resolve()
    expect(events).toEqual(['first'])

    resolveFirst()
    await writer.drain()
    expect(events).toEqual(['first', 'second'])
  })

  it('写入失败后停止后续帧并收口连接', async () => {
    const events: string[] = []
    let finished = false
    const writer = createSerializedSseWriter(
      {
        aborted: false,
        writeSSE: async ({ event }) => {
          if (event) events.push(event)
          throw new Error('客户端已断开')
        }
      },
      () => {
        finished = true
      }
    )

    writer.enqueue({ event: 'failed', data: '{}' })
    await writer.drain()
    writer.enqueue({ event: 'ignored', data: '{}' })
    await writer.drain()

    expect(finished).toBe(true)
    expect(events).toEqual(['failed'])
  })
})
