export class CrawlControl {
  paused = false
  cancelled = false
  readonly done: Promise<void>
  private wait: Promise<void> | null = null
  private resumeWait: (() => void) | null = null
  private readonly cancelDelays = new Set<() => void>()
  private finishDone = (): void => undefined
  private readonly controller = new AbortController()

  get signal(): AbortSignal {
    return this.controller.signal
  }

  constructor() {
    this.done = new Promise((resolve) => {
      this.finishDone = resolve
    })
  }

  pause(): void {
    if (this.paused) return
    this.paused = true
    this.wait = new Promise((resolve) => {
      this.resumeWait = resolve
    })
  }

  resume(): void {
    if (!this.paused) return
    this.paused = false
    this.resumeWait?.()
    this.wait = null
    this.resumeWait = null
  }

  cancel(): void {
    if (this.cancelled) return
    this.cancelled = true
    this.controller.abort(new Error('抓取已取消'))
    this.resume()
    for (const cancelDelay of this.cancelDelays) cancelDelay()
  }

  finish(): void {
    this.finishDone()
  }

  async waitIfPaused(): Promise<void> {
    if (this.paused && this.wait) await this.wait
    this.throwIfCancelled()
  }

  async waitForDelay(milliseconds: number): Promise<void> {
    this.throwIfCancelled()
    await new Promise<void>((resolve, reject) => {
      const cancel = (): void => {
        clearTimeout(timer)
        this.cancelDelays.delete(cancel)
        reject(new Error('抓取已取消'))
      }
      const timer = setTimeout(() => {
        this.cancelDelays.delete(cancel)
        resolve()
      }, milliseconds)
      this.cancelDelays.add(cancel)
    })
  }

  private throwIfCancelled(): void {
    if (this.cancelled) throw new Error('抓取已取消')
  }
}
