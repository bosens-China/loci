import { readFile, writeFile } from 'node:fs/promises'
import { basename, join } from 'node:path'
import { app, dialog, type BrowserWindow, type OpenDialogOptions } from 'electron'
import type { DataTransferResult } from '../shared/api'
import type { LociBackup } from './database-backup'

export type BackupSelection =
  { canceled: true } | { canceled: false; data: unknown; filename: string }

export async function exportBackupFile(
  parent: BrowserWindow | undefined,
  backup: LociBackup
): Promise<DataTransferResult> {
  const options = {
    title: '导出 Loci 数据',
    defaultPath: join(
      app.getPath('documents'),
      `loci-backup-${backup.exportedAt.slice(0, 10)}.json`
    ),
    filters: [{ name: 'JSON 备份', extensions: ['json'] }]
  }
  const result = parent
    ? await dialog.showSaveDialog(parent, options)
    : await dialog.showSaveDialog(options)
  if (result.canceled || !result.filePath) return { canceled: true, message: '' }
  await writeFile(result.filePath, JSON.stringify(backup, null, 2), 'utf8')
  return { canceled: false, message: `备份已导出：${basename(result.filePath)}` }
}

export async function selectBackupFile(
  parent: BrowserWindow | undefined
): Promise<BackupSelection> {
  const options: OpenDialogOptions = {
    title: '导入 Loci 数据',
    properties: ['openFile'],
    filters: [{ name: 'JSON 备份', extensions: ['json'] }]
  }
  const result = parent
    ? await dialog.showOpenDialog(parent, options)
    : await dialog.showOpenDialog(options)
  const filePath = result.filePaths[0]
  if (result.canceled || !filePath) return { canceled: true }
  try {
    return {
      canceled: false,
      data: JSON.parse(await readFile(filePath, 'utf8')) as unknown,
      filename: basename(filePath)
    }
  } catch (error) {
    if (error instanceof SyntaxError) throw new Error('备份文件不是有效的 JSON')
    throw error
  }
}
