import { isUrlInScope } from './scope.js'

const allowedProtocols = new Set(['http:', 'https:'])

export function normalizeUrl(input: string): string {
  const url = new URL(input.trim())
  if (!allowedProtocols.has(url.protocol)) {
    throw new Error('文档源只支持 HTTP 或 HTTPS URL')
  }
  url.search = ''
  url.hash = ''
  return url.toString()
}

export function getHostname(input: string): string {
  return new URL(normalizeUrl(input)).hostname
}

export function isSameHostname(input: string, hostname: string): boolean {
  return getHostname(input) === hostname.toLowerCase()
}

export function isAllowedNavigation(input: string, hostname?: string, scopePath = '/'): boolean {
  try {
    normalizeUrl(input)
    return !hostname || isUrlInScope(input, hostname, scopePath)
  } catch {
    return false
  }
}
