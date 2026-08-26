import { describe, expect, it } from 'vitest'
import { Readable } from 'node:stream'
import { brotliCompressSync, gzipSync } from 'node:zlib'
import {
  assertPublicUrl,
  createPinnedLookup,
  decodeResponseBody,
  isPublicAddress
} from '../public-fetch.js'

describe('isPublicAddress', () => {
  it('拦截本机和局域网地址', () => {
    expect(isPublicAddress('127.0.0.1')).toBe(false)
    expect(isPublicAddress('10.0.0.1')).toBe(false)
    expect(isPublicAddress('192.168.1.1')).toBe(false)
    expect(isPublicAddress('::1')).toBe(false)
    expect(isPublicAddress('fd00::1')).toBe(false)
  })

  it('允许公网地址', () => {
    expect(isPublicAddress('1.1.1.1')).toBe(true)
    expect(isPublicAddress('2606:4700:4700::1111')).toBe(true)
  })

  it('返回刚刚校验过的地址供连接阶段复用', async () => {
    const addresses = [
      { address: '1.1.1.1', family: 4 as const },
      { address: '2606:4700:4700::1111', family: 6 as const }
    ]
    const lookup = createPinnedLookup(
      await assertPublicUrl(new URL('https://docs.example.com'), async () => addresses)
    )

    await expect(
      new Promise((resolve, reject) =>
        lookup('docs.example.com', { all: true }, (error, result) =>
          error ? reject(error) : resolve(result)
        )
      )
    ).resolves.toEqual(addresses)
  })

  it('拦截文档、保留和转换用途地址', () => {
    expect(isPublicAddress('192.0.2.1')).toBe(false)
    expect(isPublicAddress('198.51.100.1')).toBe(false)
    expect(isPublicAddress('203.0.113.1')).toBe(false)
    expect(isPublicAddress('64:ff9b::1')).toBe(false)
    expect(isPublicAddress('2001:db8::1')).toBe(false)
    expect(isPublicAddress('fec0::1')).toBe(false)
    expect(isPublicAddress('3fff::1')).toBe(false)
  })

  it('识别带方括号的公网 IPv6 URL literal', async () => {
    await expect(assertPublicUrl(new URL('https://[2606:4700:4700::1111]/'))).resolves.toEqual([
      { address: '2606:4700:4700::1111', family: 6 }
    ])
  })

  it.each([
    ['gzip', gzipSync(Buffer.from('compressed docs'))],
    ['br', brotliCompressSync(Buffer.from('compressed docs'))]
  ])('恢复 fetch 的 %s 自动解压语义', async (encoding, compressed) => {
    const headers = new Headers({ 'content-encoding': encoding, 'content-length': '999' })
    const body = decodeResponseBody(Readable.from(compressed), headers)

    await expect(new Response(body).text()).resolves.toBe('compressed docs')
    expect(headers.has('content-encoding')).toBe(false)
    expect(headers.has('content-length')).toBe(false)
  })
})
