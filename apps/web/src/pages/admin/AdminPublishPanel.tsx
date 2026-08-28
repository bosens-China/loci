import { useState } from 'react'
import type { CloudLibrary, CloudLibraryPublishResult, DocumentSource } from '@loci/shared'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Alert, App, Button, Card, Divider, Radio, Select, Tag, Typography } from 'antd'
import {
  ArrowRightOutlined,
  CloudOutlined,
  CloudUploadOutlined,
  GithubOutlined,
  GlobalOutlined
} from '@ant-design/icons'
import { publishAdminLibrary } from '@/api/admin'
import { ADMIN_LIBRARIES_KEY } from '@/pages/admin/admin-query-keys'
import { formatBytes } from '@/utils/format'

interface AdminPublishPanelProps {
  source: DocumentSource
  libraries: CloudLibrary[]
  librariesLoading: boolean
  serverUrl: string
  onOpenLibraries: () => void
}

/** 发布面板：明确展示本地来源、目标 Server 与覆盖范围，避免跨工作区迷失。 */
export function AdminPublishPanel(props: AdminPublishPanelProps): React.JSX.Element {
  const { message, modal } = App.useApp()
  const client = useQueryClient()
  const [mode, setMode] = useState<'create' | 'replace'>('create')
  const [target, setTarget] = useState<string>()
  const [published, setPublished] = useState<CloudLibraryPublishResult>()
  const targetLibrary = props.libraries.find((item) => item.id === target)
  const serverName = displayServerName(props.serverUrl)
  const destination =
    mode === 'create'
      ? `在 ${serverName} 创建新的公开库`
      : `覆盖 ${targetLibrary?.name ?? '目标公开库'}`

  const publish = useMutation({
    mutationFn: () =>
      publishAdminLibrary(props.source.id, {
        mode,
        ...(mode === 'replace' && target ? { targetLibraryId: target } : {})
      }),
    onSuccess: (result) => {
      setPublished(result)
      void client.invalidateQueries({ queryKey: ADMIN_LIBRARIES_KEY })
      void message.success(
        result.reused
          ? `已复用发布结果：${result.library.name}`
          : `已发布 ${result.pages} 篇文档：${result.library.name}`
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const confirm = (): void => {
    if (mode === 'replace' && !targetLibrary) return
    modal.confirm({
      title:
        mode === 'create'
          ? `把“${props.source.name}”发布为新的公开文档库？`
          : `用“${props.source.name}”覆盖“${targetLibrary?.name ?? '目标公开库'}”？`,
      content:
        mode === 'create'
          ? '将只上传该文档库的公开元数据与正文 ZIP，不包含设置、凭据和任务历史。'
          : '目标 Server 文档库的正文和公开快照会被事务性替换；失败时保留旧版本。',
      okText: mode === 'create' ? '确认发布' : '确认覆盖',
      okButtonProps: { danger: mode === 'replace' },
      cancelText: '返回',
      onOk: () => publish.mutateAsync()
    })
  }

  return (
    <Card className="border-[var(--ant-color-border-secondary)] shadow-xs">
      <div className="grid items-stretch gap-3 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-5">
        <TransferEndpoint
          eyebrow="发布来源"
          icon={props.source.kind === 'github' ? <GithubOutlined /> : <GlobalOutlined />}
          name={props.source.name}
          detail={props.source.url}
          metadata={`${props.source.pages} 篇正文 · ${formatBytes(props.source.contentSize)}`}
          tag={props.source.kind === 'github' ? 'GitHub' : '本地站点'}
        />
        <div className="flex items-center justify-center text-lg text-[var(--ant-color-primary)]">
          <ArrowRightOutlined className="hidden lg:block" />
          <span className="lg:hidden">↓</span>
        </div>
        <TransferEndpoint
          eyebrow="发布目标"
          icon={<CloudOutlined />}
          name={serverName}
          detail="Loci Server · 公开文档库"
          metadata={destination}
          tag="公开分发"
        />
      </div>

      <Divider className="my-5!" />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div>
          <Typography.Text strong>发布方式</Typography.Text>
          <Typography.Paragraph type="secondary" className="mb-3! mt-1! text-xs">
            创建会保留现有公开库；覆盖会原子替换目标库的正文与公开快照。
          </Typography.Paragraph>
          <Radio.Group
            value={mode}
            onChange={(event) => {
              const nextMode = event.target.value as 'create' | 'replace'
              setMode(nextMode)
              if (nextMode === 'create') setTarget(undefined)
            }}
            options={[
              { label: '创建新的公开库', value: 'create' },
              {
                label: '覆盖已有公开库',
                value: 'replace',
                disabled: props.librariesLoading || props.libraries.length === 0
              }
            ]}
          />
        </div>

        <div>
          <Typography.Text strong>目标公开库</Typography.Text>
          <Typography.Paragraph type="secondary" className="mb-3! mt-1! text-xs">
            {mode === 'create'
              ? '将使用当前本地库创建新的公开库。'
              : '选择需要更新的 Server 文档库。'}
          </Typography.Paragraph>
          {mode === 'replace' ? (
            <Select
              className="w-full"
              loading={props.librariesLoading}
              placeholder="选择要覆盖的 Server 文档库"
              value={target}
              onChange={setTarget}
              options={props.libraries.map((library) => ({
                value: library.id,
                label: `${library.name} · ${library.hostname}`
              }))}
            />
          ) : (
            <Tag color="blue" className="m-0!">
              新建：{props.source.name}
            </Tag>
          )}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-4 rounded-lg bg-[var(--ant-color-fill-quaternary)] px-4 py-3">
        <div className="min-w-0">
          <Typography.Text strong className="block">
            准备发布 {props.source.pages} 篇文档
          </Typography.Text>
          <Typography.Text type="secondary" className="text-xs">
            {destination}
          </Typography.Text>
        </div>
        <Button
          type="primary"
          danger={mode === 'replace'}
          icon={<CloudUploadOutlined />}
          disabled={mode === 'replace' && !target}
          loading={publish.isPending}
          onClick={confirm}
        >
          {mode === 'create' ? '确认发布' : '确认覆盖并发布'}
        </Button>
      </div>

      {published && (
        <Alert
          className="mt-4"
          type="success"
          showIcon
          message={published.reused ? `已复用“${published.library.name}”的发布结果` : '发布完成'}
          description={`“${published.library.name}”现已作为 Server 公开库提供 ${published.pages} 篇文档。`}
          action={
            <Button size="small" onClick={props.onOpenLibraries}>
              查看 Server 文档库
            </Button>
          }
        />
      )}
    </Card>
  )
}

function TransferEndpoint(props: {
  eyebrow: string
  icon: React.ReactNode
  name: string
  detail: string
  metadata: string
  tag: string
}): React.JSX.Element {
  return (
    <div className="rounded-lg border border-[var(--ant-color-border-secondary)] bg-[var(--ant-color-bg-container)] p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-[var(--ant-color-primary-bg)] text-[var(--ant-color-primary)]">
            {props.icon}
          </div>
          <div className="min-w-0">
            <Typography.Text type="secondary" className="block text-xs">
              {props.eyebrow}
            </Typography.Text>
            <Typography.Text strong className="block truncate" title={props.name}>
              {props.name}
            </Typography.Text>
          </div>
        </div>
        <Tag color="blue" className="m-0! shrink-0 text-[11px]">
          {props.tag}
        </Tag>
      </div>
      <Typography.Text
        type="secondary"
        className="mt-3 block truncate font-mono text-[11px]"
        title={props.detail}
      >
        {props.detail}
      </Typography.Text>
      <Typography.Text type="secondary" className="mt-1 block text-xs">
        {props.metadata}
      </Typography.Text>
    </div>
  )
}

function displayServerName(serverUrl: string): string {
  try {
    return new URL(serverUrl).host
  } catch {
    return serverUrl
  }
}
