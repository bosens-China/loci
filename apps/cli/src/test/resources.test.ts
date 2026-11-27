import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createLocalRuntime, type LocalRuntime } from '@loci/runtime'
import { describe, expect, it as base } from 'vitest'
import { library } from '../resources.js'

const it = base.extend<{ runtime: LocalRuntime }>({
  runtime: async ({}, provide) => {
    const root = mkdtempSync(join(tmpdir(), 'loci-cli-resources-'))
    const runtime = createLocalRuntime({ dataDir: root, cacheDir: root })
    try {
      await provide(runtime)
    } finally {
      await runtime.close()
      rmSync(root, { recursive: true, force: true })
    }
  }
})

describe('CLI 文档库引用', () => {
  it('解析普通名称，并优先匹配含 @ 的原始名称和完整 ID', ({ runtime }) => {
    const react = runtime.createSource({ name: 'React', version: 'v19', url: 'https://react.test' })
    const literal = runtime.createSource({ name: 'React@v19', url: 'https://literal.test' })
    runtime.createSource({ name: react.id, url: 'https://other.test' })

    expect(library(runtime, 'React').id).toBe(react.id)
    expect(library(runtime, react.id).id).toBe(react.id)
    expect(library(runtime, 'React@v19').id).toBe(literal.id)
  })

  it('用精确版本限定名称或 ID 前缀，并在名称不唯一时列出候选', ({ runtime }) => {
    const source = { name: 'React', url: 'https://react.test' }
    const v18 = runtime.createSource({ ...source, version: 'v18' })
    const v19 = runtime.createSource({ ...source, version: 'v19' })

    expect(library(runtime, 'React@v18').id).toBe(v18.id)
    expect(library(runtime, 'React@v19').id).toBe(v19.id)
    expect(library(runtime, `${v19.id.slice(0, 8)}@v19`).id).toBe(v19.id)
    expect(() => library(runtime, 'React@v1')).toThrow('未找到文档库：React@v1')
    const ambiguous = () => library(runtime, 'React')
    expect(ambiguous).toThrow(/^文档库名称或短 ID 不唯一：React/)
    expect(ambiguous).toThrow('React@v18')
    expect(ambiguous).toThrow('React@v19')
  })

  it('重名的字面候选不会被另一座库的限定名覆盖', ({ runtime }) => {
    const literal = { name: 'React@v19', url: 'https://literal.test' }
    const first = runtime.createSource({ ...literal, version: 'a' })
    const second = runtime.createSource({ ...literal, version: 'b' })
    runtime.createSource({ name: 'React', version: 'v19', url: 'https://react.test' })

    const resolve = () => library(runtime, 'React@v19')
    expect(resolve).toThrow('文档库名称或短 ID 不唯一')
    expect(resolve).toThrow(first.id)
    expect(resolve).toThrow(second.id)
  })

  it('允许以库名或短 ID 限定包含 @ 的版本', ({ runtime }) => {
    const rc = runtime.createSource({ name: 'React', version: 'v1@rc', url: 'https://react.test' })
    expect(library(runtime, 'React@v1@rc').id).toBe(rc.id)
    expect(library(runtime, `${rc.id.slice(0, 8)}@v1@rc`).id).toBe(rc.id)
  })

  it('支持带作用域的库名与版本', ({ runtime }) => {
    const source = { name: '@scope/pkg', url: 'https://pkg.test' }
    runtime.createSource({ ...source, version: 'v1' })
    const v2 = runtime.createSource({ ...source, version: 'v2' })

    expect(library(runtime, '@scope/pkg@v2').id).toBe(v2.id)
  })
})
