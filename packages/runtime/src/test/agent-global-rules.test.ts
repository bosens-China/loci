import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  LOCI_CONTEXT7_COMPATIBILITY,
  LOCI_INSTRUCTIONS_END,
  LOCI_INSTRUCTIONS_START
} from '@loci/shared'
import {
  inspectAgentGlobalRules,
  installAgentGlobalRules,
  removeAgentGlobalRules
} from '../agent-global-rules.js'
import { acquireRuntimeLock } from '../runtime-lock.js'

let root = ''
let homeDir = ''
let dataDir = ''

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'loci-agent-rules-'))
  homeDir = join(root, 'home')
  dataDir = join(root, 'data')
})

afterEach(() => rmSync(root, { recursive: true, force: true }))

describe('Agent 全局规则写入', () => {
  it('保留个人内容并让重复与同时调用保持幂等', async () => {
    const path = join(homeDir, '.claude', 'CLAUDE.md')
    mkdirSync(join(homeDir, '.claude'), { recursive: true })
    writeFileSync(path, '# 我的规则\n', 'utf8')

    const results = await Promise.all(
      [1, 2].map(() =>
        Promise.resolve(installAgentGlobalRules('claude-code', { dataDir, homeDir, owner: '测试' }))
      )
    )
    const content = readFileSync(path, 'utf8')

    expect(results.map((result) => result.changed)).toEqual([true, false])
    expect(content).toContain('# 我的规则')
    expect(content.match(/<!-- loci:start -->/g)).toHaveLength(1)
  })

  it('优先写入 Codex override 并为 VS Code 创建 frontmatter', () => {
    const codexDir = join(homeDir, '.codex')
    mkdirSync(codexDir, { recursive: true })
    const overridePath = join(codexDir, 'AGENTS.override.md')
    writeFileSync(overridePath, '# 临时规则\n', 'utf8')

    expect(installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' }).path).toBe(
      overridePath
    )
    installAgentGlobalRules('vscode', { dataDir, homeDir, owner: '测试' })
    expect(
      readFileSync(join(homeDir, '.copilot', 'instructions', 'loci.instructions.md'), 'utf8')
    ).toMatch(/^---\n[\s\S]*applyTo: "\*\*"[\s\S]*<!-- loci:start -->/)
  })

  it('创建、检查并安全移除 Cursor 本机 MDC 规则', () => {
    const first = installAgentGlobalRules('cursor', { dataDir, homeDir, owner: '测试' })
    const path = join(homeDir, '.cursor', 'rules', 'loci.mdc')
    const content = readFileSync(path, 'utf8')
    const second = installAgentGlobalRules('cursor', { dataDir, homeDir, owner: '测试' })

    expect(first).toMatchObject({ path, changed: true })
    expect(content).toMatch(
      /^---\ndescription: [^\n]+\nglobs:\nalwaysApply: true\n---\n\n<!-- loci:start -->/
    )
    expect(second.changed).toBe(false)
    expect(inspectAgentGlobalRules('cursor', { homeDir }).status).toBe('current')
    expect(removeAgentGlobalRules('cursor', { dataDir, homeDir, owner: '测试' }).changed).toBe(true)
    expect(existsSync(path)).toBe(false)
  })

  it('Cursor 规则保留用户附加内容并拒绝无效 frontmatter', () => {
    const rulesDir = join(homeDir, '.cursor', 'rules')
    const path = join(rulesDir, 'loci.mdc')
    mkdirSync(rulesDir, { recursive: true })
    writeFileSync(
      path,
      '---\ndescription: 自定义\nalwaysApply: true\n---\n\n# 我的附加规则\n',
      'utf8'
    )

    installAgentGlobalRules('cursor', { dataDir, homeDir, owner: '测试' })
    removeAgentGlobalRules('cursor', { dataDir, homeDir, owner: '测试' })
    expect(readFileSync(path, 'utf8')).toContain('# 我的附加规则')

    const invalid = '---\nalwaysApply: false\n---\n\n# 不应修改\n'
    writeFileSync(path, invalid, 'utf8')
    expect(inspectAgentGlobalRules('cursor', { homeDir }).status).toBe('conflict')
    expect(() => installAgentGlobalRules('cursor', { dataDir, homeDir, owner: '测试' })).toThrow(
      'alwaysApply: true'
    )
    expect(readFileSync(path, 'utf8')).toBe(invalid)
  })

  it('检测到 Cursor Context7 本机规则时写入协调说明但不修改原文件', () => {
    const context7Path = join(homeDir, '.cursor', 'rules', 'context7.mdc')
    mkdirSync(join(homeDir, '.cursor', 'rules'), { recursive: true })
    writeFileSync(context7Path, '---\nalwaysApply: true\n---\n\nContext7\n', 'utf8')

    installAgentGlobalRules('cursor', { dataDir, homeDir, owner: '测试' })

    expect(readFileSync(join(homeDir, '.cursor', 'rules', 'loci.mdc'), 'utf8')).toContain(
      LOCI_CONTEXT7_COMPATIBILITY
    )
    expect(readFileSync(context7Path, 'utf8')).toBe('---\nalwaysApply: true\n---\n\nContext7\n')
  })

  it('迁移 Codex 中有边界的 Context7 规则并保留个人规则', () => {
    const codexDir = join(homeDir, '.codex')
    const path = join(codexDir, 'AGENTS.md')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(
      path,
      '<!-- context7 -->\nRun `npx ctx7@latest library` first.\n<!-- context7 -->\n\n# 我的规则\n',
      'utf8'
    )

    installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })
    const content = readFileSync(path, 'utf8')
    const second = installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })

    expect(content).toContain(LOCI_CONTEXT7_COMPATIBILITY)
    expect(content).toContain('# 我的规则')
    expect(content).not.toContain('<!-- context7 -->')
    expect(second.changed).toBe(false)
  })

  it('迁移旧版 Codex Loci 与 Context7 组合规则', () => {
    const codexDir = join(homeDir, '.codex')
    const path = join(codexDir, 'AGENTS.md')
    mkdirSync(codexDir, { recursive: true })
    writeFileSync(
      path,
      '<!-- loci-context7:start -->\nRun `npx ctx7@latest docs` after Loci.\n<!-- loci-context7:end -->\n\n# 我的规则\n',
      'utf8'
    )

    installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })
    const content = readFileSync(path, 'utf8')

    expect(content).toContain(LOCI_CONTEXT7_COMPATIBILITY)
    expect(content).toContain('# 我的规则')
    expect(content).not.toContain('loci-context7')
  })

  it('Context7 Skill 后装后再次写入会升级已有 Loci 规则', () => {
    const first = installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })
    const path = join(homeDir, '.codex', 'AGENTS.md')
    expect(readFileSync(path, 'utf8')).not.toContain(LOCI_CONTEXT7_COMPATIBILITY)

    const skillDir = join(homeDir, '.agents', 'skills', 'context7-mcp')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# Context7\n', 'utf8')
    const second = installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })
    const third = installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })

    expect(first.changed).toBe(true)
    expect(second.changed).toBe(true)
    expect(readFileSync(path, 'utf8')).toContain(LOCI_CONTEXT7_COMPATIBILITY)
    expect(third.changed).toBe(false)
  })

  it('组合规则存在时再次安装 Context7 规则会去重', () => {
    const skillDir = join(homeDir, '.codex', 'skills', 'context7-mcp')
    mkdirSync(skillDir, { recursive: true })
    writeFileSync(join(skillDir, 'SKILL.md'), '# Context7\n', 'utf8')
    const path = join(homeDir, '.codex', 'AGENTS.md')
    installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })
    writeFileSync(
      path,
      `${readFileSync(path, 'utf8')}\n<!-- context7:start -->\n新规则\n<!-- context7:end -->\n`,
      'utf8'
    )

    installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })
    const content = readFileSync(path, 'utf8')

    expect(content).not.toContain('<!-- context7:start -->')
    expect(content).not.toContain('<!-- context7:end -->')
    expect(content.match(/<!-- loci:start -->/g)).toHaveLength(1)
  })

  it('Codex 中未标记的 Context7 规则会中止且不修改文件', () => {
    const codexDir = join(homeDir, '.codex')
    const path = join(codexDir, 'AGENTS.md')
    mkdirSync(codexDir, { recursive: true })
    const original = 'Always run `npx ctx7@latest docs` first.\n'
    writeFileSync(path, original, 'utf8')

    expect(() => installAgentGlobalRules('codex', { dataDir, homeDir, owner: '测试' })).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(original)
  })

  it('跨进程锁释放后可以重试', () => {
    const lock = acquireRuntimeLock(dataDir, 'agent-global-rules-antigravity', '另一个进程')
    expect(() =>
      installAgentGlobalRules('antigravity', { dataDir, homeDir, owner: '测试' })
    ).toThrow()

    lock.release()
    expect(
      installAgentGlobalRules('antigravity', { dataDir, homeDir, owner: '测试' }).changed
    ).toBe(true)
  })

  it('异常标记会中止且不修改原文件', () => {
    const path = join(homeDir, '.gemini', 'GEMINI.md')
    mkdirSync(join(homeDir, '.gemini'), { recursive: true })
    const original = `${LOCI_INSTRUCTIONS_START}\n缺少结束标记\n`
    writeFileSync(path, original, 'utf8')

    expect(() =>
      installAgentGlobalRules('antigravity', { dataDir, homeDir, owner: '测试' })
    ).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(original)
    expect(original).not.toContain(LOCI_INSTRUCTIONS_END)
  })

  it('检查并移除受管区块，保留个人规则', () => {
    const path = join(homeDir, '.claude', 'CLAUDE.md')
    mkdirSync(join(homeDir, '.claude'), { recursive: true })
    writeFileSync(path, '# 我的规则\n', 'utf8')
    installAgentGlobalRules('claude-code', { dataDir, homeDir, owner: '测试' })

    expect(inspectAgentGlobalRules('claude-code', { homeDir }).status).toBe('current')
    expect(removeAgentGlobalRules('claude-code', { dataDir, homeDir, owner: '测试' }).changed).toBe(
      true
    )
    expect(readFileSync(path, 'utf8')).toBe('# 我的规则\n')
    expect(inspectAgentGlobalRules('claude-code', { homeDir }).status).toBe('missing')
  })

  it('异常标记检查为冲突且移除拒绝修改', () => {
    const path = join(homeDir, '.gemini', 'GEMINI.md')
    mkdirSync(join(homeDir, '.gemini'), { recursive: true })
    const original = '<!-- loci:start -->\n不完整\n'
    writeFileSync(path, original, 'utf8')

    expect(inspectAgentGlobalRules('antigravity', { homeDir }).status).toBe('conflict')
    expect(() =>
      removeAgentGlobalRules('antigravity', { dataDir, homeDir, owner: '测试' })
    ).toThrow()
    expect(readFileSync(path, 'utf8')).toBe(original)
  })
})
