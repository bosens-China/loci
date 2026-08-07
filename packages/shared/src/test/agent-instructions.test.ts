import { describe, expect, it } from 'vitest'
import {
  LOCI_AGENT_INSTRUCTIONS,
  LOCI_CONTEXT7_COMPATIBILITY,
  LOCI_INSTRUCTIONS_END,
  LOCI_INSTRUCTIONS_START,
  mergeLociAgentInstructions
} from '../agent-instructions.js'

describe('Loci Agent 全局规则区块', () => {
  it('追加规则并保持重复执行幂等', () => {
    const first = mergeLociAgentInstructions('# 我的规则\n')

    expect(first).toContain(`# 我的规则\n\n${LOCI_AGENT_INSTRUCTIONS}`)
    expect(mergeLociAgentInstructions(first)).toBe(first)
  })

  it('只替换受管区块并保留 CRLF 与其他内容', () => {
    const current = [
      '# 前置规则',
      '',
      LOCI_INSTRUCTIONS_START,
      '旧内容',
      LOCI_INSTRUCTIONS_END,
      '',
      '# 后置规则',
      ''
    ].join('\r\n')

    const next = mergeLociAgentInstructions(current)

    expect(next).toContain('# 前置规则\r\n\r\n<!-- loci:start -->')
    expect(next).toContain('<!-- loci:end -->\r\n\r\n# 后置规则')
    expect(next).not.toContain('旧内容')
  })

  it('把成对的 Context7 规则替换为组合区块并保持幂等', () => {
    const current = [
      '<!-- context7 -->',
      'Use `npx ctx7@latest library` before reading documentation.',
      '<!-- context7 -->',
      '',
      '# 我的其他规则',
      ''
    ].join('\n')

    const first = mergeLociAgentInstructions(current, { migrateContext7: true })

    expect(first).not.toContain('<!-- context7 -->')
    expect(first).toContain(LOCI_CONTEXT7_COMPATIBILITY)
    expect(first).toContain('## Context7 fallback')
    expect(first).toContain('# 我的其他规则')
    expect(mergeLociAgentInstructions(first, { migrateContext7: true })).toBe(first)
  })

  it('迁移 Context7 时保留已有 Loci 区块位置与其他内容', () => {
    const current = [
      '<!-- context7:start -->',
      'Run `ctx7 docs`.',
      '<!-- context7:end -->',
      '',
      '# 中间规则',
      '',
      LOCI_INSTRUCTIONS_START,
      '旧 Loci 内容',
      LOCI_INSTRUCTIONS_END,
      ''
    ].join('\r\n')

    const next = mergeLociAgentInstructions(current, { migrateContext7: true })

    expect(next).not.toContain('context7:start')
    expect(next).not.toContain('旧 Loci 内容')
    expect(next).toContain('# 中间规则\r\n\r\n<!-- loci:start -->')
    expect(next.match(/<!-- loci:start -->/g)).toHaveLength(1)
  })

  it('只在显式迁移时处理 Context7', () => {
    const current = '<!-- context7 -->\nRun `ctx7 docs`.\n<!-- context7 -->\n'
    const next = mergeLociAgentInstructions(current)

    expect(next).toContain(current)
    expect(next).not.toContain(LOCI_CONTEXT7_COMPATIBILITY)
  })

  it('拒绝不完整或无法安全定位的 Context7 规则', () => {
    expect(() =>
      mergeLociAgentInstructions('<!-- context7 -->\nRun `ctx7 docs`.\n', {
        migrateContext7: true
      })
    ).toThrow('不完整')
    expect(() =>
      mergeLociAgentInstructions('Run `npx ctx7@latest docs` before answering.\n', {
        migrateContext7: true
      })
    ).toThrow('无法安全替换')
  })

  it('拒绝不完整、重复或逆序标记', () => {
    expect(() => mergeLociAgentInstructions(LOCI_INSTRUCTIONS_START)).toThrow('不完整')
    expect(() =>
      mergeLociAgentInstructions(
        `${LOCI_INSTRUCTIONS_START}\n${LOCI_INSTRUCTIONS_START}\n${LOCI_INSTRUCTIONS_END}\n${LOCI_INSTRUCTIONS_END}`
      )
    ).toThrow('重复')
    expect(() =>
      mergeLociAgentInstructions(`${LOCI_INSTRUCTIONS_END}\n${LOCI_INSTRUCTIONS_START}`)
    ).toThrow('顺序')
  })
})
