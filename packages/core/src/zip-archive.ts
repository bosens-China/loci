import { createHash } from 'node:crypto'
import { ZipFile as OutputZip } from 'yazl'

export interface ZipArchiveEntry {
  path: string
  buffer: Buffer
  mtime?: Date
}

/** ZIP 格式共用的有界读写原语；具体文件清单和校验策略仍由各归档模块负责。 */
export async function createZipArchive(
  entries: readonly ZipArchiveEntry[],
  maxBytes: number,
  tooLargeMessage: string
): Promise<Buffer> {
  const zip = new OutputZip()
  const output = collectArchiveStream(zip.outputStream, maxBytes, tooLargeMessage)
  for (const entry of entries) {
    if (entry.mtime) zip.addBuffer(entry.buffer, entry.path, { mtime: entry.mtime })
    else zip.addBuffer(entry.buffer, entry.path)
  }
  zip.end()
  return output
}

export async function collectArchiveStream(
  stream: NodeJS.ReadableStream,
  maxBytes: number,
  tooLargeMessage: string
): Promise<Buffer> {
  const chunks: Buffer[] = []
  let total = 0
  for await (const chunk of stream) {
    const value = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    total += value.length
    if (total > maxBytes) throw new Error(tooLargeMessage)
    chunks.push(value)
  }
  return Buffer.concat(chunks)
}

export function requireArchiveFile(
  files: ReadonlyMap<string, Buffer>,
  path: string,
  missingMessage: string
): Buffer {
  const value = files.get(path)
  if (!value) throw new Error(missingMessage)
  return value
}

export function readArchiveJson(buffer: Buffer, invalidMessage: string): unknown {
  try {
    return JSON.parse(buffer.toString('utf8')) as unknown
  } catch {
    throw new Error(invalidMessage)
  }
}

export function sha256(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex')
}
