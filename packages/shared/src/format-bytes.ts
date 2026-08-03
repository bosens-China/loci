const KILOBYTE = 1024
const MEGABYTE = KILOBYTE * 1024
const GIGABYTE = MEGABYTE * 1024
const TERABYTE = GIGABYTE * 1024

/** 将原始字节数转换为适合人类阅读的二进制进制大小。 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—'
  if (bytes < KILOBYTE) return `${bytes} B`
  if (bytes < MEGABYTE) return `${(bytes / KILOBYTE).toFixed(1)} KB`
  if (bytes < GIGABYTE) return `${(bytes / MEGABYTE).toFixed(1)} MB`
  if (bytes < TERABYTE) return `${(bytes / GIGABYTE).toFixed(1)} GB`
  return `${(bytes / TERABYTE).toFixed(1)} TB`
}
