import { describe, expect, it } from 'vitest'
import { createProgram } from '../cli.js'

const program = createProgram()
describe('CLI 公共入口', () => {
  it('帮助只列出当前顶级命令，所有读取和抓取入口提供 JSON', () => {
    const names = [
      'setup',
      'category',
      'skills',
      'fetch',
      'cancel',
      'status',
      'update',
      'list',
      'tree',
      'search',
      'read',
      'doc',
      'delete',
      'ui',
      'browser',
      'config',
      'data',
      'upgrade'
    ]
    expect(program.commands.map((c) => c.name()).sort()).toEqual(names.sort())
    expect(program.helpInformation()).toMatch(/fetch\s+(?:\[options\]\s+)?<urls\.\.\.>/u)
    for (const name of [
      'fetch',
      'cancel',
      'status',
      'update',
      'list',
      'tree',
      'search',
      'read',
      'delete'
    ])
      expect(program.commands.find((c) => c.name() === name)?.helpInformation()).toContain('--json')
  })
})
