import {
  ApiOutlined,
  CheckCircleFilled,
  CopyOutlined,
  DeleteOutlined,
  FileProtectOutlined,
  ToolOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Button, Tag } from 'antd'
import type {
  AgentClient,
  AgentIntegrationComponentState,
  AgentIntegrationStatus
} from '@loci/shared'
import { getAgentIntegrations, removeAgentIntegration, setupAgentIntegration } from '@/api/agents'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import { canRemoveAgentIntegration } from '@/pages/agent-integration-state'

const QUERY_KEY = ['agent-integrations'] as const

interface MutationInput {
  action: 'setup' | 'remove'
  client: AgentClient
}

export function AgentsPage(): React.JSX.Element {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getAgentIntegrations })
  const mutation = useMutation({
    mutationFn: ({ action, client }: MutationInput) =>
      action === 'setup' ? setupAgentIntegration(client) : removeAgentIntegration(client),
    onSuccess: (result) => {
      queryClient.setQueryData<AgentIntegrationStatus[]>(QUERY_KEY, (current) =>
        current?.map((item) => (item.client === result.status.client ? result.status : item))
      )
      if (result.status.overall === 'attention') {
        void message.warning('操作未完全完成，请处理标记为冲突的配置')
        return
      }
      const manual = result.status.components.some((item) => item.status === 'manual')
      void message.success(
        result.action === 'remove'
          ? 'Loci 自动配置已移除'
          : manual
            ? '自动配置已完成，请继续处理手动项'
            : 'Agent 全局接入已完成'
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const confirmRemove = (status: AgentIntegrationStatus): void => {
    modal.confirm({
      title: `移除 ${status.label} 的 Loci 全局接入？`,
      content: '只移除能确认由 Loci 管理的 MCP、Skill 和 Rules；冲突内容会保留。',
      okText: '移除全局接入',
      cancelText: '取消',
      okButtonProps: { danger: true },
      onOk: () => mutation.mutateAsync({ action: 'remove', client: status.client })
    })
  }

  return (
    <div className="mx-auto max-w-6xl px-8 py-8">
      <PageHeader
        title="Agent 接入"
        description="把 Loci MCP、use-loci Skill 和全局 Rules 接到同一个 Agent。所有写入只发生在当前电脑。"
        action={
          <Button loading={query.isFetching} onClick={() => void query.refetch()}>
            重新检查
          </Button>
        }
      />
      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <div className="panel overflow-hidden">
          <div className="grid grid-cols-[220px_1fr_180px] border-b border-[#d8e0e0] bg-[#f6f9f8] px-5 py-3">
            <span className="eyebrow">Agent</span>
            <span className="eyebrow">接入线路</span>
            <span className="eyebrow text-right">操作</span>
          </div>
          {query.data?.map((status) => (
            <AgentRow
              key={status.client}
              status={status}
              pending={
                mutation.isPending && mutation.variables?.client === status.client
                  ? mutation.variables.action
                  : null
              }
              onSetup={() => mutation.mutate({ action: 'setup', client: status.client })}
              onRemove={() => confirmRemove(status)}
              onCopy={async (content) => {
                try {
                  await navigator.clipboard.writeText(content)
                  void message.success('Rules 已复制')
                } catch {
                  void message.error('无法写入剪贴板，请手动复制')
                }
              }}
            />
          ))}
        </div>
      </AsyncState>
    </div>
  )
}

interface AgentRowProps {
  status: AgentIntegrationStatus
  pending: 'setup' | 'remove' | null
  onSetup: () => void
  onRemove: () => void
  onCopy: (content: string) => Promise<void>
}

function AgentRow(props: AgentRowProps): React.JSX.Element {
  const ready = props.status.overall === 'ready'
  const hasAutomatic = canRemoveAgentIntegration(props.status.components)
  return (
    <section className="grid min-h-132px grid-cols-[220px_1fr_180px] items-center gap-5 border-b border-[#e4eaea] px-5 py-5 last:border-b-0">
      <div>
        <div className="flex items-center gap-2">
          <h2 className="m-0 text-base font-700 text-ink">{props.status.label}</h2>
          <OverallTag status={props.status.overall} />
        </div>
        <p className="mb-0 mt-2 text-xs leading-5 text-muted">
          {ready ? '三项能力均已连接' : overallDescription(props.status)}
        </p>
      </div>
      <div className="relative grid grid-cols-3 gap-3 before:absolute before:left-[16%] before:right-[16%] before:top-5 before:h-px before:bg-[#cbd7d7]">
        {props.status.components.map((component) => (
          <ComponentNode key={component.component} component={component} onCopy={props.onCopy} />
        ))}
      </div>
      <div className="flex justify-end gap-2">
        <Button
          type={ready ? 'default' : 'primary'}
          loading={props.pending === 'setup'}
          disabled={props.pending === 'remove'}
          onClick={props.onSetup}
        >
          {ready ? '检查更新' : '一键接入'}
        </Button>
        <Button
          danger
          icon={<DeleteOutlined />}
          loading={props.pending === 'remove'}
          disabled={!hasAutomatic || props.pending === 'setup'}
          onClick={props.onRemove}
          aria-label={`移除 ${props.status.label} 全局接入`}
        />
      </div>
    </section>
  )
}

function ComponentNode(props: {
  component: AgentIntegrationComponentState
  onCopy: (content: string) => Promise<void>
}): React.JSX.Element {
  const { component } = props
  const icon = {
    mcp: <ApiOutlined />,
    skill: <ToolOutlined />,
    rules: <FileProtectOutlined />
  }[component.component]
  return (
    <div className="relative z-1 flex min-w-0 flex-col items-center text-center">
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full border-2 bg-white text-base ${nodeClass(component.status)}`}
      >
        {component.status === 'current' ? <CheckCircleFilled /> : icon}
      </div>
      <strong className="mt-2 text-xs font-700 text-ink">
        {component.component === 'mcp'
          ? 'MCP'
          : component.component === 'skill'
            ? 'Skill'
            : 'Rules'}
      </strong>
      <span className={`mt-0.5 text-[11px] ${statusTextClass(component.status)}`}>
        {statusLabel(component.status)}
      </span>
      {component.status === 'manual' && component.manualContent && (
        <button
          type="button"
          className="focus-ring mt-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-accent hover:bg-[#e7f3f3]"
          onClick={() => void props.onCopy(component.manualContent!)}
        >
          <CopyOutlined />
          复制规则
        </button>
      )}
      {component.message && component.status !== 'manual' && (
        <span
          className="mt-1 max-w-42 truncate text-[10px] text-[#a4473f]"
          title={component.message}
        >
          {component.message}
        </span>
      )}
    </div>
  )
}

function OverallTag(props: { status: AgentIntegrationStatus['overall'] }): React.JSX.Element {
  const values = {
    ready: { color: 'success', text: '已接入' },
    partial: { color: 'processing', text: '部分完成' },
    missing: { color: 'default', text: '未接入' },
    attention: { color: 'error', text: '需处理' }
  } as const
  const value = values[props.status]
  return <Tag color={value.color}>{value.text}</Tag>
}

function overallDescription(status: AgentIntegrationStatus): string {
  if (status.overall === 'attention') return '存在冲突，请查看具体节点'
  if (status.overall === 'partial') return '自动项与手动项尚未全部完成'
  return '尚未写入 Loci 全局配置'
}

function statusLabel(status: AgentIntegrationComponentState['status']): string {
  return {
    missing: '未配置',
    current: '已就绪',
    outdated: '待更新',
    conflict: '有冲突',
    manual: '需手动'
  }[status]
}

function nodeClass(status: AgentIntegrationComponentState['status']): string {
  return {
    missing: 'border-[#cbd7d7] text-[#7c9092]',
    current: 'border-[#4c9472] text-[#2f7d5c]',
    outdated: 'border-[#d69a45] text-[#b86d10]',
    conflict: 'border-[#c9625b] text-[#b6423c]',
    manual: 'border-[#4d8d96] text-accent'
  }[status]
}

function statusTextClass(status: AgentIntegrationComponentState['status']): string {
  return status === 'conflict'
    ? 'text-[#b6423c]'
    : status === 'current'
      ? 'text-[#2f7d5c]'
      : 'text-muted'
}
