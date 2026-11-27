import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { join } from 'node:path'
import type { EmbeddingModel } from './embedding-catalog.js'

export interface EmbeddingSession {
  countTokens: (text: string) => number
  embed: (inputs: readonly string[], options?: { truncate?: boolean }) => Promise<Float32Array[]>
  close: () => Promise<void>
}

type Tensor = { data: unknown; dims: readonly number[] }
interface OnnxSession {
  inputNames: readonly string[]
  outputNames: readonly string[]
  run: (feeds: Record<string, Tensor>) => Promise<Record<string, Tensor>>
  release: () => Promise<void>
}
interface OnnxRuntime {
  Tensor: new (type: 'int64', input: BigInt64Array, dims: number[]) => Tensor
  InferenceSession: {
    create: (
      path: string,
      options: { executionProviders: string[]; intraOpNumThreads: number }
    ) => Promise<OnnxSession>
  }
}
interface Tokenizers {
  Tokenizer: new (
    tokenizer: unknown,
    config: object
  ) => {
    encode: (text: string, options: { add_special_tokens: boolean }) => { ids: number[] }
    token_to_id: (text: string) => number | undefined
  }
}

const maxBatchedInputTokens = 512

/** 可选引擎由显式安装写入本机数据目录，普通关键词搜索无需加载它。 */
export async function openEmbeddingSession(
  engine: string,
  directory: string,
  model: EmbeddingModel
): Promise<EmbeddingSession> {
  const requireEngine = createRequire(join(engine, 'package.json'))
  const onnx = requireEngine('onnxruntime-node') as OnnxRuntime
  const { Tokenizer } = requireEngine('@huggingface/tokenizers') as Tokenizers
  const tokenizer = new Tokenizer(
    JSON.parse(readFileSync(join(directory, 'tokenizer.json'), 'utf8')) as unknown,
    {}
  )
  const tokenIds = (text: string) => tokenizer.encode(text, { add_special_tokens: true }).ids
  const pad = BigInt(tokenizer.token_to_id('<pad>') ?? 1)
  const session = await onnx.InferenceSession.create(join(directory, 'model.onnx'), {
    executionProviders: ['cpu'],
    intraOpNumThreads: 2
  })
  async function embedRows(rows: number[][]): Promise<Float32Array[]> {
    const width = Math.max(...rows.map((row) => row.length))
    const ids = new BigInt64Array(rows.length * width).fill(pad)
    const mask = new BigInt64Array(ids.length)
    const types = new BigInt64Array(ids.length)
    for (const [index, row] of rows.entries()) {
      ids.set(row.map(BigInt), index * width)
      mask.fill(1n, index * width, index * width + row.length)
    }
    const inputs = { input_ids: ids, attention_mask: mask, token_type_ids: types }
    const feeds: Record<string, Tensor> = {}
    for (const name of session.inputNames) {
      if (!(name in inputs)) throw new Error('向量模型输入格式不受支持')
      feeds[name] = new onnx.Tensor('int64', inputs[name as keyof typeof inputs], [
        rows.length,
        width
      ])
    }
    const results = await session.run(feeds)
    const output = results.last_hidden_state ?? results[session.outputNames[0]]
    if (
      !(output?.data instanceof Float32Array) ||
      output.dims.length !== 3 ||
      output.dims[0] !== rows.length ||
      output.dims[1] !== width ||
      output.dims[2] !== model.dimensions
    )
      throw new Error('向量模型输出尺寸不正确')
    const values = output.data
    return rows.map((row, index) => {
      const vector = new Float32Array(model.dimensions)
      const tokens = model.pooling === 'cls' ? 1 : row.length
      for (let token = 0; token < tokens; token++) {
        const offset = (index * width + token) * vector.length
        for (let dim = 0; dim < vector.length; dim++) vector[dim] += values[offset + dim]
      }
      const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0))
      if (!Number.isFinite(norm) || norm === 0) throw new Error('模型返回了无效向量')
      return vector.map((value) => value / norm)
    })
  }

  return {
    countTokens: (text) => tokenIds(text).length,
    embed: async (texts, options) => {
      const rows = texts.map((text) => {
        const ids = tokenIds(text)
        if (ids.length <= model.maxTokens) return ids
        if (!options?.truncate) throw new Error('向量索引片段超出模型输入上限')
        return [...ids.slice(0, model.maxTokens - 1), ids.at(-1)!]
      })
      if (!rows.length) return []
      if (rows.every((row) => row.length <= maxBatchedInputTokens)) return embedRows(rows)
      // 长序列单独推理，避免给同一批短输入填充大量无用 token。
      const vectors: Float32Array[] = []
      for (const row of rows) vectors.push(...(await embedRows([row])))
      return vectors
    },
    close: () => session.release()
  }
}
