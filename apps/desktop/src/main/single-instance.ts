import { app, type BrowserWindow } from 'electron'

type FocusableWindow = Pick<BrowserWindow, 'isMinimized' | 'restore' | 'show' | 'focus'>

export function registerSingleInstance(getWindow: () => FocusableWindow | undefined): boolean {
  if (!app.requestSingleInstanceLock()) {
    app.quit()
    return false
  }

  app.on('second-instance', () => {
    const window = getWindow()
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })
  return true
}
