import type { EmbeddingModelId, EmbeddingModelStatus } from '@loci/shared'
import { request } from '@/api/client'

export const listEmbeddingModels = async (): Promise<EmbeddingModelStatus[]> => {
  const { data } = await request.get<EmbeddingModelStatus[]>('/api/models')
  return data
}

export const installEmbeddingModel = async (
  id: EmbeddingModelId
): Promise<EmbeddingModelStatus> => {
  const { data } = await request.post<EmbeddingModelStatus>('/api/models/install', { id })
  return data
}

export const cancelEmbeddingModel = async (id: EmbeddingModelId): Promise<EmbeddingModelStatus> => {
  const { data } = await request.post<EmbeddingModelStatus>('/api/models/cancel', { id })
  return data
}
