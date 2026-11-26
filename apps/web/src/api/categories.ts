import type { CategorySummary } from '@loci/shared'
import { request } from './client'

/** 分类名称允许中文和路径分隔符，构造资源 URL 时编码整个名称。 */
export async function listCategories(): Promise<CategorySummary[]> {
  return (await request.get<CategorySummary[]>('/api/categories')).data
}

export async function createCategory(name: string): Promise<CategorySummary> {
  return (await request.post<CategorySummary>('/api/categories', { name })).data
}

export async function deleteCategory(name: string): Promise<{ deleted: boolean }> {
  // URL 解析器会消除独立的点路径段，末尾的空格在服务端规范化时去除。
  const segment = name === '.' || name === '..' ? `${name} ` : name
  return (
    await request.delete<{ deleted: boolean }>(`/api/categories/${encodeURIComponent(segment)}`)
  ).data
}
