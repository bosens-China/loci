import { describe, expect, it } from 'vitest'
import {
  LOCI_AGENT_INSTRUCTIONS,
  LOCI_CONTEXT7_COMPATIBILITY,
  LOCI_INSTRUCTIONS_END,
  LOCI_INSTRUCTIONS_START,
  mergeLociAgentInstructions
} from '../agent-instructions.js'

describe('Loci Agent 全局规则区块', () => {
  it('明确限定技术文档职责并让非文档任务直接选择其他来源', () => {
    expect(LOCI_AGENT_INSTRUCTIONS).toContain('only when a task depends on developer documentation')
    expect(LOCI_AGENT_INSTRUCTIONS).toContain('Do not route general web research through Loci')
    expect(LOCI_AGENT_INSTRUCTIONS).toContain('use the appropriate web or domain source directly')
    expect(LOCI_AGENT_INSTRUCTIONS).toContain(
      'another documentation source or targeted web search only when'
    )
  })

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

  it('迁移旧版 Loci 与 Context7 组合区块并保留其他内容', () => {
    const current = [
      '<!-- loci-context7:start -->',
      '# Technical Documentation: Loci First, Context7 Fallback',
      'Run `npx ctx7@latest docs` only after Loci.',
      '<!-- loci-context7:end -->',
      '',
      '# 我的其他规则',
      ''
    ].join('\r\n')

    const first = mergeLociAgentInstructions(current, { migrateContext7: true })

    expect(first).not.toContain('loci-context7:start')
    expect(first).not.toContain('loci-context7:end')
    expect(first).toContain(LOCI_CONTEXT7_COMPATIBILITY)
    expect(first).toContain('# 我的其他规则')
    expect(first).toContain('\r\n')
    expect(first.match(/<!-- loci:start -->/g)).toHaveLength(1)
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

  it('Context7 后装时把已有 Loci 区块升级为组合规则', () => {
    const current = mergeLociAgentInstructions('# 我的规则\n')
    const next = mergeLociAgentInstructions(current, { context7Available: true })

    expect(current).not.toContain(LOCI_CONTEXT7_COMPATIBILITY)
    expect(next).toContain(LOCI_CONTEXT7_COMPATIBILITY)
    expect(next).toContain('# 我的规则')
    expect(mergeLociAgentInstructions(next, { context7Available: true })).toBe(next)
  })

  it('已有组合规则后再次出现 Context7 区块时仍收敛为单一区块', () => {
    const combined = mergeLociAgentInstructions('', { context7Available: true })
    const current = `${combined}\n<!-- context7:start -->\n新 Context7 规则\n<!-- context7:end -->\n`
    const next = mergeLociAgentInstructions(current, { migrateContext7: true })

    expect(next).not.toContain('<!-- context7:start -->')
    expect(next).not.toContain('<!-- context7:end -->')
    expect(next.match(/<!-- loci:start -->/g)).toHaveLength(1)
    expect(next).toContain(LOCI_CONTEXT7_COMPATIBILITY)
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
    expect(() =>
      mergeLociAgentInstructions('<!-- loci-context7:start -->\nRun `ctx7 docs`.\n', {
        migrateContext7: true
      })
    ).toThrow('不完整')
    expect(() =>
      mergeLociAgentInstructions(
        '<!-- loci-context7:start -->\n旧规则\n<!-- loci-context7:end -->\n<!-- context7 -->\n新规则\n<!-- context7 -->\n',
        { migrateContext7: true }
      )
    ).toThrow('重复')
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
