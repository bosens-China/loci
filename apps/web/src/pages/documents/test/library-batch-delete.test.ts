import { describe, expect, it, vi } from 'vitest'
import { BatchDeleteError, deleteLibrarySources } from '../library-batch-delete'

describe('文档源批量删除', () => {
  it('等待所有请求结束并返回成功删除的 ID', async () => {
    const deleteOne = vi.fn(async () => undefined)

    await expect(deleteLibrarySources(['one', 'two'], deleteOne)).resolves.toEqual(['one', 'two'])
    expect(deleteOne).toHaveBeenCalledTimes(2)
  })

  it('部分失败时保留成功与失败 ID', async () => {
    const deleteOne = vi.fn(async (id: string) => {
      if (id === 'two') throw new Error('network error')
    })

    await expect(deleteLibrarySources(['one', 'two', 'three'], deleteOne)).rejects.toEqual(
      new BatchDeleteError(['one', 'three'], ['two'])
    )
    expect(deleteOne).toHaveBeenCalledTimes(3)
  })
})
