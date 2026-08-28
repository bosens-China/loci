import { useMemo, useState } from 'react'
import type { CloudLibrary, DocumentSource } from '@loci/shared'
import { useMutation, useQuery } from '@tanstack/react-query'
import { App, Button, Card, Empty, Radio, Select, Tag, Typography } from 'antd'
import { CloudUploadOutlined, GithubOutlined, GlobalOutlined } from '@ant-design/icons'
import { publishAdminLibrary } from '@/api/admin'
import { listSources } from '@/api/sources'
import { formatBytes } from '@/utils/format'

/** 发布面板：将本地收录的文档库发布为 Server 上的公开文档库。 */
export function AdminPublishPanel({ libraries }: { libraries: CloudLibrary[] }): React.JSX.Element {
  const { message, modal } = App.useApp()
  const sources = useQuery({ queryKey: ['sources'], queryFn: listSources })
  const [selected, setSelected] = useState<string | null>(null)
  const [mode, setMode] = useState<'create' | 'replace'>('create')
  const [target, setTarget] = useState<string>()
  const localSources = useMemo(
    () => (sources.data ?? []).filter((source) => !source.cloud && source.pages > 0),
    [sources.data]
  )
  const publish = useMutation({
    mutationFn: () =>
      publishAdminLibrary(selected!, {
        mode,
        ...(mode === 'replace' && target ? { targetLibraryId: target } : {})
      }),
    onSuccess: (result) => {
      void message.success(
        result.reused
          ? `已复用发布结果：${result.library.name}`
          : `已发布 ${result.pages} 篇文档：${result.library.name}`
      )
    },
    onError: (error: Error) => void message.error(error.message)
  })

  const confirm = (): void => {
    const source = localSources.find((item) => item.id === selected)
    const targetLibrary = libraries.find((item) => item.id === target)
    if (!source || (mode === 'replace' && !targetLibrary)) return
    modal.confirm({
      title:
        mode === 'create'
          ? `把“${source.name}”发布为新的公开文档库？`
          : `用“${source.name}”覆盖“${targetLibrary?.name}”？`,
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
    <Card
      title="发布本地文档库"
      extra={
        <Typography.Text type="secondary" className="text-xs">
          使用带校验的压缩归档上传；创建与覆盖必须显式确认
        </Typography.Text>
      }
    >
      {localSources.length ? (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {localSources.map((source) => (
              <SourceCard
                key={source.id}
                source={source}
                selected={selected === source.id}
                onSelect={() => setSelected(source.id)}
              />
            ))}
          </div>
          <Card size="small" className="mt-4">
            <div className="flex flex-col gap-3 md:flex-row md:items-center">
              <Radio.Group
                value={mode}
                onChange={(event) => setMode(event.target.value as 'create' | 'replace')}
                options={[
                  { label: '创建新库', value: 'create' },
                  { label: '覆盖现有库', value: 'replace' }
                ]}
              />
              {mode === 'replace' && (
                <Select
                  className="min-w-60 flex-1"
                  placeholder="选择要覆盖的 Server 文档库"
                  value={target}
                  onChange={setTarget}
                  options={libraries.map((library) => ({
                    value: library.id,
                    label: `${library.name} · ${library.hostname}`
                  }))}
                />
              )}
              <Button
                type="primary"
                danger={mode === 'replace'}
                icon={<CloudUploadOutlined />}
                disabled={!selected || (mode === 'replace' && !target)}
                loading={publish.isPending}
                onClick={confirm}
              >
                发布到 Server
              </Button>
            </div>
          </Card>
        </>
      ) : (
        <Empty className="py-12" description="暂无包含正文的本地文档库" />
      )}
    </Card>
  )
}

function SourceCard(props: {
  source: DocumentSource
  selected: boolean
  onSelect: () => void
}): React.JSX.Element {
  const isGithub = props.source.kind === 'github'
  return (
    <Card
      hoverable
      size="small"
      className={`cursor-pointer transition-all duration-200 ${
        props.selected
          ? 'border-[var(--ant-color-primary)]! bg-[var(--ant-color-primary-bg-hover)]!'
          : 'hover:border-[var(--ant-color-primary)]'
      }`}
      onClick={props.onSelect}
    >
      <div className="flex items-start justify-between gap-2">
        <Typography.Text strong className="block truncate text-sm flex-1">
          {props.source.name}
        </Typography.Text>
        <Tag
          className="m-0! text-[10px]"
          icon={isGithub ? <GithubOutlined /> : <GlobalOutlined />}
          color={isGithub ? undefined : 'blue'}
        >
          {isGithub ? 'GitHub' : '站点'}
        </Tag>
      </div>
      <div className="mt-2 flex items-center gap-2 text-xs text-[var(--ant-color-text-secondary)]">
        <span>📄 {props.source.pages} 篇</span>
        <span>·</span>
        <span>💾 {formatBytes(props.source.contentSize)}</span>
      </div>
      <Typography.Text type="secondary" className="mt-1 block truncate font-mono text-[11px]">
        {props.source.url}
      </Typography.Text>
    </Card>
  )
}
