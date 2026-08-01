import { Menu, Tray } from 'electron'
import icon from '../../resources/icon.png?asset'

export function createAppTray(onShow: () => void, onQuit: () => void): Tray {
  const tray = new Tray(icon)
  tray.setToolTip('Loci')
  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: '显示主窗口', click: onShow },
      { type: 'separator' },
      { label: '退出 Loci', click: onQuit }
    ])
  )
  tray.on('click', onShow)
  return tray
}
