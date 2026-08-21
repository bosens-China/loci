import { join } from 'node:path'

export const LOCI_SERVICE_LABEL = 'com.loci.service'

export interface ServiceCommand {
  executable: string
  args: string[]
  environment?: Record<string, string>
}

export function renderLaunchdPlist(command: ServiceCommand, dataDir: string): string {
  const out = join(dataDir, 'logs', 'service.log')
  const error = join(dataDir, 'logs', 'service-error.log')
  const args = [command.executable, ...command.args]
    .map((argument) => `      <string>${escapeXml(argument)}</string>`)
    .join('\n')
  const environment = renderLaunchdEnvironment(command.environment)
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${LOCI_SERVICE_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
${args}
  </array>
  <key>KeepAlive</key>
  <true/>
  <key>ProcessType</key>
  <string>Background</string>
  <key>ThrottleInterval</key>
  <integer>10</integer>
${environment}
  <key>StandardOutPath</key>
  <string>${escapeXml(out)}</string>
  <key>StandardErrorPath</key>
  <string>${escapeXml(error)}</string>
</dict>
</plist>
`
}

export function renderSystemdUnit(command: ServiceCommand, dataDir: string): string {
  const executable = [command.executable, ...command.args].map(quoteSystemd).join(' ')
  const environment = Object.entries(command.environment ?? {})
    .map(([key, value]) => `Environment=${quoteSystemd(`${key}=${value}`)}`)
    .join('\n')
  return `[Unit]
Description=Loci local background service
After=network.target

[Service]
Type=simple
ExecStart=${executable}
${environment}
Restart=on-failure
RestartSec=5
StandardOutput=append:${join(dataDir, 'logs', 'service.log')}
StandardError=append:${join(dataDir, 'logs', 'service-error.log')}

[Install]
WantedBy=default.target
`
}

export function renderWindowsServiceScript(command: ServiceCommand): string {
  const environment = Object.entries(command.environment ?? {})
    .map(([key, value]) => `set "${key}=${value.replaceAll('"', '""')}"`)
    .join('\r\n')
  const start = [command.executable, ...command.args].map(quoteWindows).join(' ')
  return `@echo off\r\n${environment}${environment ? '\r\n' : ''}:loci_service_loop\r\n${start}\r\ntimeout /t 5 /nobreak >nul\r\ngoto loci_service_loop\r\n`
}

function quoteSystemd(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`
}

function quoteWindows(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;')
}

function renderLaunchdEnvironment(environment: Record<string, string> | undefined): string {
  const entries = Object.entries(environment ?? {})
  if (entries.length === 0) return ''
  const values = entries
    .map(
      ([key, value]) => `    <key>${escapeXml(key)}</key>\n    <string>${escapeXml(value)}</string>`
    )
    .join('\n')
  return `  <key>EnvironmentVariables</key>\n  <dict>\n${values}\n  </dict>`
}
