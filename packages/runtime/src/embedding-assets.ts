import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, statSync } from 'node:fs'
import { mkdir, rename, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { Readable, Transform } from 'node:stream'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import { pipeline } from 'node:stream/promises'
import { setTimeout as delay } from 'node:timers/promises'
import { promisify } from 'node:util'
import { openEmbeddingSession, type EmbeddingSession } from './embedding-inference.js'
import type { EmbeddingModel } from './embedding-catalog.js'
import { acquireRuntimeLock, RuntimeLockedError } from './runtime-lock.js'

export interface EmbeddingBackend {
  isInstalled: (model: EmbeddingModel) => boolean
  install: (
    model: EmbeddingModel,
    signal: AbortSignal,
    report: (downloadedBytes: number) => void
  ) => Promise<void>
  open: (model: EmbeddingModel) => Promise<EmbeddingSession>
}

const run = promisify(execFile)
const engineVersion = '1.31.1'
const tokenizerVersion = '0.2.0'

function size(path: string): number {
  try {
    return statSync(path).size
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return 0
    throw error
  }
}

async function verified(path: string, asset: EmbeddingModel['weight']): Promise<boolean> {
  if (size(path) !== asset.bytes) return false
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest('hex') === asset.sha256
}

async function download(
  url: string,
  target: string,
  asset: EmbeddingModel['weight'],
  signal: AbortSignal,
  report: (bytes: number) => void
): Promise<void> {
  if (await verified(target, asset)) return report(asset.bytes)
  const partial = target + '.partial'
  if (await verified(partial, asset)) {
    await rename(partial, target)
    return report(asset.bytes)
  }
  if (size(partial) >= asset.bytes) await rm(partial, { force: true })
  for (let attempt = 0; attempt < 3; attempt++) {
    signal.throwIfAborted()
    let received = size(partial)
    report(received)
    try {
      const response = await fetch(url, {
        signal: AbortSignal.any([signal, AbortSignal.timeout(30 * 60_000)]),
        headers: received ? { Range: `bytes=${received}-` } : undefined
      })
      if (!response.ok || !response.body) {
        await response.body?.cancel()
        throw new Error(`下载失败（HTTP ${response.status}）`)
      }
      const append = received > 0 && response.status === 206
      if (
        response.status === 206 &&
        !response.headers.get('content-range')?.startsWith(`bytes ${received}-`)
      ) {
        await response.body.cancel()
        await rm(partial, { force: true })
        throw new Error('下载续传位置不匹配')
      }
      if (!append) received = 0
      const meter = new Transform({
        transform(chunk: Buffer, _encoding, callback) {
          received += chunk.length
          if (received > asset.bytes) return callback(new Error('下载文件超出记录大小'))
          report(received)
          callback(null, chunk)
        }
      })
      await pipeline(
        Readable.fromWeb(response.body as unknown as NodeReadableStream<Uint8Array>),
        meter,
        createWriteStream(partial, {
          flags: append ? 'a' : 'w',
          mode: 0o600
        }),
        { signal }
      )
      if (!(await verified(partial, asset))) {
        if (size(partial) >= asset.bytes) await rm(partial, { force: true })
        throw new Error('下载文件大小或校验值不匹配')
      }
      signal.throwIfAborted()
      await rename(partial, target)
      return
    } catch (error) {
      signal.throwIfAborted()
      if (attempt === 2) throw error
      await delay(500 * (attempt + 1), undefined, { signal })
    }
  }
}

/** 两种模型共享一份按需安装的 CPU 引擎，缓存目录内原子发布。 */
export function createEmbeddingBackend(dataDir: string): EmbeddingBackend {
  const root = join(dataDir, 'embeddings')
  const engine = join(
    root,
    `engine-${engineVersion}-${tokenizerVersion}-${process.platform}-${process.arch}`
  )
  const engineReady = () => existsSync(join(engine, 'ready'))
  const modelDir = (model: EmbeddingModel) => join(root, model.key)

  async function ensureEngine(signal: AbortSignal) {
    while (!engineReady()) {
      signal.throwIfAborted()
      let lock
      try {
        lock = acquireRuntimeLock(dataDir, 'embeddings-engine', '向量推理引擎安装')
      } catch (error) {
        if (!(error instanceof RuntimeLockedError)) throw error
        await delay(200, undefined, { signal })
        continue
      }
      const stage = `${engine}.${randomUUID()}.tmp`
      try {
        if (engineReady()) return
        await mkdir(stage, { recursive: true })
        await writeFile(join(stage, 'package.json'), '{"private":true}', { mode: 0o600 })
        const args = [
          'install',
          '--ignore-scripts',
          '--no-audit',
          '--no-fund',
          '--no-package-lock',
          '--registry=https://registry.npmjs.org',
          `onnxruntime-node@${engineVersion}`,
          `@huggingface/tokenizers@${tokenizerVersion}`
        ]
        const windows = process.platform === 'win32'
        try {
          await run(windows ? 'cmd.exe' : 'npm', windows ? ['/d', '/c', 'npm', ...args] : args, {
            cwd: stage,
            signal,
            windowsHide: true
          })
        } catch {
          signal.throwIfAborted()
          throw new Error('无法安装本机推理引擎，请检查 npm 和网络后重试')
        }
        await writeFile(join(stage, 'ready'), '')
        await rename(stage, engine)
      } finally {
        try {
          await rm(stage, { recursive: true, force: true })
        } finally {
          lock.release()
        }
      }
    }
  }

  const isInstalled = (model: EmbeddingModel) => {
    const directory = modelDir(model)
    return (
      engineReady() &&
      existsSync(join(directory, 'ready')) &&
      size(join(directory, 'model.onnx')) === model.weight.bytes &&
      size(join(directory, 'tokenizer.json')) === model.tokenizer.bytes
    )
  }

  return {
    isInstalled,
    install: async (model, signal, report) => {
      if (isInstalled(model)) return
      await ensureEngine(signal)
      const directory = modelDir(model)
      await mkdir(directory, { recursive: true })
      const base = `https://huggingface.co/${model.repository}/resolve/${model.revision}/`
      await download(
        base + model.tokenizer.path,
        join(directory, 'tokenizer.json'),
        model.tokenizer,
        signal,
        report
      )
      await download(
        base + model.weight.path,
        join(directory, 'model.onnx'),
        model.weight,
        signal,
        (bytes) => report(model.tokenizer.bytes + bytes)
      )
      signal.throwIfAborted()
      await writeFile(join(directory, 'ready'), '')
    },
    open: (model) => openEmbeddingSession(engine, modelDir(model), model)
  }
}
