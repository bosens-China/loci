import { homedir } from 'node:os'
import {
  getMcpClientDefinition,
  isAgentClient,
  isAgentGlobalRulesClient,
  listImportableAgentClients,
  LOCI_AGENT_INSTRUCTIONS,
  type AgentClient,
  type AgentIntegrationActionResult,
  type AgentIntegrationComponent,
  type AgentIntegrationComponentState,
  type AgentIntegrationStatus
} from '@loci/shared'
import {
  importAgentClient,
  LOCI_CLI_STDIO_CONNECTION,
  type ImportAgentClientOptions
} from './agent-import.js'
import {
  AGENT_INTEGRATION_LOCK_RETRY_INTERVAL_MS,
  AGENT_INTEGRATION_LOCK_WAIT_TIMEOUT_MS
} from './agent-operation-timing.js'
import {
  inspectAgentGlobalRules,
  installAgentGlobalRules,
  removeAgentGlobalRules
} from './agent-global-rules.js'
import {
  inspectAgentMcpConfigFile,
  removeAgentMcpConfigFile,
  type AgentMcpConfigPathOptions
} from './agent-mcp-config.js'
import type { LociDatabase } from './database.js'
import { RuntimeLockedError, acquireRuntimeLock, type RuntimeLock } from './runtime-lock.js'
import { SkillManager } from './skill-manager.js'

export interface AgentIntegrationOptions extends AgentMcpConfigPathOptions {
  database: LociDatabase
  dataDir: string
  packageVersion: string
  skillResourceDir: string
  owner?: string
  setupMcp?: (client: AgentClient, options: ImportAgentClientOptions) => Promise<void>
}

interface ActiveOperation {
  action: 'setup' | 'remove'
  promise: Promise<AgentIntegrationActionResult>
}

/** CLI 与本机 Web 共用的 Agent 全局接入编排。 */
export class AgentIntegrationService {
  private readonly active = new Map<AgentClient, ActiveOperation>()
  private readonly skillManager: SkillManager

  constructor(private readonly options: AgentIntegrationOptions) {
    this.skillManager = new SkillManager({
      database: options.database,
      dataDir: options.dataDir,
      packageVersion: options.packageVersion,
      skillResourceDir: options.skillResourceDir,
      homeDir: options.homeDir
    })
  }

  list(): AgentIntegrationStatus[] {
    return listImportableAgentClients().map((client) => this.inspect(client.id))
  }

  inspect(client: unknown): AgentIntegrationStatus {
    const selected = requireAgentClient(client)
    const components = [
      this.inspectMcp(selected),
      this.inspectSkill(selected),
      this.inspectRules(selected)
    ]
    return {
      client: selected,
      label: getMcpClientDefinition(selected).label,
      overall: overallStatus(components),
      components
    }
  }

  setup(client: unknown): Promise<AgentIntegrationActionResult> {
    return this.enqueue(requireAgentClient(client), 'setup', (selected) =>
      this.performSetup(selected)
    )
  }

  remove(client: unknown): Promise<AgentIntegrationActionResult> {
    return this.enqueue(requireAgentClient(client), 'remove', (selected) =>
      this.performRemove(selected)
    )
  }

  setupMcp(client: unknown): Promise<AgentIntegrationComponentState> {
    const selected = requireAgentClient(client)
    return this.withClientLock(selected, async () => {
      await this.applyMcpSetup(selected)
      return this.inspectMcp(selected)
    })
  }

  setupRules(client: unknown): Promise<AgentIntegrationComponentState> {
    const selected = requireAgentClient(client)
    return this.withClientLock(selected, async () => {
      await this.applyRulesSetup(selected)
      return this.inspectRules(selected)
    })
  }

  private enqueue(
    client: AgentClient,
    action: 'setup' | 'remove',
    operation: (client: AgentClient) => Promise<AgentIntegrationActionResult>
  ): Promise<AgentIntegrationActionResult> {
    const current = this.active.get(client)
    if (current?.action === action) return current.promise
    const previous = current?.promise.catch(() => undefined) ?? Promise.resolve()
    const promise = previous.then(() => this.withClientLock(client, () => operation(client)))
    const active = { action, promise }
    this.active.set(client, active)
    void promise.then(
      () => {
        if (this.active.get(client) === active) this.active.delete(client)
      },
      () => {
        if (this.active.get(client) === active) this.active.delete(client)
      }
    )
    return promise
  }

