export function isRequestCancellation(error: unknown, signal?: AbortSignal): boolean {
  return Boolean(signal?.aborted) || (error instanceof Error && error.name === 'AbortError')
}

/** MCP 取消必须沿调用链抛出，不能降级成普通业务失败。 */
export function rethrowRequestCancellation(error: unknown, signal?: AbortSignal): void {
  if (isRequestCancellation(error, signal)) {
    throw signal?.aborted ? (signal.reason ?? error) : error
  }
}
