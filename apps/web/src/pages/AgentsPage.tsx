import { useMemo } from 'react'
import {
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

/** Agent 接入管理页：以 use-loci Skill 与 全局 Rules 两列展示并管理各个 Agent 客户端。 */
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
      content: '只移除能确认由 Loci 管理的 Skill 和 Rules；冲突内容会安全保留。',
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
        description="把 use-loci Skill 与全局 Rules 接入到主流 Agent。所有配置均只保存在当前电脑本地。"
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
            自动部署 use-loci 技能与知识库检索全局规则
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
              {ready ? 'Skill 与 Rules 均已就绪并连接' : overallDescription(props.status)}
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

      {/* 两列布局：use-loci Skill 与 全局 Rules */}
      <div className="pt-4">
        <Row gutter={[16, 16]}>
          {props.status.components.map((component) => (
            <Col xs={24} sm={12} key={component.component}>
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
  const isSkill = props.component.component === 'skill'
  const title = isSkill ? 'use-loci Skill' : '全局 Rules'
  const icon = isSkill ? <ToolOutlined /> : <FileProtectOutlined />

  return (
    <div className="h-full rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-fill-quaternary)] p-3.5 flex flex-col justify-between">
      <div>
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-xs font-semibold text-[var(--ant-color-text)]">
            <span className="text-[var(--ant-color-primary)]">{icon}</span>
            <span>{title}</span>
          </div>
          <ComponentStatusTag status={props.component.status} />
        </div>

        <div className="mt-2 text-xs text-[var(--ant-color-text-secondary)] leading-relaxed">
          {props.component.message ?? defaultComponentDescription(props.component)}
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-[var(--ant-color-split)] pt-2 text-[11px] text-[var(--ant-color-text-tertiary)] font-mono">
        <span className="truncate flex-1" title={props.component.path}>
          {props.component.path}
        </span>
        {props.component.manualContent && (
          <Button
            type="link"
            size="small"
            icon={<CopyOutlined />}
            onClick={() => void props.onCopy(props.component.manualContent!)}
            className="p-0! h-auto text-xs shrink-0"
          >
            复制规则
          </Button>
        )}
      </div>
    </div>
  )
}

function OverallTag({ status }: { status: AgentIntegrationStatus['overall'] }): React.JSX.Element {
  if (status === 'ready') return <Tag color="success">已就绪</Tag>
  if (status === 'partial') return <Tag color="processing">部分接入</Tag>
  if (status === 'attention') return <Tag color="warning">需处理</Tag>
  return <Tag color="default">未接入</Tag>
}

function ComponentStatusTag({
  status
}: {
  status: AgentIntegrationComponentState['status']
}): React.JSX.Element {
  if (status === 'current')
    return (
      <Tag color="success" icon={<CheckCircleFilled />}>
        最新
      </Tag>
    )
  if (status === 'outdated') return <Tag color="processing">可更新</Tag>
  if (status === 'conflict') return <Tag color="error">存在冲突</Tag>
  if (status === 'manual') return <Tag color="warning">需手动</Tag>
  return <Tag color="default">未配置</Tag>
}

function defaultComponentDescription(component: AgentIntegrationComponentState): string {
  if (component.component === 'skill') {
    return component.status === 'current'
      ? 'use-loci skill 指令已部署，支持智能查阅本地文档库'
      : '未安装 use-loci skill，点击一键接入完成部署'
  }
  return component.status === 'current'
    ? '全局 Rules 规则已配置，提示 Agent 优先通过 loci 查询本地文档'
    : '未注入全局 Rules，点击一键接入自动写入'
}

function overallDescription(status: AgentIntegrationStatus): string {
  if (status.overall === 'attention') return '部分配置存在冲突或需手动确认'
  if (status.overall === 'partial') return '已完成部分配置，可点击一键接入补全'
  return '未接入 Loci，点击一键接入快速配置 Skill 与 Rules'
}
