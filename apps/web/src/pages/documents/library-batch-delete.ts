export class BatchDeleteError extends Error {
  constructor(
    readonly succeededIds: string[],
    readonly failedIds: string[]
  ) {
    super('部分文档源删除失败')
    this.name = 'BatchDeleteError'
  }
}

/** 等待所有删除请求收口，避免单个失败掩盖已经完成的删除。 */
export async function deleteLibrarySources(
  ids: string[],
  deleteOne: (id: string) => Promise<unknown>
): Promise<string[]> {
  const results = await Promise.allSettled(ids.map(async (id) => deleteOne(id)))
  const succeededIds: string[] = []
  const failedIds: string[] = []

  results.forEach((result, index) => {
    const id = ids[index]
    if (id === undefined) return
    if (result.status === 'fulfilled') succeededIds.push(id)
    else failedIds.push(id)
  })

  if (failedIds.length) throw new BatchDeleteError(succeededIds, failedIds)
  return succeededIds
}
