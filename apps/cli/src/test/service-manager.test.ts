import { describe, expect, it } from 'vitest'
import {
  renderLaunchdPlist,
  renderSystemdUnit,
  renderWindowsServiceScript
} from '../service-manager.js'

const command = {
  executable: '/usr/local/bin/node',
  args: ['/opt/loci/dist/index.js', 'service', 'run', '--managed'],
  environment: { LOCI_DATA_DIR: '/tmp/loci data' }
}

describe('service manager definitions', () => {
  it('生成不经过 shell 的 launchd 用户服务定义', () => {
    const plist = renderLaunchdPlist(command, '/Users/test/Library/Application Support/Loci')
    expect(plist).toContain('<string>com.loci.service</string>')
    expect(plist).toContain('<string>/usr/local/bin/node</string>')
    expect(plist).toContain('<key>KeepAlive</key>')
    expect(plist).toContain('<string>Background</string>')
    expect(plist).toContain('<key>LOCI_DATA_DIR</key>')
  })

  it('生成登录后启用的 systemd user service', () => {
    const unit = renderSystemdUnit(command, '/home/test/.config/Loci')
    expect(unit).toContain('ExecStart="/usr/local/bin/node"')
    expect(unit).toContain('Restart=on-failure')
    expect(unit).toContain('WantedBy=default.target')
    expect(unit).toContain('Environment="LOCI_DATA_DIR=/tmp/loci data"')
  })

  it('生成 Windows Task Scheduler 调用脚本', () => {
    const script = renderWindowsServiceScript({
      executable: 'C:\\Program Files\\nodejs\\node.exe',
      args: ['C:\\Users\\test\\loci\\index.js', 'service', 'run', '--managed']
    })
    expect(script).toContain('"C:\\Program Files\\nodejs\\node.exe"')
    expect(script).toContain('service')
    expect(script).toContain('--managed')
    expect(script).toContain(':loci_service_loop')
    expect(script).toContain('timeout /t 5')
  })
})
