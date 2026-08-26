import { lookup } from 'node:dns/promises'
import type { LookupAddress, LookupAllOptions } from 'node:dns'
import { request as httpRequest, type IncomingMessage, type RequestOptions } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP, type LookupFunction } from 'node:net'
import { Readable } from 'node:stream'
import { createBrotliDecompress, createUnzip } from 'node:zlib'

export type DnsLookup = (hostname: string, options: LookupAllOptions) => Promise<LookupAddress[]>

/** 阻止云端抓取访问回环、局域网和链路本地地址。 */
export function createPublicFetch(lookupImpl: DnsLookup = lookup): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const source = new Request(input, init)
    if (source.method !== 'GET' && source.method !== 'HEAD') {
      throw new TypeError('服务端公开文档抓取只支持 GET 和 HEAD')
    }
    let url = new URL(source.url)
    let headers = new Headers(source.headers)
    if (!headers.has('accept')) headers.set('accept', '*/*')
    if (!headers.has('user-agent')) headers.set('user-agent', 'Loci')
    for (let redirects = 0; redirects <= 5; redirects += 1) {
      const addresses = await assertPublicUrl(url, lookupImpl)
      const response = await requestPinned(url, source.method, headers, source.signal, addresses)
      if (response.status < 300 || response.status >= 400) return response
      const location = response.headers.get('location')
      if (!location) return response
      if (redirects === 5) throw new Error('页面重定向次数过多')
      const next = new URL(location, url)
      await response.body?.cancel()
      if (next.origin !== url.origin) {
        headers = new Headers(headers)
        headers.delete('authorization')
        headers.delete('cookie')
        headers.delete('proxy-authorization')
      }
      url = next
    }
    throw new Error('页面重定向次数过多')
  }) as typeof fetch
}

export async function assertPublicUrl(
  url: URL,
  lookupImpl: DnsLookup = lookup
): Promise<LookupAddress[]> {
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('只允许抓取 HTTP 或 HTTPS')
  const hostname = normalizedHostname(url)
  if (hostname === 'localhost' || hostname.endsWith('.local')) {
    throw new Error('不允许抓取本机或局域网地址')
  }
  const addresses = isIP(hostname)
    ? [{ address: hostname, family: isIP(hostname) }]
    : await lookupImpl(hostname, { all: true, verbatim: true })
  if (addresses.length === 0 || addresses.some(({ address }) => !isPublicAddress(address))) {
    throw new Error('不允许抓取本机或局域网地址')
  }
  return addresses
}

/** 连接阶段只复用刚刚验证过的地址，避免重新解析产生 DNS rebinding 窗口。 */
export function createPinnedLookup(addresses: readonly LookupAddress[]): LookupFunction {
  return (_hostname, options, callback) => {
    if (options.all) {
      callback(null, [...addresses])
      return
    }
    const selected = addresses.find((item) => !options.family || item.family === options.family)
    if (!selected) {
      const error = new Error('没有符合地址族要求的已验证地址') as NodeJS.ErrnoException
      error.code = 'ENOTFOUND'
      callback(error, '')
      return
    }
    callback(null, selected.address, selected.family)
  }
}

function requestPinned(
  url: URL,
  method: string,
  headers: Headers,
  signal: AbortSignal,
  addresses: readonly LookupAddress[]
): Promise<Response> {
  return new Promise((resolve, reject) => {
    const hostname = normalizedHostname(url)
    const options: RequestOptions = {
      protocol: url.protocol,
      hostname,
      port: url.port || undefined,
      path: `${url.pathname}${url.search}`,
      method,
      headers: Object.fromEntries(headers),
      lookup: createPinnedLookup(addresses),
      signal
    }
    const onResponse = (message: IncomingMessage): void => resolve(toResponse(message, url, method))
    const request =
      url.protocol === 'https:'
        ? httpsRequest(
            {
              ...options,
              servername: isIP(hostname) ? undefined : hostname
            },
            onResponse
          )
        : httpRequest(options, onResponse)
    request.once('error', reject)
    request.end()
  })
}

function toResponse(message: IncomingMessage, url: URL, method: string): Response {
  const headers = new Headers()
  for (let index = 0; index < message.rawHeaders.length; index += 2) {
    const name = message.rawHeaders[index]
    const value = message.rawHeaders[index + 1]
    if (name && value !== undefined) headers.append(name, value)
  }
  const status = message.statusCode ?? 500
  const bodyless = method === 'HEAD' || status === 204 || status === 205 || status === 304
  if (bodyless) message.resume()
  const body = bodyless ? null : decodeResponseBody(message, headers)
  return new PublicResponse(
    body,
    { status, statusText: message.statusMessage, headers },
    url.toString()
  )
}

/** Node 原生 request 不会像 fetch 一样自动解压，支持服务器常见的 gzip/deflate/br 编码。 */
export function decodeResponseBody(
  message: Readable,
  headers: Headers
): ReadableStream<Uint8Array> {
  const encodings = (headers.get('content-encoding') ?? '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value && value !== 'identity')
  if (!encodings.every((encoding) => ['gzip', 'x-gzip', 'deflate', 'br'].includes(encoding))) {
    return Readable.toWeb(message) as ReadableStream<Uint8Array>
  }
  let body = message
  for (const encoding of encodings.reverse()) {
    body = body.pipe(encoding === 'br' ? createBrotliDecompress() : createUnzip())
  }
  if (encodings.length) {
    headers.delete('content-encoding')
    headers.delete('content-length')
  }
  return Readable.toWeb(body) as ReadableStream<Uint8Array>
}

class PublicResponse extends Response {
  constructor(
    body: BodyInit | null,
    init: ResponseInit,
    private readonly responseUrl: string
  ) {
    super(body, init)
  }

  override get url(): string {
    return this.responseUrl
  }
}

export function isPublicAddress(address: string): boolean {
  const normalized = address.toLowerCase()
  if (normalized.startsWith('::ffff:')) return isPublicAddress(normalized.slice(7))
  const family = isIP(normalized)
  return family !== 0 && !blockedAddresses.check(normalized, family === 4 ? 'ipv4' : 'ipv6')
}

function normalizedHostname(url: URL): string {
  const hostname = url.hostname.toLowerCase().replace(/\.$/u, '')
  return hostname.startsWith('[') && hostname.endsWith(']') ? hostname.slice(1, -1) : hostname
}

const blockedAddresses = new BlockList()
for (const [network, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.88.99.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 4],
  ['240.0.0.0', 4]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv4')
}
for (const [network, prefix] of [
  ['::', 96],
  ['64:ff9b::', 96],
  ['64:ff9b:1::', 48],
  ['100::', 64],
  ['2001::', 23],
  ['2001:db8::', 32],
  ['2002::', 16],
  ['3fff::', 20],
  ['fc00::', 7],
  ['fe80::', 10],
  ['fec0::', 10],
  ['ff00::', 8]
] as const) {
  blockedAddresses.addSubnet(network, prefix, 'ipv6')
}
