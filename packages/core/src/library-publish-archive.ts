import { fromBufferPromise } from 'yauzl'
import { z } from 'zod'
import {
  collectArchiveStream,
  createZipArchive,
  readArchiveJson,
  requireArchiveFile,
  sha256
} from './zip-archive.js'

const MAX_BYTES = 256 * 1024 * 1024

const sourceSchema = z.object({
  name: z.string().trim().min(1).max(200),
  url: z.string().url(),
  scopePath: z.string().startsWith('/'),
  pageLimit: z.number().int().min(1).max(10_000)
})
const documentSchema = z.object({
  id: z.string().min(1),
  title: z.string(),
  url: z.string().url(),
  language: z.string(),
  markdown: z.string(),
  crawledAt: z.string(),
  relativePath: z.string().nullable()
})
const manifestSchema = z.object({
  format: z.literal('loci-library-publish'),
  version: z.literal(1),
  publishId: z.string().regex(/^[a-f0-9]{64}$/u),
  checksum: z.string().regex(/^[a-f0-9]{64}$/u),
  mode: z.enum(['create', 'replace']),
  targetLibraryId: z.string().min(1).nullable(),
  source: sourceSchema,
  documentsFile: z.literal('documents.json'),
  documentsCount: z.number().int().nonnegative(),
  documentsSha256: z.string().regex(/^[a-f0-9]{64}$/u)
})

export interface LibraryPublishDocument {
  id: string
  title: string
  url: string
  language: string
  markdown: string
  crawledAt: string
  relativePath: string | null
}

export interface LibraryPublishInput {
  mode: 'create' | 'replace'
  targetLibraryId: string | null
  source: z.infer<typeof sourceSchema>
  documents: LibraryPublishDocument[]
}

export interface LibraryPublishPayload extends LibraryPublishInput {
  publishId: string
  checksum: string
}

export async function createLibraryPublishArchive(input: LibraryPublishInput): Promise<Buffer> {
  const documents = Buffer.from(JSON.stringify(input.documents), 'utf8')
  const documentsSha256 = sha256(documents)
  const checksum = sha256(
    Buffer.from(
      JSON.stringify({
        mode: input.mode,
        targetLibraryId: input.targetLibraryId,
        source: input.source,
        documentsSha256
      })
    )
  )
  const publishId = sha256(
    Buffer.from(`${input.mode}:${input.targetLibraryId ?? 'new'}:${checksum}`)
  )
  const manifest = Buffer.from(
    JSON.stringify({
      format: 'loci-library-publish',
      version: 1,
      publishId,
      checksum,
      mode: input.mode,
      targetLibraryId: input.targetLibraryId,
      source: input.source,
      documentsFile: 'documents.json',
      documentsCount: input.documents.length,
      documentsSha256
    })
  )
  return createZipArchive(
    [
      { path: 'manifest.json', buffer: manifest },
      { path: 'documents.json', buffer: documents }
    ],
    MAX_BYTES,
    '发布归档解压后过大'
  )
}

export async function parseLibraryPublishArchive(buffer: Buffer): Promise<LibraryPublishPayload> {
  if (buffer.length > MAX_BYTES) throw new Error('发布归档不能超过 256 MB')
  const zip = await fromBufferPromise(buffer, {
    lazyEntries: true,
    validateEntrySizes: true,
    strictFileNames: true
  })
  const files = new Map<string, Buffer>()
  try {
    for await (const entry of zip.eachEntry()) {
      if (!['manifest.json', 'documents.json'].includes(entry.fileName)) {
        throw new Error('发布归档包含未知文件')
      }
      if (entry.uncompressedSize > MAX_BYTES) throw new Error('发布归档解压后过大')
      files.set(
        entry.fileName,
        await collectArchiveStream(
          await zip.openReadStreamPromise(entry),
          MAX_BYTES,
          '发布归档解压后过大'
        )
      )
    }
  } finally {
    if (zip.isOpen) zip.close()
  }
  if (files.size !== 2) throw new Error('发布归档文件不完整')
  const manifest = manifestSchema.parse(
    readArchiveJson(
      requireArchiveFile(files, 'manifest.json', '发布归档缺少 manifest.json'),
      '发布归档包含无效 JSON'
    )
  )
  const documentBuffer = requireArchiveFile(
    files,
    manifest.documentsFile,
    `发布归档缺少 ${manifest.documentsFile}`
  )
  if (sha256(documentBuffer) !== manifest.documentsSha256) throw new Error('发布正文校验失败')
  const documents = z
    .array(documentSchema)
    .parse(readArchiveJson(documentBuffer, '发布归档包含无效 JSON'))
  if (documents.length !== manifest.documentsCount) throw new Error('发布正文数量不一致')
  const checksum = sha256(
    Buffer.from(
      JSON.stringify({
        mode: manifest.mode,
        targetLibraryId: manifest.targetLibraryId,
        source: manifest.source,
        documentsSha256: manifest.documentsSha256
      })
    )
  )
  if (checksum !== manifest.checksum) throw new Error('发布清单校验失败')
  return { ...manifest, documents }
}
