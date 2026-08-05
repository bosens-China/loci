export type BrowserProvider = 'browserless' | 'local'

export type BrowserConfig = { provider: 'local' } | { provider: 'browserless'; endpoint: string }

type BrowserEnvironment = Partial<
  Pick<NodeJS.ProcessEnv, 'LOCI_BROWSER_PROVIDER' | 'LOCI_BROWSER_TOKEN' | 'LOCI_BROWSER_URL'>
>

/** 默认不开启浏览器；Docker 使用本地 headless shell，也兼容远程 Browserless。 */
export function readBrowserConfig(
  environment: BrowserEnvironment = process.env
): BrowserConfig | undefined {
  const endpointValue = environment.LOCI_BROWSER_URL?.trim()
  const providerValue = environment.LOCI_BROWSER_PROVIDER?.trim()
  const token = environment.LOCI_BROWSER_TOKEN?.trim()
  if (!endpointValue && !providerValue && !token) return undefined

  const provider = readProvider(providerValue)
  if (provider === 'local') {
    if (endpointValue || token) throw new Error('本地浏览器不使用 LOCI_BROWSER_URL 或令牌')
    return { provider }
  }
  if (!endpointValue) throw new Error('配置远程浏览器时必须设置 LOCI_BROWSER_URL')
  return readBrowserlessEndpoint(new URL(endpointValue), token)
}

function readProvider(providerValue: string | undefined): BrowserProvider {
  if (!providerValue) return 'browserless'
  if (providerValue === 'browserless' || providerValue === 'local') {
    return providerValue
  }
  throw new Error('LOCI_BROWSER_PROVIDER 只支持 local 或 browserless')
}

function readBrowserlessEndpoint(endpoint: URL, token: string | undefined): BrowserConfig {
  if (!token) throw new Error('Browserless 必须设置 LOCI_BROWSER_TOKEN')
  if (!['ws:', 'wss:'].includes(endpoint.protocol)) {
    throw new Error('Browserless LOCI_BROWSER_URL 必须使用 ws 或 wss')
  }
  endpoint.searchParams.set('token', token)
  return { provider: 'browserless', endpoint: endpoint.toString() }
}