  private async performSetup(client: AgentClient): Promise<AgentIntegrationActionResult> {
    let changed = false
    const messages = new Map<AgentIntegrationComponent, string>()
    changed = (await this.tryApply('mcp', messages, () => this.applyMcpSetup(client))) || changed
    changed =
      (await this.tryApply('skill', messages, () => this.applySkillSetup(client))) || changed
    changed =
      (await this.tryApply('rules', messages, () => this.applyRulesSetup(client))) || changed
    return { action: 'setup', changed, status: this.withMessages(this.inspect(client), messages) }
  }

  private async performRemove(client: AgentClient): Promise<AgentIntegrationActionResult> {
    let changed = false
    const messages = new Map<AgentIntegrationComponent, string>()
    changed =
      (await this.tryApply('rules', messages, () => this.applyRulesRemove(client))) || changed
    changed =
      (await this.tryApply('skill', messages, () => this.applySkillRemove(client))) || changed
    changed = (await this.tryApply('mcp', messages, () => this.applyMcpRemove(client))) || changed
    return { action: 'remove', changed, status: this.withMessages(this.inspect(client), messages) }
  }

  private async applyMcpSetup(client: AgentClient): Promise<boolean> {
    const state = this.inspectMcp(client)
    if (state.status === 'current') return false
    if (state.status === 'conflict') throw new Error(state.message ?? 'MCP 配置冲突')
    const setup =
      this.options.setupMcp ??
      (async (selected: AgentClient, options: ImportAgentClientOptions) => {
        await importAgentClient(selected, LOCI_CLI_STDIO_CONNECTION, options)
      })
    await setup(client, this.pathOptions('Agent 全局接入 MCP'))
    return true
  }

  private async applyMcpRemove(client: AgentClient): Promise<boolean> {
    const state = this.inspectMcp(client)
    if (state.status === 'missing') return false
    if (state.status === 'conflict') throw new Error(state.message ?? 'MCP 配置冲突')
    return removeAgentMcpConfigFile(
      client,
      LOCI_CLI_STDIO_CONNECTION,
      this.pathOptions('Agent 全局移除 MCP')
    ).changed
  }

  private async applySkillSetup(client: AgentClient): Promise<boolean> {
    const state = this.inspectSkill(client)
    if (state.status === 'current') return false
    if (state.status === 'conflict') throw new Error(state.message ?? 'Skill 目录冲突')
    const [result] = await this.skillManager.add({ agent: client })
    return result?.action !== 'unchanged'
  }

  private async applySkillRemove(client: AgentClient): Promise<boolean> {
    const state = this.inspectSkill(client)
    if (state.status === 'missing') return false
    if (state.status === 'conflict') throw new Error(state.message ?? 'Skill 目录冲突')
    const [result] = await this.skillManager.remove({ agent: client })
    return result?.action === 'removed'
  }

  private applyRulesSetup(client: AgentClient): boolean {
    const state = this.inspectRules(client)
    if (state.status === 'manual' || state.status === 'current') return false
    if (state.status === 'conflict') throw new Error(state.message ?? '全局规则冲突')
    if (!isAgentGlobalRulesClient(client)) return false
    return installAgentGlobalRules(client, this.rulesOptions('Agent 全局接入 Rules')).changed
  }

  private applyRulesRemove(client: AgentClient): boolean {
    const state = this.inspectRules(client)
    if (state.status === 'manual' || state.status === 'missing') return false
    if (state.status === 'conflict') throw new Error(state.message ?? '全局规则冲突')
    if (!isAgentGlobalRulesClient(client)) return false
    return removeAgentGlobalRules(client, this.rulesOptions('Agent 全局移除 Rules')).changed
  }

  private inspectMcp(client: AgentClient): AgentIntegrationComponentState {
    const state = inspectAgentMcpConfigFile(
      client,
      LOCI_CLI_STDIO_CONNECTION,
      this.pathOptions('Agent MCP 状态')
    )
    return { component: 'mcp', ...state }
  }

