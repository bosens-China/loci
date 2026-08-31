import type { SSEMessage } from 'hono/streaming'

/** Hono SSE 流的最小写入边界，方便串行处理背压和断连失败。 */
export interface SseWritable {
  readonly aborted: boolean
  writeSSE(message: SSEMessage): Promise<void>
}

export interface SerializedSseWriter {
  enqueue(message: SSEMessage): void
  drain(): Promise<void>
}

/**
 * SSE 订阅回调不能 await 写入；此队列保持帧顺序，并将一次写入失败收口为连接结束。
 */
export function createSerializedSseWriter(
  stream: SseWritable,
  onFailure: () => void
): SerializedSseWriter {
  let failed = false
  let writes = Promise.resolve()

  const fail = (): void => {
    if (failed) return
    failed = true
    onFailure()
  }

  return {
    enqueue: (message) => {
      if (failed || stream.aborted) return
      writes = writes
        .then(async () => {
          if (failed || stream.aborted) return
          await stream.writeSSE(message)
        })
        .catch(() => {
          fail()
        })
    },
    drain: () => writes
  }
}
