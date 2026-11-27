import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, expect, it, vi } from 'vitest'
import { createEmbeddingBackend } from '../embedding-assets.js'
import { EMBEDDING_MODELS } from '../embedding-catalog.js'

let root: string | undefined
afterEach(() => {
  vi.unstubAllGlobals()
  if (root) rmSync(root, { recursive: true, force: true })
})

it('续传只接受正确的位置，校验失败不会发布模型', async () => {
  root = mkdtempSync(join(tmpdir(), 'loci-model-assets-'))
  const engine = join(root, 'embeddings', `engine-1.31.1-0.2.0-${process.platform}-${process.arch}`)
  const directory = join(root, 'embeddings', 'test-hash')
  mkdirSync(engine, { recursive: true })
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(engine, 'ready'), '')
  writeFileSync(join(directory, 'tokenizer.json.partial'), 'tok')
  const asset = (path: string, content: string) => ({
    path,
    bytes: content.length,
    sha256: createHash('sha256').update(content).digest('hex')
  })
  const model = {
    ...EMBEDDING_MODELS.minilm,
    key: 'test-hash',
    tokenizer: asset('tokenizer.json', 'tokenizer'),
    weight: asset('model.onnx', 'model')
  }
  let tokenizerRange: string | undefined
  let validWeight = false
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    if (url.endsWith('/tokenizer.json')) {
      tokenizerRange = new Headers(init.headers).get('Range') ?? undefined
      return new Response('enizer', { status: 206, headers: { 'content-range': 'bytes 3-8/9' } })
    }
    return new Response(validWeight ? 'model' : 'other')
  })
  const backend = createEmbeddingBackend(root)
  const signal = new AbortController().signal
  await expect(backend.install(model, signal, () => undefined)).rejects.toThrow('校验')
  expect(tokenizerRange).toBe('bytes=3-')
  expect(readFileSync(join(directory, 'tokenizer.json'), 'utf8')).toBe('tokenizer')
  expect(backend.isInstalled(model)).toBe(false)

  validWeight = true
  await backend.install(model, signal, () => undefined)
  expect(backend.isInstalled(model)).toBe(true)
})