  private inspectSkill(client: AgentClient): AgentIntegrationComponentState {
    try {
      const [state] = this.skillManager.preview({ agent: client })
      if (!state) throw new Error('无法解析 Skill 目标')
      const status =
        state.status === 'absent'
          ? 'missing'
          : state.status === 'modified' || state.status === 'conflict'
            ? 'conflict'
            : state.status
      return {
        component: 'skill',
        status,
        path: state.targetPath,
        message: status === 'conflict' ? 'Skill 已被修改或不属于 Loci' : null
      }
    } catch (error) {
      return {
        component: 'skill',
        status: 'conflict',
        path: resolveFallbackSkillPath(client, this.options.homeDir),
        message: error instanceof Error ? error.message : 'Skill 状态无法识别'
      }
    }
  }

  private inspectRules(client: AgentClient): AgentIntegrationComponentState {
    const definition = getMcpClientDefinition(client)
    if (!isAgentGlobalRulesClient(client)) {
      return {
        component: 'rules',
        status: 'manual',
        path: definition.globalRulesPath,
        message: '请在客户端的用户级 Rules 中手动维护 Loci 规则',
        manualContent: LOCI_AGENT_INSTRUCTIONS
      }
    }
    const state = inspectAgentGlobalRules(client, { homeDir: this.options.homeDir })
    return { component: 'rules', ...state }
  }

  private async tryApply(
    component: AgentIntegrationComponent,
    messages: Map<AgentIntegrationComponent, string>,
    operation: () => boolean | Promise<boolean>
  ): Promise<boolean> {
    try {
      return await operation()
    } catch (error) {
      messages.set(component, error instanceof Error ? error.message : '操作失败')
      return false
    }
  }

  private withMessages(
    status: AgentIntegrationStatus,
    messages: Map<AgentIntegrationComponent, string>
  ): AgentIntegrationStatus {
    const components = status.components.map((component) => {
      const error = messages.get(component.component)
      return {
        ...component,
        status: error ? ('conflict' as const) : component.status,
        message: error ?? component.message
      }
    })
    return { ...status, overall: overallStatus(components), components }
  }

  private pathOptions(owner: string): ImportAgentClientOptions {
    return {
      dataDir: this.options.dataDir,
      owner,
      homeDir: this.options.homeDir,
      platform: this.options.platform,
      environment: this.options.environment
    }
  }

  private rulesOptions(owner: string): {
    dataDir: string
    owner: string
    homeDir?: string
  } {
    return { dataDir: this.options.dataDir, owner, homeDir: this.options.homeDir }
  }

  private async withClientLock<T>(client: AgentClient, operation: () => Promise<T>): Promise<T> {
    const lock = await acquireAgentLock(
      this.options.dataDir,
      `agent-integration-${client}`,
      this.options.owner ?? 'Agent 全局接入'
    )
    try {
      return await operation()
    } finally {
      lock.release()
    }
  }
}

function requireAgentClient(client: unknown): AgentClient {
  if (!isAgentClient(client)) throw new Error(`不支持的 Agent 客户端：${String(client)}`)
  return client
}

function overallStatus(
  components: readonly AgentIntegrationComponentState[]
): AgentIntegrationStatus['overall'] {
  const automatic = components.filter((item) => item.status !== 'manual')
  if (automatic.some((item) => item.status === 'conflict' || item.status === 'outdated')) {
    return 'attention'
  }
  if (automatic.every((item) => item.status === 'current')) {
    return components.some((item) => item.status === 'manual') ? 'partial' : 'ready'
  }
  if (automatic.every((item) => item.status === 'missing')) return 'missing'
  return 'partial'
}

function resolveFallbackSkillPath(client: AgentClient, homeDir?: string): string {
  return `${homeDir ?? homedir()}/${getMcpClientDefinition(client).label}/use-loci`
}

async function acquireAgentLock(dataDir: string, key: string, owner: string): Promise<RuntimeLock> {
  const deadline = Date.now() + AGENT_INTEGRATION_LOCK_WAIT_TIMEOUT_MS
  while (true) {
    try {
      return acquireRuntimeLock(dataDir, key, owner)
    } catch (error) {
      if (!(error instanceof RuntimeLockedError)) throw error
      if (Date.now() >= deadline) {
        throw new RuntimeLockedError(
          `等待${error.record?.owner ?? '其他 Loci 入口'}完成超时，请稍后重试`,
          error.record
        )
      }
      await new Promise<void>((resolvePromise) =>
        setTimeout(resolvePromise, AGENT_INTEGRATION_LOCK_RETRY_INTERVAL_MS)
      )
    }
  }
}
