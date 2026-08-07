/** 将取消统一转换为 Error，避免各运行时得到不可读的 DOMException 或任意 reason。 */
export function throwIfAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return
  if (signal.reason instanceof Error) throw signal.reason
  throw new Error(typeof signal.reason === 'string' ? signal.reason : '操作已取消')
}

/** 等待期间响应取消；传入的自定义 sleep 可以继续收尾，但调用链立即停止。 */
export async function abortableSleep(
  milliseconds: number,
  signal: AbortSignal | undefined,
  sleep: (milliseconds: number) => Promise<void>
): Promise<void> {
  throwIfAborted(signal)
  if (!signal) return sleep(milliseconds)
  await new Promise<void>((resolve, reject) => {
    const abort = (): void => reject(abortError(signal))
    signal.addEventListener('abort', abort, { once: true })
    void sleep(milliseconds)
      .then(resolve, reject)
      .finally(() => {
        signal.removeEventListener('abort', abort)
      })
  })
}

function abortError(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error(typeof signal.reason === 'string' ? signal.reason : '操作已取消')
}
