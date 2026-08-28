import { describe, expect, it, vi } from 'vitest'
import { createRevisionEventStream } from '../revision-event-stream.js'

describe('revision 事件流', () => {
  it('多个订阅者共用一个检查器，并只广播变化后的持久版本', () => {
    vi.useFakeTimers()
    let revision = 1
    const read = vi.fn(() => ({ sources: revision }))
    const stream = createRevisionEventStream(read, 1_000)
    const first = vi.fn()
    const second = vi.fn()

    const releaseFirst = stream.subscribe(first)
    const releaseSecond = stream.subscribe(second)
    expect(first).toHaveBeenLastCalledWith({ sources: 1 })
    expect(second).toHaveBeenLastCalledWith({ sources: 1 })

    vi.advanceTimersByTime(1_000)
    expect(first).toHaveBeenCalledTimes(1)
    expect(second).toHaveBeenCalledTimes(1)

    revision = 2
    vi.advanceTimersByTime(1_000)
    expect(first).toHaveBeenLastCalledWith({ sources: 2 })
    expect(second).toHaveBeenLastCalledWith({ sources: 2 })

    releaseFirst()
    releaseSecond()
    const callsAfterRelease = read.mock.calls.length
    vi.advanceTimersByTime(2_000)
    expect(read).toHaveBeenCalledTimes(callsAfterRelease)
    stream.close()
    vi.useRealTimers()
  })
})
