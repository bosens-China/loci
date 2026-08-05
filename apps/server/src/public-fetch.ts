import { lookup } from 'node:dns/promises'
import type { LookupAddress, LookupAllOptions } from 'node:dns'
import { isIP } from 'node:net'

export type DnsLookup = (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>

/** 阻止云端抓取访问回环、局域网和链路本地地址。 */
export function createPublicFetch(lookupImpl: DnsLookup = lookup): typeof fetch {
  return async (input, init) => {
    let url = new URL(input instanceof Request ? input.url : String(input))
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      await assertPublicUrl(url, lookupImpl)
      const response = await fetch(url, { ...init, redirect: 'manual' })
      if (response.status < 300 || response.status >= 400) return response
      const location = response.headers.get('location')
      if (!location) return response
      if (redirects === 5) throw new Error('页面重定向次数过多')
      url = new URL(location, url)
    }
    throw new Error('页面重定向次数过多')
  }
}

export async function assertPublicUrl(url: URL, lookupImpl: DnsLookup = lookup): Promise<void> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许抓取 HTTP 或 HTTPS')
  const hostname = url.hostname.toLowerCase()
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('不允许抓取本机或局域网地址')
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookupImpl(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('不允许抓取本机或局域网地址')
  }
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7))
  if (isIP(normalized) === 4) {
    const [a, b] = normalized.split('.').map(Number)
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    )
  }
  if (isIP(normalized) === 6) {
    return !(
      normalized === '::' ||
      normalized === '::1' ||
      normalized.startsWith('fc') ||
      normalized.startsWith('fd') ||
      /^fe[89ab]/u.test(normalized)
    )
  }
  return false
}
