import {
  existsSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync
} from 'node:fs'
import { randomUUID } from 'node:crypto'
import { basename, dirname, resolve } from 'node:path'

/** 原子替换文本文件；保留已有文件权限，并避免通过符号链接替换链接本身。 */
export function writeFileAtomically(path: string, content: string): void {
  mkdirSync(dirname(path), { recursive: true })
  const target = existsSync(path) ? realpathSync(path) : path
  const tempPath = resolve(
    dirname(target),
    `.${basename(target)}.${process.pid}.${randomUUID()}.tmp`
  )
  try {
    writeFileSync(tempPath, content, {
      encoding: 'utf8',
      flag: 'wx',
      mode: existsSync(target) ? statSync(target).mode : 0o600
    })
    renameSync(tempPath, target)
  } finally {
    rmSync(tempPath, { force: true })
  }
}
