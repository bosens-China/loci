import type { BrowserWindow, Input } from 'electron'

type ShortcutInput = Pick<Input, 'alt' | 'control' | 'key' | 'meta' | 'shift' | 'type'>

export function isDevToolsShortcut(input: ShortcutInput, platform = process.platform): boolean {
  if (input.type !== 'keyDown' || input.key.toLowerCase() !== 'i') return false
  return platform === 'darwin' ? input.meta && input.alt : input.control && input.shift
}

/** 仅在应用窗口聚焦时响应，避免占用系统全局快捷键。 */
export function registerDevToolsShortcut(window: BrowserWindow): void {
  window.webContents.on('before-input-event', (event, input) => {
    if (!isDevToolsShortcut(input)) return
    event.preventDefault()
    window.webContents.toggleDevTools()
  })
}
