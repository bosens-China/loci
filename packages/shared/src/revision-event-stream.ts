/**
 * 多订阅者共用的 revision 监视器。
 *
 * SQLite 没有跨进程提交回调；服务端只在存在订阅者时读取持久 revision，
 * 将变化广播给全部 SSE 连接，避免每个浏览器页面各自轮询。
 */
export interface RevisionEventStream<T extends Record<string, number>> {
  subscribe: (listener: (revisions: T) => void) => () => void
  close: () => void
}

export function createRevisionEventStream<T extends Record<string, number>>(
  readRevisions: () => T,
  intervalMs = 1_000
): RevisionEventStream<T> {
  const listeners = new Set<(revisions: T) => void>()
  let latest: T | undefined
  let timer: ReturnType<typeof setInterval> | undefined
  let closed = false

  const refresh = (): void => {
    const next = readRevisions()
    if (latest && sameRevisions(latest, next)) return
    latest = next
    for (const listener of listeners) listener(latest)
  }
  const start = (): void => {
    if (timer || closed) return
    timer = setInterval(refresh, intervalMs)
  }
  const stop = (): void => {
    if (!timer) return
    clearInterval(timer)
    timer = undefined
  }

  return {
    subscribe: (listener) => {
      if (closed) return () => undefined
      listeners.add(listener)
      latest = readRevisions()
      listener(latest)
      start()
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) stop()
      }
    },
    close: () => {
      if (closed) return
      closed = true
      stop()
      listeners.clear()
    }
  }
}

function sameRevisions<T extends Record<string, number>>(left: T, right: T): boolean {
  const keys = Object.keys(left)
  return keys.length === Object.keys(right).length && keys.every((key) => left[key] === right[key])
}
