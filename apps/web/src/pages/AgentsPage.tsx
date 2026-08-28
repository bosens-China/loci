import { useMemo } from 'react'
import {
  ApiOutlined,
  CheckCircleFilled,
  CopyOutlined,
  DeleteOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  RobotOutlined,
  ToolOutlined
} from '@ant-design/icons'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { App, Avatar, Button, Card, Col, Row, Space, Tag, Tooltip, Typography } from 'antd'
import type {
  AgentClient,
  AgentIntegrationComponentState,
  AgentIntegrationStatus
} from '@loci/shared'
import { getAgentIntegrations, removeAgentIntegration, setupAgentIntegration } from '@/api/agents'
import { AsyncState } from '@/components/AsyncState'
import { PageHeader } from '@/components/PageHeader'
import {
  canRemoveAgentIntegration,
  resolveAgentIntegrationFeedback,
  type AgentIntegrationActionIntent
} from '@/pages/agent-integration-state'

const QUERY_KEY = ['agent-integrations'] as const

interface MutationInput {
  action: AgentIntegrationActionIntent
  client: AgentClient
}

/** Agent 接入管理页：展示并管理各个 Agent 客户端的 MCP、Skill 和 Rules 接入状态。 */
export function AgentsPage(): React.JSX.Element {
  const { message, modal } = App.useApp()
  const queryClient = useQueryClient()
  const query = useQuery({ queryKey: QUERY_KEY, queryFn: getAgentIntegrations })
  const mutation = useMutation({
    mutationFn: ({ action, client }: MutationInput) =>
      action === 'remove' ? removeAgentIntegration(client) : setupAgentIntegration(client),
    onSuccess: (result, variables) => {
      queryClient.setQueryData<AgentIntegrationStatus[]>(QUERY_KEY, (current) =>
        current?.map((item) => (item.client === result.status.client ? result.status : item))
      )
      showAgentIntegrationFeedback(
        resolveAgentIntegrationFeedback(result, variables.action),
        message
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

  const list = query.data ?? []
  const readyCount = useMemo(
    () => (query.data ?? []).filter((i) => i.overall === 'ready').length,
    [query.data]
  )
  const attentionCount = useMemo(
    () => (query.data ?? []).filter((i) => i.overall === 'attention').length,
    [query.data]
  )

  return (
    <div className="px-6 py-6 sm:px-8 sm:py-8">
      <PageHeader
        title="Agent 接入"
        description="把 Loci MCP、use-loci Skill 和全局 Rules 接到同一个 Agent。所有写入只发生在当前电脑。"
        action={
          <Button
            icon={<ReloadOutlined />}
            loading={query.isFetching}
            onClick={() => void query.refetch()}
          >
            重新检查
          </Button>
        }
      />

      {/* 状态统计看板 */}
      <Card size="small" className="mb-5 shadow-xs">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-[var(--ant-color-primary)] text-lg text-[var(--ant-color-text-light-solid)]">
              <RobotOutlined />
            </div>
            <div>
              <div className="text-sm font-semibold">支持 {list.length} 款主流 AI 编程助手</div>
              <div className="mt-0.5 text-xs text-[var(--ant-color-text-secondary)]">
                已完全接入{' '}
                <span className="font-semibold text-[var(--ant-color-success)]">{readyCount}</span>{' '}
                款 · 待处理/需注意{' '}
                <span className="font-semibold text-[var(--ant-color-warning)]">
                  {attentionCount}
                </span>{' '}
                款
              </div>
            </div>
          </div>
          <Typography.Text type="secondary" className="text-xs">
            自动管理 MCP 协议、Skill 指令与文档 Rules
          </Typography.Text>
        </div>
      </Card>

      <AsyncState
        loading={query.isLoading}
        error={query.error}
        onRetry={() => void query.refetch()}
      >
        <div className="space-y-4">
          {list.map((status) => (
            <AgentCard
              key={status.client}
              status={status}
              pending={
                mutation.isPending && mutation.variables?.client === status.client
                  ? mutation.variables.action === 'remove'
                    ? 'remove'
                    : 'setup'
                  : null
              }
              onSetup={() =>
                mutation.mutate({
                  action: status.overall === 'ready' ? 'update' : 'setup',
                  client: status.client
                })
              }
              onRemove={() => confirmRemove(status)}
              onCopy={async (content) => {
                try {
                  await navigator.clipboard.writeText(content)
                  void message.success('Rules 已复制到剪贴板')
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

function showAgentIntegrationFeedback(
  feedback: ReturnType<typeof resolveAgentIntegrationFeedback>,
  message: ReturnType<typeof App.useApp>['message']
): void {
  if (feedback === 'attention') {
    void message.warning('操作未完全完成，请处理标记为冲突的配置')
  } else if (feedback === 'unchanged') {
    void message.info('当前接入已是最新')
  } else if (feedback === 'update-completed') {
    void message.success('Agent 全局接入已更新')
  } else if (feedback === 'setup-completed') {
    void message.success('Agent 全局接入已完成')
  } else if (feedback === 'manual-completed') {
    void message.success('自动配置已完成，请继续处理手动项')
  } else if (feedback === 'manual-unchanged') {
    void message.info('自动配置已是最新，请继续处理手动项')
  } else if (feedback === 'removed') {
    void message.success('Loci 自动配置已移除')
  } else {
    void message.info('当前没有可移除的 Loci 自动配置')
  }
}

interface AgentCardProps {
  status: AgentIntegrationStatus
  pending: 'setup' | 'remove' | null
  onSetup: () => void
  onRemove: () => void
  onCopy: (content: string) => Promise<void>
}

function AgentCard(props: AgentCardProps): React.JSX.Element {
  const ready = props.status.overall === 'ready'
  const hasAutomatic = canRemoveAgentIntegration(props.status.components)

  return (
    <Card
      hoverable
      className="shadow-xs overflow-hidden transition-all hover:border-[var(--ant-color-primary)]"
      styles={{ body: { padding: '16px 20px' } }}
    >
      {/* 头部：Agent 身份、状态与操作按钮 */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--ant-color-border-secondary)] pb-3">
        <div className="flex items-center gap-3">
          <Avatar
            shape="square"
            size="default"
            icon={<RobotOutlined />}
            className="bg-[var(--ant-color-fill-quaternary)]! text-[var(--ant-color-primary)]!"
          />
          <div>
            <div className="flex items-center gap-2">
              <Typography.Text strong className="text-base">
                {props.status.label}
              </Typography.Text>
              <OverallTag status={props.status.overall} />
            </div>
            <Typography.Text type="secondary" className="block text-xs mt-0.5">
              {ready ? '三项能力均已就绪并连接' : overallDescription(props.status)}
            </Typography.Text>
          </div>
        </div>

        <Space size={8}>
          <Button
            type={ready ? 'default' : 'primary'}
            loading={props.pending === 'setup'}
            disabled={props.pending === 'remove'}
            onClick={props.onSetup}
          >
            {ready ? '检查更新' : '一键接入'}
          </Button>
          <Tooltip title={hasAutomatic ? '移除自动写入的接入配置' : '当前无自动配置可移除'}>
            <Button
              danger
              icon={<DeleteOutlined />}
              loading={props.pending === 'remove'}
              disabled={!hasAutomatic || props.pending === 'setup'}
              onClick={props.onRemove}
              aria-label={`移除 ${props.status.label} 全局接入`}
            />
          </Tooltip>
        </Space>
      </div>

      {/* 核心路线：MCP · Skill · Rules 三项指标卡片 */}
      <div className="pt-4">
        <Row gutter={[12, 12]}>
          {props.status.components.map((component) => (
            <Col xs={24} sm={8} key={component.component}>
              <ComponentTile component={component} onCopy={props.onCopy} />
            </Col>
          ))}
        </Row>
      </div>
    </Card>
  )
}

function ComponentTile(props: {
  component: AgentIntegrationComponentState
  onCopy: (content: string) => Promise<void>
}): React.JSX.Element {
  const { component } = props
  const config = {
    mcp: { title: 'MCP 服务', icon: <ApiOutlined />, subtitle: '@loci/server 工具协议' },
    skill: { title: 'use-loci Skill', icon: <ToolOutlined />, subtitle: 'Prompt 技能指令' },
    rules: { title: '全局 Rules', icon: <FileProtectOutlined />, subtitle: '文档查询指引规范' }
  }[component.component]

  const isCurrent = component.status === 'current'

  return (
    <div className="flex h-full flex-col justify-between rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-tertiary)] p-3 transition-colors hover:bg-[var(--ant-color-fill-secondary)]">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span
              className={`text-sm ${isCurrent ? 'text-[var(--ant-color-success)]' : 'text-[var(--ant-color-text-secondary)]'}`}
            >
              {isCurrent ? <CheckCircleFilled /> : config.icon}
            </span>
            <Typography.Text strong className="text-xs">
              {config.title}
            </Typography.Text>
          </div>
          <Tag color={statusTagColor(component.status)} className="m-0! text-[11px]">
            {statusLabel(component.status)}
          </Tag>
        </div>
        <Typography.Text type="secondary" className="mt-1.5 block text-[11px]">
          {config.subtitle}
        </Typography.Text>
      </div>

      <div className="mt-2 pt-2 border-t border-[var(--ant-color-border-secondary)] flex items-center justify-between min-h-6">
        {component.status === 'manual' && component.manualContent ? (
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            className="p-0! text-xs h-auto"
            onClick={() => void props.onCopy(component.manualContent!)}
          >
            复制全局 Rules
          </Button>
        ) : component.message && component.status !== 'manual' ? (
          <Tooltip title={component.message}>
            <Typography.Text type="danger" ellipsis className="text-xs max-w-full cursor-help">
              {component.message}
            </Typography.Text>
          </Tooltip>
        ) : (
          <Typography.Text type="secondary" className="text-[11px]">
            {isCurrent ? '状态正常' : '点击上方一键接入'}
          </Typography.Text>
        )}
      </div>
    </div>
  )
}

function OverallTag(props: { status: AgentIntegrationStatus['overall'] }): React.JSX.Element {
  const values = {
    ready: { color: 'success', text: '已接入' },
    partial: { color: 'processing', text: '部分就绪' },
    missing: { color: 'default', text: '未接入' },
    attention: { color: 'error', text: '需处理' }
  } as const
  const value = values[props.status]
  return (
    <Tag color={value.color} className="m-0!">
      {value.text}
    </Tag>
  )
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

function statusTagColor(status: AgentIntegrationComponentState['status']): string | undefined {
  return {
    missing: undefined,
    current: 'success',
    outdated: 'warning',
    conflict: 'error',
    manual: 'processing'
  }[status]
}
