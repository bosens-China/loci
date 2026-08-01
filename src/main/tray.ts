import { readFileSync } from 'node:fs'
import { Menu, Tray, nativeImage, type NativeImage } from 'electron'
import icon from '../../resources/icon.png?asset'
import trayTemplate from '../../resources/trayTemplate.png?asset'
import trayTemplate2x from '../../resources/trayTemplate@2x.png?asset'

export function createAppTray(onShow: () => void, onQuit: () => void): Tray {
  const tray = new Tray(createTrayIcon())
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

function createTrayIcon(): string | NativeImage {
  if (process.platform !== 'darwin') return icon
  const image = nativeImage.createFromPath(trayTemplate)
  image.addRepresentation({ scaleFactor: 2, buffer: readFileSync(trayTemplate2x) })
  image.setTemplateImage(true)
  return image
}
