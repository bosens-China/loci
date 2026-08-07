import { describe, expect, it } from 'vitest'
import {
  LOCI_AGENT_INSTRUCTIONS,
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
