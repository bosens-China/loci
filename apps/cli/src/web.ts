import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { startLocalHttpServer } from '@loci/runtime'
import { type Command } from 'commander'
import {
  jsonOption,
  natural,
  output,
  withCancellation,
  withRuntime,
  type OutputOptions
} from './command-runtime.js'

function assetsDir() {
  return ['./resources/ui/', './resources/ui/dist/', '../../web/dist/']
    .map((path) => new URL(path, import.meta.url))
    .filter((url) => existsSync(new URL('index.html', url)))
    .map((url) => fileURLToPath(url))[0]
}
function openBrowser(endpoint: string) {
  const executable =
    process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'rundll32' : 'xdg-open'
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler', endpoint] : [endpoint]
  const child = spawn(executable, args, { stdio: 'ignore', windowsHide: true })
  const warn = () => process.stderr.write(`请手动打开 ${endpoint}\n`)
  child.once('error', warn)
  child.once('exit', (code) => {
    if (code) warn()
  })
  child.unref()
}

/** 启动前注册信号处理；关闭 HTTP 连接和进行中的抓取后再关闭数据库。 */
export function registerWebCommand(program: Command): void {
  jsonOption(program.command('ui').description('在前台打开本地 Web 界面'))
    .option('--port <n>', '回环监听端口，0 表示自动选择', natural, 4520)
    .option('--no-open', '只打印地址')
    .action(async (opts: OutputOptions & { port: number; open: boolean }) => {
      await withCancellation((signal) =>
        withRuntime(async (runtime) => {
          const server = await startLocalHttpServer(runtime, {
            port: opts.port,
            assetsDir: assetsDir()
          })
          try {
            output(opts, { url: server.endpoint }, (r) => r.url)
            if (opts.open) openBrowser(server.endpoint)
            if (!signal.aborted)
              await new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => resolve(), { once: true })
              )
          } finally {
            await server.close()
          }
        })
      )
    })
}
