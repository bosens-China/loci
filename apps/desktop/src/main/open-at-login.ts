import { app } from 'electron'
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import type { OpenAtLoginState } from '@loci/shared'

const HIDDEN_ARGUMENT = '--hidden'

function isSupported(): boolean {
  return app.isPackaged && ['win32', 'darwin', 'linux'].includes(process.platform)
}

function getLinuxAutostartPath(): string {
  const configHome = process.env.XDG_CONFIG_HOME || join(app.getPath('home'), '.config')
  return join(configHome, 'autostart', 'loci.desktop')
}

function quoteDesktopArgument(value: string): string {
  return `"${value.replaceAll('\\', '\\\\\\\\').replace(/["`$]/g, '\\\\$&').replaceAll('%', '%%')}"`
}

function setLinuxOpenAtLogin(enabled: boolean): void {
  const filename = getLinuxAutostartPath()
  if (!enabled) return rmSync(filename, { force: true })

  const executable = process.env.APPIMAGE || process.execPath
  mkdirSync(dirname(filename), { recursive: true })
  writeFileSync(
    filename,
    `[Desktop Entry]\nType=Application\nVersion=1.0\nName=Loci\nExec=${quoteDesktopArgument(executable)} ${HIDDEN_ARGUMENT}\nTerminal=false\nX-GNOME-Autostart-enabled=true\n`,
    { mode: 0o644 }
  )
}

/** 直接以操作系统登录项为准，避免应用配置与系统状态不一致。 */
export function getOpenAtLogin(): OpenAtLoginState {
  const supported = isSupported()
  if (!supported) return { supported, enabled: false }
  if (process.platform === 'linux') {
    return { supported, enabled: existsSync(getLinuxAutostartPath()) }
  }

  const settings = app.getLoginItemSettings(
    process.platform === 'win32' ? { args: [HIDDEN_ARGUMENT] } : undefined
  )
  return {
    supported,
    enabled:
      process.platform === 'win32' ? settings.executableWillLaunchAtLogin : settings.openAtLogin
  }
}

export function setOpenAtLogin(enabled: boolean): OpenAtLoginState {
  if (!isSupported()) return { supported: false, enabled: false }
  if (process.platform === 'linux') setLinuxOpenAtLogin(enabled)
  else
    app.setLoginItemSettings({
      openAtLogin: enabled,
      ...(process.platform === 'win32' ? { args: [HIDDEN_ARGUMENT] } : {})
    })
  return getOpenAtLogin()
}

/** 登录启动只创建托盘，用户主动启动仍显示主窗口。 */
export function shouldStartHidden(): boolean {
  if (process.argv.includes(HIDDEN_ARGUMENT)) return true
  return Boolean(
    process.platform === 'darwin' && app.isPackaged && app.getLoginItemSettings().wasOpenedAtLogin
  )
}
