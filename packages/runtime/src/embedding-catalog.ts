import { EMBEDDING_MODEL_IDS, type EmbeddingModelId } from '@loci/shared'

type Asset = { path: string; bytes: number; sha256: string }

export interface EmbeddingModel {
  id: EmbeddingModelId
  name: string
  key: string
  dimensions: number
  maxTokens: number
  pooling: 'mean' | 'cls'
  repository: string
  revision: string
  weight: Asset
  tokenizer: Asset
}

const miniArm64 = process.arch === 'arm64'
const miniWeight = miniArm64
  ? {
      path: 'onnx/model_qint8_arm64.onnx',
      bytes: 118412398,
      sha256: '783fea82d71a58179b830a4dbd2d58447e640609e98eedf9ffa12622d375a672'
    }
  : {
      path: 'onnx/model_quint8_avx2.onnx',
      bytes: 118453870,
      sha256: '98a01d88b7de996cdea58c32ca71208c09968d143798814b2ea09d3439dc334f'
    }

// key 标识权重目录，切分策略可独立升级而无需重新下载模型。
export const EMBEDDING_MODELS = {
  minilm: {
    id: 'minilm',
    name: 'MiniLM',
    key: `minilm-v1-${miniArm64 ? 'arm64' : 'avx2'}`,
    dimensions: 384,
    maxTokens: 512,
    pooling: 'mean',
    repository: 'sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2',
    revision: 'e8f8c211226b894fcb81acc59f3b34ba3efd5f42',
    weight: miniWeight,
    tokenizer: {
      path: 'tokenizer.json',
      bytes: 9081518,
      sha256: '2c3387be76557bd40970cec13153b3bbf80407865484b209e655e5e4729076b8'
    }
  },
  'bge-m3': {
    id: 'bge-m3',
    name: 'BGE-M3',
    key: 'bge-m3-v1-int8',
    dimensions: 1024,
    maxTokens: 8192,
    pooling: 'cls',
    repository: 'Xenova/bge-m3',
    revision: '4de13258303883538bd53b696b452bf8099f0858',
    weight: {
      path: 'onnx/model_int8.onnx',
      bytes: 568456694,
      sha256: 'a206e10e995aa2a833924bcd725ba5dd6c3425cd34bac3cf2b5677cd2a1c51d6'
    },
    tokenizer: {
      path: 'tokenizer.json',
      bytes: 17082821,
      sha256: '6710678b12670bc442b99edc952c4d996ae309a7020c1fa0096dd245c2faf790'
    }
  }
} satisfies Record<EmbeddingModelId, EmbeddingModel>

export function embeddingIndexKey(model: EmbeddingModel): string {
  return `${model.key}:chunks-v2`
}

export function embeddingModelId(value: string): EmbeddingModelId {
  const id = EMBEDDING_MODEL_IDS.find((candidate) => candidate === value)
  if (!id) throw new Error('请选择 minilm 或 bge-m3')
  return id
}

export function embeddingPlatformSupported(): boolean {
  if (process.platform === 'darwin') return process.arch === 'arm64'
  return ['linux', 'win32'].includes(process.platform) && ['arm64', 'x64'].includes(process.arch)
}
