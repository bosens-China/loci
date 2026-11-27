import { randomUUID } from 'node:crypto'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import {
  EMBEDDING_MODEL_IDS,
  type DocumentSearchInput,
  type EmbeddingModelId,
  type EmbeddingModelStatus
} from '@loci/shared'
import { writeFileAtomically } from './atomic-file.js'
import type { LociDatabase } from './database.js'
import { splitEmbeddingMarkdown, type EmbeddingChunk } from './embedding-chunks.js'
import { createEmbeddingBackend, type EmbeddingBackend } from './embedding-assets.js'
import {
  EMBEDDING_MODELS,
  embeddingIndexKey,
  embeddingPlatformSupported,
  type EmbeddingModel
} from './embedding-catalog.js'
import type { EmbeddingSession } from './embedding-inference.js'
import { searchEmbeddingSections } from './embedding-search.js'
import { acquireRuntimeLock, readRuntimeLock, RuntimeLockedError } from './runtime-lock.js'

type Operation = NonNullable<EmbeddingModelStatus['operation']>
type StoredOperation = Operation & { runId: string }

export function createEmbeddingService(
  database: LociDatabase,
  dataDir: string,
  launchRefresh?: (id: EmbeddingModelId) => void,
  backend: EmbeddingBackend = createEmbeddingBackend(dataDir)
) {
  const root = join(dataDir, 'embeddings')
  const sessions = new Map<EmbeddingModelId, Promise<EmbeddingSession>>()
  const running = new Map<EmbeddingModelId, Promise<void>>()
  const refreshRequested = new Map<EmbeddingModelId, number>()
  const lifetime = new AbortController()
  const lockKey = (id: EmbeddingModelId) => `embeddings-${id}`
  const stateFile = (id: EmbeddingModelId) => join(root, `${id}.json`)
  const cancelFile = (id: EmbeddingModelId, runId: string) =>
    join(root, `${id}-${runId.replace(/[^a-f0-9-]/giu, '')}.cancel`)

  function readOperation(id: EmbeddingModelId): StoredOperation | undefined {
    try {
      return JSON.parse(readFileSync(stateFile(id), 'utf8')) as StoredOperation
    } catch (error) {
      if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return undefined
      throw error
    }
  }

  function getStatus(id: EmbeddingModelId): EmbeddingModelStatus {
    const model = EMBEDDING_MODELS[id]
    const supported = embeddingPlatformSupported()
    const installed = supported && backend.isInstalled(model)
    const active = readRuntimeLock(dataDir, lockKey(id))
    const stored = readOperation(id)
    let operation: Operation | undefined
    if (active && stored?.runId !== active.crawlRunId) {
      operation = { phase: installed ? 'indexing' : 'downloading' }
    } else if (stored) {
      const { phase, downloadedBytes, error } = stored
      const state = { phase, downloadedBytes, error }
      operation =
        active || state.phase === 'failed' || state.phase === 'cancelled'
          ? state
          : { phase: 'failed', error: '上次操作已中断，可以重试' }
    }
    return {
      id,
      name: model.name,
      supported,
      installed,
      downloadBytes: model.weight.bytes + model.tokenizer.bytes,
      ...database.embeddingCounts(embeddingIndexKey(model)),
      ...(operation ? { operation } : {})
    }
  }

  function open(model: EmbeddingModel): Promise<EmbeddingSession> {
    const current = sessions.get(model.id)
    if (current) return current
    const job = backend.open(model)
    sessions.set(model.id, job)
    void job.catch(() => sessions.delete(model.id))
    return job
  }

  async function index(model: EmbeddingModel, signal: AbortSignal) {
    let after = ''
    const key = embeddingIndexKey(model)
    const session = await open(model)
    while (true) {
      signal.throwIfAborted()
      const document = database.nextUnindexedDocument(key, after)
      if (!document) return
      after = document.id
      const locations: EmbeddingChunk['location'][] = []
      const vectors: Buffer[] = []
      let batch: string[] = []
      const embedBatch = async () => {
        signal.throwIfAborted()
        const result = await session.embed(batch)
        if (
          result.length !== batch.length ||
          result.some((vector) => vector.length !== model.dimensions)
        )
          throw new Error('模型返回的向量数量或尺寸不正确')
        for (const vector of result)
          vectors.push(Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength))
        batch = []
      }
      for (const chunk of splitEmbeddingMarkdown(document, model.maxTokens, session.countTokens)) {
        locations.push(chunk.location)
        batch.push(chunk.text)
        if (batch.length === 6) await embedBatch()
      }
      if (batch.length) await embedBatch()
      signal.throwIfAborted()
      database.storeDocumentEmbeddings(key, document, locations, Buffer.concat(vectors))
    }
  }

  /** 同一个模型的下载与建索引共享一把跨进程锁。取消文件只对应本次运行。 */
  function start(id: EmbeddingModelId, install = true) {
    lifetime.signal.throwIfAborted()
    const status = getStatus(id)
    if (!status.supported) throw new Error('此平台不支持本机向量模型')
    if (running.has(id) || (!install && !status.installed)) return status
    if (status.installed && status.indexed === status.total && !status.operation) return status
    const runId = randomUUID()
    let lock
    try {
      lock = acquireRuntimeLock(dataDir, lockKey(id), '向量模型', runId)
    } catch (error) {
      if (error instanceof RuntimeLockedError) return getStatus(id)
      throw error
    }
    const model = EMBEDDING_MODELS[id]
    let complete
    try {
      const counts = database.embeddingCounts(embeddingIndexKey(model))
      complete = backend.isInstalled(model) && counts.indexed === counts.total && !readOperation(id)
    } catch (error) {
      lock.release()
      throw error
    }
    if (complete) {
      lock.release()
      return getStatus(id)
    }
    const controller = new AbortController()
    const signal = AbortSignal.any([lifetime.signal, controller.signal])
    const cancel = cancelFile(id, runId)
    const timer = setInterval(() => {
      if (existsSync(cancel)) controller.abort(new Error('操作已取消'))
    }, 150)
    timer.unref()
    const save = (operation: Operation) =>
      writeFileAtomically(stateFile(id), JSON.stringify({ ...operation, runId }))
    const initial = () => save({ phase: backend.isInstalled(model) ? 'indexing' : 'downloading' })
    try {
      initial()
    } catch (error) {
      clearInterval(timer)
      lock.release()
      throw error
    }
    const job = Promise.resolve().then(async () => {
      try {
        if (install && !backend.isInstalled(model)) {
          let lastUpdate = 0
          await backend.install(model, signal, (downloadedBytes) => {
            if (Date.now() - lastUpdate < 500) return
            lastUpdate = Date.now()
            save({ phase: 'downloading', downloadedBytes })
          })
        }
        save({ phase: 'indexing' })
        await index(model, signal)
        signal.throwIfAborted()
        rmSync(stateFile(id), { force: true })
      } catch (error) {
        save(
          signal.aborted
            ? { phase: 'cancelled' }
            : { phase: 'failed', error: operationError(error) }
        )
      } finally {
        clearInterval(timer)
        running.delete(id)
        try {
          rmSync(cancel, { force: true })
        } finally {
          lock.release()
        }
      }
    })
    running.set(id, job)
    void job.catch(() => undefined)
    return getStatus(id)
  }

  function cancel(id: EmbeddingModelId): EmbeddingModelStatus {
    const active = readRuntimeLock(dataDir, lockKey(id))
    if (active?.crawlRunId) writeFileAtomically(cancelFile(id, active.crawlRunId), '')
    return getStatus(id)
  }

  async function wait(id: EmbeddingModelId, signal?: AbortSignal) {
    const stop = () => cancel(id)
    signal?.addEventListener('abort', stop, { once: true })
    try {
      if (signal?.aborted) stop()
      while (readRuntimeLock(dataDir, lockKey(id))) {
        const job = running.get(id)
        if (job) await job
        else await delay(200)
      }
      return getStatus(id)
    } finally {
      signal?.removeEventListener('abort', stop)
    }
  }

  function requestRefresh(id: EmbeddingModelId) {
    const status = getStatus(id)
    if (status.indexed === status.total || status.operation || lifetime.signal.aborted) return
    if (!launchRefresh) {
      start(id, false)
    } else if (Date.now() - (refreshRequested.get(id) ?? 0) > 5000) {
      refreshRequested.set(id, Date.now())
      launchRefresh(id)
    }
  }

  async function prepareSearch(input: DocumentSearchInput) {
    const queries = typeof input.queries === 'string' ? [input.queries] : input.queries
    const results = await Promise.all(
      EMBEDDING_MODEL_IDS.map(async (id) => {
        const model = EMBEDDING_MODELS[id]
        try {
          if (!embeddingPlatformSupported() || !backend.isInstalled(model)) return undefined
          requestRefresh(id)
          if (!database.embeddingCounts(embeddingIndexKey(model)).indexed) return undefined
          const session = await open(model)
          const vectors: Float32Array[] = []
          const texts = [...new Set(queries.map((query) => query.trim().slice(0, 16000)))]
          for (let offset = 0; offset < texts.length; offset += 6)
            vectors.push(
              ...(await session.embed(texts.slice(offset, offset + 6), { truncate: true }))
            )
          return {
            model,
            queries: vectors.map((vector, index) => ({ query: texts[index], vector }))
          }
        } catch {
          // 可选通道报错时，普通搜索仍返回其他通道的结果。
          return undefined
        }
      })
    )
    return () =>
      results.map((result) => {
        if (!result) return []
        try {
          return searchEmbeddingSections(database, result.model, input, result.queries)
        } catch {
          return []
        }
      })
  }

  return {
    list: () => EMBEDDING_MODEL_IDS.map(getStatus),
    getStatus,
    start,
    wait,
    cancel,
    prepareSearch,
    close: async () => {
      lifetime.abort()
      await Promise.allSettled(running.values())
      await Promise.allSettled(
        [...sessions.values()].map(async (session) => (await session).close())
      )
    }
  }
}

export type EmbeddingService = ReturnType<typeof createEmbeddingService>

function operationError(error: unknown): string {
  const detail = error instanceof Error ? error.message : ''
  return !detail || /sqlite|database|ENOENT|EACCES|(?:[\\/][\w.-]+){2,}/iu.test(detail)
    ? '向量模型操作失败，可以重试'
    : detail
}
