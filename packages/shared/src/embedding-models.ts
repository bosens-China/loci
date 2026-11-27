export const EMBEDDING_MODEL_IDS = ['minilm', 'bge-m3'] as const
export type EmbeddingModelId = (typeof EMBEDDING_MODEL_IDS)[number]

export interface EmbeddingModelStatus {
  id: EmbeddingModelId
  name: string
  downloadBytes: number
  installed: boolean
  supported: boolean
  indexed: number
  total: number
  operation?: {
    phase: 'downloading' | 'indexing' | 'failed' | 'cancelled'
    downloadedBytes?: number
    error?: string
  }
}
